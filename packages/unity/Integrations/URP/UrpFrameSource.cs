using System.Collections.Generic;
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
    [Preserve]
    sealed class UrpFrameSource : IRejourneyFrameSource
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
        bool recorded, unreadable;
        RenderTexture target;
        RTHandle handle;

        UrpFrameSource()
        {
            pass = new CapturePass(this);
            RenderPipelineManager.beginCameraRendering += OnBeginCamera;
            RenderPipelineManager.endContextRendering += OnEndContext;
        }

        public string Name => "urp";
        public bool Available => GraphicsSettings.currentRenderPipeline is UniversalRenderPipelineAsset;

        public bool Request(RenderTexture texture)
        {
            if (state == State.Armed || !texture) return false;
            if (target != texture) {
                // Alloc without ownership: FrameCapture owns and releases the texture.
                handle?.Release();
                handle = RTHandles.Alloc(texture);
                target = texture;
            }
            state = State.Armed;
            recorded = unreadable = false;
            armedFrame = Time.frameCount;
            return true;
        }

        public FrameSourceStatus Poll()
        {
            switch (state) {
                case State.Ready: state = State.Idle; return FrameSourceStatus.Ready;
                case State.Failed: state = State.Idle; return FrameSourceStatus.Failed;
                case State.Armed:
                    if (Time.frameCount - armedFrame > MaximumWaitFrames) { state = State.Idle; return FrameSourceStatus.Failed; }
                    return FrameSourceStatus.Pending;
                default: return FrameSourceStatus.Idle;
            }
        }

        public void Cancel() => state = State.Idle;

        void OnBeginCamera(ScriptableRenderContext context, Camera camera)
        {
            // Only screen-presenting game cameras can be the last camera of a stack;
            // the pass itself checks resolveFinalTarget.
            if (state != State.Armed || camera.cameraType != CameraType.Game || camera.targetTexture) return;
            var data = camera.GetUniversalAdditionalCameraData();
            data?.scriptableRenderer?.EnqueuePass(pass);
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
                internal TextureHandle source;
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
                using (var builder = renderGraph.AddRasterRenderPass<PassData>("Rejourney Capture", out var data, profilingSampler)) {
                    data.source = resourceData.activeColorTexture;
                    builder.UseTexture(data.source, AccessFlags.Read);
                    builder.SetRenderAttachment(destination, 0, AccessFlags.Write);
                    data.drawOverlay = cameraData.rendersOverlayUI;
                    if (data.drawOverlay) {
                        // uGUI masks use stencil; draw with a cleared depth-stencil like URP does.
                        var depthDesc = new TextureDesc(destinationHandle.rt.width, destinationHandle.rt.height) {
                            format = SystemInfo.GetGraphicsFormat(DefaultFormat.DepthStencil),
                            clearBuffer = true,
                            name = "Rejourney Capture Depth",
                        };
                        builder.SetRenderAttachmentDepth(renderGraph.CreateTexture(depthDesc), AccessFlags.Write);
                        data.overlay = renderGraph.CreateUIOverlayRendererList(cameraData.camera, UISubset.UIToolkit_UGUI);
                        builder.UseRendererList(data.overlay);
                        // UI shaders may sample any global texture, as in URP's own overlay pass.
                        builder.UseAllGlobalTextures(true);
                    }
                    builder.AllowPassCulling(false);
                    builder.SetRenderFunc(static (PassData d, RasterGraphContext context) => {
                        // Copy as-is; FrameCapture flips rows on UV-top APIs, as for ScreenCapture.
                        Blitter.BlitTexture(context.cmd, d.source, new Vector4(1, 1, 0, 0), 0, true);
                        if (d.drawOverlay) context.cmd.DrawRendererList(d.overlay);
                    });
                }
                owner.MarkRecorded();
            }
        }
    }
}
