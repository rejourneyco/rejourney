using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public static class MatrixBuild
{
    const string Root = "Assets/Resources/Lab";
    const string ScenePath = "Assets/Lab/Matrix.unity";

    static T Asset<T>(string path, Func<T> create) where T : UnityEngine.Object
    {
        var existing = AssetDatabase.LoadAssetAtPath<T>(path);
        if (existing) return existing;
        AssetDatabase.CreateAsset(create(), path);
        return AssetDatabase.LoadAssetAtPath<T>(path);
    }

    public static void Prepare()
    {
        Directory.CreateDirectory(Root);
        Asset(Root + "/LabUnlit.mat", () => new Material(Shader.Find("Unlit/Color")));
        var renderers = new ScriptableRendererData[3];
        for (int i = 0; i < renderers.Length; i++) {
            var data = Asset(Root + "/LabRenderer" + i + ".asset", () => ScriptableObject.CreateInstance<UniversalRendererData>());
            data.intermediateTextureMode = i == 1 ? IntermediateTextureMode.Always : IntermediateTextureMode.Auto;
            var serialized = new SerializedObject(data);
            var tileOnly = serialized.FindProperty("m_TileOnlyMode");
            if (tileOnly != null) { tileOnly.boolValue = i == 2; serialized.ApplyModifiedPropertiesWithoutUndo(); }
            // A renderer created from script has no post-processing data; use the package default.
            if (!data.postProcessData) data.postProcessData = AssetDatabase.LoadAssetAtPath<PostProcessData>("Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset");
            EditorUtility.SetDirty(data);
            renderers[i] = data;
        }
        var pipeline = Asset(Root + "/LabPipeline.asset", () => UniversalRenderPipelineAsset.Create(renderers[0]));
        // Index 3: the 2D renderer.
        var renderer2D = Asset(Root + "/LabRenderer2D.asset", () => ScriptableObject.CreateInstance<Renderer2DData>());
        var serialized2D = new SerializedObject(renderer2D);
        var postProcess2D = serialized2D.FindProperty("m_PostProcessData");
        if (postProcess2D != null && !postProcess2D.objectReferenceValue) {
            postProcess2D.objectReferenceValue = ((UniversalRendererData)renderers[0]).postProcessData;
            serialized2D.ApplyModifiedPropertiesWithoutUndo();
        }
        var list = new SerializedObject(pipeline);
        var property = list.FindProperty("m_RendererDataList");
        property.arraySize = renderers.Length + 1;
        for (int i = 0; i < renderers.Length; i++) property.GetArrayElementAtIndex(i).objectReferenceValue = renderers[i];
        property.GetArrayElementAtIndex(renderers.Length).objectReferenceValue = renderer2D;
        list.FindProperty("m_DefaultRendererIndex").intValue = 0;
        list.ApplyModifiedPropertiesWithoutUndo();
        EditorUtility.SetDirty(pipeline);
        GraphicsSettings.defaultRenderPipeline = pipeline;
        for (int level = 0; level < QualitySettings.names.Length; level++) { QualitySettings.SetQualityLevel(level, false); QualitySettings.renderPipeline = pipeline; }

        var local = new Newtonsoft.Json.Linq.JObject();
        string key = Environment.GetEnvironmentVariable("REJOURNEY_PUBLIC_KEY"), api = Environment.GetEnvironmentVariable("REJOURNEY_API_URL");
        if (!string.IsNullOrEmpty(key)) local["publicProjectKey"] = key;
        if (!string.IsNullOrEmpty(api)) local["apiUrl"] = api;
        foreach (var name in new[] { "filter", "run" }) {
            var value = Environment.GetEnvironmentVariable("MATRIX_" + name.ToUpperInvariant());
            if (!string.IsNullOrEmpty(value)) local[name] = value;
        }
        if (Environment.GetEnvironmentVariable("MATRIX_QUICK") == "1") local["quick"] = true;
        if (Environment.GetEnvironmentVariable("MATRIX_NATIVE") == "0") local["native"] = false;
        File.WriteAllText("Assets/Resources/MatrixLocal.json", local.ToString());
        AssetDatabase.ImportAsset("Assets/Resources/MatrixLocal.json");

        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        new GameObject("Matrix").AddComponent<RejourneyLab.MatrixRunner>();
        EditorSceneManager.SaveScene(scene, ScenePath);
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };

        PlayerSettings.companyName = "Rejourney"; PlayerSettings.productName = "Rejourney Matrix";
        PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.iOS, "co.rejourney.arcadelab");
        PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "co.rejourney.arcadelab");
        PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Standalone, "co.rejourney.arcadelab");
        PlayerSettings.runInBackground = true;
        PlayerSettings.fullScreenMode = FullScreenMode.Windowed;
        PlayerSettings.defaultScreenWidth = 1280; PlayerSettings.defaultScreenHeight = 720;
        PlayerSettings.resizableWindow = false;
        PlayerSettings.colorSpace = Environment.GetEnvironmentVariable("REJOURNEY_COLORSPACE") == "gamma" ? ColorSpace.Gamma : ColorSpace.Linear;
        PlayerSettings.defaultInterfaceOrientation = UIOrientation.AutoRotation;
        PlayerSettings.allowedAutorotateToLandscapeLeft = PlayerSettings.allowedAutorotateToLandscapeRight = true;
        PlayerSettings.allowedAutorotateToPortrait = PlayerSettings.allowedAutorotateToPortraitUpsideDown = true;
        PlayerSettings.SetScriptingBackend(NamedBuildTarget.Standalone, ScriptingImplementation.Mono2x);
        PlayerSettings.SetScriptingBackend(NamedBuildTarget.iOS, ScriptingImplementation.IL2CPP);
        PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
        PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
        PlayerSettings.Android.minSdkVersion = (AndroidSdkVersions)26;
        PlayerSettings.Android.applicationEntry = Environment.GetEnvironmentVariable("REJOURNEY_ANDROID_ENTRY") == "activity" ? AndroidApplicationEntry.Activity : AndroidApplicationEntry.GameActivity;
        PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
        PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { Environment.GetEnvironmentVariable("REJOURNEY_GRAPHICS") == "gles3" ? GraphicsDeviceType.OpenGLES3 : GraphicsDeviceType.Vulkan });
        PlayerSettings.vulkanEnablePreTransform = Environment.GetEnvironmentVariable("REJOURNEY_VULKAN_PRETRANSFORM") == "1";
        PlayerSettings.iOS.targetOSVersionString = "15.1";
        foreach (var target in new[] { NamedBuildTarget.Android, NamedBuildTarget.iOS }) {
            PlayerSettings.SetManagedStrippingLevel(target, ManagedStrippingLevel.High);
            PlayerSettings.SetIl2CppCodeGeneration(target, Il2CppCodeGeneration.OptimizeSize);
            PlayerSettings.SetIl2CppCompilerConfiguration(target, Il2CppCompilerConfiguration.Debug);
        }
        // Player Settings > iOS > Metal Write-Only Backbuffer has no public editor API.
        var settings = new SerializedObject(Unsupported.GetSerializedAssetInterfaceSingleton("PlayerSettings"));
        var writeOnly = settings.FindProperty("metalFramebufferOnly");
        if (writeOnly != null) { writeOnly.boolValue = Environment.GetEnvironmentVariable("REJOURNEY_METAL_WRITE_ONLY") == "1"; settings.ApplyModifiedPropertiesWithoutUndo(); }
        var blit = settings.FindProperty("androidBlitType");
        string blitType = Environment.GetEnvironmentVariable("REJOURNEY_ANDROID_BLIT");
        if (blit != null && !string.IsNullOrEmpty(blitType)) { blit.intValue = blitType == "never" ? 2 : blitType == "auto" ? 1 : 0; settings.ApplyModifiedPropertiesWithoutUndo(); }
        AssetDatabase.SaveAssets();
    }

    static void Build(BuildTarget target, string output, BuildOptions options)
    {
        Prepare();
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = new[] { ScenePath }, locationPathName = output, target = target, options = options });
        if (report.summary.result != BuildResult.Succeeded) throw new BuildFailedException("Matrix build failed: " + report.summary.result);
        Debug.Log("Matrix build succeeded: " + output);
    }

    // REJOURNEY_DEVELOPMENT=1: a development player, whose profiler counters include managed allocations per frame.
    public static void Mac() => Build(BuildTarget.StandaloneOSX, "build/mac/RejourneyMatrix.app", Environment.GetEnvironmentVariable("REJOURNEY_DEVELOPMENT") == "1" ? BuildOptions.Development : BuildOptions.None);
    public static void IOSSimulator() { PlayerSettings.iOS.sdkVersion = iOSSdkVersion.SimulatorSDK; Build(BuildTarget.iOS, "build/ios-sim", BuildOptions.Development); }
    public static void IOS() { PlayerSettings.iOS.sdkVersion = iOSSdkVersion.DeviceSDK; Build(BuildTarget.iOS, "build/ios", BuildOptions.Development); }
    public static void Android() => Build(BuildTarget.Android, "build/android/matrix.apk", BuildOptions.Development);
    public static void AndroidRelease() => Build(BuildTarget.Android, "build/android/matrix-release.apk", BuildOptions.None);
}
