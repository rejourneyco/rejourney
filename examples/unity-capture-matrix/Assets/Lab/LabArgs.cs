using System;
using System.Collections.Generic;
using UnityEngine;

namespace RejourneyLab
{
    /// <summary>Launch arguments: the process command line, plus the "args" string extra of the launch intent on Android.</summary>
    public static class LabArgs
    {
        static string[] all;
        public static string[] All
        {
            get {
                if (all != null) return all;
                var list = new List<string>(Environment.GetCommandLineArgs());
                // iOS players see no process arguments; `SIMCTL_CHILD_LAB_ARGS=... xcrun simctl launch` sets this instead.
                string environment = Environment.GetEnvironmentVariable("LAB_ARGS");
                if (!string.IsNullOrEmpty(environment)) list.AddRange(environment.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries));
#if UNITY_ANDROID && !UNITY_EDITOR
                try {
                    using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                    using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
                    using (var intent = activity.Call<AndroidJavaObject>("getIntent")) {
                        string extra = intent.Call<string>("getStringExtra", "args");
                        if (!string.IsNullOrEmpty(extra)) list.AddRange(extra.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries));
                    }
                } catch (Exception error) { Debug.Log("[Lab] intent args unavailable: " + error.Message); }
#endif
                return all = list.ToArray();
            }
        }
        public static string Value(string name)
        {
            var args = All;
            for (int i = 0; i < args.Length - 1; i++) if (args[i] == name) return args[i + 1];
            return null;
        }
        public static bool Flag(string name) => Array.IndexOf(All, name) >= 0;
    }
}
