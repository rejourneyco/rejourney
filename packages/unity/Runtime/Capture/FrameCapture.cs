using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;

namespace RejourneySDK
{
    internal sealed class FrameCapture : IDisposable
    {
        readonly RejourneyBehaviour host;
        readonly List<Rect> masks = new List<Rect>(128);
        readonly Vector4[] shaderMasks = new Vector4[128];
        readonly Stopwatch clock = Stopwatch.StartNew();
        RenderTexture full, small;
        Material redact;
        bool busy, disposed;
        double next;
        double lastAttempt = double.NegativeInfinity;
        int width, height;
        // One capture is in flight at a time (busy), so one readback buffer suffices.
        byte[] pixels;
        // Hierarchy snapshots describe masks, registered targets and the viewport.
        // Resend only when that content changes: at once for a new session or
        // viewport, otherwise at most every two seconds, as the native scanners do.
        ulong sentHierarchyKey;
        string sentHierarchySession;
        int sentWidth, sentHeight;
        double sentHierarchyAt = double.NegativeInfinity;
        const double HierarchyInterval = 2.0;
        public FrameCapture(RejourneyBehaviour host) { this.host = host; }
        public void ForceNext() => next = Math.Min(next, lastAttempt + 1.0 / host.Settings.FramesPerSecond);
        internal IEnumerator Run()
        {
            var end = new WaitForEndOfFrame();
            while (!disposed) {
                // Wait for the end of frame only when a capture is due.
                if (!host.Recording || clock.Elapsed.TotalSeconds < next) { yield return null; continue; }
                yield return end;
                if (!host.Recording || clock.Elapsed.TotalSeconds < next) continue;
                long started = Stopwatch.GetTimestamp();
                Attempt();
                host.AddMainThreadTicks(started);
            }
        }
        void Attempt()
        {
            lastAttempt = clock.Elapsed.TotalSeconds;
            next = lastAttempt + 1.0 / host.Settings.FramesPerSecond;
            if (busy) { host.Health.FramesSkippedBackpressure++; return; }
            // A Unity scene contains arbitrary rendered media. Until every source can
            // be classified, the all-media policy must suppress the complete frame.
            if (host.Settings.MaskImagesAndVideos || !PrivacyRegistry.Collect(masks, host.Settings.MaskTextInputs)) {
                host.Health.FramesSkippedPrivacy++; return;
            }
            Capture();
        }
        void Capture()
        {
            busy = true;
            long timestamp = host.Timestamp;
            var session = host.SessionId;
            int generation = host.Generation;
            double began = clock.Elapsed.TotalMilliseconds;
            try {
                if (!full || width != Screen.width || height != Screen.height) Allocate();
                if (!redact) throw new InvalidOperationException("Rejourney redaction shader missing.");
                for (int i = 0; i < masks.Count; i++) {
                    Rect r = masks[i]; shaderMasks[i] = new Vector4(r.xMin / width, r.yMin / height, r.xMax / width, r.yMax / height);
                }
                redact.SetInt("_MaskCount", masks.Count);
                redact.SetVectorArray("_Masks", shaderMasks);
                // Verified on device replays: Metal/Vulkan captures arrive upside down,
                // GLES captures upright. Uncorrected, masks land on the wrong rows.
                redact.SetFloat("_FlipSource", SystemInfo.graphicsUVStartsAtTop ? 1f : 0f);
                ScreenCapture.CaptureScreenshotIntoRenderTexture(full);
                Graphics.Blit(full, small, redact);
                int frameWidth = small.width, frameHeight = small.height;
                int viewportWidth = width, viewportHeight = height;
                var hierarchy = Snapshot(timestamp, session, viewportWidth, viewportHeight);
                if (SystemInfo.supportsAsyncGPUReadback) {
                    AsyncGPUReadback.Request(small, 0, TextureFormat.RGBA32, request => {
                        long callbackStarted = Stopwatch.GetTimestamp();
                        try {
                            if (request.hasError || !Valid(generation, session, viewportWidth, viewportHeight)) { Complete(request.hasError); return; }
                            var data = request.GetData<byte>();
                            if (pixels == null || pixels.Length != data.Length) pixels = new byte[data.Length];
                            data.CopyTo(pixels);
                            Encode(pixels, frameWidth, frameHeight, timestamp, session, generation, viewportWidth, viewportHeight, hierarchy, began);
                        } finally { host.AddMainThreadTicks(callbackStarted); }
                    });
                } else {
                    host.Health.SynchronousReadback = true;
                    var old = RenderTexture.active;
                    var texture = new Texture2D(frameWidth, frameHeight, TextureFormat.RGBA32, false);
                    try {
                        RenderTexture.active = small;
                        texture.ReadPixels(new Rect(0, 0, frameWidth, frameHeight), 0, 0, false);
                        var data = texture.GetRawTextureData<byte>();
                        if (pixels == null || pixels.Length != data.Length) pixels = new byte[data.Length];
                        data.CopyTo(pixels);
                        Encode(pixels, frameWidth, frameHeight, timestamp, session, generation, viewportWidth, viewportHeight, hierarchy, began);
                    } finally { RenderTexture.active = old; UnityEngine.Object.Destroy(texture); }
                }
            } catch { Complete(true); }
        }
        sealed class PendingHierarchy { internal object Snapshot; internal ulong Key; }
        readonly List<RejourneyTarget> targetBuffer = new List<RejourneyTarget>(128);
        readonly List<Rect> targetRects = new List<Rect>(128);
        // FNV-1a over the snapshot's semantic content; independent of .NET profile.
        struct ContentKey
        {
            internal ulong Value;
            internal void Add(int value) { unchecked { for (int i = 0; i < 4; i++) { Value ^= (byte)(value >> (i * 8)); Value *= 1099511628211UL; } } }
            internal void Add(string value) { Add(value.Length); foreach (char c in value) Add(c); }
            // Whole pixels: sub-pixel animation jitter is not a semantic change.
            internal void Add(Rect rect) { Add(Mathf.RoundToInt(rect.x)); Add(Mathf.RoundToInt(rect.y)); Add(Mathf.RoundToInt(rect.width)); Add(Mathf.RoundToInt(rect.height)); }
        }
        PendingHierarchy Snapshot(long timestamp, string session, int w, int h)
        {
            // Only explicitly registered identifiers; no arbitrary scene graph or UI text.
            var targets = UnityEngine.Object.FindObjectsByType<RejourneyTarget>(FindObjectsSortMode.None);
            targetBuffer.Clear(); targetRects.Clear();
            var key = new ContentKey { Value = 14695981039346656037UL };
            key.Add(w); key.Add(h); key.Add(masks.Count);
            foreach (var rect in masks) key.Add(rect);
            for (int i = 0; i < targets.Length && targetBuffer.Count < 128; i++) {
                var target = targets[i];
                if (!target.isActiveAndEnabled || string.IsNullOrEmpty(target.Identifier) || !PrivacyRegistry.TryBounds(target.gameObject, out var r)) continue;
                targetBuffer.Add(target); targetRects.Add(r);
                key.Add(target.Identifier); key.Add(target.Actionable ? 1 : 0); key.Add(r);
            }
            double now = clock.Elapsed.TotalSeconds;
            bool viewportChanged = session != sentHierarchySession || w != sentWidth || h != sentHeight;
            if (!viewportChanged && (key.Value == sentHierarchyKey || now - sentHierarchyAt < HierarchyInterval)) return null;
            var nodes = new List<object>(masks.Count + targetBuffer.Count);
            foreach (var rect in masks) nodes.Add(new { type = "RejourneyMask", masked = true, frame = new { x = rect.x, y = rect.y, width = rect.width, height = rect.height } });
            for (int i = 0; i < targetBuffer.Count; i++) {
                var target = targetBuffer[i]; var r = targetRects[i];
                bool masked = false; foreach (var mask in masks) if (r.Overlaps(mask)) { masked = true; break; }
                nodes.Add(new { type = "UnityTarget", testID = masked ? "[masked]" : target.Identifier, masked, interactive = target.Actionable,
                    frame = new { x = r.x, y = r.y, width = r.width, height = r.height } });
            }
            targetBuffer.Clear();
            return new PendingHierarchy { Key = key.Value, Snapshot = new { timestamp, screen = new { width = w, height = h, scale = 1 },
                root = new { type = "UnityViewport", frame = new { x = 0, y = 0, width = w, height = h }, children = nodes } } };
        }
        async void Encode(byte[] frame, int w, int h, long timestamp, string session, int generation, int viewW, int viewH, PendingHierarchy hierarchy, double began)
        {
            try {
                int quality = host.Options.JpegQuality;
                // EncodeArrayToJPG is Unity's thread-safe array encoder; no Unity objects
                // or retained NativeArray from the readback callback cross this boundary.
                var jpeg = await Task.Run(() => ImageConversion.EncodeArrayToJPG(frame, GraphicsFormat.R8G8B8A8_UNorm, (uint)w, (uint)h, 0, quality));
                long resumed = Stopwatch.GetTimestamp();
                if (!Valid(generation, session, viewW, viewH)) return;
                host.Bridge.Frame(jpeg, session, timestamp);
                if (hierarchy != null) {
                    host.Command("hierarchy", new { sessionId = session, timestamp, snapshot = hierarchy.Snapshot });
                    sentHierarchyKey = hierarchy.Key; sentHierarchySession = session; sentWidth = viewW; sentHeight = viewH;
                    sentHierarchyAt = clock.Elapsed.TotalSeconds;
                }
                host.Health.FramesCaptured++;
                host.Health.LastCaptureMilliseconds = clock.Elapsed.TotalMilliseconds - began;
                host.AddMainThreadTicks(resumed);
            } catch { host.Health.CaptureFailures++; }
            finally { Complete(false); }
        }
        bool Valid(int generation, string session, int w, int h) => !disposed && host.Recording && generation == host.Generation && session == host.SessionId && Screen.width == w && Screen.height == h;
        void Allocate()
        {
            Release(); width = Screen.width; height = Screen.height;
            if (width <= 0 || height <= 0) throw new InvalidOperationException("Invalid viewport.");
            int max = SystemInfo.supportsAsyncGPUReadback ? host.Options.MaximumDimension : Math.Min(480, host.Options.MaximumDimension);
            float scale = Math.Min(1f, max / (float)Math.Max(width, height));
            full = new RenderTexture(width, height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            small = new RenderTexture(Math.Max(1, Mathf.RoundToInt(width * scale)), Math.Max(1, Mathf.RoundToInt(height * scale)), 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.sRGB);
            full.Create(); small.Create();
            var shader = Resources.Load<Shader>("RejourneyRedact");
            if (shader) redact = new Material(shader);
        }
        void Complete(bool failed)
        {
            if (failed) host.Health.CaptureFailures++;
            busy = false;
            if (disposed) Release();
        }
        void Release()
        {
            if (full) { full.Release(); UnityEngine.Object.Destroy(full); }
            if (small) { small.Release(); UnityEngine.Object.Destroy(small); }
            if (redact) UnityEngine.Object.Destroy(redact);
            full = small = null; redact = null;
        }
        public void Dispose() { disposed = true; if (!busy) Release(); }
    }
}
