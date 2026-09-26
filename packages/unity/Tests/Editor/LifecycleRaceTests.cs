using System;
using System.Collections;
using System.Collections.Generic;
using System.Threading.Tasks;
using System.Net;
using System.Net.Http;
using System.Threading;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
namespace RejourneySDK.Tests
{
    public sealed class LifecycleRaceTests
    {
        sealed class Bridge : IRejourneyBridge
        {
            public readonly Queue<TaskCompletionSource<JObject>> Starts = new Queue<TaskCompletionSource<JObject>>();
            public readonly Dictionary<string, int> Calls = new Dictionary<string, int>();
            public readonly Dictionary<string, TaskCompletionSource<JObject>> Held = new Dictionary<string, TaskCompletionSource<JObject>>();
            public readonly List<JObject> Events = new List<JObject>();
            public Task<JObject> Request(string command, object payload = null) {
                Calls[command] = Calls.TryGetValue(command, out var count) ? count + 1 : 1;
                if (command == "events") foreach (var item in JArray.Parse(((RawJson)payload).Json)) Events.Add((JObject)item);
                if (Held.TryGetValue(command, out var held)) return held.Task;
                if (command == "start") { var source = new TaskCompletionSource<JObject>(); Starts.Enqueue(source); return source.Task; }
                if (command == "status") return Task.FromResult(JObject.FromObject(new { success = true, sessionId = "synthetic-2", telemetryOnly = true }));
                return Task.FromResult(JObject.FromObject(new { success = true, delivered = true }));
            }
            public void Poll() { }
            public void Frame(byte[] bytes, string session, long timestamp) { }
            public void Dispose() { }
            public void Complete(string session) => Starts.Dequeue().SetResult(JObject.FromObject(new { success = true, sessionId = session, telemetryOnly = true }));
        }
        Bridge bridge;
        [SetUp] public void Setup() { bridge = new Bridge(); RejourneyBehaviour.BridgeFactory = () => bridge; Rejourney.Init("rj_synthetic_test"); }
        [TearDown] public void Teardown() { if (Rejourney.Host) UnityEngine.Object.DestroyImmediate(Rejourney.Host.gameObject); RejourneyBehaviour.BridgeFactory = null; }
        [UnityTest] public IEnumerator StopDuringStartRejectsLateSessionAndAllowsRestart()
        {
            var old = Rejourney.StartAsync();
            var stop = Rejourney.StopAsync(); while (!stop.IsCompleted) yield return null;
            var fresh = Rejourney.StartAsync();
            bridge.Complete("stale-session"); while (!old.IsCompleted) yield return null;
            Assert.That(old.Result.Success, Is.False);
            Assert.That(Rejourney.CurrentSessionId, Is.Null);
            bridge.Complete("synthetic-2"); while (!fresh.IsCompleted) yield return null;
            Assert.That(fresh.Result.Success, Is.True);
            Assert.That(Rejourney.CurrentSessionId, Is.EqualTo("synthetic-2"));
        }
        [UnityTest] public IEnumerator RepeatedStartAndPauseAreIdempotent()
        {
            var first = Rejourney.StartAsync(); var second = Rejourney.StartAsync();
            Assert.That(bridge.Calls["start"], Is.EqualTo(1));
            bridge.Complete("synthetic-2"); while (!first.IsCompleted || !second.IsCompleted) yield return null;
            var pause = Rejourney.PauseAsync(); while (!pause.IsCompleted) yield return null;
            pause = Rejourney.PauseAsync(); while (!pause.IsCompleted) yield return null;
            Assert.That(bridge.Calls["pause"], Is.EqualTo(1));
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.Paused));
            var resume = Rejourney.ResumeAsync(); while (!resume.IsCompleted) yield return null;
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.TelemetryOnly));
        }
        [UnityTest] public IEnumerator ActiveProjectCannotBeReconfigured()
        {
            var started = Rejourney.StartAsync(); bridge.Complete("synthetic-2"); while (!started.IsCompleted) yield return null;
            Assert.Throws<InvalidOperationException>(() => Rejourney.Init("rj_another_project"));
            Assert.That(Rejourney.CurrentSessionId, Is.EqualTo("synthetic-2"));
        }
        [UnityTest] public IEnumerator SameProjectCanChangeCaptureOptionsAfterStop()
        {
            var started = Rejourney.StartAsync(); bridge.Complete("synthetic-2"); while (!started.IsCompleted) yield return null;
            var stop = Rejourney.StopAsync(); while (!stop.IsCompleted) yield return null;
            Rejourney.Init("rj_synthetic_test", new RejourneyOptions { ObserveOnly = true, FramesPerSecond = 3 });
            Assert.That(Rejourney.Host.Options.ObserveOnly, Is.True);
            Assert.That(Rejourney.Host.Options.FramesPerSecond, Is.EqualTo(3));
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.Ready));
        }
        [UnityTest] public IEnumerator StopDuringResumeCannotReactivateCapture()
        {
            var start = Rejourney.StartAsync(); bridge.Complete("synthetic-2"); while (!start.IsCompleted) yield return null;
            var pause = Rejourney.PauseAsync(); while (!pause.IsCompleted) yield return null;
            var completion = new TaskCompletionSource<JObject>(); bridge.Held["resume"] = completion;
            var resume = Rejourney.ResumeAsync(); var stop = Rejourney.StopAsync(); while (!stop.IsCompleted) yield return null;
            completion.SetResult(JObject.FromObject(new { success = true })); while (!resume.IsCompleted) yield return null;
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.Stopped));
            Assert.That(Rejourney.CurrentSessionId, Is.Null);
        }
        [UnityTest] public IEnumerator PauseAndResumeDuringStartDoNotDeadlock()
        {
            var start = Rejourney.StartAsync(); var pause = Rejourney.PauseAsync(); var resume = Rejourney.ResumeAsync();
            bridge.Complete("synthetic-2");
            for (int i = 0; i < 60 && (!start.IsCompleted || !pause.IsCompleted || !resume.IsCompleted); i++) yield return null;
            Assert.That(start.IsCompleted && pause.IsCompleted && resume.IsCompleted, Is.True);
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.TelemetryOnly));
        }
        sealed class DeferredHandler : HttpMessageHandler
        {
            internal readonly TaskCompletionSource<HttpResponseMessage> Completion = new TaskCompletionSource<HttpResponseMessage>();
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) => Completion.Task;
        }
        [UnityTest] public IEnumerator RequestStartedBeforeConsentIsNotCapturedAfterStart()
        {
            var handler = new DeferredHandler();
            using (var client = NetworkCapture.CreateHttpClient(handler)) {
                var response = client.GetAsync("https://synthetic.example/before-consent");
                var start = Rejourney.StartAsync(); bridge.Complete("synthetic-2"); while (!start.IsCompleted) yield return null;
                handler.Completion.SetResult(new HttpResponseMessage(HttpStatusCode.OK)); while (!response.IsCompleted) yield return null;
                using (response.Result) { }
                var flush = Rejourney.FlushAsync(); while (!flush.IsCompleted) yield return null;
                Assert.That(bridge.Events.Exists(e => e.Value<string>("type") == "network_request"), Is.False);
            }
        }
        [UnityTest] public IEnumerator OldRequestCannotEnterReplacementSession()
        {
            var start = Rejourney.StartAsync(); bridge.Complete("old"); while (!start.IsCompleted) yield return null;
            var handler = new DeferredHandler();
            using (var client = NetworkCapture.CreateHttpClient(handler)) {
                var response = client.GetAsync("https://synthetic.example/prior-session");
                var stop = Rejourney.StopAsync(); while (!stop.IsCompleted) yield return null;
                start = Rejourney.StartAsync(); bridge.Complete("replacement"); while (!start.IsCompleted) yield return null;
                handler.Completion.SetResult(new HttpResponseMessage(HttpStatusCode.OK)); while (!response.IsCompleted) yield return null;
                using (response.Result) { }
                var flush = Rejourney.FlushAsync(); while (!flush.IsCompleted) yield return null;
                Assert.That(bridge.Events.Exists(e => e.Value<string>("type") == "network_request"), Is.False);
            }
        }
        [UnityTest] public IEnumerator FlushPreservesHandledErrorsAndNetworkReplayProperties()
        {
            Rejourney.Host.Options.CaptureLogs = false;
            var start = Rejourney.StartAsync(); bridge.Complete("synthetic-2"); while (!start.IsCompleted) yield return null;
            Rejourney.CaptureException(new InvalidOperationException("synthetic handled"));
            Rejourney.LogNetworkRequest(new NetworkRequestInfo { Method = "GET", Url = "https://synthetic.example/a?secret=omit", StatusCode = 202, DurationMilliseconds = 17, StartedAtUnixMilliseconds = 1770000000100 });
            var flush = Rejourney.FlushAsync(); while (!flush.IsCompleted) yield return null;
            var error = bridge.Events.Find(e => e.Value<string>("type") == "error");
            Assert.That(error.Value<bool>("handled"), Is.True);
            Assert.That(error.Value<string>("name"), Is.EqualTo("System.InvalidOperationException"));
            var network = bridge.Events.Find(e => e.Value<string>("type") == "network_request");
            Assert.That(network.Value<long>("timestamp"), Is.EqualTo(1770000000100));
            Assert.That(network["properties"].Value<string>("url"), Is.EqualTo("https://synthetic.example/a"));
            Assert.That(network.Value<int>("statusCode"), Is.EqualTo(202));
        }
        [UnityTest] public IEnumerator FailedEventDrainStillStopsNativeAndReturnsTypedFailure()
        {
            var start = Rejourney.StartAsync(); bridge.Complete("synthetic-2"); while (!start.IsCompleted) yield return null;
            var failure = new TaskCompletionSource<JObject>(); failure.SetException(new InvalidOperationException("synthetic queue failure")); bridge.Held["events"] = failure;
            Rejourney.LogEvent("queued-before-stop");
            var stop = Rejourney.StopAsync(); while (!stop.IsCompleted) yield return null;
            Assert.That(stop.Result.State, Is.EqualTo(DeliveryState.Failed));
            Assert.That(bridge.Calls["stop"], Is.EqualTo(1));
            Assert.That(Rejourney.CurrentSessionId, Is.Null);
        }
        [UnityTest] public IEnumerator ManualAndUnityLogExceptionAreReportedOnce()
        {
            var start = Rejourney.StartAsync(); bridge.Complete("synthetic-2"); while (!start.IsCompleted) yield return null;
            try { throw new InvalidOperationException("synthetic deduplication"); }
            catch (Exception error) {
                Rejourney.CaptureException(error);
                LogAssert.Expect(LogType.Exception, new System.Text.RegularExpressions.Regex("synthetic deduplication"));
                Debug.LogException(error);
            }
            var flush = Rejourney.FlushAsync(); while (!flush.IsCompleted) yield return null;
            Assert.That(bridge.Events.FindAll(e => e.Value<string>("type") == "error").Count, Is.EqualTo(1));
        }
        [UnityTest] public IEnumerator UnityErrorsAreReportedWhenConsoleLogsAreOff()
        {
            Rejourney.Host.Options.CaptureLogs = false;
            var start = Rejourney.StartAsync(); bridge.Complete("synthetic-2"); while (!start.IsCompleted) yield return null;
            Debug.Log("synthetic console line");
            LogAssert.Expect(LogType.Error, "synthetic unity error");
            Debug.LogError("synthetic unity error");
            var flush = Rejourney.FlushAsync(); while (!flush.IsCompleted) yield return null;
            Assert.That(bridge.Events.Exists(e => e.Value<string>("type") == "error" && e.Value<string>("message") == "synthetic unity error"), Is.True);
            Assert.That(bridge.Events.Exists(e => e.Value<string>("type") == "log"), Is.False);
        }
        sealed class InFlightBridge : IRejourneyBridge
        {
            public readonly List<string> Commands = new List<string>();
            public TaskCompletionSource<JObject> FirstEvents;
            public Task<JObject> Request(string command, object payload = null)
            {
                if (command == "events") {
                    bool error = false;
                    foreach (var item in JArray.Parse(((RawJson)payload).Json)) error |= item.Value<string>("type") == "error";
                    Commands.Add(error ? "events:error" : "events");
                    if (FirstEvents == null) { FirstEvents = new TaskCompletionSource<JObject>(); return FirstEvents.Task; }
                } else Commands.Add(command);
                if (command == "start" || command == "status") return Task.FromResult(JObject.FromObject(new { success = true, sessionId = "inflight-session", telemetryOnly = true }));
                return Task.FromResult(JObject.FromObject(new { success = true, delivered = true }));
            }
            public void Poll() { }
            public void Frame(byte[] bytes, string session, long timestamp) { }
            public void Dispose() { }
        }
        // Device regression: native requests resolve frames later, so a background drain
        // is usually in flight. An error queued just before PauseAsync must still reach
        // native before it pauses; native discards events received while paused.
        [UnityTest] public IEnumerator ErrorQueuedDuringInFlightDrainReachesNativeBeforePause()
        {
            var inflight = new InFlightBridge(); RejourneyBehaviour.BridgeFactory = () => inflight;
            Rejourney.Init("rj_synthetic_test");
            var start = Rejourney.StartAsync(); while (!start.IsCompleted) yield return null;
            Rejourney.LogEvent("before-drain");
            var background = Rejourney.Host.DrainEvents();
            Assert.That(inflight.FirstEvents, Is.Not.Null, "The first event batch must be held in flight.");
            Rejourney.CaptureException(new InvalidOperationException("queued during an in-flight drain"));
            var pause = Rejourney.PauseAsync();
            inflight.FirstEvents.SetResult(JObject.FromObject(new { success = true }));
            while (!pause.IsCompleted || !background.IsCompleted) yield return null;
            Assert.That(inflight.Commands, Does.Contain("events:error"));
            Assert.That(inflight.Commands.IndexOf("events:error"), Is.LessThan(inflight.Commands.IndexOf("pause")));
        }
    }
}
