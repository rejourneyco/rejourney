using System.IO;
using UnityEditor;
using UnityEngine;
using Newtonsoft.Json;
namespace RejourneySDK.Editor
{
    public static class RejourneySettings
    {
        const string Path = "ProjectSettings/Rejourney.local.json";
        [System.Serializable] sealed class Configuration { public string PublicProjectKey = ""; public RejourneyOptions Options = new RejourneyOptions(); }
        static Configuration current;
        [SettingsProvider] public static SettingsProvider Provider() => new SettingsProvider("Project/Rejourney", SettingsScope.Project) {
            label = "Rejourney",
            guiHandler = _ => {
                if (current == null) {
                    try { current = File.Exists(Path) ? JsonConvert.DeserializeObject<Configuration>(File.ReadAllText(Path)) ?? new Configuration() : new Configuration(); }
                    catch { current = new Configuration(); }
                }
                EditorGUILayout.LabelField("Rejourney for Unity · 0.1.0", EditorStyles.boldLabel);
                EditorGUILayout.HelpBox("Init configures the SDK. Your consent flow must call StartAsync before recording. Device builds use the native core; Editor sessions provide diagnostics only.", MessageType.Info);
                EditorGUI.BeginChangeCheck();
                current.PublicProjectKey = EditorGUILayout.TextField("Public project key", current.PublicProjectKey);
                current.Options.ApiUrl = EditorGUILayout.TextField("API endpoint", current.Options.ApiUrl);
                current.Options.ObserveOnly = EditorGUILayout.Toggle("Telemetry only", current.Options.ObserveOnly);
                current.Options.FramesPerSecond = EditorGUILayout.IntSlider("Capture FPS (remote limit)", current.Options.FramesPerSecond, 1, 3);
                current.Options.MaximumDimension = EditorGUILayout.IntSlider("Maximum dimension", current.Options.MaximumDimension, 240, 1920);
                current.Options.JpegQuality = EditorGUILayout.IntSlider("JPEG quality", current.Options.JpegQuality, 1, 100);
                current.Options.MaskTextInputs = EditorGUILayout.Toggle("Mask text inputs", current.Options.MaskTextInputs);
                if (EditorGUI.EndChangeCheck()) File.WriteAllText(Path, JsonConvert.SerializeObject(current, Formatting.Indented));
                EditorGUILayout.Space();
                EditorGUILayout.LabelField("HTTP capture", "Compiled player C# assemblies (IL postprocessor)");
                EditorGUILayout.LabelField("Native minimums", "iOS 15.1 / Android API 24");
                EditorGUILayout.LabelField("Build reports", "Library/Rejourney/NetworkReports");
                EditorGUILayout.HelpBox("Ignore ProjectSettings/Rejourney.local.json in version control. Copy this configuration into your bootstrap explicitly. Native overlays and system keyboards require app integration around their presentation.", MessageType.Info);
            }
        };
    }
}
