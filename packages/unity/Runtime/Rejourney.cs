using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Scripting;

namespace RejourneySDK
{
    [Preserve]
    public static class Rejourney
    {
        internal static RejourneyBehaviour Host;
        public static CaptureState State => Host ? Host.State : CaptureState.Uninitialized;
        public static string CurrentSessionId => Host ? Host.SessionId : null;
        public static SdkHealth Health => Host ? Host.Health : emptyHealth;
        public static EffectiveSettings Settings => Host ? Host.Settings : emptySettings;
        static readonly SdkHealth emptyHealth = new SdkHealth();
        static readonly EffectiveSettings emptySettings = new EffectiveSettings();
        public static event Action<CaptureState> StateChanged;
        public static event Action<string> AuthenticationError;
        internal static void Notify(CaptureState state, string error)
        {
            try { StateChanged?.Invoke(state); } catch (Exception e) { Debug.LogException(e); }
            if (state == CaptureState.AuthenticationFailed) {
                try { AuthenticationError?.Invoke(error); } catch (Exception e) { Debug.LogException(e); }
            }
        }
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        static void Reset()
        {
            Host = null; RejourneyBehaviour.BridgeFactory = null; StateChanged = null; AuthenticationError = null;
            PrivacyRegistry.Reset();
        }
        public static void Init(string publicProjectKey, RejourneyOptions options = null)
        {
            if (string.IsNullOrWhiteSpace(publicProjectKey)) throw new ArgumentException("A public project key is required.");
            var validated = (options ?? new RejourneyOptions()).Validated();
            if (Host) {
                if (Host.SessionId != null || Host.State == CaptureState.Starting) {
                    if (Host.Key == publicProjectKey && Host.Options.ApiUrl == validated.ApiUrl) return;
                    throw new InvalidOperationException("Await StopAsync before changing the project key or endpoint.");
                }
                // Reinitialization after Stop applies new capture options, even
                // for the same project. Deactivate before deferred destruction
                // so the old host cannot dispatch another native command.
                Host.gameObject.SetActive(false);
                if (Application.isPlaying) UnityEngine.Object.Destroy(Host.gameObject);
                else UnityEngine.Object.DestroyImmediate(Host.gameObject);
            }
            var go = new GameObject("Rejourney") { hideFlags = HideFlags.HideInHierarchy };
            if (Application.isPlaying) UnityEngine.Object.DontDestroyOnLoad(go);
            Host = go.AddComponent<RejourneyBehaviour>();
            Host.Configure(publicProjectKey, validated);
        }
        public static Task<StartResult> StartAsync() => Host ? Host.StartSession() : Task.FromResult(new StartResult { State = CaptureState.Uninitialized, Error = "Call Init first." });
        public static Task<DeliveryResult> StopAsync() => Host ? Host.StopSession() : EmptyDelivery();
        public static Task<DeliveryResult> FlushAsync() => Host ? Host.Flush() : EmptyDelivery();
        public static Task PauseAsync() => Host ? Host.PauseSession() : Task.CompletedTask;
        public static Task ResumeAsync() => Host ? Host.ResumeSession() : Task.CompletedTask;
        static Task<DeliveryResult> EmptyDelivery() => Task.FromResult(new DeliveryResult { State = DeliveryState.NothingToDeliver });
        public static void SetUserIdentity(string identity) => Host?.Command("identify", new { identity });
        public static void ClearUserIdentity() => Host?.Command("identify", new { identity = "" });
        public static void SetMetadata(string key, object value) => Host?.Command("metadata", new { key, value });
        public static void SetMetadata(IDictionary<string, object> values)
        {
            if (values == null) return;
            foreach (var pair in values) SetMetadata(pair.Key, pair.Value);
        }
        public static void AddSessionTag(string tag) => LogEvent("session_tag", new Dictionary<string, object> { ["tag"] = tag });
        public static void LogFeedback(string message) => LogEvent("feedback", new Dictionary<string, object> { ["message"] = message });
        /// <summary>Survey or rating feedback, matching the other SDKs' rating plus message shape.</summary>
        public static void LogFeedback(int rating, string message) => LogEvent("feedback", new Dictionary<string, object> { ["type"] = "feedback", ["rating"] = rating, ["message"] = message });
        /// <summary>Mark flows that leave the game, so a replay gap has an explanation.</summary>
        public static void OnExternalUrlOpened(string urlScheme) => LogEvent("external_url_opened", new Dictionary<string, object> { ["scheme"] = urlScheme });
        public static void OnOAuthStarted(string provider) => LogEvent("oauth_started", new Dictionary<string, object> { ["provider"] = provider });
        public static void OnOAuthCompleted(string provider, bool success) => LogEvent("oauth_completed", new Dictionary<string, object> { ["provider"] = provider, ["success"] = success });
        public static void TrackScreen(string name) => Host?.TrackScreen(name);
        /// <summary>
        /// Marks the start of active gameplay: a level, match, round or run. Until
        /// <see cref="EndGameplay"/>, replays show a gameplay interval and analytics and
        /// research treat input inside it as play rather than interface friction.
        /// Call it where play begins, even before Init or StartAsync: every session that
        /// records during the interval gets its own start marker. Starting while another
        /// segment is active ends that one as <see cref="GameplayOutcome.Superseded"/>.
        /// Keep the name and properties free of player-entered or personal data.
        /// </summary>
        /// <returns>The segment's gameplay id, shared by its start and end markers.</returns>
        public static string StartGameplay(string name = null, IDictionary<string, object> properties = null) => GameplayTracker.Start(name, properties);
        /// <summary>Marks the end of the active gameplay segment, for example with <see cref="GameplayOutcome.Completed"/>.</summary>
        public static void EndGameplay(string outcome = GameplayOutcome.Ended, IDictionary<string, object> properties = null) => GameplayTracker.End(outcome, properties);
        /// <summary>
        /// Starts a gameplay segment that ends as <see cref="GameplayOutcome.Completed"/> when
        /// disposed, unless it was already ended or replaced: <c>using (Rejourney.Gameplay("arena")) { ... }</c>.
        /// </summary>
        public static IDisposable Gameplay(string name = null, IDictionary<string, object> properties = null) => new GameplayTracker.Scope(GameplayTracker.Start(name, properties));
        public static bool IsGameplayActive => GameplayTracker.ActiveId != null;
        public static string ActiveGameplayId => GameplayTracker.ActiveId;
        public static void LogEvent(string name, IDictionary<string, object> properties = null) => Host?.CustomEvent(name, properties);
        public static void CaptureException(Exception exception) => Host?.CaptureException(exception);
        public static void LogNetworkRequest(NetworkRequestInfo request) => Host?.Network(request);
        public static void MarkVisualChange() { if (Host) Host.MarkVisualChange(); }
        /// <summary>Measure an actual scene load; dispose after its AsyncOperation completes.</summary>
        public static IDisposable BeginSceneLoad(string scene) => Host ? new SceneLoadMeasurement(Host, scene) : null;
        public static void Mask(GameObject target) => PrivacyRegistry.Add(target);
        public static void Unmask(GameObject target) => PrivacyRegistry.Remove(target);
    }
}
