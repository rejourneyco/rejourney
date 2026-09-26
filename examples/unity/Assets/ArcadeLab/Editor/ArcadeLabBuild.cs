using System;
using System.IO;
using System.IO.Compression;
using System.Collections.Generic;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.UIElements;

public static class ArcadeLabBuild
{
    [MenuItem("Rejourney/Prepare Arcade Lab")]
    public static void Prepare()
    {
        Directory.CreateDirectory("Assets/ArcadeLab/Generated");
        // Editor package samples can satisfy Resources.Load without putting TMP's
        // settings in the player. Require the imported project assets explicitly.
        const string tmpSettings = "Assets/TextMesh Pro/Resources/TMP Settings.asset";
        const string tmpFont = "Assets/TextMesh Pro/Resources/Fonts & Materials/LiberationSans SDF.asset";
        if (!AssetDatabase.LoadAssetAtPath<TMPro.TMP_Settings>(tmpSettings) || !AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>(tmpFont)) {
            var ugui = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(TMPro.TMP_Text).Assembly);
            ImportTmpResources(Path.Combine(ugui.resolvedPath, "Package Resources/TMP Essential Resources.unitypackage"));
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        }
        if (!AssetDatabase.LoadAssetAtPath<TMPro.TMP_Settings>(tmpSettings) || !AssetDatabase.LoadAssetAtPath<TMPro.TMP_FontAsset>(tmpFont))
            throw new BuildFailedException("Arcade Lab requires the imported TextMesh Pro settings and font assets.");
        Directory.CreateDirectory("Assets/Resources");
        foreach (var entry in new[] { ("ArcadeURP", "Universal Render Pipeline/Lit"), ("ArcadeBuiltin", "Standard") }) {
            var materialPath = "Assets/Resources/" + entry.Item1 + ".mat";
            if (!AssetDatabase.LoadAssetAtPath<Material>(materialPath)) AssetDatabase.CreateAsset(new Material(Shader.Find(entry.Item2)), materialPath);
        }
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        new GameObject("Arcade Lab").AddComponent<ArcadeLab>();
        EditorSceneManager.SaveScene(scene, "Assets/ArcadeLab/Generated/ArcadeLab.unity");
        EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        var fixture = GameObject.CreatePrimitive(PrimitiveType.Cube); fixture.name = "Additive scene marker"; fixture.transform.position = new Vector3(0, 3, 0);
        fixture.GetComponent<Renderer>().sharedMaterial = Resources.Load<Material>(Environment.GetEnvironmentVariable("REJOURNEY_PIPELINE") == "builtin" ? "ArcadeBuiltin" : "ArcadeURP");
        EditorSceneManager.SaveScene(UnityEngine.SceneManagement.SceneManager.GetActiveScene(), "Assets/ArcadeLab/Generated/AdditiveFixture.unity");
        EditorSceneManager.OpenScene("Assets/ArcadeLab/Generated/ArcadeLab.unity");
        EditorBuildSettings.scenes = new[] {
            new EditorBuildSettingsScene("Assets/ArcadeLab/Generated/ArcadeLab.unity", true),
            new EditorBuildSettingsScene("Assets/ArcadeLab/Generated/AdditiveFixture.unity", true)
        };
        var renderer = ScriptableObject.CreateInstance<UniversalRendererData>();
        var rendererPath = "Assets/ArcadeLab/Generated/ArcadeRenderer.asset";
        if (!AssetDatabase.LoadAssetAtPath<UniversalRendererData>(rendererPath)) AssetDatabase.CreateAsset(renderer, rendererPath);
        else UnityEngine.Object.DestroyImmediate(renderer);
        var pipeline = UniversalRenderPipelineAsset.Create(AssetDatabase.LoadAssetAtPath<UniversalRendererData>(rendererPath));
        var pipelinePath = "Assets/ArcadeLab/Generated/ArcadePipeline.asset";
        if (!AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(pipelinePath)) AssetDatabase.CreateAsset(pipeline, pipelinePath);
        else UnityEngine.Object.DestroyImmediate(pipeline);
        GraphicsSettings.defaultRenderPipeline = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(pipelinePath);
        QualitySettings.renderPipeline = GraphicsSettings.defaultRenderPipeline;
        if (Environment.GetEnvironmentVariable("REJOURNEY_PIPELINE") == "builtin") {
            GraphicsSettings.defaultRenderPipeline = null; QualitySettings.renderPipeline = null;
        }
        Directory.CreateDirectory("Assets/Resources");
        const string themePath = "Assets/ArcadeLab/Generated/ArcadeTheme.tss";
        File.WriteAllText(themePath, "@import url(\"unity-theme://default\");\n");
        AssetDatabase.ImportAsset(themePath);
        const string panelPath = "Assets/Resources/ArcadePanel.asset";
        var settings = AssetDatabase.LoadAssetAtPath<PanelSettings>(panelPath);
        if (!settings) { settings = ScriptableObject.CreateInstance<PanelSettings>(); AssetDatabase.CreateAsset(settings, panelPath); }
        settings.themeStyleSheet = AssetDatabase.LoadAssetAtPath<ThemeStyleSheet>(themePath);
        settings.scaleMode = PanelScaleMode.ScaleWithScreenSize; settings.referenceResolution = new Vector2Int(1080, 1920);
        EditorUtility.SetDirty(settings);
        PlayerSettings.companyName = "Rejourney"; PlayerSettings.productName = "Rejourney Arcade Lab";
        PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.iOS, "co.rejourney.arcadelab");
        PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "co.rejourney.arcadelab");
        PlayerSettings.SetScriptingBackend(NamedBuildTarget.iOS, ScriptingImplementation.IL2CPP);
        // REJOURNEY_BACKEND=mono selects the Mono compatibility lane (Android only; iOS requires IL2CPP).
        PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, Environment.GetEnvironmentVariable("REJOURNEY_BACKEND") == "mono" ? ScriptingImplementation.Mono2x : ScriptingImplementation.IL2CPP);
        PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel24;
        // Unity 6 Mono on Android is ARMv7-only; IL2CPP lanes ship ARM64 as Google Play requires.
        bool mono = Environment.GetEnvironmentVariable("REJOURNEY_BACKEND") == "mono";
        PlayerSettings.Android.targetArchitectures = mono ? AndroidArchitecture.ARMv7 : AndroidArchitecture.ARM64;
        // REJOURNEY_IL2CPP_FAST=1 shortens C++ builds for functional device lanes.
        // Benchmark and release lanes always use size-neutral release code generation.
        bool fast = Environment.GetEnvironmentVariable("REJOURNEY_IL2CPP_FAST") == "1";
        foreach (var target in new[] { NamedBuildTarget.Android, NamedBuildTarget.iOS }) {
            PlayerSettings.SetIl2CppCodeGeneration(target, fast ? Il2CppCodeGeneration.OptimizeSize : Il2CppCodeGeneration.OptimizeSpeed);
            PlayerSettings.SetIl2CppCompilerConfiguration(target, fast ? Il2CppCompilerConfiguration.Debug : Il2CppCompilerConfiguration.Release);
        }
        PlayerSettings.Android.minifyRelease = true;
        PlayerSettings.Android.applicationEntry = Environment.GetEnvironmentVariable("REJOURNEY_ANDROID_ENTRY") == "activity" ? AndroidApplicationEntry.Activity : AndroidApplicationEntry.GameActivity;
        PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
        PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { Environment.GetEnvironmentVariable("REJOURNEY_GRAPHICS") == "gles3" ? GraphicsDeviceType.OpenGLES3 : GraphicsDeviceType.Vulkan });
        PlayerSettings.iOS.targetOSVersionString = "15.1";
        PlayerSettings.iOS.sdkVersion = iOSSdkVersion.DeviceSDK;
        PlayerSettings.defaultInterfaceOrientation = UIOrientation.AutoRotation;
        PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.iOS, ManagedStrippingLevel.High);
        PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.Android, ManagedStrippingLevel.High);
        // Benchmarks read main-thread CPU time through FrameTimingManager.
        PlayerSettings.enableFrameTimingStats = true;
        // Compatibility lanes: REJOURNEY_COLORSPACE=gamma, REJOURNEY_INPUT=old|new|both and
        // REJOURNEY_VULKAN_PRETRANSFORM=1 (render in the panel's native orientation).
        PlayerSettings.vulkanEnablePreTransform = Environment.GetEnvironmentVariable("REJOURNEY_VULKAN_PRETRANSFORM") == "1";
        PlayerSettings.colorSpace = Environment.GetEnvironmentVariable("REJOURNEY_COLORSPACE") == "gamma" ? ColorSpace.Gamma : ColorSpace.Linear;
        var input = Environment.GetEnvironmentVariable("REJOURNEY_INPUT");
        if (!string.IsNullOrEmpty(input)) {
            // No public API exists; this is the serialized setting Input System itself edits.
            var playerSettings = new SerializedObject(Unsupported.GetSerializedAssetInterfaceSingleton("PlayerSettings"));
            playerSettings.FindProperty("activeInputHandler").intValue = input == "new" ? 1 : input == "both" ? 2 : 0;
            playerSettings.ApplyModifiedPropertiesWithoutUndo();
        }
        AssetDatabase.SaveAssets();
    }
    // Unity 6.6 queues ImportPackage until the next editor update, so an
    // executeMethod followed by -quit can finish without importing any assets.
    // Unpack only the official UGUI archive's TMP assets and their original
    // GUIDs, then force the normal AssetDatabase import before building.
    static void ImportTmpResources(string archive)
    {
        var entries = new Dictionary<string, byte[]>();
        using (var stream = new GZipStream(File.OpenRead(archive), CompressionMode.Decompress)) {
            var header = new byte[512];
            while (true) {
                ReadExactly(stream, header);
                if (header.All(value => value == 0)) break;
                string name = System.Text.Encoding.UTF8.GetString(header, 0, 100).TrimEnd('\0');
                int size = checked((int)Convert.ToInt64(System.Text.Encoding.ASCII.GetString(header, 124, 12).Trim('\0', ' '), 8));
                if (size < 0 || size > 64 * 1024 * 1024) throw new BuildFailedException("Unexpected TMP archive entry size.");
                var bytes = new byte[size]; ReadExactly(stream, bytes);
                if (header[156] == 0 || header[156] == (byte)'0') entries[name.TrimStart('.', '/')] = bytes;
                int padding = (512 - size % 512) % 512;
                if (padding > 0) ReadExactly(stream, new byte[padding]);
            }
        }
        foreach (var entry in entries.Where(pair => pair.Key.EndsWith("/pathname"))) {
            string path = System.Text.Encoding.UTF8.GetString(entry.Value).TrimEnd('\0', '\r', '\n');
            if ((path != "Assets/TextMesh Pro" && !path.StartsWith("Assets/TextMesh Pro/", StringComparison.Ordinal)) || path.Split('/').Any(part => part == "..") || path.Contains("\\"))
                throw new BuildFailedException("Unexpected path in the official TMP resource archive.");
            string prefix = entry.Key.Substring(0, entry.Key.Length - "pathname".Length);
            if (entries.TryGetValue(prefix + "asset", out var asset)) {
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                if (!File.Exists(path)) File.WriteAllBytes(path, asset);
            } else Directory.CreateDirectory(path);
            if (entries.TryGetValue(prefix + "asset.meta", out var meta) && !File.Exists(path + ".meta")) File.WriteAllBytes(path + ".meta", meta);
        }
    }
    static void ReadExactly(Stream stream, byte[] bytes)
    {
        int offset = 0;
        while (offset < bytes.Length) {
            int read = stream.Read(bytes, offset, bytes.Length - offset);
            if (read == 0) throw new BuildFailedException("Truncated TMP resource archive.");
            offset += read;
        }
    }
    public static void Android() { Prepare(); Build(BuildTarget.Android, "Builds/Android/ArcadeLab.apk", true); }
    public static void AndroidRelease() { Prepare(); Build(BuildTarget.Android, "Builds/Android/ArcadeLab-release.apk", false); }
    public static void IOS() { Prepare(); Build(BuildTarget.iOS, "Builds/iOS", true); }
    public static void IOSRelease() { Prepare(); Build(BuildTarget.iOS, "Builds/iOS-release", false); }
    public static void IOSSimulator() { Prepare(); PlayerSettings.iOS.sdkVersion = iOSSdkVersion.SimulatorSDK; Build(BuildTarget.iOS, "Builds/iOS-simulator", true); }
    // Release players with the lab automation launch files compiled in, for matched
    // benchmark suites. The define applies to this build only, never to project settings.
    public static void IOSBenchmark() { Prepare(); Build(BuildTarget.iOS, "Builds/iOS-benchmark", false, "REJOURNEY_LAB_AUTOMATION"); }
    public static void IOSSimulatorBenchmark() { Prepare(); PlayerSettings.iOS.sdkVersion = iOSSdkVersion.SimulatorSDK; Build(BuildTarget.iOS, "Builds/iOS-simulator-benchmark", false, "REJOURNEY_LAB_AUTOMATION"); }
    public static void AndroidBenchmark() { Prepare(); Build(BuildTarget.Android, "Builds/Android/ArcadeLab-benchmark.apk", false, "REJOURNEY_LAB_AUTOMATION"); }
    static void Build(BuildTarget target, string path, bool development, params string[] defines)
    {
        var key = Environment.GetEnvironmentVariable("REJOURNEY_PUBLIC_KEY");
        if (!string.IsNullOrEmpty(key)) {
            Directory.CreateDirectory("Assets/Resources");
            File.WriteAllText("Assets/Resources/RejourneyLocal.json", Newtonsoft.Json.JsonConvert.SerializeObject(new { publicProjectKey = key, apiUrl = "https://api.rejourney.co" }));
            AssetDatabase.Refresh();
        }
        // Unity 6 build profiles persist the Development flag and override the
        // options passed below; set it explicitly so release lanes are release players.
        EditorUserBuildSettings.development = development;
        EditorUserBuildSettings.connectProfiler = false;
        EditorUserBuildSettings.allowDebugging = false;
        var result = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = EditorBuildSettings.scenes.Where(scene => scene.enabled).Select(scene => scene.path).ToArray(), locationPathName = path, target = target, options = development ? BuildOptions.Development : BuildOptions.None, extraScriptingDefines = defines });
        if (result.summary.result != BuildResult.Succeeded) throw new BuildFailedException(result.summary.result.ToString());
    }
}
