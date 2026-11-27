using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RejourneySDK;
using Unity.Profiling;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.UI;

namespace RejourneyLab
{
    /// <summary>
    /// Cost of the SDK on a fixed scene, case by case, against the same scene without it:
    /// frame times, main-thread time, managed allocations per frame, memory and the SDK's
    /// own main-thread counter. `--perf` uses a loopback bridge (the C# and GPU side alone);
    /// `--perf --perf-native` uses the real native bridge and a cloud session.
    /// </summary>
    public static class PerfLab
    {
        sealed class Bridge : IRejourneyBridge
        {
            internal readonly IRejourneyBridge Inner;
            internal int Fps = 1; internal bool TelemetryOnly; internal long Frames, Bytes;
            internal Bridge(IRejourneyBridge inner) { Inner = inner; }
            public Task<JObject> Request(string command, object payload = null)
            {
                if (Inner != null) return Inner.Request(command, payload);
                if (command == "start" || command == "status")
                    return Task.FromResult(new JObject { ["success"] = true, ["sessionId"] = "perf-session", ["telemetryOnly"] = TelemetryOnly, ["fps"] = Fps, ["maskTextInputs"] = true, ["maskImagesAndVideos"] = false });
                return Task.FromResult(new JObject { ["success"] = true, ["delivered"] = true });
            }
            public void Poll() => Inner?.Poll();
            internal byte[] Last;
            public void Frame(byte[] bytes, string session, long timestamp) { Frames++; Bytes += bytes.Length; Last = bytes; Inner?.Frame(bytes, session, timestamp); }
            public void Dispose() => Inner?.Dispose();
        }

        sealed class Case
        {
            public string Name; public bool Sdk = true, TelemetryOnly, Pipeline, Stress; public int Fps = 1;
        }

        static readonly List<Transform> spinners = new List<Transform>();
        static void Log(string message) => Debug.Log("[Perf] " + message);

        static void BuildLoad(Material unlit)
        {
            // A few hundred moving objects and some UI, so a frame costs something to render.
            var root = new GameObject("Load").transform;
            var random = new System.Random(7);
            for (int i = 0; i < 400; i++) {
                var quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
                UnityEngine.Object.Destroy(quad.GetComponent<Collider>());
                quad.transform.SetParent(root, false);
                quad.transform.position = new Vector3((float)random.NextDouble() * 2f - 1f, (float)random.NextDouble() * 2f - 1f, 2 + i * 0.01f);
                quad.transform.localScale = Vector3.one * 0.08f;
                quad.GetComponent<Renderer>().sharedMaterial = unlit;
                spinners.Add(quad.transform);
            }
            var canvas = new GameObject("Hud").AddComponent<Canvas>(); canvas.renderMode = RenderMode.ScreenSpaceOverlay; canvas.sortingOrder = 5;
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            for (int i = 0; i < 24; i++) {
                var item = new GameObject("Label" + i, typeof(RectTransform));
                item.transform.SetParent(canvas.transform, false);
                var rect = (RectTransform)item.transform;
                rect.anchorMin = new Vector2(0.02f + (i % 4) * 0.24f, 0.05f + (i / 4) * 0.07f); rect.anchorMax = rect.anchorMin + new Vector2(0.22f, 0.06f);
                rect.offsetMin = rect.offsetMax = Vector2.zero;
                item.AddComponent<Image>().color = new Color(0, 0, 0, 0.5f);
                var label = new GameObject("Text", typeof(RectTransform)); label.transform.SetParent(item.transform, false);
                var text = label.AddComponent<Text>(); text.font = font; text.text = "Score " + (i * 137); text.color = Color.white; text.alignment = TextAnchor.MiddleCenter;
                ((RectTransform)label.transform).anchorMin = Vector2.zero; ((RectTransform)label.transform).anchorMax = Vector2.one;
                ((RectTransform)label.transform).offsetMin = ((RectTransform)label.transform).offsetMax = Vector2.zero;
            }
        }

        static double Percentile(List<double> sorted, double p) => sorted.Count == 0 ? 0 : sorted[Math.Min(sorted.Count - 1, (int)(p * (sorted.Count - 1) + 0.5))];

        public static IEnumerator Run(JObject settings, Material unlit)
        {
            bool native = LabArgs.Flag("--perf-native") && Application.isMobilePlatform;
            float seconds = float.Parse(LabArgs.Value("--perf-seconds") ?? "15", System.Globalization.CultureInfo.InvariantCulture);
            string only = LabArgs.Value("--perf-case");
            Application.targetFrameRate = 60;
            QualitySettings.vSyncCount = 0;
            BuildLoad(unlit);
            var cases = new List<Case> {
                new Case { Name = "sdk-off", Sdk = false },
                new Case { Name = "telemetry-only", TelemetryOnly = true },
                new Case { Name = "replay-1fps-screen", Fps = 1 },
                new Case { Name = "replay-3fps-screen", Fps = 3 },
                new Case { Name = "replay-1fps-pipeline", Fps = 1, Pipeline = true },
                new Case { Name = "replay-3fps-pipeline", Fps = 3, Pipeline = true },
                new Case { Name = "replay-3fps-screen-stress", Fps = 3, Stress = true },
                new Case { Name = "sdk-off-again", Sdk = false },
                // The same logging and event calls without a session: what the game's own calls cost.
                new Case { Name = "sdk-off-stress", Sdk = false, Stress = true },
            };
            Bridge bridge = null;
            var results = new JArray();
            using var gcAlloc = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Allocated In Frame");
            using var mainThread = ProfilerRecorder.StartNew(ProfilerCategory.Internal, "Main Thread", 4);
            using var systemMemory = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "System Used Memory");
            using var gfxMemory = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "Gfx Used Memory");
            using var gcUsed = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Used Memory");
            using var totalUsed = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "Total Used Memory");
            using var gcCount = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Collect");  // may be unavailable; GC.CollectionCount is used too
            foreach (var test in cases) {
                if (only != null && test.Name != only && test.Name != "sdk-off") continue;
                if (test.Sdk && bridge == null) {
                    bridge = new Bridge(native ? new NativeBridge() : null);
                    RejourneyBehaviour.BridgeFactory = () => bridge;
                    Rejourney.Init(settings.Value<string>("publicProjectKey") ?? "rj_perf_loopback", new RejourneyOptions {
                        ApiUrl = settings.Value<string>("apiUrl") ?? "https://api.rejourney.co", FramesPerSecond = 3, CaptureLogs = true, CaptureHangs = true,
                        CaptureCrashes = false, CaptureTouches = true });
                    var start = Rejourney.StartAsync();
                    while (!start.IsCompleted) yield return null;
                    Log("started state=" + Rejourney.State + " session=" + Rejourney.CurrentSessionId + " native=" + native);
                }
                if (!test.Sdk && bridge != null) {
                    var stop = Rejourney.StopAsync();
                    while (!stop.IsCompleted) yield return null;
                }
                if (bridge != null && test.Sdk) { bridge.Fps = test.Fps; bridge.TelemetryOnly = test.TelemetryOnly; }
                CaptureEnvironment.Override = test.Pipeline;
                // Let the status poll pick the case up, and the scene settle.
                yield return new WaitForSecondsRealtime(3);
                GC.Collect();
                yield return null;
                var frameTimes = new List<double>(4096); var cpuTimes = new List<double>(4096);
                long allocated = 0, frames = 0; int collections = GC.CollectionCount(0);
                var health = Rejourney.Health;
                double sdkBefore = health.MainThreadMilliseconds; long capturedBefore = health.FramesCaptured, bridgeFramesBefore = bridge?.Frames ?? 0, bridgeBytesBefore = bridge?.Bytes ?? 0;
                long droppedBefore = health.EventsDropped, backpressureBefore = health.FramesSkippedBackpressure, failuresBefore = health.CaptureFailures;
                double began = Time.realtimeSinceStartupAsDouble, nextLog = began, nextEvent = began;
                while (Time.realtimeSinceStartupAsDouble - began < seconds) {
                    float angle = Time.unscaledTime * 90f;
                    for (int i = 0; i < spinners.Count; i++) spinners[i].localRotation = Quaternion.Euler(0, 0, angle + i);
                    if (test.Stress) {
                        double now = Time.realtimeSinceStartupAsDouble;
                        if (now >= nextLog) { nextLog += 1.0 / 60; Debug.Log("perf log line with a number " + frames); }
                        if (now >= nextEvent) { nextEvent += 0.1; Rejourney.LogEvent("perf_event", new Dictionary<string, object> { ["frame"] = frames, ["label"] = "stress" }); }
                    }
                    yield return null;
                    frames++;
                    frameTimes.Add(Time.unscaledDeltaTime * 1000.0);
                    if (gcAlloc.Valid) allocated += gcAlloc.LastValue;
                    if (mainThread.Valid) cpuTimes.Add(mainThread.LastValue / 1e6);
                }
                double elapsed = Time.realtimeSinceStartupAsDouble - began;
                frameTimes.Sort(); cpuTimes.Sort();
                var result = new JObject {
                    ["case"] = test.Name, ["seconds"] = Math.Round(elapsed, 2), ["frames"] = frames, ["fps"] = Math.Round(frames / elapsed, 2),
                    ["frameP50"] = Math.Round(Percentile(frameTimes, 0.5), 3), ["frameP95"] = Math.Round(Percentile(frameTimes, 0.95), 3),
                    ["frameP99"] = Math.Round(Percentile(frameTimes, 0.99), 3), ["frameMax"] = Math.Round(frameTimes.Count > 0 ? frameTimes[frameTimes.Count - 1] : 0, 3),
                    ["cpuP50"] = Math.Round(Percentile(cpuTimes, 0.5), 3), ["cpuP95"] = Math.Round(Percentile(cpuTimes, 0.95), 3), ["cpuP99"] = Math.Round(Percentile(cpuTimes, 0.99), 3),
                    ["gcBytesPerFrame"] = frames > 0 ? allocated / frames : 0, ["gcBytesPerSecond"] = (long)(allocated / elapsed), ["gcCollections"] = GC.CollectionCount(0) - collections,
                    ["sdkMainThreadMsPerSecond"] = Math.Round((health.MainThreadMilliseconds - sdkBefore) / elapsed, 3),
                    ["framesCaptured"] = health.FramesCaptured - capturedBefore, ["framesToBridge"] = (bridge?.Frames ?? 0) - bridgeFramesBefore,
                    ["jpegBytesPerFrame"] = (bridge?.Frames ?? 0) - bridgeFramesBefore > 0 ? ((bridge?.Bytes ?? 0) - bridgeBytesBefore) / ((bridge?.Frames ?? 0) - bridgeFramesBefore) : 0,
                    ["lastCaptureMs"] = Math.Round(health.LastCaptureMilliseconds, 2), ["captureSource"] = health.CaptureSource,
                    ["eventsDropped"] = health.EventsDropped - droppedBefore, ["skippedBackpressure"] = health.FramesSkippedBackpressure - backpressureBefore, ["captureFailures"] = health.CaptureFailures - failuresBefore,
                    ["systemMemoryMb"] = systemMemory.Valid ? Math.Round(systemMemory.LastValue / 1048576.0, 1) : -1, ["gfxMemoryMb"] = gfxMemory.Valid ? Math.Round(gfxMemory.LastValue / 1048576.0, 1) : -1,
                    ["gcUsedMb"] = gcUsed.Valid ? Math.Round(gcUsed.LastValue / 1048576.0, 2) : -1, ["totalUsedMb"] = totalUsed.Valid ? Math.Round(totalUsed.LastValue / 1048576.0, 1) : -1,
                    ["state"] = Rejourney.State.ToString(),
                };
                results.Add(result);
                Log(result.ToString(Newtonsoft.Json.Formatting.None));
                // --perf-dump <folder>: keep each case's last frame, to compare the two capture paths by eye.
                string dump = LabArgs.Value("--perf-dump");
                if (dump != null && bridge?.Last != null && test.Sdk && !test.TelemetryOnly) { try { Directory.CreateDirectory(dump); File.WriteAllBytes(Path.Combine(dump, test.Name + ".jpg"), bridge.Last); } catch { } }
            }
            var report = new JObject {
                ["platform"] = Application.platform.ToString(), ["graphicsApi"] = SystemInfo.graphicsDeviceType.ToString(), ["unity"] = Application.unityVersion,
                ["device"] = SystemInfo.deviceModel, ["screen"] = Screen.width + "x" + Screen.height, ["native"] = native, ["debugBuild"] = Debug.isDebugBuild, ["results"] = results,
            };
            string path = LabArgs.Value("--perf-report") ?? Path.Combine(Application.persistentDataPath, "perf-report.json");
            File.WriteAllText(path, report.ToString(Newtonsoft.Json.Formatting.Indented), new UTF8Encoding(false));
            Log("DONE report=" + path);
            if (!Application.isMobilePlatform) Application.Quit(0);
        }
    }
}
