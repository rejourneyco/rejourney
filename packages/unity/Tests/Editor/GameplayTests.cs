using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine.TestTools;

namespace RejourneySDK.Tests
{
    public sealed class GameplayTests
    {
        sealed class Bridge : IRejourneyBridge
        {
            public string Session = "gameplay-session";
            public readonly List<JObject> Events = new List<JObject>();
            public Task<JObject> Request(string command, object payload = null)
            {
                if (command == "events") foreach (var item in JArray.Parse(((RawJson)payload).Json)) Events.Add((JObject)item);
                if (command == "start" || command == "status")
                    return Task.FromResult(JObject.FromObject(new { success = true, sessionId = Session, telemetryOnly = true }));
                return Task.FromResult(JObject.FromObject(new { success = true, delivered = true }));
            }
            public void Poll() { }
            public void Frame(byte[] bytes, string session, long timestamp) { }
            public void Dispose() { }
            public List<JObject> Markers() => Events.Where(e => e.Value<string>("type") == "gameplay").ToList();
        }
        Bridge bridge;
        [SetUp] public void Setup()
        {
            if (Rejourney.IsGameplayActive) Rejourney.EndGameplay();
            bridge = new Bridge(); RejourneyBehaviour.BridgeFactory = () => bridge; Rejourney.Init("rj_synthetic_test");
        }
        [TearDown] public void Teardown()
        {
            if (Rejourney.IsGameplayActive) Rejourney.EndGameplay();
            if (Rejourney.Host) UnityEngine.Object.DestroyImmediate(Rejourney.Host.gameObject);
            RejourneyBehaviour.BridgeFactory = null;
        }
        IEnumerator Start() { var start = Rejourney.StartAsync(); while (!start.IsCompleted) yield return null; }
        IEnumerator Flush() { var flush = Rejourney.FlushAsync(); while (!flush.IsCompleted) yield return null; }

        [UnityTest] public IEnumerator StartAndEndShareIdOutcomeAndDuration()
        {
            yield return Start();
            var id = Rejourney.StartGameplay("level_3", new Dictionary<string, object> { ["difficulty"] = "hard" });
            Assert.That(Rejourney.IsGameplayActive, Is.True);
            Assert.That(Rejourney.ActiveGameplayId, Is.EqualTo(id));
            Rejourney.EndGameplay(GameplayOutcome.Completed, new Dictionary<string, object> { ["score"] = 1200 });
            Assert.That(Rejourney.IsGameplayActive, Is.False);
            yield return Flush();
            var markers = bridge.Markers();
            Assert.That(markers.Count, Is.EqualTo(2));
            Assert.That((string)markers[0]["phase"], Is.EqualTo("start"));
            Assert.That((string)markers[0]["gameplayId"], Is.EqualTo(id));
            Assert.That((string)markers[0]["name"], Is.EqualTo("level_3"));
            Assert.That((bool)markers[0]["continued"], Is.False);
            Assert.That((string)markers[0]["properties"]["difficulty"], Is.EqualTo("hard"));
            Assert.That((string)markers[0]["sessionId"], Is.EqualTo("gameplay-session"));
            Assert.That((string)markers[1]["phase"], Is.EqualTo("end"));
            Assert.That((string)markers[1]["gameplayId"], Is.EqualTo(id));
            Assert.That((string)markers[1]["outcome"], Is.EqualTo("completed"));
            Assert.That((long)markers[1]["durationMs"], Is.GreaterThanOrEqualTo(0));
            Assert.That((int)markers[1]["properties"]["score"], Is.EqualTo(1200));
            Assert.That((long)markers[1]["timestamp"], Is.GreaterThanOrEqualTo((long)markers[0]["timestamp"]));
        }

        [UnityTest] public IEnumerator SegmentStartedBeforeRecordingIsMarkedInTheSession()
        {
            var id = Rejourney.StartGameplay("run");
            yield return Start();
            yield return Flush();
            var start = bridge.Markers().Single();
            Assert.That((string)start["gameplayId"], Is.EqualTo(id));
            Assert.That((bool)start["continued"], Is.True);
            Assert.That((long)start["startedAt"], Is.LessThanOrEqualTo((long)start["timestamp"]));
        }

        [UnityTest] public IEnumerator RolloverStartsTheIntervalAgainInTheNewSession()
        {
            yield return Start();
            var id = Rejourney.StartGameplay("match");
            yield return Flush();
            bridge.Session = "gameplay-session-2";
            typeof(RejourneyBehaviour).GetMethod("ApplyStatus", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                .Invoke(Rejourney.Host, new object[] { JObject.FromObject(new { success = true, sessionId = "gameplay-session-2", telemetryOnly = true }) });
            yield return Flush();
            var inNewSession = bridge.Markers().Where(e => (string)e["sessionId"] == "gameplay-session-2").ToList();
            Assert.That(inNewSession.Count, Is.EqualTo(1));
            Assert.That((string)inNewSession[0]["gameplayId"], Is.EqualTo(id));
            Assert.That((bool)inNewSession[0]["continued"], Is.True);
        }

        [UnityTest] public IEnumerator StopEndsTheSessionIntervalButNotTheSegment()
        {
            yield return Start();
            var id = Rejourney.StartGameplay("arena");
            var stop = Rejourney.StopAsync(); while (!stop.IsCompleted) yield return null;
            var end = bridge.Markers().Last();
            Assert.That((string)end["phase"], Is.EqualTo("end"));
            Assert.That((string)end["outcome"], Is.EqualTo(GameplayOutcome.SessionEnd));
            Assert.That((string)end["gameplayId"], Is.EqualTo(id));
            Assert.That(Rejourney.ActiveGameplayId, Is.EqualTo(id));
        }

        [UnityTest] public IEnumerator StartingAgainSupersedesAndScopesEndOnce()
        {
            yield return Start();
            var first = Rejourney.StartGameplay("round_1");
            string second;
            using (Rejourney.Gameplay("round_2")) second = Rejourney.ActiveGameplayId;
            var scope = Rejourney.Gameplay("round_3");
            var third = Rejourney.ActiveGameplayId;
            Rejourney.EndGameplay(GameplayOutcome.Failed);
            scope.Dispose();
            yield return Flush();
            var ends = bridge.Markers().Where(e => (string)e["phase"] == "end").ToList();
            Assert.That(ends.Select(e => (string)e["gameplayId"] + ":" + (string)e["outcome"]),
                Is.EqualTo(new[] { first + ":superseded", second + ":completed", third + ":failed" }));
            Assert.That(Rejourney.IsGameplayActive, Is.False);
        }

        [UnityTest] public IEnumerator TouchesDuringPlayAreTaggedAndNeverRageEligible()
        {
            yield return Start();
            Rejourney.Host.TouchEvent(10, 20, "Began", 0, true, "Menu/Play", 1);
            var id = Rejourney.StartGameplay("level");
            Rejourney.Host.TouchEvent(30, 40, "Began", 0, true, "HUD/Fire", 2);
            Rejourney.EndGameplay();
            Rejourney.Host.TouchEvent(50, 60, "Began", 0, true, "Results/Continue", 3);
            yield return Flush();
            var touches = bridge.Events.Where(e => (string)e["type"] == "touch").ToList();
            Assert.That(touches.Count, Is.EqualTo(3));
            Assert.That(touches[0]["gameplayId"], Is.Null);
            Assert.That((bool)touches[0]["rageEligible"], Is.True);
            Assert.That((string)touches[1]["gameplayId"], Is.EqualTo(id));
            Assert.That((bool)touches[1]["rageEligible"], Is.False);
            Assert.That(touches[2]["gameplayId"], Is.Null);
            Assert.That((bool)touches[2]["rageEligible"], Is.True);
        }

        static void AppPause(bool paused) =>
            typeof(RejourneyBehaviour).GetMethod("OnApplicationPause", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Instance)
                .Invoke(Rejourney.Host, new object[] { paused });

        // Unity does not order OnApplicationPause across scripts: a game's own handler may run
        // after the SDK has stopped collecting.
        [UnityTest] public IEnumerator EndFromThePauseHandlerIsWrittenWhenTheAppReturns()
        {
            yield return Start();
            var id = Rejourney.StartGameplay("level");
            AppPause(true);
            Rejourney.EndGameplay(GameplayOutcome.Quit, new Dictionary<string, object> { ["score"] = 7 });
            long endedBefore = GameplayTracker.Now();
            yield return null;
            AppPause(false);
            yield return Flush();
            var markers = bridge.Markers();
            Assert.That(markers.Select(e => (string)e["phase"] + ":" + (string)e["gameplayId"]), Is.EqualTo(new[] { "start:" + id, "end:" + id }));
            Assert.That((string)markers[1]["outcome"], Is.EqualTo("quit"));
            Assert.That((int)markers[1]["properties"]["score"], Is.EqualTo(7));
            Assert.That((long)markers[1]["timestamp"], Is.LessThanOrEqualTo(endedBefore), "the end keeps the time it happened");
        }

        [UnityTest] public IEnumerator StartFromTheResumeHandlerIsWrittenWhenCollectionResumes()
        {
            yield return Start();
            AppPause(true);
            var id = Rejourney.StartGameplay("level");
            long startedBefore = GameplayTracker.Now();
            AppPause(false);
            yield return Flush();
            var start = bridge.Markers().Single();
            Assert.That((string)start["gameplayId"], Is.EqualTo(id));
            Assert.That((bool)start["continued"], Is.False, "the segment began inside this session");
            Assert.That((long)start["timestamp"], Is.LessThanOrEqualTo(startedBefore));
        }

        [UnityTest] public IEnumerator SegmentsChangedDuringAnExplicitPauseAreWrittenOnResume()
        {
            yield return Start();
            var first = Rejourney.StartGameplay("round_1");
            var pause = Rejourney.PauseAsync(); while (!pause.IsCompleted) yield return null;
            var second = Rejourney.StartGameplay("round_2");
            Assert.That(bridge.Markers().Count, Is.EqualTo(1));
            var resume = Rejourney.ResumeAsync(); while (!resume.IsCompleted) yield return null;
            yield return Flush();
            Assert.That(bridge.Markers().Select(e => (string)e["phase"] + ":" + (string)e["gameplayId"] + ":" + ((string)e["outcome"] ?? "-")),
                Is.EqualTo(new[] { "start:" + first + ":-", "end:" + first + ":superseded", "start:" + second + ":-" }));
        }

        [UnityTest] public IEnumerator OversizedPropertiesAreDroppedNotTheMarker()
        {
            yield return Start();
            Rejourney.StartGameplay("level", new Dictionary<string, object> { ["blob"] = new string('x', 5000) });
            yield return Flush();
            var start = bridge.Markers().Single();
            Assert.That(start["properties"], Is.Null);
            Assert.That((string)start["name"], Is.EqualTo("level"));
        }
    }
}
