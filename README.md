# RimworldLiteraryChinese

为《边缘世界》1.7 新增 **文言（華夏）**（`lzh`）。游戏优先使用文言包，缺失的 `Keyed` 键、`DefInjected` 字段和 `Strings` 文件从已启用内容的繁体中文译文补齐。

## 翻译工作流

需要 Node.js 24.12+ 和 Git。首次使用时初始化繁中子模块并安装脚本依赖。

```powershell
git submodule update --init
npm ci
npm run workspace:generate
```

- `RimWorld-ChineseTraditional/` 固定到 [Ludeon 的官方繁中翻译项目](https://github.com/Ludeon/RimWorld-ChineseTraditional)。它提供本体及 Royalty、Ideology、Biotech、Anomaly、Odyssey 的编辑底稿。
- `RimWorld-LiteraryChineseWorkspace/` 由脚本生成。到对应的 `Core/` 或 DLC 目录编辑译文，保留文件相对路径和 XML 键名。
- `npm run workspace:export` 将与繁中不同的 Keyed 和 DefInjected 条目逐条回写到 `RimWorld-LiteraryChinese/`。`TODO` 会留在工作区。`Strings` 按文件比较和回写，改了一行也会带上该文件的其余行，因为游戏按整份列表加载。
- 从工作区删除文言条目，或把它改回繁中，即可在回写时移除该译文。生成命令会保护未回写的修改。明确需要丢弃修改时，使用 `npm run workspace:generate -- --force`。

子模块当前标注适配 1.6.4607。工作区以该提交为底稿，游戏内的回退则来自实际安装并启用的 1.7 内容。回写前请保持子模块和文言目录与生成工作区时一致。

## 打包模组

需要 .NET 10 SDK。在 PowerShell 中可用 `$env:DOTNET` 指定 SDK 的 `dotnet.exe`。

```powershell
npm run package
```

输出为 `dist/RimworldLiteraryChinese.zip`。包内包含模组元数据、回退 DLL 和 `RimWorld-LiteraryChinese/` 中的语言资源。带有译文的 DLC 会生成对应的条件加载配置。

将 ZIP 中的模组目录解压到游戏的 `Mods/`，启用适用于 1.7 的 [Harmony 3](https://github.com/pardeike/HarmonyRimWorld) 和「文言（華夏）」。重启后在语言列表中选择 `lzh (文言（華夏）)`。
