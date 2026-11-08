import { existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOMParser, XMLSerializer, type Element } from '@xmldom/xmldom';
import { digest, literary, metadata, readAssets, replaceTree, root, traditional, workspace, type Files } from './layout.ts';

const manifest = '.workspace.json';
const manifestPath = join(root, workspace, manifest);
const lockPath = join(root, '.lzh-workspace.lock');
const serializer = new XMLSerializer();

type Manifest = {
  baseline: string;
  authored: string;
  snapshot: string;
};

function isEntries(path: string): boolean {
  return /^[^/]+\/(?:Keyed|DefInjected)\/.+\.xml$/i.test(path);
}

function parseEntries(data: Buffer, path: string) {
  const document = new DOMParser({
    onError(_level, message) {
      throw new Error(`${path}：${message}`);
    },
  }).parseFromString(data.toString('utf8').replace(/^\uFEFF/, ''), 'application/xml');
  if (document.doctype || document.documentElement?.tagName !== 'LanguageData') {
    throw new Error(`${path} 必须以 LanguageData 为根元素，且不能包含 DTD。`);
  }

  const entries = new Map<string, Element>();
  for (const child of Array.from(document.documentElement.childNodes)) {
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    const key = element.tagName === 'rep' && path.includes('/DefInjected/')
      ? element.getElementsByTagName('path').item(0)?.textContent?.trim()
      : element.tagName;
    if (!key || entries.has(key)) throw new Error(`${path} 有空键或重复键：${key}`);
    entries.set(key, element);
  }
  return { document, entries };
}

function comparable(element: Element): unknown {
  const nodes = Array.from(element.childNodes);
  const hasElements = nodes.some(node => node.nodeType === 1);
  const contents: unknown[] = [];
  for (const node of nodes) {
    if (node.nodeType === 1) {
      contents.push(comparable(node as Element));
    } else if (node.nodeType === 3 || node.nodeType === 4) {
      const value = node.nodeValue ?? '';
      if (hasElements && node.nodeType === 3 && /\n/.test(value) && !value.trim()) continue;
      const previous = contents.at(-1);
      if (typeof previous === 'string') {
        contents[contents.length - 1] = previous + value;
      } else {
        contents.push(value);
      }
    }
  }
  return [element.tagName, Array.from(element.attributes, attr => [attr.name, attr.value]).sort(), contents];
}

function sameEntry(base: Element | undefined, translation: Element): boolean {
  return base !== undefined && JSON.stringify(comparable(base)) === JSON.stringify(comparable(translation));
}

function isPlaceholder(element: Element): boolean {
  const value = element.tagName === 'rep'
    ? element.getElementsByTagName('trans').item(0)
    : element;
  return value?.textContent === 'TODO' && !Array.from(value.childNodes).some(node => node.nodeType === 1);
}

function mergeEntries(base: Buffer, overlay: Buffer, path: string): Buffer {
  const { document, entries } = parseEntries(base, path);
  const translation = parseEntries(overlay, path);
  const rootElement = document.documentElement!;
  for (const [key, element] of translation.entries) {
    const imported = document.importNode(element, true);
    const original = entries.get(key);
    if (original) {
      rootElement.replaceChild(imported, original);
    } else {
      rootElement.appendChild(document.createTextNode('  '));
      rootElement.appendChild(imported);
      rootElement.appendChild(document.createTextNode('\n'));
    }
  }
  return Buffer.from(serializer.serializeToString(document));
}

function sparseEntries(edited: Buffer, base: Buffer | undefined, path: string): Buffer | undefined {
  const { entries } = parseEntries(edited, path);
  const original = base && parseEntries(base, path).entries;
  const changes = [...entries].filter(([key, element]) =>
    !isPlaceholder(element) && !sameEntry(original?.get(key), element));
  if (changes.length === 0) return undefined;

  const xml = changes.map(([, element]) => `  ${serializer.serializeToString(element)}`).join('\n');
  return Buffer.from(`<?xml version="1.0" encoding="utf-8"?>\n<LanguageData>\n${xml}\n</LanguageData>\n`);
}

function sameFile(data: Buffer, base: Buffer | undefined, path: string): boolean {
  if (!base) return false;
  if (/\.txt$/i.test(path)) {
    const text = (file: Buffer) => file.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    return text(data) === text(base);
  }
  return data.equals(base);
}

function readManifest(): Manifest {
  if (!existsSync(manifestPath)) throw new Error('请先运行 npm run workspace:generate。');
  if (!lstatSync(manifestPath).isFile()) throw new Error('工作区的状态文件必须是普通文件。');
  return JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
}

function manifestBytes(value: Manifest): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n');
}

function main(): void {
  const [action, option, ...extra] = process.argv.slice(2);
  const generate = action === 'generate';
  if ((!generate && action !== 'export') || (option && (!generate || option !== '--force')) || extra.length) {
    throw new Error('用法：npm run workspace:generate [-- --force] 或 npm run workspace:export');
  }

  const baseline = readAssets(traditional);
  if (!baseline.has(metadata)) throw new Error('请先运行 git submodule update --init。');
  const authored = readAssets(literary);
  if (!authored.has(metadata)) throw new Error(`${literary} 缺少 ${metadata}。`);
  const baselineHash = digest(baseline);
  const authoredHash = digest(authored);

  if (generate) {
    if (existsSync(join(root, workspace)) && option !== '--force') {
      if (!existsSync(manifestPath) || digest(readAssets(workspace)) !== readManifest().snapshot) {
        throw new Error('工作区有未回写的改动。请先回写，或用 --force 重新生成。');
      }
    }

    const files: Files = new Map(baseline);
    for (const [path, data] of authored) {
      const base = baseline.get(path);
      files.set(path, base && isEntries(path) ? mergeEntries(base, data, path) : data);
    }
    files.set(manifest, manifestBytes({ baseline: baselineHash, authored: authoredHash, snapshot: digest(files) }));
    replaceTree(workspace, files);
    console.log(`已生成 ${workspace}。`);
    return;
  }

  const saved = readManifest();
  if (saved.baseline !== baselineHash || saved.authored !== authoredHash) {
    throw new Error('繁中底稿或文言目录在生成工作区后已更改。请保留工作区中的改动并重新生成后再回写。');
  }

  const edited = readAssets(workspace);
  if (!edited.has(metadata)) throw new Error(`工作区缺少 ${metadata}。`);
  const sparse: Files = new Map();
  for (const [path, data] of edited) {
    const base = baseline.get(path);
    const translation = isEntries(path)
      ? sparseEntries(data, base, path)
      : path === metadata || !sameFile(data, base, path) ? data : undefined;
    if (translation) sparse.set(path, translation);
  }
  replaceTree(literary, sparse);
  writeFileSync(manifestPath, manifestBytes({ ...saved, authored: digest(sparse), snapshot: digest(edited) }));
  console.log(`已回写 ${sparse.size} 个文件到 ${literary}（含语言元数据）。`);
}

try {
  try {
    mkdirSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('已有工作区命令在运行。确认没有命令在运行后，可移除 .lzh-workspace.lock 再重试。');
    }
    throw error;
  }
  try {
    main();
  } finally {
    rmdirSync(lockPath);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
