using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace RejourneySDK.Tests
{
    // Error events carry the fields the issue feed groups and labels by, the same way the
    // React Native and Flutter SDKs send them: the exception type as the category, whether
    // the game handled it, and an incident id for deduplication.
    public sealed class CaptureTests
    {
        sealed class Bridge : IRejourneyBridge
        {
            public readonly List<JObject> Events = new List<JObject>();
            public Task<JObject> Request(string command, object payload = null)
            {
                if (command == "events") foreach (var item in JArray.Parse(((RawJson)payload).Json)) Events.Add((JObject)item);
                if (command == "start" || command == "status")
                    return Task.FromResult(JObject.FromObject(new { success = true, sessionId = "capture-session", telemetryOnly = true }));
                return Task.FromResult(JObject.FromObject(new { success = true, delivered = true }));
            }
            public void Poll() { }
            public void Frame(byte[] bytes, string session, long timestamp) { }
            public void Dispose() { }
            public List<JObject> Errors() => Events.Where(e => (string)e["type"] == "error").ToList();
        }
        Bridge bridge;
        [SetUp] public void Setup()
        {
            if (Rejourney.IsGameplayActive) Rejourney.EndGameplay();
            bridge = new Bridge(); RejourneyBehaviour.BridgeFactory = () => bridge; Rejourney.Init("rj_synthetic_test");
        }
        [TearDown] public void Teardown()
        {
            SdkClock.OffsetMilliseconds = 0;
            if (Rejourney.IsGameplayActive) Rejourney.EndGameplay();
            if (Rejourney.Host) UnityEngine.Object.DestroyImmediate(Rejourney.Host.gameObject);
            RejourneyBehaviour.BridgeFactory = null;
        }
        IEnumerator Start() { var start = Rejourney.StartAsync(); while (!start.IsCompleted) yield return null; }
        IEnumerator Flush() { var flush = Rejourney.FlushAsync(); while (!flush.IsCompleted) yield return null; }
        static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        // A device that sleeps with the game in the background freezes monotonic clocks while
        // the wall clock moves on. Events after it must carry wall-clock time, or they land
        // before the session that native starts on return and its frames are rejected.
        [UnityTest] public IEnumerator EventsFollowTheWallClockAfterTheDeviceSleeps()
        {
            yield return Start();
            SdkClock.OffsetMilliseconds = 3_600_000;
            long slept = Now() + SdkClock.OffsetMilliseconds;
            Rejourney.LogEvent("after_sleep");
            Rejourney.Host.TouchEvent(1, 2, "Began", 0, true, "HUD/Fire", Rejourney.Host.Timestamp);
            Rejourney.StartGameplay("level");
            yield return Flush();
            foreach (var type in new[] { "custom", "touch", "gameplay" }) {
                var e = bridge.Events.Last(item => (string)item["type"] == type);
                Assert.That((long)e["timestamp"], Is.InRange(slept - 5000, slept + 5000), type);
            }
        }

        [UnityTest] public IEnumerator UnityExceptionsNameTheirTypeAndCountAsUnhandled()
        {
            yield return Start();
            LogAssert.Expect(LogType.Exception, new System.Text.RegularExpressions.Regex("ArgumentOutOfRangeException"));
            Debug.LogException(new ArgumentOutOfRangeException("slot"));
            yield return Flush();
            var error = bridge.Errors().Single();
            Assert.That((string)error["name"], Is.EqualTo("ArgumentOutOfRangeException"));
            Assert.That((string)error["exceptionCategory"], Is.EqualTo("ArgumentOutOfRangeException"));
            Assert.That((bool)error["handled"], Is.False);
            Assert.That((string)error["source"], Is.EqualTo("unity_log"));
            Assert.That((string)error["incidentId"], Is.Not.Empty);
        }

        [UnityTest] public IEnumerator LogErrorsAndAssertsKeepTheirUnityNames()
        {
            yield return Start();
            Rejourney.TrackScreen("Shop");
            LogAssert.Expect(LogType.Error, "synthetic log error");
            Debug.LogError("synthetic log error");
            LogAssert.Expect(LogType.Assert, "synthetic assertion");
            Debug.LogAssertion("synthetic assertion");
            yield return Flush();
            var errors = bridge.Errors();
            Assert.That(errors.Select(e => (string)e["exceptionCategory"]), Is.EqualTo(new[] { "UnityLogError", "UnityAssert" }));
            Assert.That(errors.Select(e => e["handled"].Type), Is.All.EqualTo(JTokenType.Null));
            Assert.That(errors.Select(e => (string)e["screen"]), Is.All.EqualTo("Shop"));
            Assert.That(errors.Select(e => (string)e["incidentId"]).Distinct().Count(), Is.EqualTo(2));
        }

        [UnityTest] public IEnumerator CapturedExceptionsAreHandledAndKeepTheCallerStack()
        {
            yield return Start();
            Rejourney.CaptureException(new InvalidOperationException("never thrown"));
            yield return Flush();
            var error = bridge.Errors().Single();
            Assert.That((string)error["name"], Is.EqualTo("System.InvalidOperationException"));
            Assert.That((string)error["exceptionCategory"], Is.EqualTo("InvalidOperationException"));
            Assert.That((bool)error["handled"], Is.True);
            Assert.That((string)error["source"], Is.EqualTo("unity_capture"));
            var stack = (string)error["stack"];
            Assert.That(stack, Does.Contain(nameof(CapturedExceptionsAreHandledAndKeepTheCallerStack)));
            Assert.That(stack, Does.Not.StartWith("RejourneySDK.Rejourney"));
        }

        // .NET raises the event on the finalizer thread after a collection, which a test
        // cannot force reliably under a conservative GC; the handler is invoked directly.
        [UnityTest] public IEnumerator UnobservedTaskExceptionsAreReportedAsUnhandled()
        {
            yield return Start();
            var args = new UnobservedTaskExceptionEventArgs(new AggregateException(new FormatException("abandoned task")));
            typeof(RejourneyBehaviour).GetMethod("OnUnobservedTaskException", BindingFlags.NonPublic | BindingFlags.Instance)
                .Invoke(Rejourney.Host, new object[] { null, args });
            yield return Flush();
            var error = bridge.Errors().Single();
            Assert.That((string)error["exceptionCategory"], Is.EqualTo("FormatException"));
            Assert.That((string)error["message"], Is.EqualTo("FormatException: abandoned task"));
            Assert.That((bool)error["handled"], Is.False);
            Assert.That((string)error["source"], Is.EqualTo("unity_unobserved_task"));
            Assert.That(args.Observed, Is.False, "the game's own policy for unobserved exceptions is unchanged");
        }
    }
}
