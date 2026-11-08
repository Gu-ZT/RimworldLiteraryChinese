import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

export const root = realpathSync(join(import.meta.dirname, '..'));
export const packs = ['Core', 'Royalty', 'Ideology', 'Biotech', 'Anomaly', 'Odyssey'];
export const traditional = 'RimWorld-ChineseTraditional';
export const literary = 'RimWorld-LiteraryChinese';
export const workspace = 'RimWorld-LiteraryChineseWorkspace';
export const metadata = 'Core/LanguageInfo.xml';

export type Files = Map<string, Buffer>;

function isAsset(path: string): boolean {
  return /^(?:Keyed|DefInjected|Backstories)\/.+\.xml$/i.test(path)
    || /^(?:Strings|WordInfo)\/.+\.txt$/i.test(path);
}

export function readAssets(tree: string): Files {
  const files: Files = new Map();
  const base = join(root, tree);
  if (existsSync(base) && !lstatSync(base).isDirectory()) {
    throw new Error(`语言目录必须是普通目录：${base}`);
  }

  function walk(pack: string, relative = ''): void {
    const dir = join(base, pack, relative);
    if (!existsSync(dir)) return;
    if (!lstatSync(dir).isDirectory()) throw new Error(`语言目录必须是普通目录：${dir}`);

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`语言目录中存在符号链接：${join(dir, entry.name)}`);
      if (entry.isDirectory()) {
        walk(pack, path);
      } else if (entry.isFile() && (isAsset(path) ||
          (pack === 'Core' && (path === 'LanguageInfo.xml' || path === 'LangIcon.png')))) {
        files.set(`${pack}/${path}`, readFileSync(join(dir, entry.name)));
      }
    }
  }

  for (const pack of packs) walk(pack);
  return files;
}

export function digest(files: Files): string {
  const hash = createHash('sha256');
  for (const path of [...files.keys()].sort()) {
    hash.update(JSON.stringify(path));
    hash.update(createHash('sha256').update(files.get(path)!).digest());
  }
  return hash.digest('hex');
}

export function replaceTree(tree: typeof literary | typeof workspace, files: Files): void {
  const target = join(root, tree);
  const hadTarget = existsSync(target);
  if (hadTarget && (!lstatSync(target).isDirectory() || realpathSync(target) !== target)) {
    throw new Error(`无法替换此目录：${target}`);
  }

  if (hadTarget) {
    const known = readAssets(tree);
    for (const entry of readdirSync(target, { recursive: true, withFileTypes: true })) {
      const path = relative(target, join(entry.parentPath, entry.name)).split(sep).join('/');
      if (!entry.isDirectory() && !known.has(path) &&
          !(tree === workspace && path === '.workspace.json' && entry.isFile())) {
        throw new Error(`替换前请先移出脚本无法识别的文件：${join(target, path)}`);
      }
    }
  }

  const temp = mkdtempSync(join(root, '.lzh-tmp-'));
  const next = join(temp, 'next');
  const previous = join(temp, 'previous');
  let keepBackup = false;
  try {
    mkdirSync(next);
    for (const [path, data] of files) {
      const file = join(next, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
    }

    if (hadTarget) renameSync(target, previous);
    try {
      renameSync(next, target);
    } catch (error) {
      if (hadTarget) {
        keepBackup = true;
        renameSync(previous, target);
        keepBackup = false;
      }
      throw error;
    }
  } finally {
    // If rollback failed, preserve the previous directory for recovery.
    if (!keepBackup && dirname(realpathSync(temp)) === root) {
      rmSync(temp, { recursive: true });
    }
  }
}
