using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using Debug = UnityEngine.Debug;

namespace RejourneySDK.Tests
{
    /// <summary>
    /// Cost probes for SDK hot paths. Each logs a "[RejourneyPerf]" line (CPU
    /// microseconds and managed bytes per operation). Allocation budgets fail the
    /// test when a measurement is valid and exceeds them. In EditMode the uGUI
    /// adapter is not installed, so privacy collection measures the fail-closed scan.
    /// </summary>
    public sealed class PerformanceBudgetTests
    {
        // Routes every request through the production bridge serializer.
        sealed class SerializingBridge : IRejourneyBridge
        {
            public int Requests;
            public readonly List<JObject> Events = new List<JObject>();
            public Task<JObject> Request(string command, object payload = null)
            {
                Requests++;
                var json = NativeBridge.Serialize(Requests, command, payload);
                if (command == "events" && Capture) foreach (var item in (JArray)JObject.Parse(json)["payload"]) Events.Add((JObject)item);
                if (command == "start" || command == "status")
                    return Task.FromResult(JObject.FromObject(new { success = true, sessionId = "perf-session", telemetryOnly = false }));
                return Task.FromResult(JObject.FromObject(new { success = true }));
            }
            public bool Capture;
            public void Poll() { }
            public void Frame(byte[] bytes, string session, long timestamp) { }
            public void Dispose() { }
        }
        static readonly bool perThreadAllocations = ProbeAllocations();
        static bool ProbeAllocations()
        {
            long before = GC.GetAllocatedBytesForCurrentThread();
            var probe = new byte[8192]; GC.KeepAlive(probe);
            return GC.GetAllocatedBytesForCurrentThread() - before >= 8192;
        }
        // Boehm-based editors lack per-thread counters and refuse to pause the GC.
        // After a full collection, heap growth across a short window is the
        // allocation volume; a collection inside the window invalidates the sample.
        static long AllocatedBytes(Action run)
        {
            if (perThreadAllocations) { long before = GC.GetAllocatedBytesForCurrentThread(); run(); return GC.GetAllocatedBytesForCurrentThread() - before; }
            GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect();
            int collections = GC.CollectionCount(0);
            long start = GC.GetTotalMemory(false);
            run();
            long end = GC.GetTotalMemory(false);
            return GC.CollectionCount(0) == collections ? Math.Max(0, end - start) : -1;
        }
        static (double microseconds, double bytes) Measure(int operations, Action<int> action)
        {
            for (int i = 0; i < Math.Min(64, operations); i++) action(i);
            var clock = Stopwatch.StartNew();
            for (int i = 0; i < operations; i++) action(i);
            clock.Stop();
            long bytes = AllocatedBytes(() => { for (int i = 0; i < operations; i++) action(i); });
            return (clock.Elapsed.TotalMilliseconds * 1000 / operations, bytes < 0 ? -1 : bytes / (double)operations);
        }
        static void Report(string name, (double microseconds, double bytes) cost) =>
            Debug.Log($"[RejourneyPerf] {name} us_per_op={cost.microseconds:F2} bytes_per_op={cost.bytes:F0}");
        // Budgets sit well above today's measurements; -1 means a GC ran inside the window.
        static void Budget(string name, (double microseconds, double bytes) cost, double maximumBytes)
        {
            if (cost.bytes >= 0) Assert.That(cost.bytes, Is.LessThanOrEqualTo(maximumBytes), name + " allocation budget");
        }

        SerializingBridge bridge;
        IEnumerator StartRecording()
        {
            bridge = new SerializingBridge(); RejourneyBehaviour.BridgeFactory = () => bridge;
            Rejourney.Init("rj_synthetic_test");
            var start = Rejourney.StartAsync(); while (!start.IsCompleted) yield return null;
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.Recording));
        }
        [TearDown] public void Teardown()
        {
            if (Rejourney.Host) UnityEngine.Object.DestroyImmediate(Rejourney.Host.gameObject);
            RejourneyBehaviour.BridgeFactory = null;
        }

        [UnityTest] public IEnumerator EventPipelineCost()
        {
            yield return StartRecording();
            var host = Rejourney.Host;
            // Warmup, timing and allocation passes stay below the 512-log and 2048-event caps.
            const int count = 200;
            var messages = new string[count];
            for (int i = 0; i < count; i++) messages[i] = "Synthetic stress log " + i;
            var drainedBefore = host.DrainEvents(); while (!drainedBefore.IsCompleted) yield return null;
            // Unity's log callback path, exactly as Debug.Log reaches the SDK.
            var flags = System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance;
            var onLog = (Action<string, string, LogType>)Delegate.CreateDelegate(typeof(Action<string, string, LogType>), host, typeof(RejourneyBehaviour).GetMethod("OnLog", flags));
            var drainLogs = (Action<int>)Delegate.CreateDelegate(typeof(Action<int>), host, typeof(RejourneyBehaviour).GetMethod("DrainLogs", flags));
            Report("event.log.capture", Measure(count, i => onLog(messages[i], "", LogType.Log)));
            var serialize = Measure(count, i => drainLogs(1));
            Report("event.log.serialize", serialize);
            Budget("event.log.serialize", serialize, 1024);
            drainLogs(512);
            // What DrainLogs did before direct writing: the generic path plus level string allocations.
            Report("event.log.serialize.legacy", Measure(count, i => host.Event("log", new { message = messages[i], level = LogType.Log.ToString().ToLowerInvariant() })));
            Report("event.custom.legacy", Measure(count, i => host.Event("custom", new { name = "stress_tick", properties = new Dictionary<string, object> { ["frame"] = i } })));
            var custom = Measure(count, i => host.CustomEvent("stress_tick", new Dictionary<string, object> { ["frame"] = i }));
            Report("event.custom", custom);
            Budget("event.custom (including the caller's dictionary)", custom, 3072);
            Task drain = null; var clock = Stopwatch.StartNew();
            // This bridge completes synchronously, so the drain finishes inside the measured window.
            long drainBytes = AllocatedBytes(() => drain = host.DrainEvents());
            clock.Stop();
            while (!drain.IsCompleted) yield return null;
            // Each Measure call runs warmup + timed + allocation passes: 464 events for each of four probes.
            int drained = 4 * (Math.Min(64, count) + 2 * count);
            Report("event.drain", (clock.Elapsed.TotalMilliseconds * 1000 / drained, drainBytes < 0 ? -1 : drainBytes / (double)drained));
            Assert.That(host.Health.EventsDropped, Is.EqualTo(0));
        }

        [UnityTest] public IEnumerator TouchEventCost()
        {
            yield return StartRecording();
            var host = Rejourney.Host;
            var began = Measure(300, i => InputObserver.Touch(host, i % 5, new Vector2(100 + i % 300, 200), "Began"));
            Report("event.touch.began", began);
            Budget("event.touch.began", began, 2048);
            var drain = host.DrainEvents(); while (!drain.IsCompleted) yield return null;
        }

        // Directly written hot events must serialize exactly like the generic path.
        [UnityTest] public IEnumerator DirectEventJsonMatchesGenericSerialization()
        {
            yield return StartRecording();
            var host = Rejourney.Host;
            var flushed = host.DrainEvents(); while (!flushed.IsCompleted) yield return null;
            bridge.Capture = true;
            host.TouchEvent(12.5f, 40f, "Began", 3, false, null, 1234);
            host.Event("touch", new { x = 12.5f, y = 40f, phase = "Began", pointerId = 3, gestureType = "tap", rageEligible = false, targetLabel = (string)null,
                touches = new[] { new { x = 12.5f, y = 40f, timestamp = 1234L } }, screenWidth = Screen.width, screenHeight = Screen.height, coordinateSpace = "px" });
            host.TouchEvent(99f, 7.25f, "Moved", 1, true, "Buy_button", 99);
            host.Event("motion", new { x = 99f, y = 7.25f, phase = "Moved", pointerId = 1, gestureType = "touch_move", rageEligible = true, targetLabel = "Buy_button",
                touches = new[] { new { x = 99f, y = 7.25f, timestamp = 99L } }, screenWidth = Screen.width, screenHeight = Screen.height, coordinateSpace = "px" });
            var properties = new Dictionary<string, object> { ["amount"] = 3, ["currency"] = "TEST", ["ratio"] = 0.25f, ["ok"] = true, ["note"] = "a\"b" };
            host.CustomEvent("purchase_completed", properties);
            host.Event("custom", new { name = "purchase_completed", properties });
            host.CustomEvent("no_properties", null);
            host.Event("custom", new { name = "no_properties", properties = (IDictionary<string, object>)null });
            // Exact text, not just equivalent JSON: escaping and number formatting must match.
            var queue = (System.Collections.Concurrent.ConcurrentQueue<string>)typeof(RejourneyBehaviour)
                .GetField("events", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance).GetValue(host);
            var raw = queue.ToArray();
            Assert.That(raw.Length, Is.EqualTo(8));
            var envelope = new System.Text.RegularExpressions.Regex("\"timestamp\":\\d+,\"sessionId\"");
            for (int i = 0; i < raw.Length; i += 2)
                Assert.That(envelope.Replace(raw[i], "\"timestamp\":0,\"sessionId\""), Is.EqualTo(envelope.Replace(raw[i + 1], "\"timestamp\":0,\"sessionId\"")));
            Debug.Log("Synthetic \"parity\" log \u2713");
            Debug.LogWarning("Synthetic parity warning");
            var flush = Rejourney.FlushAsync(); while (!flush.IsCompleted) yield return null;
            bridge.Capture = false;
            Assert.That(bridge.Events.Count, Is.GreaterThanOrEqualTo(10));
            for (int i = 0; i < 8; i += 2) {
                var direct = (JObject)bridge.Events[i].DeepClone(); var generic = (JObject)bridge.Events[i + 1].DeepClone();
                direct.Remove("timestamp"); generic.Remove("timestamp");
                Assert.That(direct.ToString(Newtonsoft.Json.Formatting.None), Is.EqualTo(generic.ToString(Newtonsoft.Json.Formatting.None)));
            }
            var logs = bridge.Events.FindAll(e => (string)e["type"] == "log" && ((string)e["message"]).StartsWith("Synthetic", StringComparison.Ordinal));
            Assert.That(logs.Count, Is.EqualTo(2));
            Assert.That((string)logs[0]["message"], Is.EqualTo("Synthetic \"parity\" log \u2713"));
            Assert.That((string)logs[0]["level"], Is.EqualTo("log"));
            Assert.That((string)logs[1]["level"], Is.EqualTo("warning"));
            Assert.That(string.Join(",", ((JObject)logs[0]).Properties().Select(p => p.Name)), Is.EqualTo("message,level,type,timestamp,sessionId"));
            Assert.That((string)logs[0]["sessionId"], Is.EqualTo("perf-session"));
        }

        [Test] public void MaskBoundsCost()
        {
            var canvas = new GameObject("Perf canvas", typeof(Canvas));
            canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var panel = new GameObject("Masked panel", typeof(RectTransform));
            panel.transform.SetParent(canvas.transform, false);
            for (int i = 0; i < 12; i++) new GameObject("Child " + i, typeof(RectTransform)).transform.SetParent(panel.transform, false);
            try {
                var cost = Measure(1000, i => PrivacyRegistry.TryBounds(panel, out Rect _));
                Report("privacy.bounds.rect_subtree_13", cost);
                Budget("privacy.bounds", cost, 64);
                Assert.That(PrivacyRegistry.TryBounds(panel, out var rect), Is.True);
                Assert.That(rect.width, Is.GreaterThanOrEqualTo(0));
            } finally { UnityEngine.Object.DestroyImmediate(canvas); }
        }

        [Test] public void PrivacyCollectCost()
        {
            var canvas = new GameObject("Perf canvas", typeof(Canvas));
            canvas.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            var targets = new List<GameObject>();
            for (int i = 0; i < 8; i++) {
                var target = new GameObject("Sensitive " + i, typeof(RectTransform));
                target.transform.SetParent(canvas.transform, false);
                ((RectTransform)target.transform).anchoredPosition = new Vector2(i * 40, i * 20);
                Rejourney.Mask(target); targets.Add(target);
            }
            var masks = new List<Rect>(128);
            try {
                var cost = Measure(500, i => PrivacyRegistry.Collect(masks, true));
                Report("privacy.collect.masks_8", cost);
                Assert.That(PrivacyRegistry.Collect(masks, true), Is.True);
                Assert.That(masks.Count, Is.GreaterThanOrEqualTo(8));
            } finally {
                foreach (var target in targets) Rejourney.Unmask(target);
                UnityEngine.Object.DestroyImmediate(canvas);
            }
        }
    }
}
