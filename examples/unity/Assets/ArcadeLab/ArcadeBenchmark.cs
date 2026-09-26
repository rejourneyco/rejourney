using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json;
using RejourneySDK;
using Unity.Profiling;
using UnityEngine;

/// <summary>Fixed-memory frame histograms and five-second samples for matched runs.</summary>
public sealed class ArcadeBenchmark : MonoBehaviour
{
    // 0.1 ms bins; the final bin is overflow.
    readonly int[] histogram = new int[10001], cpuHistogram = new int[10001];
    readonly FrameTiming[] timings = new FrameTiming[1];
    readonly List<object> samples = new List<object>(362);
    ProfilerRecorder gcAllocated;
    double began, nextSample, duration, sdkMillisecondsAtStart;
    int count, cpuCount, initialGc;
    long gcBytes, gcMaximum, framesAtStart, acceptedAtStart, privacyAtStart, backlogAtStart, droppedAtStart;
    long managedPeak, unityPeak;
    float maximum;
    string mode, runId;
    Action<string, object> completed;
    public bool Active { get; private set; }
    public void Begin(string mode, string runId, int seconds, Action<string> completed) => Begin(mode, runId, seconds, (path, _) => completed?.Invoke(path), 30);
    public void Begin(string mode, string runId, int seconds, Action<string, object> completed, int minimumSeconds)
    {
        if (Active) return;
        Array.Clear(histogram, 0, histogram.Length); Array.Clear(cpuHistogram, 0, cpuHistogram.Length); samples.Clear();
        count = cpuCount = 0; maximum = 0; gcBytes = gcMaximum = 0; managedPeak = unityPeak = 0;
        this.mode = mode; this.runId = runId; this.completed = completed;
        duration = Math.Max(minimumSeconds, Math.Min(1800, seconds)); began = Time.realtimeSinceStartupAsDouble; nextSample = began;
        initialGc = GC.CollectionCount(0);
        var health = Rejourney.Health;
        sdkMillisecondsAtStart = health.MainThreadMilliseconds; framesAtStart = health.FramesCaptured; acceptedAtStart = health.NativeFramesAccepted;
        privacyAtStart = health.FramesSkippedPrivacy; backlogAtStart = health.FramesSkippedBackpressure + health.NativeFramesSkippedBackpressure; droppedAtStart = health.EventsDropped;
        if (!gcAllocated.Valid) gcAllocated = ProfilerRecorder.StartNew(ProfilerCategory.Memory, "GC Allocated In Frame");
        Active = true;
    }
    void OnDestroy() { if (gcAllocated.Valid) gcAllocated.Dispose(); }
    static void Add(int[] bins, double ms) => bins[Math.Min(bins.Length - 1, Math.Max(0, (int)(ms * 10)))]++;
    static double Percentile(int[] bins, int total, double fraction)
    {
        if (total == 0) return 0;
        int remaining = (int)Math.Ceiling(total * fraction), bin = 0;
        for (; bin < bins.Length - 1; bin++) { remaining -= bins[bin]; if (remaining <= 0) break; }
        return (bin + 1) / 10.0;
    }
    void Update()
    {
        if (!Active) return;
        float ms = Time.unscaledDeltaTime * 1000;
        Add(histogram, ms); count++; maximum = Math.Max(maximum, ms);
        // Main-thread CPU time is independent of vsync, unlike the frame interval.
        FrameTimingManager.CaptureFrameTimings();
        if (FrameTimingManager.GetLatestTimings(1, timings) > 0 && timings[0].cpuMainThreadFrameTime > 0) { Add(cpuHistogram, timings[0].cpuMainThreadFrameTime); cpuCount++; }
        if (gcAllocated.Valid) { long bytes = gcAllocated.LastValue; gcBytes += bytes; gcMaximum = Math.Max(gcMaximum, bytes); }
        managedPeak = Math.Max(managedPeak, GC.GetTotalMemory(false));
        unityPeak = Math.Max(unityPeak, UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong());
        double now = Time.realtimeSinceStartupAsDouble;
        if (now >= nextSample) {
            nextSample = now + 5;
            samples.Add(new { seconds = now - began, managedMemoryBytes = GC.GetTotalMemory(false),
                unityAllocatedMemoryBytes = UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong(),
                gcCollections = GC.CollectionCount(0) - initialGc, batteryLevel = SystemInfo.batteryLevel,
                sessionId = Rejourney.CurrentSessionId, state = Rejourney.State.ToString(),
                framesSubmitted = Rejourney.Health.FramesCaptured, framesAccepted = Rejourney.Health.NativeFramesAccepted,
                backpressureDrops = Rejourney.Health.FramesSkippedBackpressure + Rejourney.Health.NativeFramesSkippedBackpressure,
                privacyDrops = Rejourney.Health.FramesSkippedPrivacy, captureFailures = Rejourney.Health.CaptureFailures,
                eventsDropped = Rejourney.Health.EventsDropped, pendingEvents = Rejourney.Health.PendingEvents,
                captureMilliseconds = Rejourney.Health.LastCaptureMilliseconds, sdkMainThreadMilliseconds = Rejourney.Health.MainThreadMilliseconds });
        }
        if (now - began < duration) return;
        Active = false;
        double seconds = now - began;
        var health = Rejourney.Health;
        double sdkMs = health.MainThreadMilliseconds - sdkMillisecondsAtStart;
        var summary = new {
            runId, mode, seconds, frames = count, framesPerSecond = count / seconds,
            frameTimeP50Ms = Percentile(histogram, count, .50), frameTimeP95Ms = Percentile(histogram, count, .95),
            frameTimeP99Ms = Percentile(histogram, count, .99), frameTimeMaximumMs = maximum,
            cpuMainThreadSamples = cpuCount, cpuMainThreadP50Ms = Percentile(cpuHistogram, cpuCount, .50),
            cpuMainThreadP95Ms = Percentile(cpuHistogram, cpuCount, .95), cpuMainThreadP99Ms = Percentile(cpuHistogram, cpuCount, .99),
            sdkMainThreadMsPerSecond = sdkMs / seconds, sdkMainThreadMsPerFrame = count > 0 ? sdkMs / count : 0,
            gcAllocatedRecorderValid = gcAllocated.Valid, gcAllocatedBytesPerFrame = count > 0 && gcAllocated.Valid ? gcBytes / (double)count : -1,
            gcAllocatedMaximumFrameBytes = gcAllocated.Valid ? gcMaximum : -1, gcCollections = GC.CollectionCount(0) - initialGc,
            managedPeakBytes = managedPeak, unityAllocatedPeakBytes = unityPeak,
            framesSubmitted = health.FramesCaptured - framesAtStart, framesAccepted = health.NativeFramesAccepted - acceptedAtStart,
            privacyDrops = health.FramesSkippedPrivacy - privacyAtStart,
            backpressureDrops = health.FramesSkippedBackpressure + health.NativeFramesSkippedBackpressure - backlogAtStart,
            eventsDropped = health.EventsDropped - droppedAtStart, sessionId = Rejourney.CurrentSessionId, state = Rejourney.State.ToString(),
            framesPerSecondPolicy = Rejourney.Settings.FramesPerSecond
        };
        var report = new { summary, unityVersion = Application.unityVersion, buildIdentifier = Application.buildGUID,
            graphicsApi = SystemInfo.graphicsDeviceType.ToString(), deviceModel = SystemInfo.deviceModel, samples, histogram, cpuHistogram,
            thermalObservation = "Collect OS thermal observations alongside this report; no thermal measurement inferred." };
        string path = Path.Combine(Application.persistentDataPath, "benchmark-" + runId + "-" + mode + ".json");
        try { File.WriteAllText(path, JsonConvert.SerializeObject(report)); completed?.Invoke(path, summary); }
        catch (Exception error) { completed?.Invoke("Benchmark report write failed: " + error.Message, summary); }
    }
}
