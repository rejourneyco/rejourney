using System.Runtime.InteropServices;
using UnityEngine;
namespace RejourneySDK
{
    /// <summary>
    /// Deliberate fault probes. They act only in development players
    /// (Debug.isDebugBuild) and are inert in release builds. Restart the app after
    /// a fatal probe. A runtime check replaces DEVELOPMENT_BUILD, which Unity 6.6
    /// deprecates, so the same code compiles on every supported Unity version.
    /// </summary>
    public static class DiagnosticFaults
    {
#if UNITY_IOS && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void rj_unity_test_crash();
        [DllImport("__Internal")] static extern void rj_unity_test_ui_stall();
#endif
        public static void NativeCrash()
        {
            if (!Debug.isDebugBuild) { Debug.LogWarning("[Rejourney] Fault probes run only in development builds."); return; }
#if UNITY_IOS && !UNITY_EDITOR
            rj_unity_test_crash();
#elif UNITY_ANDROID && !UNITY_EDITOR
            using (var marker = new AndroidJavaClass("com.rejourney.UnityCrashMarker")) marker.CallStatic("deliberateCrash");
#else
            Debug.Log("[Rejourney] Native fault probes require a physical mobile build.");
#endif
        }
        public static void NativeUiStall()
        {
            if (!Debug.isDebugBuild) { Debug.LogWarning("[Rejourney] Fault probes run only in development builds."); return; }
#if UNITY_IOS && !UNITY_EDITOR
            rj_unity_test_ui_stall();
#elif UNITY_ANDROID && !UNITY_EDITOR
            using (var bridge = new AndroidJavaClass("com.rejourney.RejourneyUnity")) bridge.CallStatic("deliberateUiStall");
#else
            Debug.Log("[Rejourney] Native UI stall probe requires a mobile build.");
#endif
        }
    }
}
