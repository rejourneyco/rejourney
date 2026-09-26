using System.IO;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.UnityLinker;

namespace RejourneySDK.Editor
{
    // UnityLinker ignores link.xml files inside packages; only Assets/ copies are
    // discovered. Without this hand-off, high stripping removes the reflection-read
    // bridge payload types and the uGUI privacy adapter from player builds.
    public sealed class RejourneyLinkerProcessor : IUnityLinkerProcessor
    {
        public int callbackOrder => 0;
        public string GenerateAdditionalLinkXmlFile(BuildReport report, UnityLinkerBuildPipelineData data)
        {
            var path = Path.GetFullPath(Path.Combine(NativeBuildProcessor.PackageRoot(), "Runtime/link.xml"));
            if (!File.Exists(path)) throw new BuildFailedException("Rejourney link.xml is missing from the package.");
            return path;
        }
        public void OnBeforeRun(BuildReport report, UnityLinkerBuildPipelineData data) { }
        public void OnAfterRun(BuildReport report, UnityLinkerBuildPipelineData data) { }
    }
}
