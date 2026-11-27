using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine.TestTools;

namespace RejourneySDK.Tests
{
    // Native replaces the session after a background of 60 seconds or more and reports no
    // session for a moment while it does.
    public sealed class RolloverTests
    {
        sealed class Bridge : IRejourneyBridge
        {
            public string StartSession = "session-1";
            public JObject StartFailure;
            public readonly List<JObject> Events = new List<JObject>();
            public readonly List<string> Commands = new List<string>();
            public int Count(string command) => Commands.Count(c => c == command);
            public Task<JObject> Request(string command, object payload = null)
            {
                Commands.Add(command);
                if (command == "events") foreach (var item in JArray.Parse(((RawJson)payload).Json)) Events.Add((JObject)item);
                if (command == "start") return Task.FromResult(StartFailure ?? Status(StartSession));
                if (command == "status") return Task.FromResult(Status(Rejourney.CurrentSessionId));
                return Task.FromResult(JObject.FromObject(new { success = true, delivered = true }));
            }
            public void Poll() { }
            public void Frame(byte[] bytes, string session, long timestamp) { }
            public void Dispose() { }
            public List<JObject> For(string session, string type) =>
                Events.Where(e => (string)e["sessionId"] == session && (string)e["type"] == type).ToList();
        }
        static JObject Status(string session) => JObject.FromObject(new { success = true, sessionId = session, telemetryOnly = true });
        static readonly JObject NoSession = JObject.FromObject(new { success = false, sessionId = "" });
        static void Apply(JObject status) =>
            typeof(RejourneyBehaviour).GetMethod("ApplyStatus", BindingFlags.NonPublic | BindingFlags.Instance).Invoke(Rejourney.Host, new object[] { status });

        Bridge bridge;
        readonly List<CaptureState> states = new List<CaptureState>();
        double grace, endGrace;
        // Native ending the session for good, with the continuation turned off: the earlier behavior.
        static void WithoutContinuation() => Rejourney.Init("rj_synthetic_test", new RejourneyOptions { ContinueAfterSessionLimit = false });
        [SetUp] public void Setup()
        {
            if (Rejourney.IsGameplayActive) Rejourney.EndGameplay();
            grace = RejourneyBehaviour.NativeSessionGapGraceSeconds; endGrace = RejourneyBehaviour.NativeSessionEndGraceSeconds;
            bridge = new Bridge(); RejourneyBehaviour.BridgeFactory = () => bridge; Rejourney.Init("rj_synthetic_test");
            states.Clear(); Rejourney.StateChanged += states.Add;
        }
        [TearDown] public void Teardown()
        {
            Rejourney.StateChanged -= states.Add;
            RejourneyBehaviour.NativeSessionGapGraceSeconds = grace; RejourneyBehaviour.NativeSessionEndGraceSeconds = endGrace;
            if (Rejourney.IsGameplayActive) Rejourney.EndGameplay();
            if (Rejourney.Host) UnityEngine.Object.DestroyImmediate(Rejourney.Host.gameObject);
            RejourneyBehaviour.BridgeFactory = null;
        }
        IEnumerator Start() { var start = Rejourney.StartAsync(); while (!start.IsCompleted) yield return null; }
        IEnumerator Flush() { var flush = Rejourney.FlushAsync(); while (!flush.IsCompleted) yield return null; }

        [UnityTest] public IEnumerator GapKeepsTheStateAndTheNewSessionGetsItsMarkers()
        {
            yield return Start();
            Rejourney.TrackScreen("Arena");
            var id = Rejourney.StartGameplay("arena");
            states.Clear();
            Apply(NoSession);
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.TelemetryOnly));
            Assert.That(Rejourney.CurrentSessionId, Is.EqualTo("session-1"));
            Apply(NoSession);
            Apply(Status("session-2"));
            yield return Flush();
            Assert.That(states, Has.No.Member(CaptureState.Error));
            Assert.That(Rejourney.CurrentSessionId, Is.EqualTo("session-2"));
            var starts = bridge.For("session-2", "gameplay");
            Assert.That(starts.Count, Is.EqualTo(1));
            Assert.That((string)starts[0]["gameplayId"], Is.EqualTo(id));
            Assert.That((bool)starts[0]["continued"], Is.True);
            Assert.That(bridge.For("session-2", "screen_view").Select(e => (string)e["screen"]), Is.EqualTo(new[] { "Arena" }));
        }

        [UnityTest] public IEnumerator GapBecomesAnErrorAfterTheGracePeriod()
        {
            WithoutContinuation();
            yield return Start();
            RejourneyBehaviour.NativeSessionGapGraceSeconds = 0;
            Apply(NoSession);
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.Error));
        }

        [UnityTest] public IEnumerator RestartAfterAnErrorWritesTheSessionMarkersOnce()
        {
            WithoutContinuation();
            yield return Start();
            Rejourney.TrackScreen("Arena");
            var id = Rejourney.StartGameplay("arena");
            RejourneyBehaviour.NativeSessionGapGraceSeconds = 0;
            Apply(NoSession);
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.Error));
            bridge.StartSession = "session-2";
            yield return Start();
            yield return Flush();
            Assert.That(Rejourney.CurrentSessionId, Is.EqualTo("session-2"));
            Assert.That(bridge.For("session-2", "gameplay").Select(e => (string)e["gameplayId"] + ":" + (bool)e["continued"]), Is.EqualTo(new[] { id + ":True" }));
            Assert.That(bridge.For("session-2", "screen_view").Count, Is.EqualTo(1));
        }

        // The project's recording-time limit ends the native session while the game plays on.
        // The SDK starts the next session itself, so errors and crashes later in a long play
        // session are still reported, and the game never sees an Error state.
        [UnityTest] public IEnumerator SessionEndedByNativeContinuesInANewSession()
        {
            yield return Start();
            Rejourney.TrackScreen("Arena");
            var id = Rejourney.StartGameplay("arena");
            states.Clear();
            RejourneyBehaviour.NativeSessionEndGraceSeconds = 0;
            bridge.StartSession = "session-2";
            Apply(NoSession);
            yield return null;
            Rejourney.LogEvent("after_limit");
            yield return Flush();
            Assert.That(states, Has.No.Member(CaptureState.Error));
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.TelemetryOnly));
            Assert.That(Rejourney.CurrentSessionId, Is.EqualTo("session-2"));
            Assert.That(bridge.Count("start"), Is.EqualTo(2));
            Assert.That(Rejourney.Health.SessionsContinued, Is.EqualTo(1));
            Assert.That(bridge.For("session-2", "gameplay").Select(e => (string)e["gameplayId"] + ":" + (bool)e["continued"]), Is.EqualTo(new[] { id + ":True" }));
            Assert.That(bridge.For("session-2", "screen_view").Select(e => (string)e["screen"]), Is.EqualTo(new[] { "Arena" }));
            Assert.That(bridge.For("session-2", "custom").Select(e => (string)e["name"]), Has.Member("after_limit"));
        }

        [UnityTest] public IEnumerator SessionEndedByNativeIsConfirmedBeforeContinuing()
        {
            yield return Start();
            Apply(NoSession);
            Assert.That(bridge.Count("start"), Is.EqualTo(1), "a single status without a session must not restart at once");
            Assert.That(Rejourney.CurrentSessionId, Is.EqualTo("session-1"));
        }

        [UnityTest] public IEnumerator ContinuationKeepsAnExplicitPause()
        {
            yield return Start();
            var pause = Rejourney.PauseAsync(); while (!pause.IsCompleted) yield return null;
            states.Clear();
            RejourneyBehaviour.NativeSessionEndGraceSeconds = 0;
            bridge.StartSession = "session-2";
            Apply(NoSession);
            yield return null;
            Assert.That(Rejourney.CurrentSessionId, Is.EqualTo("session-2"));
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.Paused));
            Assert.That(states, Has.No.Member(CaptureState.Error));
            Assert.That(bridge.Count("pause"), Is.EqualTo(2), "the new native session must be paused too");
        }

        [UnityTest] public IEnumerator ContinuationReportsWhyTheNextSessionDidNotStart()
        {
            yield return Start();
            RejourneyBehaviour.NativeSessionEndGraceSeconds = 0;
            bridge.StartFailure = JObject.FromObject(new { success = false, error = "sampled_out" });
            Apply(NoSession);
            yield return null;
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.Disabled));
            Assert.That(bridge.Count("start"), Is.EqualTo(2));
        }

        [UnityTest] public IEnumerator SessionThatKeepsVanishingBecomesAnError()
        {
            yield return Start();
            RejourneyBehaviour.NativeSessionEndGraceSeconds = 0;
            for (int i = 0; i < 8 && Rejourney.State != CaptureState.Error; i++) { Apply(NoSession); yield return null; }
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.Error));
            Assert.That(bridge.Count("start"), Is.EqualTo(4), "three continuations in quick succession, then stop trying");
        }

        [UnityTest] public IEnumerator ErrorsFromNativeAreNotTreatedAsAGap()
        {
            yield return Start();
            Apply(JObject.FromObject(new { success = false, error = "disabled" }));
            Assert.That(Rejourney.State, Is.EqualTo(CaptureState.Disabled));
        }
    }
}
