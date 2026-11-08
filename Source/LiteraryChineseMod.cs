using System;
using System.Collections.Generic;
using System.Linq;
using HarmonyLib;
using Verse;

namespace RimworldLiteraryChinese;

public sealed class LiteraryChineseMod : Mod
{
    public LiteraryChineseMod(ModContentPack content) : base(content)
    {
        new Harmony("literarychinese.rimworld").PatchAll(typeof(LiteraryChineseMod).Assembly);
    }

    private static LoadedLanguage? LoadFallback(LoadedLanguage language)
    {
        if (language.LegacyFolderName != "lzh" || language != LanguageDatabase.activeLanguage)
        {
            return null;
        }

        var fallback = LanguageDatabase.AllLoadedLanguages
            .FirstOrDefault(candidate => candidate.LegacyFolderName == "ChineseTraditional");
        fallback?.LoadData();
        return fallback;
    }

    [HarmonyPatch(typeof(LoadedLanguage), nameof(LoadedLanguage.LoadData))]
    private static class TextFallback
    {
        private static void Prefix(bool ___dataIsLoaded, out bool __state)
        {
            __state = !___dataIsLoaded;
        }

        private static void Postfix(LoadedLanguage __instance, bool __state)
        {
            if (!__state || LoadFallback(__instance) is not { } fallback)
            {
                return;
            }

            foreach (var (key, translation) in fallback.keyedReplacements)
            {
                if (!translation.isPlaceholder &&
                    (!__instance.keyedReplacements.TryGetValue(key, out var current) || current.isPlaceholder))
                {
                    __instance.keyedReplacements[key] = translation;
                }
            }

            foreach (var (path, lines) in fallback.stringFiles)
            {
                __instance.stringFiles.TryAdd(path, lines);
            }
        }
    }

    [HarmonyPatch(typeof(LoadedLanguage), nameof(LoadedLanguage.InjectIntoData_BeforeImpliedDefs))]
    private static class DefFallback
    {
        private static void Prefix(LoadedLanguage __instance)
        {
            if (LoadFallback(__instance) is not { } fallback)
            {
                return;
            }

            // TKey mappings are ready by the first injection pass.
            __instance.LoadData();
            var packages = __instance.defInjections.ToDictionary(package => package.defType);
            foreach (var source in fallback.defInjections)
            {
                if (source.injections.Count == 0)
                {
                    continue;
                }

                if (!packages.TryGetValue(source.defType, out var destination))
                {
                    destination = new DefInjectionPackage(source.defType);
                    packages.Add(source.defType, destination);
                    __instance.defInjections.Add(destination);
                }

                Merge(destination, source);
            }
        }

        private static void Merge(DefInjectionPackage destination, DefInjectionPackage source)
        {
            var occupied = new Dictionary<string, (string Key, DefInjectionPackage.DefInjection Entry)>();
            foreach (var (key, entry) in destination.injections)
            {
                var path = Normalize(key);
                if (!entry.isPlaceholder || !occupied.ContainsKey(path))
                {
                    occupied[path] = (key, entry);
                }
            }

            foreach (var (key, entry) in source.injections)
            {
                var path = Normalize(key);
                if (entry.isPlaceholder ||
                    (occupied.TryGetValue(path, out var current) && !current.Entry.isPlaceholder) ||
                    ConflictsWithList(path, entry.IsFullListInjection, occupied))
                {
                    continue;
                }

                if (current.Entry is not null && current.Key != key)
                {
                    destination.injections.Remove(current.Key);
                }

                // The game records the result of injection on each entry.
                var copy = new DefInjectionPackage.DefInjection
                {
                    path = entry.path,
                    nonBackCompatiblePath = entry.nonBackCompatiblePath,
                    injection = entry.injection,
                    fullListInjection = entry.fullListInjection is null ? null : new List<string>(entry.fullListInjection),
                    fullListInjectionComments = entry.fullListInjectionComments,
                    fileSource = entry.fileSource
                };
                destination.injections[key] = copy;
                occupied[path] = (key, copy);
            }
        }

        private static bool ConflictsWithList(
            string path, bool wholeList,
            Dictionary<string, (string Key, DefInjectionPackage.DefInjection Entry)> occupied)
        {
            if (wholeList && occupied.Any(pair =>
                !pair.Value.Entry.isPlaceholder && pair.Key.StartsWith(path + ".", StringComparison.Ordinal)))
            {
                return true;
            }

            for (var dot = path.LastIndexOf('.'); dot > 0; dot = path.LastIndexOf('.', dot - 1))
            {
                if (occupied.TryGetValue(path[..dot], out var parent) && parent.Entry.IsFullListInjection)
                {
                    return true;
                }
            }

            return false;
        }

        private static string Normalize(string path)
        {
            return TKeySystem.TryGetNormalizedPath(path, out var normalized) ? normalized : path;
        }
    }
}
