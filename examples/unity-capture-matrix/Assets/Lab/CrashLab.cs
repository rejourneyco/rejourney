using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using Newtonsoft.Json.Linq;
using RejourneySDK;
using UnityEngine;

namespace RejourneyLab
{
    /// <summary>
    /// Fatal-fault probes against the real native bridge. A probe run starts a session,
    /// optionally changes its state, records the session id on disk and then crashes.
    /// A recover run starts the next session, which is when native uploads the report.
    ///   --crash-probe abort|segv|thread|java|none[:paused|:rolled|:late|:background]
    ///   --crash-recover
    /// </summary>
    public static class CrashLab
    {
        static string Documents => Application.persistentDataPath;
        static void Log(string message) => Debug.Log("[CrashLab] " + message);

        static RejourneyOptions Options(JObject settings) => new RejourneyOptions {
            ApiUrl = settings.Value<string>("apiUrl") ?? "https://api.rejourney.co", FramesPerSecond = 1,
            CaptureLogs = true, CaptureHangs = true, CaptureCrashes = true, Debug = true,
            ContinueAfterSessionLimit = !LabArgs.Flag("--no-continue"),
        };

        static IEnumerator Wait(System.Threading.Tasks.Task task) { while (!task.IsCompleted) yield return null; }

        public static IEnumerator Probe(string mode, JObject settings)
        {
            string fault = mode.Split(':')[0], state = mode.Contains(":") ? mode.Split(':')[1] : "recording";
            var states = new List<string>();
            Rejourney.StateChanged += value => { states.Add(value.ToString()); Log("state " + value + " session=" + Rejourney.CurrentSessionId); };
            // "reporter-first": another crash reporter installed its handlers before Rejourney (the
            // usual order with Crashlytics); "reporter-last": after it.
            if (state == "reporter-first") InstallReporter();
            Rejourney.Init(settings.Value<string>("publicProjectKey"), Options(settings));
            var start = Rejourney.StartAsync();
            yield return Wait(start);
            Log("probe=" + mode + " start state=" + Rejourney.State + " session=" + Rejourney.CurrentSessionId + " error=" + start.Result.Error);
            Rejourney.SetMetadata("crashProbe", mode);
            Rejourney.TrackScreen("CrashLab");
            yield return new WaitForSecondsRealtime(6);
            string first = Rejourney.CurrentSessionId;
            if (state == "reporter-last") InstallReporter();
            if (state == "paused") { yield return Wait(Rejourney.PauseAsync()); yield return new WaitForSecondsRealtime(2); }
            if (state == "rolled") {
                yield return Wait(Rejourney.StopAsync());
                var again = Rejourney.StartAsync(); yield return Wait(again);
                yield return new WaitForSecondsRealtime(5);
            }
            if (state == "late" || state == "late-paused") {
                // "late-paused": the game paused capture before the limit; the pause must carry over.
                if (state == "late-paused") yield return Wait(Rejourney.PauseAsync());
                // Past the project's recording-time limit (10 minutes unless the project says otherwise).
                float limit = float.Parse(Argument("--late-seconds") ?? "640", System.Globalization.CultureInfo.InvariantCulture);
                for (float waited = 0; waited < limit; waited += 20) {
                    yield return new WaitForSecondsRealtime(20);
                    Log("late t=" + (waited + 20) + " state=" + Rejourney.State + " session=" + Rejourney.CurrentSessionId + " continued=" + Rejourney.Health.SessionsContinued);
                }
                if (state == "late-paused") {
                    Log("before resume state=" + Rejourney.State + " session=" + Rejourney.CurrentSessionId + " continued=" + Rejourney.Health.SessionsContinued);
                    yield return Wait(Rejourney.ResumeAsync());
                    yield return new WaitForSecondsRealtime(2);
                    Log("after resume state=" + Rejourney.State + " session=" + Rejourney.CurrentSessionId);
                }
                // An error after the limit must still be reported.
                Debug.LogException(new InvalidOperationException("crashlab error after the session limit"));
                Rejourney.LogEvent("after_limit");
                yield return new WaitForSecondsRealtime(4);
                yield return Wait(Rejourney.FlushAsync());
            }
            var record = new JObject {
                ["mode"] = mode, ["firstSession"] = first, ["session"] = Rejourney.CurrentSessionId, ["state"] = Rejourney.State.ToString(),
                ["states"] = new JArray(states.ToArray()), ["continued"] = Rejourney.Health.SessionsContinued,
                ["time"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), ["platform"] = Application.platform.ToString(),
            };
            File.WriteAllText(Path.Combine(Documents, "crashlab-probe.json"), record.ToString());
            Log("armed " + record.ToString(Newtonsoft.Json.Formatting.None));
            yield return new WaitForSecondsRealtime(1);
            switch (fault) {
                case "abort": DiagnosticFaults.NativeCrash(); break;
                case "segv": Marshal.WriteInt32(new IntPtr(16), 42); break;
                case "thread": new Thread(() => throw new InvalidOperationException("crashlab unhandled exception on a managed thread")).Start(); break;
                case "java": JavaCrash(); break;
                case "none": break;
            }
            yield return new WaitForSecondsRealtime(5);
            Log("still alive after fault=" + fault + " state=" + Rejourney.State);
            File.WriteAllText(Path.Combine(Documents, "crashlab-done.json"), new JObject { ["survived"] = true, ["mode"] = mode }.ToString());
        }

#if UNITY_IOS && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void lab_install_reporter(string path);
#endif
        static void InstallReporter()
        {
            string path = Path.Combine(Documents, "lab-reporter.txt");
#if UNITY_IOS && !UNITY_EDITOR
            lab_install_reporter(path);
            Log("stand-in crash reporter installed");
#else
            Log("stand-in crash reporter needs iOS");
#endif
        }

        static void JavaCrash()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            using (var looper = new AndroidJavaClass("android.os.Looper").CallStatic<AndroidJavaObject>("getMainLooper"))
            using (var handler = new AndroidJavaObject("android.os.Handler", looper))
                handler.Call<bool>("post", new AndroidJavaRunnable(() => throw new InvalidOperationException("crashlab exception on the Android main thread")));
#else
            Log("java fault needs Android");
#endif
        }

        public static IEnumerator Recover(JObject settings)
        {
            Rejourney.Init(settings.Value<string>("publicProjectKey"), Options(settings));
            var start = Rejourney.StartAsync();
            yield return Wait(start);
            Log("recover start state=" + Rejourney.State + " session=" + Rejourney.CurrentSessionId + " error=" + start.Result.Error);
            float seconds = float.Parse(Argument("--recover-seconds") ?? "25", System.Globalization.CultureInfo.InvariantCulture);
            yield return new WaitForSecondsRealtime(seconds);
            var stop = Rejourney.StopAsync();
            yield return Wait(stop);
            string previous = null;
            try { previous = File.ReadAllText(Path.Combine(Documents, "crashlab-probe.json")); } catch { }
            File.WriteAllText(Path.Combine(Documents, "crashlab-done.json"), new JObject {
                ["recovered"] = true, ["session"] = stop.Result.SessionId, ["delivery"] = stop.Result.State.ToString(), ["probe"] = previous == null ? null : JObject.Parse(previous) }.ToString());
            Log("recover done delivery=" + stop.Result.State + " probe=" + previous);
        }

        static string Argument(string name) => LabArgs.Value(name);
    }
}
