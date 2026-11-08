import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { literary, metadata, packs, readAssets, root } from './layout.ts';

const modFolder = 'RimworldLiteraryChinese';
const language = 'lzh (文言（華夏）)';

function main(): void {
  const translations = readAssets(literary);
  if (!translations.has(metadata)) throw new Error(`${literary} 缺少 ${metadata}。`);

  const build = spawnSync(process.env.DOTNET || 'dotnet', [
    'build', 'Source/RimworldLiteraryChinese.csproj', '-c', 'Release', '--nologo',
  ], { cwd: root, stdio: 'inherit' });
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error('构建失败。请使用 .NET 10 SDK，或用 DOTNET 指定其可执行文件。');

  const files: Record<string, Uint8Array> = {};
  const include = (path: string, data: Uint8Array) => { files[`${modFolder}/${path}`] = data; };
  for (const path of ['About/About.xml', 'Assemblies/RimworldLiteraryChinese.dll']) {
    include(path, readFileSync(join(root, path)));
  }

  const dlc = new Set<string>();
  for (const [path, data] of translations) {
    const [pack, category, ...parts] = path.split('/');
    const relative = [category, ...parts];
    let prefix = '';
    if (pack !== 'Core') {
      dlc.add(pack);
      prefix = `DLC/${pack}/`;
      // Within one mod RimWorld deduplicates translation files by relative path.
      if (category === 'Keyed') relative.splice(1, 0, pack);
      if (category === 'DefInjected') relative.splice(2, 0, pack);
    }
    include(`${prefix}Languages/${language}/${relative.join('/')}`, data);
  }

  const loadFolders = packs.toReversed().filter(pack => dlc.has(pack)).map(pack =>
    `    <li IfModActive="ludeon.rimworld.${pack.toLowerCase()}">DLC/${pack}</li>`);
  include('LoadFolders.xml', Buffer.from([
    '<?xml version="1.0" encoding="utf-8"?>',
    '<loadFolders>',
    '  <v1.7>',
    ...loadFolders,
    '    <li>/</li>',
    '  </v1.7>',
    '</loadFolders>',
    '',
  ].join('\n')));

  const out = join(root, 'dist');
  mkdirSync(out, { recursive: true });
  const destination = join(out, `${modFolder}.zip`);
  const pending = join(out, `.${modFolder}.${process.pid}.zip`);
  writeFileSync(pending, zipSync(files));
  renameSync(pending, destination);
  console.log(`已打包 ${destination}。`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
