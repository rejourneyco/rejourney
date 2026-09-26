using System;
using System.IO;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
#if UNITY_IOS
using UnityEditor.iOS.Xcode;
using UnityEditor.iOS.Xcode.Extensions;
#endif
#if UNITY_ANDROID
using UnityEditor.Android;
#endif
namespace RejourneySDK.Editor
{
    public sealed class NativeBuildProcessor : IPreprocessBuildWithReport, IPostprocessBuildWithReport
#if UNITY_ANDROID
        , IPostGenerateGradleAndroidProject
#endif
    {
        public int callbackOrder => 900;
        public void OnPreprocessBuild(BuildReport report)
        {
            var root = PackageRoot();
            if (report.summary.platform == BuildTarget.iOS) {
                if (!Directory.Exists(System.IO.Path.Combine(root, "Plugins/iOS/RejourneyUnity.xcframework")))
                    throw new BuildFailedException("Rejourney iOS XCFramework missing. Install the release tarball, or run Tools~/build-native.sh ios from the source checkout.");
                if (Version.TryParse(PlayerSettings.iOS.targetOSVersionString, out var minimum) && minimum < new Version(15, 1))
                    throw new BuildFailedException("Rejourney requires iOS 15.1 or later.");
            }
            if (report.summary.platform == BuildTarget.Android) {
                if (!File.Exists(System.IO.Path.Combine(root, "Plugins/Android/rejourney-unity.aar")))
                    throw new BuildFailedException("Rejourney Android AAR missing. Install the release tarball, or run Tools~/build-native.sh android.");
                if ((int)PlayerSettings.Android.minSdkVersion < 24) throw new BuildFailedException("Rejourney requires Android API 24 or later.");
            }
        }
        internal static string PackageRoot()
        {
            var package = UnityEditor.PackageManager.PackageInfo.FindForAssembly(typeof(Rejourney).Assembly);
            if (package == null) throw new BuildFailedException("Rejourney UPM package location unavailable.");
            return package.resolvedPath;
        }
        public void OnPostprocessBuild(BuildReport report)
        {
#if UNITY_IOS
            if (report.summary.platform != BuildTarget.iOS) return;
            string root = report.summary.outputPath, path = PBXProject.GetPBXProjectPath(root);
            var project = new PBXProject(); project.ReadFromFile(path);
            var frameworkTarget = project.GetUnityFrameworkTargetGuid();
            const string frameworkPath = "Frameworks/co.rejourney.unity/Plugins/iOS/RejourneyUnity.xcframework";
            var frameworkGuid = project.FindFileGuidByProjectPath(frameworkPath);
            if (string.IsNullOrEmpty(frameworkGuid)) frameworkGuid = project.FindFileGuidByRealPath(frameworkPath);
            if (string.IsNullOrEmpty(frameworkGuid)) throw new BuildFailedException("Rejourney XCFramework was not exported. Check the iOS PluginImporter settings.");
            // Dynamic Swift frameworks must also be copied into the app bundle.
            // Unity's importer links XCFrameworks but does not consistently embed them.
            project.AddFileToEmbedFrameworks(project.GetUnityMainTargetGuid(), frameworkGuid);
            project.AddBuildProperty(frameworkTarget, "OTHER_LDFLAGS", "-ObjC");
            project.SetBuildProperty(frameworkTarget, "SWIFT_VERSION", "5.0");
            project.SetBuildProperty(project.GetUnityMainTargetGuid(), "ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES", "YES");
            project.WriteToFile(path);
#endif
        }
#if UNITY_ANDROID
        public void OnPostGenerateGradleAndroidProject(string path)
        {
            var gradle = System.IO.Path.Combine(path, "build.gradle");
            var source = File.ReadAllText(gradle);
            const string begin = "// REJOURNEY_DEPENDENCIES_BEGIN";
            const string end = "// REJOURNEY_DEPENDENCIES_END";
            int start = source.IndexOf(begin, StringComparison.Ordinal), finish = source.IndexOf(end, StringComparison.Ordinal);
            if (start >= 0 && finish > start) source = source.Remove(start, finish + end.Length - start);
            source += "\n" + begin + @"
dependencies {
    implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2'
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    implementation 'androidx.work:work-runtime-ktx:2.10.2'
    implementation 'androidx.core:core-ktx:1.16.0'
    implementation 'androidx.appcompat:appcompat:1.7.1'
    implementation 'androidx.recyclerview:recyclerview:1.4.0'
    implementation 'androidx.lifecycle:lifecycle-process:2.9.2'
}
" + end + "\n";
            File.WriteAllText(gradle, source);
        }
#endif
    }
}
