using System;
using UnityEngine;

namespace RejourneySDK
{
    public enum CaptureState { Uninitialized, Ready, Starting, Recording, TelemetryOnly, Paused, Disabled, AuthenticationFailed, Stopped, Unsupported, Error }
    public enum DeliveryState { Delivered, Queued, Failed, NothingToDeliver }
    [Serializable]
    public sealed class RejourneyOptions
    {
        public string ApiUrl = "https://api.rejourney.co";
        public bool Enabled = true;
        public bool ObserveOnly;
        [Range(1, 3)] public int FramesPerSecond = 1;
        [Range(240, 1920)] public int MaximumDimension = 960;
        [Range(1, 100)] public int JpegQuality = 50;
        public bool MaskTextInputs = true;
        public bool CaptureLogs = true;
        public bool CaptureTouches = true;
        public bool DetectRageTaps;
        public bool CaptureCrashes = true;
        public bool CaptureHangs = true;
        /// <summary>
        /// A project records each session for a limited time (10 minutes by default). When that
        /// limit ends the session while the game is still running, start a new session at once,
        /// so errors, hangs and crashes later in a long play session are still reported. Each
        /// new session counts as a session and is sampled like any other. Off: capture stops at
        /// the limit, <see cref="Rejourney.State"/> becomes <see cref="CaptureState.Error"/>, and
        /// nothing is reported until the game calls <see cref="Rejourney.StartAsync"/> again.
        /// </summary>
        public bool ContinueAfterSessionLimit = true;
        public bool CollectDeviceInfo = true;
        public bool CollectGeoLocation = true;
        public bool Debug;
        [Range(2, 60)] public int HangThresholdSeconds = 5;
        internal RejourneyOptions Validated()
        {
            var copy = (RejourneyOptions)MemberwiseClone();
            if (!Uri.TryCreate(ApiUrl, UriKind.Absolute, out var uri) || uri.Scheme != "https")
                throw new ArgumentException("Rejourney requires an absolute HTTPS API endpoint.");
            copy.ApiUrl = ApiUrl.TrimEnd('/');
            copy.FramesPerSecond = Math.Max(1, Math.Min(3, FramesPerSecond));
            copy.MaximumDimension = Math.Max(240, Math.Min(1920, MaximumDimension));
            copy.JpegQuality = Math.Max(1, Math.Min(100, JpegQuality));
            copy.HangThresholdSeconds = Math.Max(2, HangThresholdSeconds);
            return copy;
        }
    }
    public sealed class StartResult
    {
        public CaptureState State { get; internal set; }
        public string SessionId { get; internal set; }
        public string Error { get; internal set; }
        public bool Success => State == CaptureState.Recording || State == CaptureState.TelemetryOnly || State == CaptureState.Paused;
    }
    public sealed class DeliveryResult
    {
        public DeliveryState State { get; internal set; }
        public string SessionId { get; internal set; }
        public string Error { get; internal set; }
    }
    public sealed class SdkHealth
    {
        public long FramesCaptured, FramesSkippedBackpressure, FramesSkippedPrivacy, CaptureFailures, EventsDropped;
        public long NativeFramesAccepted, NativeFramesSkippedBackpressure;
        /// <summary>Frames not captured because the back buffer is write-only and no render-pipeline source applies.</summary>
        public long FramesSkippedUnreadable;
        /// <summary>Sessions started because the previous one reached the project's recording-time limit.</summary>
        public long SessionsContinued;
        public double LastCaptureMilliseconds;
        /// <summary>Cumulative SDK work on the Unity main thread since Init, in milliseconds.</summary>
        public double MainThreadMilliseconds;
        public int PendingEvents;
        public bool SynchronousReadback;
        /// <summary>Where frames come from: "screen" (ScreenCapture), "urp" (inside URP, used when the back buffer is write-only) or "unreadable" (write-only back buffer without URP; frames are skipped).</summary>
        public string CaptureSource;
        /// <summary>Why frames are unreadable, when <see cref="CaptureSource"/> is "unreadable": "no_render_pipeline_source" (write-only back buffer without URP), "tile_only_renderer" or "render_graph_rejected_capture_pass".</summary>
        public string CaptureUnavailableReason;
        /// <summary>The last native status reply as JSON, or the last native error.</summary>
        public string NativeStatus
        {
            // Formatted when read: a status arrives every second, and almost nobody reads it.
            get { var token = NativeStatusToken; if (token != null) { nativeStatus = token.ToString(Newtonsoft.Json.Formatting.None); NativeStatusToken = null; } return nativeStatus; }
            internal set { NativeStatusToken = null; nativeStatus = value; }
        }
        internal Newtonsoft.Json.Linq.JToken NativeStatusToken;
        string nativeStatus;
    }
    public sealed class NetworkRequestInfo
    {
        public string Method, Url, Error;
        public int StatusCode;
        public double DurationMilliseconds;
        public long? RequestBytes, ResponseBytes;
        public bool Cancelled;
        public long? StartedAtUnixMilliseconds;
    }
    public sealed class EffectiveSettings
    {
        public int FramesPerSecond { get; internal set; } = 1;
        public bool MaskTextInputs { get; internal set; } = true;
        public bool MaskImagesAndVideos { get; internal set; }
    }
}
