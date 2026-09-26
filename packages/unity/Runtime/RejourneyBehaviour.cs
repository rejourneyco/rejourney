using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.Rendering;
using Debug = UnityEngine.Debug;

namespace RejourneySDK
{
    internal sealed class RejourneyBehaviour : MonoBehaviour
    {
        internal string Key, SessionId;
        string screenName;
        internal RejourneyOptions Options;
        internal CaptureState State = CaptureState.Ready;
        internal readonly SdkHealth Health = new SdkHealth();
        internal readonly EffectiveSettings Settings = new EffectiveSettings();
        internal int Generation;
        internal bool Backgrounded;
        internal IRejourneyBridge Bridge;
        internal static Func<IRejourneyBridge> BridgeFactory;
        internal bool Collecting => !Backgrounded && (State == CaptureState.Recording || State == CaptureState.TelemetryOnly);
        internal bool Recording => !Backgrounded && State == CaptureState.Recording && !string.IsNullOrEmpty(SessionId);
        // Events are serialized once, on the producing thread; batches join raw JSON.
        readonly ConcurrentQueue<string> events = new ConcurrentQueue<string>();
        sealed class LogEntry
        {
            internal string Message, Stack, Name, Category, Source;
            internal LogType Type;
            internal bool? Handled;
            internal CollectionContext Context;
        }
        readonly ConcurrentQueue<LogEntry> logs = new ConcurrentQueue<LogEntry>();
        readonly Dictionary<string, long> recentErrors = new Dictionary<string, long>();
        readonly Dictionary<string, (long timestamp, bool manual)> recentErrorSources = new Dictionary<string, (long, bool)>();
        // Schedules and measures durations only; event times come from SdkClock.
        readonly Stopwatch clock = Stopwatch.StartNew();
        long heartbeat, hangStarted;
        int queued, logCount, accepting, watchdogEnabled;
        CancellationTokenSource lifetime;
        FrameCapture capture;
        Task configured;
        Task<StartResult> startTask;
        Task<DeliveryResult> stopTask;
        Task pauseTask, resumeTask, drainTask;
        CaptureState beforePause;
        double nextStatus, nextMetrics;
        // Native has no session for a moment while it replaces one after a background of
        // 60 seconds or more. That gap is not an error; it becomes one only if no session
        // arrives within the grace period.
        internal static double NativeSessionGapGraceSeconds = 10;
        double sessionGapSince = -1;
        // StartInternal records the screen and gameplay itself after applying the start result.
        bool applyingStart;
        // The gameplay segment whose start this session received and whose end it has not.
        // Both fields change only under GameplayTracker's lock.
        internal GameplayTracker.Segment SessionSegment;
        // Orders the current session against segments; segments that began earlier are continued.
        internal long SessionSequence;
        internal void SyncGameplay() => GameplayTracker.Sync(this);
        bool statusPending, debugger;
        readonly float[] frameTimes = new float[1024];
        int frameCount, longFrames;
        float frameTotal, frameMax;
        int previousGc;
        internal long Timestamp => SdkClock.Now();
        long mainThreadTicks;
        internal void AddMainThreadTicks(long started) => mainThreadTicks += Stopwatch.GetTimestamp() - started;

        // Async producers retain the original host and session. A completion after
        // pause, rollover or reconfiguration must never enter the next session.
        internal sealed class CollectionContext
        {
            readonly RejourneyBehaviour owner;
            internal readonly string Session;
            internal readonly int Generation;
            internal readonly long Timestamp;
            internal CollectionContext(RejourneyBehaviour owner) {
                this.owner = owner; Session = owner.SessionId; Generation = owner.Generation; Timestamp = owner.Timestamp;
            }
            internal bool Valid => Volatile.Read(ref owner.accepting) != 0 && Generation == owner.Generation && Session == owner.SessionId;
            internal void Network(NetworkRequestInfo request) { if (Valid) owner.Network(request, this); }
        }
        internal CollectionContext CaptureContext() => Volatile.Read(ref accepting) != 0 && SessionId != null ? new CollectionContext(this) : null;

        internal void Configure(string key, RejourneyOptions options)
        {
            Key = key; Options = options; Bridge = BridgeFactory?.Invoke() ?? new NativeBridge();
            Settings.FramesPerSecond = options.FramesPerSecond;
            Settings.MaskTextInputs = options.MaskTextInputs;
            configured = Bridge.Request("configure", new {
                publicKey = key, apiUrl = options.ApiUrl, enabled = options.Enabled,
                observeOnly = options.ObserveOnly, fps = options.FramesPerSecond,
                captureAnalytics = false, autoTrackNetwork = false, captureNativeSheets = false,
                captureCrashes = options.CaptureCrashes,
                // Unity's iOS game loop runs on the main thread: one managed
                // watchdog owns that stall. Android's UI thread is independent.
                captureANR = options.CaptureHangs && Application.platform == RuntimePlatform.Android,
                captureLogs = false, collectDeviceInfo = options.CollectDeviceInfo, collectGeoLocation = options.CollectGeoLocation,
                detectRageTaps = false, debug = options.Debug,
                runtime = new { sdkFamily = "unity", unityVersion = Application.unityVersion,
#if ENABLE_IL2CPP
                    scriptingBackend = "il2cpp",
#else
                    scriptingBackend = "mono",
#endif
                    graphicsApi = SystemInfo.graphicsDeviceType.ToString(),
                    renderPipeline = GraphicsSettings.currentRenderPipeline ? GraphicsSettings.currentRenderPipeline.GetType().Name : "built-in",
                    buildIdentifier = Application.buildGUID,
                    screenWidth = Screen.width, screenHeight = Screen.height,
                    screenWidthPixels = Screen.width, screenHeightPixels = Screen.height, screenScale = 1, pixelRatio = 1, coordinateSpace = "px"
                }
            });
            capture = new FrameCapture(this);
            if (Application.isPlaying) StartCoroutine(capture.Run());
            Application.logMessageReceivedThreaded += OnLog;
            TaskScheduler.UnobservedTaskException += OnUnobservedTaskException;
            SceneManager.activeSceneChanged += OnSceneChanged;
            SceneManager.sceneLoaded += OnSceneLoaded;
            SceneManager.sceneUnloaded += OnSceneUnloaded;
            lifetime = new CancellationTokenSource();
            if (Application.isPlaying) _ = Watchdog(lifetime.Token);
            SetState(CaptureState.Ready);
        }
        internal async Task<StartResult> StartSession()
        {
            if (stopTask != null) await stopTask;
            if (Collecting || State == CaptureState.Paused) return new StartResult { State = State, SessionId = SessionId };
            var task = startTask ?? (startTask = StartInternal());
            try { return await task; } finally { if (ReferenceEquals(startTask, task)) startTask = null; }
        }
        async Task<StartResult> StartInternal()
        {
            var generation = ++Generation;
            SetState(CaptureState.Starting);
            try {
                await configured;
                var result = await Bridge.Request("start");
                if (generation != Generation) { return new StartResult { State = CaptureState.Stopped, Error = "start_cancelled" }; }
                applyingStart = true;
                try { ApplyStatus(result); } finally { applyingStart = false; }
                var started = new StartResult { State = State, SessionId = SessionId, Error = result.Value<string>("error") };
                if (Collecting) {
                    TrackScreen(screenName ?? SceneManager.GetActiveScene().name);
                    SyncGameplay();
                }
                return started;
            } catch (Exception e) {
                if (generation == Generation) SetState(CaptureState.Error, e.Message);
                return new StartResult { State = CaptureState.Error, Error = e.Message };
            }
        }
        internal async Task<DeliveryResult> StopSession()
        {
            var task = stopTask ?? (stopTask = StopInternal());
            try { return await task; } finally { if (ReferenceEquals(stopTask, task)) stopTask = null; }
        }
        async Task<DeliveryResult> StopInternal()
        {
            DrainLogs(512);
            // Close the interval inside the session that is ending; the game may still be playing.
            if (Collecting) GameplayTracker.MarkSessionEnd(this);
            ++Generation; startTask = null;
            SetState(CaptureState.Stopped);
            var sid = SessionId;
            string drainError = null;
            try { await configured; await DrainEvents(); } catch (Exception error) { drainError = error.Message; }
            try {
                var response = await Bridge.Request("stop");
                SessionId = null; GameplayTracker.ResetSession(this);
                return drainError == null ? Delivery(response, sid) : new DeliveryResult { SessionId = sid, State = DeliveryState.Failed, Error = drainError };
            } catch (Exception error) { return new DeliveryResult { SessionId = sid, State = DeliveryState.Failed, Error = error.Message }; }
        }
        internal async Task PauseSession()
        {
            var task = pauseTask ?? (pauseTask = PauseInternal());
            try { await task; } finally { if (ReferenceEquals(pauseTask, task)) pauseTask = null; }
        }
        async Task PauseInternal()
        {
            if (resumeTask != null) await resumeTask;
            if (startTask != null) await startTask;
            if (!Collecting) return;
            DrainLogs(512);
            beforePause = State; var generation = ++Generation;
            SetState(CaptureState.Paused);
            await DrainEvents();
            var result = await Bridge.Request("pause");
            if (generation == Generation && !result.Value<bool>("success")) SetState(CaptureState.Error, "pause_failed");
        }
        internal async Task ResumeSession()
        {
            var task = resumeTask ?? (resumeTask = ResumeInternal());
            try { await task; } finally { if (ReferenceEquals(resumeTask, task)) resumeTask = null; }
        }
        async Task ResumeInternal()
        {
            if (pauseTask != null) await pauseTask;
            if (State != CaptureState.Paused) return;
            var generation = ++Generation;
            var result = await Bridge.Request("resume");
            if (generation != Generation || State != CaptureState.Paused) return;
            if (!result.Value<bool>("success")) { SetState(CaptureState.Error, "resume_failed"); return; }
            SetState(beforePause);
            // Markers skipped while paused are written now, with their original times.
            SyncGameplay();
            heartbeat = clock.ElapsedMilliseconds;
            await RefreshStatus();
        }
        internal async Task<DeliveryResult> Flush()
        {
            DrainLogs(512);
            var sid = SessionId;
            try {
                await configured; await DrainEvents();
                var response = await Bridge.Request("flush");
                return sid == SessionId ? Delivery(response, sid) : new DeliveryResult { SessionId = sid, State = DeliveryState.Failed, Error = "session_changed_during_flush" };
            } catch (Exception error) { return new DeliveryResult { SessionId = sid, State = DeliveryState.Failed, Error = error.Message }; }
        }
        static DeliveryResult Delivery(JObject result, string sid) => new DeliveryResult {
            SessionId = sid, Error = result.Value<string>("error"),
            State = result.Value<bool>("delivered") ? DeliveryState.Delivered : result.Value<bool>("success") ? DeliveryState.Queued : DeliveryState.Failed
        };
        internal async void Command(string name, object payload)
        {
            try { await configured; await Bridge.Request(name, payload); }
            catch (Exception e) { Health.NativeStatus = e.Message; }
        }
        bool Admit(CollectionContext context)
        {
            if (Volatile.Read(ref accepting) == 0 || (context != null && !context.Valid)) return false;
            if (Interlocked.Increment(ref queued) > 2048) { Interlocked.Decrement(ref queued); Interlocked.Increment(ref Health.EventsDropped); return false; }
            return true;
        }
        void Commit(string json)
        {
            if (json.Length > 16384) { Interlocked.Decrement(ref queued); Interlocked.Increment(ref Health.EventsDropped); return; }
            events.Enqueue(json);
        }
        void Reject() { Interlocked.Decrement(ref queued); Interlocked.Increment(ref Health.EventsDropped); }
        // Logs and touches are the highest-volume events, so they are written directly.
        // Reflection-based JObject conversion costs about 2.5 KB of garbage per event.
        // Output matches the generic path: payload fields, then type, timestamp, sessionId.
        [ThreadStatic] static System.Text.StringBuilder eventText;
        [ThreadStatic] static System.IO.StringWriter eventWriter;
        static JsonTextWriter BeginEvent()
        {
            if (eventWriter == null) { eventText = new System.Text.StringBuilder(512); eventWriter = new System.IO.StringWriter(eventText, System.Globalization.CultureInfo.InvariantCulture); }
            eventText.Clear();
            var writer = new JsonTextWriter(eventWriter) { CloseOutput = false, Formatting = Formatting.None };
            writer.WriteStartObject();
            return writer;
        }
        static string EndEvent(JsonTextWriter writer, string type, long timestamp, string session)
        {
            writer.WritePropertyName("type"); writer.WriteValue(type);
            writer.WritePropertyName("timestamp"); writer.WriteValue(timestamp);
            writer.WritePropertyName("sessionId"); writer.WriteValue(session);
            writer.WriteEndObject(); writer.Flush();
            return eventText.ToString();
        }
        static readonly string[] levelNames = { "error", "assert", "warning", "log", "exception" };
        static string LevelName(LogType type) => (int)type >= 0 && (int)type < levelNames.Length ? levelNames[(int)type] : type.ToString().ToLowerInvariant();
        void LogEvent(LogEntry entry)
        {
            var context = entry.Context;
            if (!Admit(context)) return;
            try {
                var writer = BeginEvent();
                writer.WritePropertyName("message"); writer.WriteValue(entry.Message);
                writer.WritePropertyName("level"); writer.WriteValue(LevelName(entry.Type));
                Commit(EndEvent(writer, "log", context.Timestamp, context.Session));
            } catch { Reject(); }
        }
        internal void TouchEvent(float x, float y, string phase, int pointerId, bool rageEligible, string target, long touchTimestamp)
        {
            if (!Admit(null)) return;
            try {
                // Taps during play are game input: tagged, and never inferred as rage taps.
                var gameplay = GameplayTracker.ActiveId;
                if (gameplay != null) rageEligible = false;
                var writer = BeginEvent();
                writer.WritePropertyName("x"); writer.WriteValue(x);
                writer.WritePropertyName("y"); writer.WriteValue(y);
                writer.WritePropertyName("phase"); writer.WriteValue(phase);
                writer.WritePropertyName("pointerId"); writer.WriteValue(pointerId);
                writer.WritePropertyName("gestureType"); writer.WriteValue(phase == "Began" ? "tap" : phase == "Moved" ? "touch_move" : "touch_end");
                writer.WritePropertyName("rageEligible"); writer.WriteValue(rageEligible);
                writer.WritePropertyName("targetLabel"); writer.WriteValue(target);
                writer.WritePropertyName("touches"); writer.WriteStartArray(); writer.WriteStartObject();
                writer.WritePropertyName("x"); writer.WriteValue(x);
                writer.WritePropertyName("y"); writer.WriteValue(y);
                writer.WritePropertyName("timestamp"); writer.WriteValue(touchTimestamp);
                writer.WriteEndObject(); writer.WriteEndArray();
                writer.WritePropertyName("screenWidth"); writer.WriteValue(Screen.width);
                writer.WritePropertyName("screenHeight"); writer.WriteValue(Screen.height);
                writer.WritePropertyName("coordinateSpace"); writer.WriteValue("px");
                if (gameplay != null) { writer.WritePropertyName("gameplayId"); writer.WriteValue(gameplay); }
                Commit(EndEvent(writer, phase == "Began" ? "touch" : "motion", Timestamp, SessionId));
            } catch { Reject(); }
        }
        // Game analytics events: identical to Event("custom", new { name, properties }),
        // whose payload is the properties JSON ("null" when absent), without reflection.
        internal void CustomEvent(string name, IDictionary<string, object> properties)
        {
            if (!Admit(null)) return;
            try {
                // Caller code (getters, converters) runs here, before the shared
                // [ThreadStatic] writer is in use, so a nested LogEvent is safe.
                string payload = properties == null ? "null" : SdkJson.Serialize(properties);
                var writer = BeginEvent();
                writer.WritePropertyName("name"); writer.WriteValue(name);
                writer.WritePropertyName("payload"); writer.WriteValue(payload);
                Commit(EndEvent(writer, "custom", Timestamp, SessionId));
            } catch { Reject(); }
        }
        // Gameplay interval markers (see GameplayTracker). A start carries the segment's
        // properties; an end carries the outcome, duration and any end properties.
        internal bool GameplayEvent(string phase, GameplayTracker.Segment segment, string outcome, IDictionary<string, object> endProperties, bool continued, long timestamp)
        {
            if (!Admit(null)) return false;
            try {
                bool start = phase == "start";
                // Caller dictionaries serialize before the shared writer is in use.
                var extra = start ? segment.Properties : endProperties;
                string properties = extra == null || extra.Count == 0 ? null : SdkJson.Serialize(extra);
                if (properties != null && properties.Length > 4096) properties = null;
                var writer = BeginEvent();
                writer.WritePropertyName("phase"); writer.WriteValue(phase);
                writer.WritePropertyName("gameplayId"); writer.WriteValue(segment.Id);
                if (segment.Name != null) { writer.WritePropertyName("name"); writer.WriteValue(segment.Name); }
                if (start) {
                    writer.WritePropertyName("continued"); writer.WriteValue(continued);
                    writer.WritePropertyName("startedAt"); writer.WriteValue(segment.StartedAt);
                } else {
                    writer.WritePropertyName("outcome"); writer.WriteValue(outcome);
                    writer.WritePropertyName("durationMs"); writer.WriteValue(Math.Max(0, timestamp - segment.StartedAt));
                }
                if (properties != null) { writer.WritePropertyName("properties"); writer.WriteRawValue(properties); }
                Commit(EndEvent(writer, "gameplay", timestamp, SessionId));
                return true;
            } catch { Reject(); return false; }
        }
        internal void Event(string type, object payload, long? timestamp = null, CollectionContext context = null)
        {
            if (!Admit(context)) return;
            try {
                var data = payload == null ? new JObject() : SdkJson.ToObject(payload);
                if (type == "custom") {
                    data["payload"] = data["properties"]?.ToString(Formatting.None) ?? "{}";
                    data.Remove("properties");
                }
                // The ingestion metrics use flat native fields; the replay UI
                // consumes properties. Preserve both compatible representations.
                else if (type == "network_request") data["properties"] = data.DeepClone();
                data["type"] = type; data["timestamp"] = timestamp ?? Timestamp;
                data["sessionId"] = context?.Session ?? SessionId;
                Commit(data.ToString(Formatting.None));
            } catch { Reject(); }
        }
        internal async Task DrainEvents()
        {
            // Joining an in-flight drain is not enough: its dequeue loop may already
            // have ended, and events queued since (an error just before PauseAsync)
            // would reach native only after it paused, where they are discarded.
            // Pause and Stop stop admitting first, so this converges; Flush is bounded.
            for (int round = 0; round < 8; round++) {
                var task = drainTask ?? (drainTask = DrainInternal());
                try { await task; } finally { if (ReferenceEquals(drainTask, task)) drainTask = null; }
                // `queued` counts admitted events not yet dequeued, including ones a
                // worker thread is still serializing, which the queue cannot show yet.
                if (Volatile.Read(ref queued) == 0) return;
                if (events.IsEmpty) await Task.Yield();
            }
        }
        async Task DrainInternal()
        {
            var batch = new System.Text.StringBuilder(4096); int count = 0;
            while (events.TryDequeue(out var item)) {
                Interlocked.Decrement(ref queued);
                batch.Append(count == 0 ? '[' : ',').Append(item);
                if (++count == 16) { await SendBatch(batch.Append(']').ToString(), count); batch.Clear(); count = 0; }
            }
            if (count > 0) await SendBatch(batch.Append(']').ToString(), count);
        }
        async Task SendBatch(string batch, int count)
        {
            try {
                var result = await Bridge.Request("events", new RawJson(batch));
                if (!result.Value<bool>("success")) throw new InvalidOperationException(result.Value<string>("error") ?? "event_batch_rejected");
            } catch { Interlocked.Add(ref Health.EventsDropped, count); throw; }
        }
        bool draining;
        async void DrainInBackground()
        {
            if (draining || events.IsEmpty) return;
            draining = true;
            try { await DrainEvents(); } catch (Exception e) { Health.NativeStatus = e.Message; }
            finally { draining = false; }
        }
        void Update()
        {
            if (Bridge == null) return;
            long started = Stopwatch.GetTimestamp();
            Bridge.Poll();
            heartbeat = clock.ElapsedMilliseconds;
            debugger = Debugger.IsAttached;
            Volatile.Write(ref watchdogEnabled, Collecting && Options.CaptureHangs && !debugger && clock.ElapsedMilliseconds > 10000 ? 1 : 0);
            DrainLogs(32);
            DrainInBackground();
            Health.PendingEvents = Volatile.Read(ref queued);
            if (Collecting) {
                float ms = Time.unscaledDeltaTime * 1000;
                frameTimes[frameCount++ % frameTimes.Length] = ms; frameTotal += ms; frameMax = Math.Max(ms, frameMax);
                if (ms >= 50) longFrames++;
                if (clock.Elapsed.TotalSeconds >= nextMetrics) { nextMetrics = clock.Elapsed.TotalSeconds + 5; EmitPerformance(); }
                if (Options.CaptureTouches) InputObserver.Collect(this);
            }
            if (clock.Elapsed.TotalSeconds >= nextStatus && !statusPending && SessionId != null) {
                nextStatus = clock.Elapsed.TotalSeconds + 1; _ = RefreshStatus();
            }
            AddMainThreadTicks(started);
            Health.MainThreadMilliseconds = mainThreadTicks * 1000.0 / Stopwatch.Frequency;
        }
        void EmitPerformance()
        {
            int count = Math.Min(frameCount, frameTimes.Length);
            if (count == 0) return;
            var sorted = new float[count]; Array.Copy(frameTimes, sorted, count); Array.Sort(sorted);
            int gc = GC.CollectionCount(0);
            Event("custom", new { name = "unity_performance", properties = new {
                fps = frameTotal > 0 ? frameCount * 1000f / frameTotal : 0,
                frameTimeP50Ms = sorted[(count - 1) / 2], frameTimeP95Ms = sorted[(int)((count - 1) * .95)],
                frameTimeMaxMs = frameMax, longFrames, managedMemoryBytes = GC.GetTotalMemory(false), gcCollections = gc - previousGc,
                unityAllocatedMemoryBytes = UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong(),
                framesCaptured = Health.FramesCaptured, skippedBackpressure = Health.FramesSkippedBackpressure,
                skippedPrivacy = Health.FramesSkippedPrivacy, width = Screen.width, height = Screen.height
            }});
            previousGc = gc; frameCount = longFrames = 0; frameTotal = frameMax = 0;
        }
        async Task RefreshStatus()
        {
            statusPending = true; var generation = Generation;
            try { var result = await Bridge.Request("status"); if (generation == Generation && State != CaptureState.Stopped) ApplyStatus(result); }
            catch (Exception e) { Health.NativeStatus = e.Message; }
            finally { statusPending = false; }
        }
        void ApplyStatus(JObject result)
        {
            var error = result.Value<string>("error");
            if (result.Value<string>("state") == "unsupported") { SetState(CaptureState.Unsupported); return; }
            if (result.Value<bool>("success")) {
                sessionGapSince = -1;
                var sid = result.Value<string>("sessionId");
                bool rolledOver = SessionId != null && SessionId != sid;
                if (SessionId != sid) { SessionId = sid; ++Generation; GameplayTracker.ResetSession(this); }
                Settings.FramesPerSecond = Math.Max(1, Math.Min(3, result.Value<int?>("fps") ?? Options.FramesPerSecond));
                Settings.MaskTextInputs = Options.MaskTextInputs || (result.Value<bool?>("maskTextInputs") ?? true);
                Settings.MaskImagesAndVideos = result.Value<bool?>("maskImagesAndVideos") ?? false;
                if (State != CaptureState.Paused) SetState(result.Value<bool>("telemetryOnly") ? CaptureState.TelemetryOnly : CaptureState.Recording);
                if (rolledOver && Collecting && !applyingStart && screenName != null) TrackScreen(screenName);
                // Tells a new session about active play, and retries any marker not yet written.
                if (!applyingStart) SyncGameplay();
            } else if (string.IsNullOrEmpty(error) && SessionId != null && !applyingStart && WithinSessionGap()) {
                // Keep the current state and look for the replacement session sooner.
                nextStatus = clock.Elapsed.TotalSeconds + .25;
            } else {
                bool gapExpired = string.IsNullOrEmpty(error) && SessionId != null && !applyingStart;
                sessionGapSince = -1;
                SetState(error == "disabled" || error == "sampled_out" || error == "billing_blocked" ? CaptureState.Disabled :
                    (error?.StartsWith("access_denied", StringComparison.Ordinal) ?? false) || error == "authentication_failed" ? CaptureState.AuthenticationFailed : CaptureState.Error,
                    gapExpired ? "native_session_unavailable" : error);
            }
            Health.NativeStatus = result.ToString(Formatting.None);
            Health.NativeFramesAccepted = result.Value<long?>("nativeFramesAccepted") ?? 0;
            Health.NativeFramesSkippedBackpressure = result.Value<long?>("nativeFramesSkippedBackpressure") ?? 0;
        }
        bool WithinSessionGap()
        {
            double now = clock.Elapsed.TotalSeconds;
            if (sessionGapSince < 0) sessionGapSince = now;
            return now - sessionGapSince < NativeSessionGapGraceSeconds;
        }
        void SetState(CaptureState state, string error = null)
        {
            bool changed = State != state; State = state;
            Volatile.Write(ref accepting, Collecting ? 1 : 0);
            if (changed) Rejourney.Notify(state, error);
        }
        void OnApplicationPause(bool paused)
        {
            if (Bridge == null) return;
            if (paused) DrainLogs(512);
            Backgrounded = paused; ++Generation;
            Volatile.Write(ref accepting, Collecting ? 1 : 0);
            Volatile.Write(ref watchdogEnabled, 0);
            heartbeat = clock.ElapsedMilliseconds;
            if (paused) { DrainInBackground(); return; }
            nextStatus = 0;
            // Markers the game wrote while the SDK was backgrounded (for example from its own
            // pause handler) are written now. After a rollover, the status poll re-tells the new
            // session once its id arrives.
            SyncGameplay();
        }
        void OnSceneChanged(Scene before, Scene after) { if (Collecting) Rejourney.TrackScreen(after.name); }
        void OnSceneLoaded(Scene scene, LoadSceneMode mode) => Event("custom", new { name = "unity_scene_loaded", properties = new { scene = scene.name, mode = mode.ToString() } });
        void OnSceneUnloaded(Scene scene) => Event("custom", new { name = "unity_scene_unloaded", properties = new { scene = scene.name } });
        void OnLog(string message, string stack, LogType type)
        {
            // Unity writes an exception as "Type: message"; the type names the issue, as the
            // exception category does in the other SDKs. Unhandled exceptions and
            // Debug.LogException both arrive here and cannot be told apart, so both count as
            // unhandled; Rejourney.CaptureException reports a handled one.
            string name = type == LogType.Exception ? ExceptionTypeOf(message) ?? "UnityException"
                : type == LogType.Assert ? "UnityAssert" : "UnityLogError";
            EnqueueLog(message, stack, type, name, name, type == LogType.Exception ? false : (bool?)null, "unity_log");
        }
        static string ExceptionTypeOf(string message)
        {
            if (string.IsNullOrEmpty(message)) return null;
            int end = message.IndexOf(": ", StringComparison.Ordinal);
            if (end < 0 && message.EndsWith("Exception", StringComparison.Ordinal)) end = message.Length;
            if (end <= 0 || end > 128) return null;
            for (int i = 0; i < end; i++) {
                char c = message[i];
                if (!char.IsLetterOrDigit(c) && c != '_' && c != '.' && c != '`' && c != '+') return null;
            }
            return message.Substring(0, end);
        }
        // A faulted Task that nothing awaited, the counterpart of an unhandled promise
        // rejection. .NET raises this on the finalizer thread once the task is collected;
        // the SDK reports it and leaves the default behavior (ignore) unchanged.
        void OnUnobservedTaskException(object sender, UnobservedTaskExceptionEventArgs args)
        {
            var aggregate = args.Exception;
            if (aggregate == null) return;
            var error = aggregate.InnerExceptions.Count == 1 ? aggregate.InnerException : aggregate;
            var type = error.GetType();
            EnqueueLog(type.Name + ": " + error.Message, error.StackTrace, LogType.Exception, type.FullName, type.Name, false, "unity_unobserved_task");
        }
        void DrainLogs(int maximum)
        {
            for (int i = 0; i < maximum && logs.TryDequeue(out var entry); i++) {
                Interlocked.Decrement(ref logCount);
                if (entry.Type == LogType.Error || entry.Type == LogType.Exception || entry.Type == LogType.Assert) Error(entry);
                else LogEvent(entry);
            }
        }
        void EnqueueLog(string message, string stack, LogType type, string name, string category, bool? handled, string source)
        {
            // Like the other SDKs, CaptureLogs governs console lines only; errors and
            // unhandled exceptions are always reported.
            bool error = type == LogType.Error || type == LogType.Exception || type == LogType.Assert;
            if (Volatile.Read(ref accepting) == 0 || (!error && !Options.CaptureLogs) || (message?.StartsWith("[Rejourney]", StringComparison.Ordinal) ?? false)) return;
            if (Interlocked.Increment(ref logCount) > 512) { Interlocked.Decrement(ref logCount); Interlocked.Increment(ref Health.EventsDropped); return; }
            var context = CaptureContext();
            if (context == null) { Interlocked.Decrement(ref logCount); return; }
            logs.Enqueue(new LogEntry { Message = Truncate(message, 4096), Stack = Truncate(stack, 8192), Type = type, Context = context, Name = name, Category = category, Handled = handled, Source = source });
        }
        static string Truncate(string text, int max) => text == null ? "" : text.Length <= max ? text : text.Substring(0, max);
        internal void CaptureException(Exception error)
        {
            if (error == null) return;
            var type = error.GetType();
            // An exception that was never thrown has no stack; the caller's stack locates it.
            EnqueueLog(type.Name + ": " + error.Message, error.StackTrace ?? CallerStack(), LogType.Exception, type.FullName, type.Name, true, "unity_capture");
        }
        static string CallerStack()
        {
            try {
                var lines = StackTraceUtility.ExtractStackTrace().Split('\n');
                int first = 0;
                // Drops this SDK's own frames (RejourneySDK.Rejourney and RejourneyBehaviour).
                while (first < lines.Length && lines[first].StartsWith("RejourneySDK.Rejourney", StringComparison.Ordinal)) first++;
                return string.Join("\n", lines, first, lines.Length - first);
            } catch { return null; }
        }
        void Error(LogEntry entry)
        {
            var context = entry.Context; string message = entry.Message, stack = entry.Stack;
            if (!context.Valid) return;
            long timestamp = context.Timestamp;
            var key = message + stack;
            if (recentErrors.TryGetValue(key, out var seen) && timestamp - seen < 2000) return;
            // Unity reformats managed stack traces before its log callback, so
            // stack-string equality cannot pair CaptureException with LogException.
            // Only cross-source pairs use the short message-based window.
            bool manual = entry.Handled == true;
            if (recentErrorSources.TryGetValue(message, out var source) && source.manual != manual && timestamp - source.timestamp < 2000) return;
            if (recentErrors.Count >= 128) recentErrors.Clear(); recentErrors[key] = timestamp;
            if (recentErrorSources.Count >= 128) recentErrorSources.Clear(); recentErrorSources[message] = (timestamp, manual);
            // incidentId lets ingestion drop a copy from a retried upload.
            Event("error", new { message, name = entry.Name, stack, isFatal = false, handled = entry.Handled, exceptionCategory = entry.Category, source = entry.Source,
                screen = screenName, incidentId = Guid.NewGuid().ToString(), platform = Application.platform == RuntimePlatform.IPhonePlayer ? "ios" : "android" }, timestamp, context);
        }
        internal void Network(NetworkRequestInfo info, CollectionContext context = null)
        {
            if (info == null || !NetworkCapture.TrySanitize(info.Url, Options.ApiUrl, out var url)) return;
            Event("network_request", new { url, name = info.Method, method = info.Method, statusCode = info.StatusCode,
                success = info.StatusCode >= 200 && info.StatusCode < 400 && !info.Cancelled && string.IsNullOrEmpty(info.Error),
                duration = info.DurationMilliseconds, durationMs = info.DurationMilliseconds,
                requestSize = info.RequestBytes, responseSize = info.ResponseBytes,
                error = info.Error, cancelled = info.Cancelled }, info.StartedAtUnixMilliseconds, context);
        }
        async Task Watchdog(CancellationToken token)
        {
            try { await Task.Run(async () => {
                while (!token.IsCancellationRequested) {
                    await Task.Delay(1000, token).ConfigureAwait(false);
                    long now = clock.ElapsedMilliseconds, last = Interlocked.Read(ref heartbeat);
                    // The loop is running again: report the stall with its full length. Events
                    // reach native only through the main thread, so an earlier report would
                    // arrive no sooner, only shorter.
                    if (hangStarted != 0 && last != hangStarted) {
                        Event("anr", new { durationMs = last - hangStarted, source = "unity_game_loop", threadState = "unity_game_loop_stalled", stackAvailable = false, screen = screenName, incidentId = Guid.NewGuid().ToString() }, Timestamp - (now - hangStarted));
                        hangStarted = 0;
                    }
                    if (Volatile.Read(ref watchdogEnabled) == 0 || Debugger.IsAttached) { hangStarted = 0; continue; }
                    if (hangStarted == 0 && now - last >= Options.HangThresholdSeconds * 1000L) hangStarted = last;
                }
            }, token); } catch (OperationCanceledException) { }
        }
        internal void MarkVisualChange() => capture?.ForceNext();
        internal void TrackScreen(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return;
            screenName = Truncate(name, 256);
            Event("screen_view", new { screen = screenName, screenName });
            MarkVisualChange();
        }
        void OnDestroy()
        {
            Volatile.Write(ref accepting, 0); Volatile.Write(ref watchdogEnabled, 0); ++Generation;
            lifetime?.Cancel(); lifetime?.Dispose();
            Application.logMessageReceivedThreaded -= OnLog;
            TaskScheduler.UnobservedTaskException -= OnUnobservedTaskException;
            SceneManager.activeSceneChanged -= OnSceneChanged; SceneManager.sceneLoaded -= OnSceneLoaded; SceneManager.sceneUnloaded -= OnSceneUnloaded;
            capture?.Dispose(); Bridge?.Dispose();
            if (Rejourney.Host == this) Rejourney.Host = null;
        }
    }
}
