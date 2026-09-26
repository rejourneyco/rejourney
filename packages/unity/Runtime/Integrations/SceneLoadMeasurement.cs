using System;
using System.Diagnostics;
using System.Threading;

namespace RejourneySDK
{
    internal sealed class SceneLoadMeasurement : IDisposable
    {
        readonly RejourneyBehaviour owner;
        readonly RejourneyBehaviour.CollectionContext context;
        readonly Stopwatch clock = Stopwatch.StartNew();
        readonly string scene;
        int completed;
        internal SceneLoadMeasurement(RejourneyBehaviour owner, string scene)
        {
            this.owner = owner; context = owner.CaptureContext();
            this.scene = scene == null ? "" : scene.Substring(0, Math.Min(256, scene.Length));
        }
        public void Dispose()
        {
            if (Interlocked.Exchange(ref completed, 1) != 0 || context == null || !context.Valid) return;
            owner.Event("custom", new { name = "unity_scene_load", properties = new { scene, durationMs = clock.Elapsed.TotalMilliseconds } }, context.Timestamp, context);
        }
    }
}
