using System.IO;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RejourneySDK
{
    internal enum FrameSourceStatus { Idle, Pending, Ready, Failed }

    // A render-pipeline source fills the capture texture from inside the pipeline,
    // so capture never reads the presented back buffer. iOS Metal back buffers are
    // unreadable when "Metal Write-Only Backbuffer" is on, and ScreenCapture then
    // returns black frames.
    internal interface IRejourneyFrameSource
    {
        string Name { get; }
        /// <summary>True when the active render pipeline is the one this source drives.</summary>
        bool Available { get; }
        /// <summary>Arms one capture into <paramref name="target"/> during the next rendered frame.</summary>
        bool Request(RenderTexture target);
        /// <summary>Ready once the frame that filled the target has been submitted.</summary>
        FrameSourceStatus Poll();
        void Cancel();
    }

    // Facts about the player build that the runtime cannot query. The iOS build hook
    // writes them into the app's StreamingAssets (Data/Raw).
    internal static class CaptureEnvironment
    {
        internal const string RelativePath = "co.rejourney.unity/capture.json";
        static bool? writeOnly;
        /// <summary>Tests set this; null reads the build file.</summary>
        internal static bool? Override;
        /// <summary>
        /// True when Player Settings > iOS > "Metal Write-Only Backbuffer" is on. The back
        /// buffer then cannot be read on device and ScreenCapture returns black frames.
        /// </summary>
        internal static bool BackbufferWriteOnly => Override ?? (writeOnly ??= Read());
        static bool Read()
        {
            if (Application.platform != RuntimePlatform.IPhonePlayer) return false;
            try {
                var path = Path.Combine(Application.streamingAssetsPath, RelativePath);
                return File.Exists(path) && (JObject.Parse(File.ReadAllText(path)).Value<bool?>("metalWriteOnlyBackbuffer") ?? false);
            } catch { return false; }
        }
    }

    internal static class FrameSources
    {
        internal static IRejourneyFrameSource Current { get; private set; }
        internal static void Register(IRejourneyFrameSource source) => Current = source;
    }
}
