import { Cpu, Zap, Map } from "lucide-react";
import type { ReactNode } from "react";

export interface Article {
    id: string;
    title: string;
    subtitle: string;
    author: {
        name: string;
        url: string; // LinkedIn
        github?: string;
    };
    image: string;
    date: string;
    urlDate: string;
    readTime: string;
    schema: object;
    content: ReactNode;
}

// --- Content: Map Performance (New) ---

const mapArticleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Rejourney Session Replay: High-Performance Maps on iOS & Android",
    description:
        "How we solved 120Hz micro-stutter in map captures by hooking native SDK delegates for Mapbox, Apple Maps, and Google Maps.",
    author: {
        "@type": "Person",
        name: "Mohammad Rashid",
        url: "https://www.linkedin.com/in/mohammad-rashid7337/",
    },
    datePublished: "2026-02-17",
    dateModified: "2026-02-17",
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
        "@id": "https://rejourney.co/engineering/maps-performance",
    },
};

const MapArticleContent = () => (
    <div className="space-y-6 text-lg font-medium leading-relaxed">
        <p>
            Capturing high-fidelity session replays of native map views (Apple Maps, Google Maps, Mapbox)
            on 120Hz "ProMotion" screens is notoriously difficult. The standard approach of repeatedly
            snapshotting the view hierarchy often leads to <strong>micro-stutters</strong> and <strong>tearing</strong>
            because the capture loop fights with the map's own aggressive rendering loop.
        </p>
        <p>
            At Rejourney, we discovered that simply scheduling captures on a timer wasn't enough.
            To achieve buttery-smooth 120Hz performance while recording, we had to get deeper:
            <strong>Hooking the native map SDK rendering delegates.</strong>
        </p>

        <div className="my-12">
            <div className="mb-4">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    THE CHALLENGE
                </span>
                <h3 className="text-3xl font-black uppercase tracking-tighter">
                    The 120Hz Conflict
                </h3>
            </div>
            <p>
                Modern map SDKs drive the GPU hard. On an iPhone 15 Pro, a map sitting idle might be efficient,
                but the moment a user pans or zooms, the map engine locks the main thread's render server to
                maintain 120 FPS.
            </p>
            <p className="mt-4">
                If a session replay SDK tries to force a `drawHierarchy` or `snapshotView` call in the middle
                of this gesture, two things happen:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4 ml-4">
                <li>
                    <strong>Dropped Frames (Stutter):</strong> The map renderer blocks waiting for the snapshot
                    to complete, causing a visible hitch in the user's scroll.
                </li>
                <li>
                    <strong>Visual Artifacts:</strong> The snapshot might capture a half-rendered buffer state.
                </li>
            </ul>
        </div>

        <div className="my-12">
            <div className="mb-4">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    THE SOLUTION
                </span>
                <h3 className="text-3xl font-black uppercase tracking-tighter">
                    Delegate Swizzling & Hooking
                </h3>
            </div>
            <p>
                Instead of guessing when to capture, we ask the Map SDK itself. We reverse-engineered the
                delegate lifecycles of the major map providers to identify the exact moments when the map
                is <strong>Idle</strong> (safe to capture) vs. <strong>Moving</strong> (unsafe to capture).
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-8">
                <div className="bg-slate-50 border-2 border-black p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Cpu size={20} className="text-black" />
                        <div className="font-mono text-xs font-black uppercase text-gray-500">
                            iOS (Swift)
                        </div>
                    </div>
                    <p className="text-sm mb-4">
                        We use method swizzling on the `delegate` property. When we detect a map, we transparently
                        hook into the lifecycle methods to toggle our internal `mapIdle` state.
                    </p>
                    <div className="bg-white border border-gray-200 p-3 rounded">
                        <div className="font-mono text-[10px] font-bold text-blue-600 mb-1">MKMapViewDelegate</div>
                        <div className="font-mono text-[10px] text-gray-600">regionWillChangeAnimated {"->"} <span className="text-red-600 font-bold">PAUSE</span></div>
                        <div className="font-mono text-[10px] text-gray-600">regionDidChangeAnimated {"->"} <span className="text-green-600 font-bold">CAPTURE</span></div>
                    </div>
                </div>

                <div className="bg-slate-50 border-2 border-black p-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Zap size={20} className="text-black" />
                        <div className="font-mono text-xs font-black uppercase text-gray-500">
                            Android (Kotlin)
                        </div>
                    </div>
                    <p className="text-sm mb-4">
                        We use dynamic proxies to intercept the `OnCameraIdleListener`. This allows us to wake
                        up our visual capture engine exactly when the map settles.
                    </p>
                    <div className="bg-white border border-gray-200 p-3 rounded">
                        <div className="font-mono text-[10px] font-bold text-green-600 mb-1">GoogleMap.OnCameraIdleListener</div>
                        <div className="font-mono text-[10px] text-gray-600">onCameraIdle() {"->"} <span className="text-green-600 font-bold">SNAPSHOT NOW</span></div>
                    </div>
                </div>
            </div>
        </div>

        <div className="bg-black text-white p-8 my-10 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-10">
                <Map size={120} />
            </div>
            <h4 className="text-2xl font-black uppercase tracking-tighter mb-4 relative z-10">
                Code Analysis: SpecialCases.swift
            </h4>
            <p className="text-gray-300 text-sm font-mono mb-6 relative z-10">
                Here is the actual logic we use to safely swizzle the Apple Maps delegate without crashing
                the host app. We verify response to selectors before hooking.
            </p>

            <pre className="text-xs sm:text-sm font-mono text-green-400 overflow-x-auto relative z-10">
                {`private func _hookAppleMapKit(_ mapView: UIView) {
    guard let delegate = mapView.value(forKey: "delegate") as? NSObject else { return }
    
    // 1. Hook regionWillChange (Movement Start)
    let willChangeSel = NSSelectorFromString("mapView:regionWillChangeAnimated:")
    if let original = class_getInstanceMethod(delegateClass, willChangeSel) {
        let block: @convention(block) (AnyObject, AnyObject, Bool) -> Void = { 
            [weak self] _, _, _ in
            self?.mapIdle = false // <--- PAUSE CAPTURE
            // ... call original implementation ...
        }
        // ... swizzle implementation ...
    }

    // 2. Hook regionDidChange (Movement End)
    let didChangeSel = NSSelectorFromString("mapView:regionDidChangeAnimated:")
    if let original = class_getInstanceMethod(delegateClass, didChangeSel) {
        let block: @convention(block) (AnyObject, AnyObject, Bool) -> Void = { 
            [weak self] _, _, _ in
            self?.mapIdle = true  // <--- RESUME CAPTURE
            VisualCapture.shared.snapshotNow() // <--- CRITICAL: Capture immediately
            // ... call original implementation ...
        }
        // ... swizzle implementation ...
    }
}`}
            </pre>
        </div>

        <div className="my-12">
            <h3 className="text-3xl font-black uppercase tracking-tighter mb-6">
                The Result: Zero Jitter
            </h3>
            <p>
                By synchronizing our capture loop with the Map SDK's own camera logic, we achieve:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
                <div className="p-4 border-l-4 border-green-500">
                    <div className="font-black text-3xl mb-1">0ms</div>
                    <div className="text-sm font-bold uppercase text-gray-500">Main Thread Block</div>
                    <div className="text-xs text-gray-400 mt-2">During active map gestures</div>
                </div>
                <div className="p-4 border-l-4 border-blue-500">
                    <div className="font-black text-3xl mb-1">100%</div>
                    <div className="text-sm font-bold uppercase text-gray-500">Frame Integrity</div>
                    <div className="text-xs text-gray-400 mt-2">No tearing or half-rendered tiles</div>
                </div>
                <div className="p-4 border-l-4 border-purple-500">
                    <div className="font-black text-3xl mb-1">Auto</div>
                    <div className="text-sm font-bold uppercase text-gray-500">Detection</div>
                    <div className="text-xs text-gray-400 mt-2">Works for Mapbox, Google, Apple</div>
                </div>
            </div>
        </div>
    </div>
);

// --- Content: Original Architecture Article ---

const techArticleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Engineering - Rejourney Architecture",
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
        "@id": "https://rejourney.co/engineering/architecture-deep-dive",
    },
};

const TECH_METRICS = [
    { name: "Main: UIKit + Metal Capture", avg: "12.4", max: "28.2", min: "8.1", thread: "Main" },
    { name: "BG: Async Image Processing", avg: "42.5", max: "88.0", min: "32.4", thread: "Background" },
    { name: "BG: Tar+Gzip Compression", avg: "14.2", max: "32.5", min: "9.6", thread: "Background" },
    { name: "BG: Upload Handshake", avg: "0.8", max: "2.4", min: "0.3", thread: "Background" },
    { name: "Total Main Thread Impact", avg: "12.4", max: "28.2", min: "8.1", thread: "Main" },
];

const TechArticleContent = () => (
    <div className="space-y-6 text-lg font-medium leading-relaxed">
        {/* Section 01 */}
        <div className="mb-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    01 //
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Why Pixel-Perfect Replay?
                </h2>
            </div>
            <p>
                Most mobile session replay tools attempt to <strong>reconstruct</strong> the
                session rather than record it. Tools like <strong>PostHog</strong>, <strong>LogRocket</strong>,
                and <strong>Microsoft Clarity</strong> use native APIs to serialize the view
                hierarchy or capture low-level drawing commands.
            </p>
            <ul className="list-disc pl-6 space-y-4 my-6">
                <li>
                    <strong>PostHog & LogRocket:</strong> Primarily serialize the <strong>View Tree</strong>.
                    They inspect the UI structure and reconstruct it as wireframes or static UI state snapshots
                    synced with event streams. While efficient, they often miss the "visual truth" of high-motion
                    GPU content.
                </li>
                <li>
                    <strong>Microsoft Clarity:</strong> Captures low-level <strong>Drawing Commands</strong> to
                    provide a "walkthrough-style" video. It buffers visual commands on-device, but it
                    isn't capturing the final rendered outcome seen by the user.
                </li>
            </ul>
            <p>
                <strong>Rejourney is different:</strong> We capture the actual <strong>GPU Framebuffer</strong>{" "}
                (via <code>drawHierarchy</code>). This ensures <strong>Pixel-Perfect Accuracy</strong>.
                If your app uses <strong>Metal</strong>, <strong>Maps</strong>, or custom shaders that
                native view serialization can't understand, Rejourney records them exactly as they
                appeared on the user's screen.
            </p>
            <p className="mt-4">
                While competitors rely on reconstructing a simulation from data points, Rejourney delivers a true visual record of the session. We handle the heavy lifting of <strong>GPU-ready capture</strong> while ensuring zero impact on the main thread.
            </p>
        </div>

        {/* Section 02 */}
        <div className="mb-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    02 //
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    The Zero-Interference Pipeline
                </h2>
            </div>
            <p>
                To achieve high-fidelity replay (3 FPS) without impacting frame rates,
                our Swift SDK uses a sophisticated <strong>Async Capture Pipeline</strong>.
                Capturing the screen is cheap; processing it is expensive.
            </p>
            <p className="mt-4">
                We perform the mandatory UIKit interaction on the main thread but immediately hand off the pixel buffer to a <strong>serialized background queue (QoS: Utility)</strong> for JPEG encoding, batching, and Gzip compression.
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    CORE: ASYNC ENCODING (Swift)
                </div>
                <pre className="text-xs sm:text-sm font-mono overflow-x-auto text-blue-800">
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
                To further protect the user experience, we utilize <strong>Run Loop Gating</strong>. By running our capture timer in the default run loop mode, the system automatically pauses capture during active touches or scrolls, eliminating any risk of micro-stutter during critical interactions.
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    Logic: Run Loop Gating
                </div>
                <pre className="text-xs sm:text-sm font-mono overflow-x-auto text-green-800">
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

        {/* Section 03 */}
        <div className="mb-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    03 //
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Intelligent Promotion Engine
                </h2>
            </div>
            <p>
                Recording every session is wasteful. Rejourney's SDK works alongside our backend to identify and promote only the sessions that contain value: crashes, performance regressions, or user frustration.
            </p>
            <p className="mt-4">
                The SDK continuously monitors signals like <strong>ANRs (Main Thread Freezes)</strong>, <strong>Dead Taps</strong>, and <strong>Rage Taps</strong>. When a session concludes, these metrics are evaluated to decide if the visual data should be retained.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-8">
                <div className="bg-slate-50 border-2 border-black p-6">
                    <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                        ANR Detection (2.0s Heartbeat)
                    </div>
                    <pre className="text-xs font-mono overflow-x-auto text-purple-800">
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
                    <pre className="text-xs font-mono overflow-x-auto text-blue-800">
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


        {/* Section 04 */}
        <div className="mb-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    04 //
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Real-World Performance Benchmarks
                </h2>
            </div>
            <p>
                Benchmarks captured on an <strong>iPhone 15 Pro (iOS 18)</strong> running
                the production Merch App. By isolating main-thread UIKit calls from background processing,
                we maintain a virtually invisible performance footprint.
            </p>
            <div className="border-2 border-black bg-white overflow-hidden mt-8">
                <table className="w-full border-collapse">
                    <thead>
                        <tr className="bg-black text-white">
                            <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">Metric</th>
                            <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">Thread</th>
                            <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest">Avg (ms)</th>
                        </tr>
                    </thead>
                    <tbody>
                        {TECH_METRICS.map((metric) => (
                            <tr key={metric.name} className="border-b-2 border-black hover:bg-slate-50 transition-colors">
                                <td className="py-2 px-4 text-xs font-black uppercase border-r-2 border-black">{metric.name}</td>
                                <td className="py-2 px-4 text-xs font-bold text-center border-r-2 border-black">
                                    <span className={metric.thread === "Main" ? "text-red-600" : "text-green-600"}>{metric.thread}</span>
                                </td>
                                <td className="py-2 px-4 text-xs font-mono font-bold text-right">{metric.avg}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>

        {/* Section 05 */}
        <div className="mb-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    05 //
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Privacy: On-Device Redaction
                </h2>
            </div>
            <p>
                Rejourney follows a <strong>Zero-Trust Privacy</strong> model. Sensitive UI elements are never recorded. Our on-device <strong>RedactionMasks</strong> scan identifies text inputs (UITextField, UITextView), password fields, and camera previews before the pixel buffer is encoded.
            </p>
            <p className="mt-4">
                These areas are blacked out directly in the memory buffer. The private data never hits the disk, never enters the JPEG encoder, and never leaves the device.
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    Security: Redaction Detection
                </div>
                <pre className="text-xs sm:text-sm font-mono overflow-x-auto text-red-800">
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

        {/* Section 06 */}
        <div className="mb-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    06 //
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Lightweight by Design: The "Smart" Internals
                </h2>
            </div>
            <p>
                Being lightweight isn't just about moving work to background threads. It's about <strong>strategic omission</strong> and defensive engineering. Our SDK includes several "invisible" optimizations to ensure we never impact your app's performance.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-6">
                <div className="p-4 border-l-4 border-black bg-gray-50">
                    <h4 className="font-bold text-lg mb-2">16ms hierarchy budget</h4>
                    <p className="text-sm text-gray-600">
                        Hierarchy scanning has a hard 16ms bailout. If your view tree is massive, we stop scanning before we block the next frame. We prioritize your app's FPS over our own data completeness.
                    </p>
                </div>
                <div className="p-4 border-l-4 border-black bg-gray-50">
                    <h4 className="font-bold text-lg mb-2">NaN-Safe Serialization</h4>
                    <p className="text-sm text-gray-600">
                        Animated iOS views often produce "degenerate" frames (NaN/Infinity sizes). Our SDK sanitizes every coordinate before serialization to prevent JSON crashes, a common failure point in mobile replay tools.
                    </p>
                </div>
                <div className="p-4 border-l-4 border-black bg-gray-50">
                    <h4 className="font-bold text-lg mb-2">Smart Key-Window Only</h4>
                    <p className="text-sm text-gray-600">
                        We only capture the Key Window. This automatically skips high-frequency system windows (like the Keyboard or Alert layers) that would otherwise cause redundant processing and rendering artifacts.
                    </p>
                </div>
                <div className="p-4 border-l-4 border-black bg-gray-50">
                    <h4 className="font-bold text-lg mb-2">1.25x Capture Scale</h4>
                    <p className="text-sm text-gray-600">
                        Instead of capturing at 3x Retina scale, we use a fixed 1.25x scale. This results in a ~6x reduction in JPEG size while maintaining perfect legibility for debugging sessions.
                    </p>
                </div>
            </div>

            <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    Optimization: Scan Caching
                </div>
                <pre className="text-xs sm:text-sm font-mono overflow-x-auto text-green-800">
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

        {/* Section 07 */}
        <div className="mb-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    07 //
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Stack Evolution: A Tale of Two Platforms
                </h2>
            </div>
            <p>
                Our journey to high-fidelity replay wasn't symmetrical. On Android, <strong>Kotlin proved exceptionally performant</strong> from day one. Its modern concurrency primitives and efficient bytecode generation allowed us to hit our performance targets with minimal architectural thrashing.
            </p>
            <p className="mt-4">
                iOS was a different story. Our initial prototype was built in legacy <strong>Objective-C</strong>. While functional, the overhead of the dynamic runtime and the complexity of managing thread-safe manual memory buffers created persistent micro-stutter in high-traffic apps.
            </p>
            <p className="mt-4">
                We made the decision to rewrite the core capture engine in <strong>Swift</strong>. The result was an immediate and dramatic improvement in main-thread responsiveness. By leveraging Swift's stricter type system and more efficient handling of OperationQueues and GCD, we managed to cut per-frame overhead by over 40% compared to the original Obj-C implementation.
            </p>
        </div>

        {/* System Architecture Map */}
        <div className="bg-black text-white p-8 sm:p-12 my-12">
            <h3 className="text-3xl font-black uppercase tracking-tighter mb-8 border-b border-gray-700 pb-4">
                Architecture Map
            </h3>
            <div className="space-y-8">
                <div>
                    <h4 className="font-bold text-yellow-400 mb-1">SDK Core Files</h4>
                    <p className="text-xs text-gray-400 font-mono mb-4">Replay Orchestrator</p>
                    <div className="font-mono text-sm bg-gray-900 p-3 rounded text-green-400">
                        packages/react-native/ios/Recording/ReplayOrchestrator.swift
                    </div>
                    <p className="text-gray-400 text-sm mt-2">Session lifecycle, remote configuration, and component synchronization.</p>
                </div>

                <div>
                    <p className="text-xs text-gray-400 font-mono mb-4">Visual Capture Engine</p>
                    <div className="font-mono text-sm bg-gray-900 p-3 rounded text-green-400">
                        packages/react-native/ios/Recording/VisualCapture.swift
                    </div>
                    <p className="text-gray-400 text-sm mt-2">Async JPEG compression, Run Loop Gating, and frame batching.</p>
                </div>

                <div>
                    <p className="text-xs text-gray-400 font-mono mb-4">Privacy & Redaction</p>
                    <div className="font-mono text-sm bg-gray-900 p-3 rounded text-green-400">
                        packages/react-native/ios/Recording/VisualCapture.swift (RedactionMask)
                    </div>
                    <p className="text-gray-400 text-sm mt-2">On-device sensitive view detection and buffer blacking.</p>
                </div>

                <div>
                    <p className="text-xs text-gray-400 font-mono mb-4">Segment Dispatcher & Uploader</p>
                    <div className="font-mono text-sm bg-gray-900 p-3 rounded text-green-400">
                        packages/react-native/ios/Recording/SegmentDispatcher.swift
                    </div>
                    <p className="text-gray-400 text-sm mt-2">HTTP/2 multiplexed uploads, retry logic, and retention evaluation.</p>
                </div>

                <div>
                    <p className="text-xs text-gray-400 font-mono mb-4">Stability & ANR Sentinel</p>
                    <div className="font-mono text-sm bg-gray-900 p-3 rounded text-green-400">
                        packages/react-native/ios/Recording/AnrSentinel.swift
                    </div>
                    <p className="text-gray-400 text-sm mt-2">Main-thread health monitoring and stack trace capture.</p>
                </div>
            </div>
        </div>

    </div>
);

// --- Articles Export ---

export const ARTICLES: Article[] = [
    {
        id: "maps-performance",
        title: "120Hz Map Performance: Hooking Native SDKs",
        subtitle: "Solving micro-stutter on Apple Maps, Google Maps, and Mapbox via delegate swizzling.",
        date: "Feb 17, 2026",
        urlDate: "2026-02-17",
        readTime: "4 min read",
        author: {
            name: "Mohammad Rashid",
            url: "https://www.linkedin.com/in/mohammad-rashid7337/",
            github: "https://github.com/Mohammad-R-Rashid",
        },
        image: "https://rejourney.co/assets/engineering/maps-performance.png",
        schema: mapArticleSchema,
        content: <MapArticleContent />,
    },
    {
        id: "architecture-deep-dive",
        title: "Rejourney Architecture: The Zero-Interference Pipeline",
        subtitle: "How we achieved pixel-perfect replay with 3 FPS and zero main-thread impact.",
        date: "Feb 06, 2026",
        urlDate: "2026-02-06",
        readTime: "8 min read",
        author: {
            name: "Mohammad Rashid",
            url: "https://www.linkedin.com/in/mohammad-rashid7337/",
            github: "https://github.com/Mohammad-R-Rashid",
        },
        image: "https://rejourney.co/assets/engineering/architecture-deep-dive.png",
        schema: techArticleSchema,
        content: <TechArticleContent />,
    },
];
