/**
 * Rejourney Dashboard - Engineering Page Route
 * Updated to accurately reflect the SDK's high-performance Swift architecture.
 */

import type { Route } from "./+types/engineering";
import { Header } from "~/components/layout/Header";
import { Footer } from "~/components/layout/Footer";

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Engineering - Rejourney",
  description:
    "How Rejourney delivers high-fidelity session replay without UI stutter. Learn about our async capture pipeline, run loop gating, and zero-trust privacy redaction.",
  author: {
    "@type": "Person",
    name: "Mohammad Rashid",
    url: "https://www.linkedin.com/in/mohammad-rashid7337/",
  },
  datePublished: "2026-02-06",
  dateModified: "2026-02-06",
  publisher: {
    "@type": "Organization",
    name: "Rejourney",
    logo: {
      "@type": "ImageObject",
      url: "https://rejourney.co/rejourneyIcon-removebg-preview.png",
    },
  },
  mainEntityOfPage: {
    "@type": "WebPage",
    "@id": "https://rejourney.co/engineering",
  },
};

const perfMetrics = [
  { name: "Main: UIKit Capture (drawHierarchy)", avg: "12.4", max: "28.2", min: "8.1", thread: "Main" },
  { name: "BG: Async Image Processing", avg: "42.5", max: "88.0", min: "32.4", thread: "Background" },
  { name: "BG: Tar+Gzip Compression", avg: "14.2", max: "32.5", min: "9.6", thread: "Background" },
  { name: "BG: Segment Upload Handshake", avg: "0.8", max: "2.4", min: "0.3", thread: "Background" },
  { name: "Total Main Thread Impact", avg: "12.4", max: "28.2", min: "8.1", thread: "Main" },
];

export const meta: Route.MetaFunction = () => [
  { title: "Engineering - Rejourney" },
  {
    name: "description",
    content:
      "How Rejourney delivers high-fidelity session replay without UI stutter. Learn about our async capture pipeline, run loop gating, and zero-trust privacy redaction.",
  },
  { property: "og:title", content: "Engineering - Rejourney" },
  { property: "og:url", content: "https://rejourney.co/engineering" },
  { property: "og:type", content: "article" },
  {
    property: "og:description",
    content:
      "How Rejourney delivers high-fidelity session replay without UI stutter. Learn about our async capture pipeline, run loop gating, and zero-trust privacy redaction.",
  },
  { name: "article:published_time", content: "2026-02-06" },
  { name: "article:author", content: "Mohammad Rashid" },
];

export default function EngineeringPage() {
  return (
    <div className="min-h-screen w-full bg-white text-slate-900 font-sans selection:bg-yellow-200 flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(articleSchema),
        }}
      />
      <Header />
      <main className="flex-grow w-full">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
          <div className="mb-16 border-b-4 border-black pb-12">
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black uppercase tracking-tighter mb-6">
              Engineering
            </h1>
            <div className="text-base font-medium text-gray-600">
              By{" "}
              <a
                href="https://www.linkedin.com/in/mohammad-rashid7337/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-slate-900 hover:underline font-bold"
              >
                Mohammad Rashid
              </a>{" "}
              on February 6th, 2026
            </div>
          </div>

          <section className="mb-20">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                01 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                Why Pixel-Perfect Replay?
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                Most mobile session replay tools attempt to <strong>reconstruct</strong> the
                session rather than record it. Tools like <strong>PostHog</strong>, <strong>LogRocket</strong>,
                and <strong>Microsoft Clarity</strong> use native APIs to serialize the view
                hierarchy or capture low-level drawing commands.
              </p>

              <ul className="list-disc pl-6 space-y-4">
                <li>
                  <strong>PostHog & LogRocket:</strong> Primarily serialize the <strong>View Tree</strong>.
                  They inspect the UI structure and reconstruct it as wireframes or static UI state snapshots
                  synced with event streams. While efficient, they often miss the "visual truth" of high-motion
                  GPU content.
                </li>
                <li>
                  <strong>Microsoft Clarity:</strong> Captures low-level <strong>Drawing Commands</strong>
                  to provide a "walkthrough-style" video. It buffers visual commands on-device, but it
                  isn't capturing the final rendered outcome seen by the user.
                </li>
              </ul>

              <p>
                <strong>Rejourney is different:</strong> We capture the actual <strong>GPU Framebuffer</strong>
                (via <code>drawHierarchy</code>). This ensures <strong>Pixel-Perfect Accuracy</strong>.
                If your app uses <strong>Metal</strong>, <strong>Maps</strong>, or custom shaders that
                native view serialization can't understand, Rejourney records them exactly as they
                appeared on the user's screen.
              </p>
              <p>
                While competitors rely on reconstructing a simulation from data points, Rejourney
                delivers a true visual record of the session. We handle the heavy lifting of
                <strong>GPU-ready capture</strong> while ensuring zero impact on the main thread.
              </p>
            </div>
          </section>

          <section className="mb-20">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                02 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                The Zero-Interference Pipeline
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                To achieve high-fidelity replay (3 FPS) without impacting frame rates,
                our Swift SDK uses a sophisticated <strong>Async Capture Pipeline</strong>.
                Capturing the screen is cheap; processing it is expensive.
              </p>
              <p>
                We perform the mandatory UIKit interaction on the main thread but immediately
                hand off the pixel buffer to a <strong>serialized background queue</strong>
                (QoS: Utility) for JPEG encoding, batching, and Gzip compression.
              </p>

              <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                  CORE: ASYNC ENCODING (Swift)
                </div>
                <pre className="text-sm font-mono overflow-x-auto">
                  {`// Capture hierarchy on main, compress on background
_encodeQueue.addOperation { [weak self] in
    // jpegData(compressionQuality:) accounts for 60% of per-frame cost
    guard let data = image.jpegData(compressionQuality: jpegQuality) else { return }
    
    self?._stateLock.lock()
    self?._screenshots.append((data, captureTs))
    // Auto-ship when batch size (20 frames) is reached
    let shouldSend = self?._screenshots.count >= self?._batchSize
    self?._stateLock.unlock()
    
    if (shouldSend) { self?._sendScreenshots() }
}`}
                </pre>
              </div>

              <p>
                To further protect the user experience, we utilize <strong>Run Loop Gating</strong>.
                By running our capture timer in the default run loop mode, the system
                automatically pauses capture during active touches or scrolls, eliminating
                any risk of micro-stutter during critical interactions.
              </p>

              <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                  Logic: Run Loop Gating
                </div>
                <pre className="text-sm font-mono overflow-x-auto">
                  {`// Industry standard: Use default run loop mode (NOT .common)
// This lets the timer pause during scrolling which prevents stutter
_captureTimer = Timer.scheduledTimer(
  withTimeInterval: snapshotInterval, 
  repeats: true
) { [weak self] _ in
    self?._captureFrame()
}`}
                </pre>
              </div>
            </div>
          </section>

          <section className="mb-20">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                03 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                Intelligent Promotion Engine
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                Recording every session is wasteful. Rejourney's SDK works alongside our
                backend to identify and <strong>promote</strong> only the sessions that
                contain value: crashes, performance regressions, or user frustration.
              </p>
              <p>
                The SDK continuously monitors signals like <strong>ANRs (Main Thread Freezes)</strong>,
                <strong>Dead Taps</strong>, and <strong>Rage Taps</strong>. When a session
                concludes, these metrics are evaluated to decide if the visual data
                should be retained.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-6">
                <div className="bg-slate-50 border-2 border-black p-6">
                  <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    ANR Detection (2.0s Heartbeat)
                  </div>
                  <pre className="text-xs font-mono overflow-x-auto">
                    {`private func _watchLoop() {
  while (running) {
    _sendPing() // To main thread
    Thread.sleep(forTimeInterval: 2.0)
    if (_awaitingPong) {
      _reportFreeze(duration: delta)
    }
  }
}`}
                  </pre>
                </div>
                <div className="bg-slate-50 border-2 border-black p-6">
                  <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    Retention Evaluation
                  </div>
                  <pre className="text-xs font-mono overflow-x-auto">
                    {`dispatcher.evaluateReplayRetention(
  replayId: sid, 
  metrics: metrics
) { promoted, reason in
    if (promoted) {
      // Retain visual capture segments
      DiagnosticLog.notice("Session promoted: \\(reason)")
    }
}`}
                  </pre>
                </div>
              </div>
            </div>
          </section>

          <section className="mb-20">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                04 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                Real-World Performance Benchmarks
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                Benchmarks captured on an <strong>iPhone 15 Pro (iOS 18)</strong> running
                the production <a href="https://merchcampus.com" target="_blank" rel="noopener noreferrer" className="underline font-bold">Merch App</a>.
                By isolating main-thread UIKit calls from background processing, we maintain
                a virtually invisible performance footprint.
              </p>
            </div>

            <div className="border-2 border-black bg-white overflow-hidden mt-8">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-black text-white">
                    <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">
                      Metric
                    </th>
                    <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">
                      Thread
                    </th>
                    <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">
                      Avg (ms)
                    </th>
                    <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest">
                      Max (ms)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {perfMetrics.map((metric) => (
                    <tr
                      key={metric.name}
                      className="border-b-2 border-black hover:bg-slate-50 transition-colors"
                    >
                      <td className="py-3 px-4 text-xs font-black uppercase border-r-2 border-black">
                        {metric.name}
                      </td>
                      <td className="py-3 px-4 text-xs font-bold text-center border-r-2 border-black">
                        <span className={metric.thread === "Main" ? "text-red-600" : "text-green-600"}>
                          {metric.thread}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">
                        {metric.avg}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono font-bold text-right">
                        {metric.max}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-20">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                05 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                Privacy: On-Device Redaction
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                Rejourney follows a <strong>Zero-Trust Privacy</strong> model. Sensitive
                UI elements are never recorded. Our on-device <code>RedactionMask</code>
                scan identifies text inputs (UITextField, UITextView), password fields,
                and camera previews before the pixel buffer is encoded.
              </p>
              <p>
                These areas are blacked out directly in the memory buffer. The private
                data never hits the disk, never enters the JPEG encoder, and never
                leaves the device.
              </p>

              <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                  Security: Redaction Detection
                </div>
                <pre className="text-sm font-mono overflow-x-auto">
                  {`private func _shouldMask(_ view: UIView) -> Bool {
  // 1. Mask ALL text input fields by default
  if view is UITextField || view is UITextView { return true }
  
  // 2. Check class name (React Native internal types)
  let className = String(describing: type(of: view))
  if _sensitiveClassNames.contains(className) { return true }
  
  // 3. Mask camera previews
  if view.layer is AVCaptureVideoPreviewLayer { return true }
  
  return false
}`}
                </pre>
              </div>
            </div>
          </section>

          <section className="mb-20">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                06 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                Lightweight by Design: The "Smart" Internals
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                Being lightweight isn't just about moving work to background threads. It's about
                <strong>strategic omission</strong> and <strong>defensive engineering</strong>.
                Our SDK includes several "invisible" optimizations to ensure we never impact
                your app's performance.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 my-8">
                <div className="border-l-4 border-black pl-6">
                  <h3 className="text-xl font-black uppercase mb-2">16ms hierarchy budget</h3>
                  <p className="text-sm">
                    Hierarchy scanning has a hard 16ms bailout. If your view tree is massive,
                    we stop scanning before we block the next frame. We prioritize your app's
                    FPS over our own data completeness.
                  </p>
                </div>
                <div className="border-l-4 border-black pl-6">
                  <h3 className="text-xl font-black uppercase mb-2">NaN-Safe Serialization</h3>
                  <p className="text-sm">
                    Animated iOS views often produce "degenerate" frames (NaN/Infinity sizes).
                    Our SDK sanitizes every coordinate before serialization to prevent
                    JSON crashes, a common failure point in mobile replay tools.
                  </p>
                </div>
                <div className="border-l-4 border-black pl-6">
                  <h3 className="text-xl font-black uppercase mb-2">Smart Key-Window Only</h3>
                  <p className="text-sm">
                    We only capture the Key Window. This automatically skips high-frequency
                    system windows (like the Keyboard or Alert layers) that would otherwise
                    cause redundant processing and rendering artifacts.
                  </p>
                </div>
                <div className="border-l-4 border-black pl-6">
                  <h3 className="text-xl font-black uppercase mb-2">1.25x Capture Scale</h3>
                  <p className="text-sm">
                    Instead of capturing at 3x Retina scale, we use a fixed 1.25x scale.
                    This results in a ~6x reduction in JPEG size while maintaining
                    perfect legibility for debugging sessions.
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                  Optimization: Scan Caching
                </div>
                <pre className="text-sm font-mono overflow-x-auto">
                  {`// We only scan the heavy hierarchy every 1.0s for auto-redaction.
// Focused inputs are always unmasked instantly via explicit registration,
// but the heavy recursive scan is 'debounced' to save CPU.
let now = CFAbsoluteTimeGetCurrent()
if (now - _lastScanTime >= 1.0) {
    _scanForSensitiveViews(in: window)
    _lastScanTime = now
}`}
                </pre>
              </div>
            </div>
          </section>

          <section className="mb-20">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                07 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                Stack Evolution: A Tale of Two Platforms
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                Our journey to high-fidelity replay wasn't symmetrical. On Android,
                <strong>Kotlin</strong> proved exceptionally performant from day one. Its modern
                concurrency primitives and efficient bytecode generation allowed us to hit
                our performance targets with minimal architectural thrashing.
              </p>
              <p>
                iOS was a different story. Our initial prototype was built in legacy
                <strong>Objective-C</strong>. While functional, the overhead of the dynamic
                runtime and the complexity of managing thread-safe manual memory buffers
                created persistent micro-stutter in high-traffic apps.
              </p>
              <p>
                We made the decision to <strong>rewrite the core capture engine in Swift</strong>.
                The result was an immediate and dramatic improvement in main-thread
                responsiveness. By leveraging Swift's stricter type system and more efficient
                handling of <code>OperationQueues</code> and GCD, we managed to cut
                per-frame overhead by over 40% compared to the original Obj-C implementation.
              </p>
            </div>
          </section>

          <section className="mb-20 border-t-4 border-black pt-12">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                ARCHITECTURE MAP //
              </span>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-6">
                SDK Core Files
              </h2>
            </div>

            <div className="space-y-4 text-base font-medium">
              <div className="border-2 border-black p-4">
                <div className="font-mono text-sm font-black uppercase mb-2">
                  Replay Orchestrator
                </div>
                <div className="text-sm">
                  packages/react-native/ios/Recording/ReplayOrchestrator.swift
                </div>
                <div className="text-sm opacity-70 mt-1">
                  Session lifecycle, remote configuration, and component synchronization.
                </div>
              </div>

              <div className="border-2 border-black p-4">
                <div className="font-mono text-sm font-black uppercase mb-2">
                  Visual Capture Engine
                </div>
                <div className="text-sm">
                  packages/react-native/ios/Recording/VisualCapture.swift
                </div>
                <div className="text-sm opacity-70 mt-1">
                  Async JPEG compression, Run Loop Gating, and frame batching.
                </div>
              </div>

              <div className="border-2 border-black p-4">
                <div className="font-mono text-sm font-black uppercase mb-2">
                  Privacy & Redaction
                </div>
                <div className="text-sm">
                  packages/react-native/ios/Recording/VisualCapture.swift (RedactionMask)
                </div>
                <div className="text-sm opacity-70 mt-1">
                  On-device sensitive view detection and buffer blacking.
                </div>
              </div>

              <div className="border-2 border-black p-4">
                <div className="font-mono text-sm font-black uppercase mb-2">
                  Segment Dispatcher & Uploader
                </div>
                <div className="text-sm">
                  packages/react-native/ios/Recording/SegmentDispatcher.swift
                </div>
                <div className="text-sm opacity-70 mt-1">
                  HTTP/2 multiplexed uploads, retry logic, and retention evaluation.
                </div>
              </div>

              <div className="border-2 border-black p-4">
                <div className="font-mono text-sm font-black uppercase mb-2">
                  Stability & ANR Sentinel
                </div>
                <div className="text-sm">
                  packages/react-native/ios/Recording/AnrSentinel.swift
                </div>
                <div className="text-sm opacity-70 mt-1">
                  Main-thread health monitoring and stack trace capture.
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
