using System;
using System.Collections.Generic;
using System.Reflection;
using UnityEngine;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;
using UnityEngine.Rendering.RenderGraphModule;
using UnityEngine.Rendering.Universal;
using UnityEngine.Scripting;
// Nothing references this adapter; it installs itself. Without AlwaysLinkAssembly,
// UnityLinker drops the whole assembly and URP projects fall back to ScreenCapture.
[assembly: AlwaysLinkAssembly]
namespace RejourneySDK
{
    // Captures the final camera image from inside URP instead of reading the back
    // buffer. URP draws Screen Space - Overlay UI straight into the back buffer after
    // every custom pass, so the capture pass copies the post-processed camera color and
    // then draws the same overlay UI renderer list into the capture texture.
    //
    // The capture texture always ends up in Unity's texture convention (UV origin at the
    // bottom left), whatever the project's settings:
    // - the camera color is copied through the render graph's own UV-origin bookkeeping.
    //   Its orientation is not a constant: Tile-Only and on-tile renderers keep the back
    //   buffer's orientation in their intermediate textures.
    // - the overlay UI is drawn after an explicit SetRenderTarget. Inside a raster pass
    //   the engine decided the UI's orientation from whichever target an earlier pass had
    //   bound, which changed with MSAA, HDR, post-processing and camera stacking and gave
    //   frames whose UI, and the masks over it, were upside down.
    [Preserve]
    sealed class UrpFrameSource : IRejourneyFrameSource, IDisposable
    {
        [Preserve, RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Install() => FrameSources.Register(new UrpFrameSource());

        // A frame that rendered no eligible camera (loading, all cameras off) fails the
        // request instead of holding the capture slot.
        const int MaximumWaitFrames = 3;
        enum State { Idle, Armed, Ready, Failed }
        readonly CapturePass pass;
        State state;
        int armedFrame;
        // Several screen cameras can present in one frame; each records over the
        // capture, so the last one wins, as on screen.
        bool recorded, unreadable, listening;
        // Set when this pass cannot run in the project's pipeline configuration. The
        // capture then reports the frame as unreadable instead of disturbing rendering.
        // `blocked` lasts for the run; `skipped` describes the last request only, because a
        // game can switch renderers (quality levels) at any time.
        string blocked, skipped;
        RenderTexture target;
        RTHandle handle;

        UrpFrameSource()
        {
            pass = new CapturePass(this);
            RenderPipelineManager.beginCameraRendering += OnBeginCamera;
            RenderPipelineManager.endContextRendering += OnEndContext;
        }

        public string Name => "urp";
        public bool Available => blocked == null && GraphicsSettings.currentRenderPipeline is UniversalRenderPipelineAsset;
        public string Unavailable => blocked ?? skipped;

        public bool Request(RenderTexture texture)
        {
            if (state == State.Armed || !texture || blocked != null) return false;
            if (target != texture) {
                // Alloc without ownership: FrameCapture owns and releases the texture.
                handle?.Release();
                handle = RTHandles.Alloc(texture);
                target = texture;
            }
            state = State.Armed;
            recorded = unreadable = false;
            skipped = null;
            armedFrame = Time.frameCount;
            Listen(true);
            return true;
        }

        public FrameSourceStatus Poll()
        {
            switch (state) {
                case State.Ready: state = State.Idle; Listen(false); return FrameSourceStatus.Ready;
                case State.Failed: state = State.Idle; Listen(false); return FrameSourceStatus.Failed;
                case State.Armed:
                    // Counted in rendered frames: with on-demand rendering only every Nth loop iteration draws.
                    if (Time.frameCount - armedFrame > MaximumWaitFrames * Math.Max(1, OnDemandRendering.renderFrameInterval)) { state = State.Idle; Listen(false); return FrameSourceStatus.Failed; }
                    return FrameSourceStatus.Pending;
                default: return FrameSourceStatus.Idle;
            }
        }

        public void Cancel() { state = State.Idle; Listen(false); }

        public void Dispose()
        {
            Cancel();
            RenderPipelineManager.beginCameraRendering -= OnBeginCamera;
            RenderPipelineManager.endContextRendering -= OnEndContext;
            handle?.Release(); handle = null; target = null;
        }

        // A render graph that cannot be compiled with the capture pass in it is reset by
        // URP: the game loses that frame and logs an exception. Whatever the cause in a
        // given URP version, one such frame turns pipeline capture off for the run.
        Application.LogCallback logCallback;
        void Listen(bool on)
        {
            if (listening == on) return;
            listening = on;
            // One delegate for the lifetime of the source: this runs for every capture.
            logCallback ??= OnLog;
            if (on) Application.logMessageReceived += logCallback; else Application.logMessageReceived -= logCallback;
        }
        void OnLog(string message, string stack, LogType type)
        {
            if (type != LogType.Exception && type != LogType.Error) return;
            if (message == null || state != State.Armed || !recorded) return;
            bool graph = message.IndexOf("Rejourney Capture", StringComparison.Ordinal) >= 0
                || message.IndexOf("Render Graph Execution error", StringComparison.Ordinal) >= 0
                || (stack != null && stack.IndexOf("RenderGraphModule", StringComparison.Ordinal) >= 0);
            if (!graph) return;
            Block("render_graph_rejected_capture_pass");
        }
        void Skip(string reason)
        {
            skipped = reason;
            unreadable = true;
            if (warned == reason) return;
            warned = reason;
            Debug.LogWarning("[Rejourney] Session replay frames cannot be captured inside this URP renderer (" + reason + "); frames are skipped while it is active. Turn off Player Settings > iOS > \"Metal Write-Only Backbuffer\" to capture from the screen instead.");
        }
        string warned;
        void Block(string reason)
        {
            if (blocked != null) return;
            blocked = reason;
            if (state == State.Armed) state = State.Failed;
            Debug.LogWarning("[Rejourney] Session replay frames cannot be captured inside this URP configuration (" + reason + "); frames are skipped. Turn off Player Settings > iOS > \"Metal Write-Only Backbuffer\" to capture from the screen instead.");
        }

        // Tile-Only renderers must keep every pass in one native render pass on the back
        // buffer. A pass that needs the intermediate texture breaks that contract.
        static PropertyInfo tileOnlyProperty;
        static bool tileOnlyResolved;
        static bool TileOnly(ScriptableRenderer renderer)
        {
            if (!(GraphicsSettings.currentRenderPipeline is UniversalRenderPipelineAsset asset) || renderer == null) return false;
            if (!tileOnlyResolved) {
                tileOnlyResolved = true;
                try { tileOnlyProperty = typeof(UniversalRendererData).GetProperty("tileOnlyMode", BindingFlags.Public | BindingFlags.Instance); } catch { tileOnlyProperty = null; }
            }
            if (tileOnlyProperty == null) return false;
            try {
                var list = asset.rendererDataList;
                for (int i = 0; i < list.Length; i++) {
                    if (!(list[i] is UniversalRendererData data) || !ReferenceEquals(asset.GetRenderer(i), renderer)) continue;
                    return tileOnlyProperty.GetValue(data) is bool on && on;
                }
            } catch { }
            return false;
        }

        void OnBeginCamera(ScriptableRenderContext context, Camera camera)
        {
            // Only screen-presenting game cameras can be the last camera of a stack;
            // the pass itself checks resolveFinalTarget.
            if (state != State.Armed || camera.cameraType != CameraType.Game || camera.targetTexture) return;
            var data = camera.GetUniversalAdditionalCameraData();
            var renderer = data ? data.scriptableRenderer : null;
            if (renderer == null) return;
            if (TileOnly(renderer)) { Skip("tile_only_renderer"); return; }
            renderer.EnqueuePass(pass);
        }

        void OnEndContext(ScriptableRenderContext context, List<Camera> cameras)
        {
            // Every camera of the frame has been recorded and submitted; commands issued
            // after this point (redaction blit, readback) run after the capture pass.
            if (state != State.Armed) return;
            if (recorded) state = State.Ready;
            else if (unreadable) state = State.Failed;
            recorded = unreadable = false;
        }

        internal RTHandle Target => state == State.Armed ? handle : null;
        internal void MarkRecorded() { if (state == State.Armed) recorded = true; }
        internal void MarkUnreadable() { if (state == State.Armed) unreadable = true; }

        sealed class CapturePass : ScriptableRenderPass
        {
            readonly UrpFrameSource owner;
            internal CapturePass(UrpFrameSource owner)
            {
                this.owner = owner;
                // After post-processing (and any user passes before it), before the final
                // blit to the back buffer and the overlay UI.
                renderPassEvent = RenderPassEvent.AfterRenderingPostProcessing;
                // Only frames that capture enqueue this pass, so a project that renders
                // straight to the back buffer pays for an intermediate texture on those
                // frames alone.
                requiresIntermediateTexture = true;
                profilingSampler = new ProfilingSampler("Rejourney Capture");
            }

            sealed class PassData
            {
                internal TextureHandle source, destination, depth;
                internal RendererListHandle overlay;
                internal bool drawOverlay;
            }

            public override void RecordRenderGraph(RenderGraph renderGraph, ContextContainer frameData)
            {
                var cameraData = frameData.Get<UniversalCameraData>();
                if (!cameraData.resolveFinalTarget) return; // a later camera in the stack presents
                var destinationHandle = owner.Target;
                if (destinationHandle == null) return;
                var resourceData = frameData.Get<UniversalResourceData>();
                if (resourceData.isActiveTargetBackBuffer || !resourceData.activeColorTexture.IsValid()) { owner.MarkUnreadable(); return; }

                var destination = renderGraph.ImportTexture(destinationHandle);
                // An unsafe pass: the overlay UI needs the capture texture bound through
                // SetRenderTarget, which raster passes do not offer.
                using (var builder = renderGraph.AddUnsafePass<PassData>("Rejourney Capture", out var data, profilingSampler)) {
                    data.source = resourceData.activeColorTexture;
                    data.destination = destination;
                    builder.UseTexture(data.source, AccessFlags.Read);
                    builder.UseTexture(data.destination, AccessFlags.Write);
                    data.drawOverlay = cameraData.rendersOverlayUI;
                    if (data.drawOverlay) {
                        // uGUI masks use stencil; draw with a cleared depth-stencil like URP does.
                        var depthDesc = new TextureDesc(destinationHandle.rt.width, destinationHandle.rt.height) {
                            format = SystemInfo.GetGraphicsFormat(DefaultFormat.DepthStencil),
                            clearBuffer = true,
                            name = "Rejourney Capture Depth",
                        };
                        data.depth = renderGraph.CreateTexture(depthDesc);
                        builder.UseTexture(data.depth, AccessFlags.Write);
                        data.overlay = renderGraph.CreateUIOverlayRendererList(cameraData.camera, UISubset.UIToolkit_UGUI);
                        builder.UseRendererList(data.overlay);
                        // UI shaders may sample any global texture, as in URP's own overlay pass.
                        builder.UseAllGlobalTextures(true);
                    }
                    builder.AllowPassCulling(false);
                    builder.SetRenderFunc(static (PassData d, UnsafeGraphContext context) => {
                        var cmd = CommandBufferHelpers.GetNativeCommandBuffer(context.cmd);
                        if (d.drawOverlay) cmd.SetRenderTarget(d.destination, d.depth);
                        else cmd.SetRenderTarget(d.destination);
                        // The destination is a plain render texture (origin bottom left). Flip
                        // only when the camera color was kept in the back buffer's orientation.
                        bool flip = context.GetTextureUVOrigin(d.source) != TextureUVOrigin.BottomLeft;
                        // A dynamically scaled handle uses only part of its texture, as in URP's own blits.
                        RTHandle source = d.source;
                        Vector2 used = source != null && source.useScaling ? new Vector2(source.rtHandleProperties.rtHandleScale.x, source.rtHandleProperties.rtHandleScale.y) : Vector2.one;
                        Blitter.BlitTexture(cmd, d.source, flip ? new Vector4(used.x, -used.y, 0, used.y) : new Vector4(used.x, used.y, 0, 0), 0, true);
                        if (d.drawOverlay) {
                            cmd.ClearRenderTarget(RTClearFlags.DepthStencil, Color.clear, 1f, 0);
                            cmd.DrawRendererList(d.overlay);
                        }
                    });
                }
                owner.MarkRecorded();
            }
        }
    }
}
