import type { Article } from "../engineeringTypes";

// --- Content: Swift Package Open Beta ---

const SWIFT_PACKAGE_BETA_ARTICLE_URL = "https://rejourney.co/engineering/2026-05-05/swift-package-open-beta";

const swiftPackageBetaArticleSchema = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "Rejourney Swift Package Is Now in Open Beta",
    description:
        "How the Rejourney native iOS SDK works: session state machine, URLProtocol swizzle for custom URLSessions, visual capture backpressure, ANR ping-pong sentinel, and crash recovery checkpoints.",
    url: SWIFT_PACKAGE_BETA_ARTICLE_URL,
    keywords: [
        "Swift Package Manager",
        "iOS session replay",
        "native iOS SDK",
        "mobile session replay",
        "mobile observability",
        "URLProtocol interception",
        "Swift concurrency",
        "Rejourney iOS SDK",
    ],
    author: {
        "@type": "Person",
        name: "Mohammad Rashid",
        url: "https://www.linkedin.com/in/mohammad-rashid7337/",
        github: "https://github.com/Mohammad-R-Rashid",
    },
    datePublished: "2026-05-05",
    dateModified: "2026-05-05",
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
        "@id": SWIFT_PACKAGE_BETA_ARTICLE_URL,
    },
};

const SwiftPackageBetaArticleContent = () => (
    <div className="space-y-6 text-lg font-medium leading-relaxed">
        <p>
            The native <strong>Rejourney Swift Package</strong> is now in open beta. This article
            covers how the recorder actually works: the session state machine, the two start paths,
            how we intercept network traffic without intercepting our own uploads, what happens to
            a session that dies mid-recording, and why the ANR sentinel lives on a separate thread.
        </p>
        <p>
            The package targets iOS 15.1+, requires Swift tools 5.9, and links only <code>libz</code>.
            There is no CocoaPods podspec, no JavaScript runtime, and no React Native dependency.
        </p>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    01 // SESSION STATE MACHINE
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Five States, One Controller
                </h2>
            </div>
            <p>
                <code>RejourneyNativeController</code> is a <code>@MainActor</code> singleton that owns
                all session transitions. Its state is a Swift enum with five cases:
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`private enum SessionState: Equatable {
    case idle
    case starting(sessionId: String)
    case active(sessionId: String)
    case paused(sessionId: String, backgroundedAt: TimeInterval)
    case terminated
}`}</pre>
            </div>
            <p>
                The <code>starting</code> case uses a <code>"pending_\(timestampMs)"</code> placeholder
                ID. A 5-second poll loop (50 iterations × 100 ms) waits for{" "}
                <code>ReplayOrchestrator.shared.replayId</code> to become non-nil before transitioning to
                <code>active</code>. If the orchestrator never produces an ID — usually because credential
                fetch failed — the controller drops back to <code>idle</code> and disables URL interception.
            </p>
            <p className="mt-4">
                Background/foreground is handled by two <code>NotificationCenter</code> observers wired in
                <code>setupLifecycleListeners()</code>. When the app backgrounds, state moves to{" "}
                <code>paused(sessionId:, backgroundedAt:)</code> with the current Unix timestamp. On
                foreground the controller reads the elapsed duration and compares it against a 60-second
                timeout. Under the threshold the session resumes; over it, the controller races two
                triggers — a 2-second <code>DispatchWorkItem</code> grace timer and the{" "}
                <code>endReplayWithReason("background_timeout")</code> completion callback — to start a
                fresh session without blocking on the prior session's upload.
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">Session rollover (simplified)</div>
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`var restartStarted = false
let triggerRestart: (String) -> Void = { source in
    guard !restartStarted else { return }
    restartStarted = true
    Task { @MainActor in await self.startNewSessionAfterTimeout() }
}
// Grace path: fire after 2s if callback hasn't arrived yet
DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
    triggerRestart("grace_timeout")
}
// Callback path: fire as soon as old session is finalized
DispatchQueue.global(qos: .utility).async {
    ReplayOrchestrator.shared.endReplayWithReason("background_timeout") { _, _ in
        triggerRestart("end_replay_callback")
    }
}`}</pre>
            </div>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    02 // START PATHS
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Fast Restart vs. Full Credential Fetch
                </h2>
            </div>
            <p>
                Every call to <code>Rejourney.start()</code> first hits <code>/api/sdk/config</code> to
                fetch remote configuration — <code>sampleRate</code>, <code>recordingEnabled</code>,{" "}
                <code>maxRecordingMinutes</code>, and billing state. The response determines whether visual
                capture runs at all. A <code>401</code>/<code>403</code>/<code>404</code> is treated as
                hard denial and returns <code>RejourneyStartResult(success: false, error: "access_denied_\(statusCode)")</code>.
                A network failure falls back to <code>RejourneyRemoteConfig.defaultConfig</code> and
                continues with local defaults.
            </p>
            <p className="mt-4">
                After remote config is resolved, the orchestrator needs upload credentials. There are two
                code paths:
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                <div className="border-2 border-black bg-slate-50 p-5">
                    <div className="font-mono text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3">
                        Cold start — beginReplay
                    </div>
                    <p className="text-base m-0">
                        Calls <code>DeviceRegistrar.shared.obtainCredential</code>, which performs a
                        credential handshake and stores the result in Keychain. Only then does it start
                        an <code>NWPathMonitor</code> and wait for a satisfied network path before{" "}
                        <code>_beginRecording</code> is called.
                    </p>
                </div>
                <div className="border-2 border-black bg-white p-5">
                    <div className="font-mono text-[10px] font-black uppercase tracking-widest text-gray-500 mb-3">
                        Warm restart — beginReplayFast
                    </div>
                    <p className="text-base m-0">
                        Uses a cached Keychain credential directly. Skips the credential fetch and the
                        network monitor startup entirely. Calls <code>_beginRecording</code> on the main
                        queue synchronously — measurably faster for the session-rollover case after a
                        background timeout.
                    </p>
                </div>
            </div>
            <p className="mt-6">
                Sample rate enforcement happens in <code>RejourneySessionPolicy.derive</code>. It draws
                a <code>Double.random(in: 0..&lt;100)</code> and compares it against the remote{" "}
                <code>sampleRate</code> integer. Sessions that are sampled out return before replay,
                network interception, or capture is started, so the SDK avoids the native recording
                path for that launch.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    03 // NETWORK INTERCEPTION
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    URLProtocol Registration and the Swizzle Problem
                </h2>
            </div>
            <p>
                <code>URLProtocol.registerClass(RejourneyURLProtocol.self)</code> covers{" "}
                <code>URLSession.shared</code> and any session created from the default configuration.
                It does not cover sessions built with a custom <code>URLSessionConfiguration</code> —
                which is exactly what SDWebImage, Alamofire, and most third-party SDKs use. To reach
                those, we swizzle the <code>protocolClasses</code> getter on{" "}
                <code>URLSessionConfiguration</code> itself.
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">Swizzle — add method onto URLSessionConfiguration, then exchange</div>
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`let didAdd = class_addMethod(
    URLSessionConfiguration.self,
    swizzledSel,
    method_getImplementation(swizzledMethod),
    method_getTypeEncoding(swizzledMethod)
)
if didAdd, let addedMethod = class_getInstanceMethod(configClass, swizzledSel) {
    originalProtocolClassesIMP = method_getImplementation(originalMethod)
    method_exchangeImplementations(originalMethod, addedMethod)
}`}</pre>
            </div>
            <p>
                The replacement getter calls through to the original IMP via a saved function pointer,
                then inserts <code>RejourneyURLProtocol</code> at index 0 if not already present. This
                means every <code>URLSessionConfiguration</code> instance — existing or future —
                gets the protocol injected at the point it queries its class list.
            </p>
            <p className="mt-4">
                Self-interception is prevented by stamping forwarded requests with a property under
                the key <code>"co.rejourney.handled"</code>. <code>canInit(with:)</code> returns
                false immediately if that property is set. The forwarding session itself is initialized
                from <code>URLSessionConfiguration.ephemeral</code> with <code>protocolClasses = []</code>,
                so even the swizzled getter produces an empty list for our internal session.
            </p>
            <p className="mt-4">
                The original implementation created a new <code>URLSession</code> per intercepted
                request, which leaked 1–3 MB per request under heavy traffic. The current design uses
                one shared forwarding session with a <code>SessionDelegateAdapter</code> that routes
                callbacks through an <code>NSMapTable&lt;URLSessionTask, RejourneyURLProtocol&gt;.strongToWeakObjects()</code>.
                The weak value side means protocol instances that are stopped by the URL loading system
                get collected without a leak, and the map never accumulates stale entries.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    04 // VISUAL CAPTURE
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Main-Thread Reads, Background Encodes, Backpressure Limits
                </h2>
            </div>
            <p>
                UIKit requires that <code>drawHierarchy(in:afterScreenUpdates:)</code> runs on the main
                thread. There is no way around this. What we can control is how much time we spend
                there and how we handle encode and upload without blocking the render pipeline.
            </p>
            <p className="mt-4">
                Screenshots are taken at a configurable interval (default 0.33s, translating to roughly
                3 fps) and immediately handed off to a serial <code>OperationQueue</code> named{" "}
                <code>"co.rejourney.encode"</code> with <code>.utility</code> QoS. JPEG compression
                runs entirely on that queue. The main thread is only involved for the initial pixel
                read — not for compression, buffering, or upload.
            </p>
            <p className="mt-4">
                Two backpressure limits protect against queue growth under slow network conditions:
                50 pending encode batches and 500 buffered screenshots. Frames are dropped — not
                queued indefinitely — when either limit is reached. The capture scale is 1.25, which
                means the framebuffer is read at 80% of linear screen size before JPEG encoding, matching
                the ratio used by the Android recorder.
            </p>
            <p className="mt-4">
                One non-obvious guard: we skip <code>drawHierarchy</code> while the keyboard is
                animating. Calling it during a keyboard transition causes UIKit to stall the main
                thread — we measured 7+ seconds — while it resolves conflicting layout constraints
                between the keyboard window and the app window. We observe both{" "}
                <code>keyboardWillShow</code> and <code>keyboardWillHide</code>, and only resume
                capture 0.45 seconds after <code>keyboardDidShow</code> or{" "}
                <code>keyboardDidHide</code> fires.
            </p>
            <p className="mt-4">
                View hierarchy snapshots run on a separate <code>Timer</code> scheduled in the
                default run loop mode — intentionally not <code>.common</code>. This lets the timer
                pause during scrolling, preventing main-thread pressure from a hierarchy walk through
                deep subviews while the user is actively scrolling. Hierarchy snapshots are also
                skipped when MapKit is visible and actively animating; the Metal and OpenGL subview
                tree under an animating map adds meaningful main-thread cost to a full hierarchy scan.
                Deduplication uses a cheap hash of the current screen name and root child count —
                if neither changes, the snapshot is not uploaded.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    05 // ANR DETECTION
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    A Ping-Pong Sentinel on a Dedicated Thread
                </h2>
            </div>
            <p>
                <code>AnrSentinel</code> runs a watch loop on a dedicated <code>Thread</code> named{" "}
                <code>"co.rejourney.anr"</code> at <code>.utility</code> QoS. Every 2 seconds it
                posts a block to <code>DispatchQueue.main.async</code> and records the dispatch time.
                When the main queue actually executes the block it stamps{" "}
                <code>ProcessInfo.processInfo.systemUptime</code> as the response time. If
                2 seconds pass without a response and the delta exceeds the 5-second freeze
                threshold, the sentinel declares an ANR.
            </p>
            <p className="mt-4">
                State shared between the watch thread and the main thread is protected by{" "}
                <code>os_unfair_lock</code>, which is appropriate here because the critical sections
                are short (a handful of struct assignments) and the lock is never held across I/O.
                A <code>lastAnrReport</code> timestamp prevents duplicate reports while a single
                long freeze persists — if the freeze hasn't cleared for another 5-second window,
                the sentinel stays quiet.
            </p>
            <p className="mt-4">
                On ANR detection, <code>Thread.callStackSymbols</code> is captured and the incident
                is handed to <code>StabilityMonitor</code>, which persists it to a JSON file in the
                caches directory. This mirrors how crash reports survive process termination: if the
                app is killed while an ANR is in progress, the next session start will find and
                upload the stored incident.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    06 // CRASH RECOVERY
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Checkpoints, Recovery Files, and the Close Anchor
                </h2>
            </div>
            <p>
                When a session starts, the orchestrator writes a checkpoint to{" "}
                <code>rejourney_recovery.json</code> in the app's Documents directory. The file
                contains the session ID, start timestamp, API token, endpoint, upload credential,
                and a <code>timingVersion</code> field (currently 3). A background{" "}
                <code>DispatchSourceTimer</code> fires every 5 seconds on a <code>.utility</code>{" "}
                queue to update <code>lastActiveCheckpointMs</code> and re-write the file. The
                timer does not fire while the app is backgrounded, so the file always reflects
                the last known foreground timestamp.
            </p>
            <p className="mt-4">
                On the next app launch, <code>recoverInterruptedReplay</code> reads the file,
                re-hydrates <code>SegmentDispatcher</code> with the stored credentials, and calls{" "}
                <code>VisualCapture.shared.uploadPendingFrames</code> for any frames that were
                buffered to disk but not uploaded. Only after those frames are confirmed uploaded
                does it call <code>SegmentDispatcher.concludeReplay</code> with{" "}
                <code>endReason: "recovery_finalize"</code>.
            </p>
            <p className="mt-4">
                The <code>closeAnchorAtMs</code> parameter in the finalize call is where{" "}
                <code>timingVersion</code> matters. Version 3 semantics: for a{" "}
                <code>"background_timeout"</code> end reason, the close anchor is set to{" "}
                <code>lastBackgroundEntryMs</code> — the exact moment the app last entered the
                background — rather than the crash recovery time. This keeps the session duration
                accurate in the replay timeline even when the finalize call happens minutes or
                hours later.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    07 // PUBLIC API
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    The Core Public Surface
                </h2>
            </div>
            <p>
                The <code>Rejourney</code> enum is <code>@MainActor</code> and exposes both async
                and callback-based overloads for <code>start()</code> and <code>stop()</code> so
                UIKit apps without Swift concurrency adoption can still call it from an{" "}
                <code>AppDelegate</code>.
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`// Configure — call before start, safe to call multiple times
Rejourney.configure(publicKey: "rj_...", options: .init(
    wifiOnly: false,
    captureANR: true,
    autoTrackNetwork: true
))

// Async start — returns RejourneyStartResult with sessionId + telemetryOnly flag
let result = await Rejourney.start()

// Identity — persisted to UserDefaults, restored across sessions
Rejourney.identify("user_abc123")

// Screen tracking — queued before session is ready, replayed on active
Rejourney.trackScreen("Checkout")

// Custom events — typed properties accept Swift literals directly
Rejourney.logEvent("checkout_started", properties: ["plan": "pro"])

// View-level redaction — registered in VisualCapture's RedactionMask
Rejourney.mask(sensitiveLabel)

// Graceful stop — drains and finalizes the session
let stopResult = await Rejourney.stop()`}</pre>
            </div>
            <p>
                Custom event properties use <code>RejourneyMetadataValue</code>, an{" "}
                <code>indirect</code> enum with{" "}
                <code>ExpressibleByStringLiteral</code>, <code>ExpressibleByIntegerLiteral</code>,{" "}
                <code>ExpressibleByFloatLiteral</code>, <code>ExpressibleByBooleanLiteral</code>,
                and <code>ExpressibleByNilLiteral</code> conformances. You can pass a string, int,
                double, bool, array, nested object, or nil literal directly without wrapping.
            </p>
            <p className="mt-4">
                Screen names tracked before <code>start()</code> returns are queued in{" "}
                <code>RejourneySessionContext</code> (capped at 50 entries, consecutive duplicates
                removed). When the session becomes active, the queue is drained and each screen
                is replayed as a telemetry view transition event, so pre-start navigation appears
                correctly in the replay timeline.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    08 // RELEASE MODEL
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    What Is Beta and What Is Not
                </h2>
            </div>
            <p>
                The recorder, the ingest protocol, the session lifecycle semantics, and the privacy
                defaults are production-quality — they have been exercised through the React Native
                SDK at scale. What we are collecting signal on in this beta:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
                <li>SwiftPM resolution behavior across real Xcode versions and enterprise CI caches.</li>
                <li>App extension edge cases — the shared <code>UserDefaults</code> and Keychain access groups behave differently under extension sandboxing.</li>
                <li>SwiftUI navigation patterns: since SwiftUI has no UIKit <code>viewDidAppear</code> equivalent, we want to understand how teams prefer to wire <code>trackScreen</code> — <code>.onAppear</code>, <code>NavigationStack</code> path observation, or a custom modifier.</li>
                <li>Whether the <code>PrivacyInfo.xcprivacy</code> manifest is being picked up correctly by App Store submission pipelines.</li>
            </ul>
            <p className="mt-6">
                Native iOS versioning is independent from the React Native package. Tags follow plain
                semver (<code>v0.2.0</code>). A CI check validates that{" "}
                <code>packages/ios/VERSION</code> and <code>RejourneySDKInfo.version</code> are in
                sync before a tag is created.
            </p>
        </div>
    </div>
);

export const swiftPackageOpenBetaArticle: Article = {
    collection: "engineering",
    id: "swift-package-open-beta",
    title: "Rejourney Swift Package Is Now in Open Beta",
    subtitle: "The session state machine, two start paths, URLProtocol swizzle, visual capture backpressure, ANR ping-pong, and crash recovery checkpoints — how the native iOS SDK actually works.",
    seoKeywords:
        "Rejourney Swift Package, SwiftPM session replay, native iOS SDK, URLProtocol swizzle iOS, ANR detection iOS, iOS crash recovery session replay, Swift session state machine",
    seo: {
        primaryKeyword: "SwiftPM session replay",
        metaTitle: "SwiftPM Session Replay SDK: Rejourney Native iOS Beta",
        metaDescription:
            "Inside Rejourney's native iOS SDK: session states, URLProtocol swizzling, visual capture backpressure, ANR detection, and crash recovery.",
        targetKeywords: [
            "SwiftPM session replay",
            "native iOS session replay SDK",
            "Rejourney Swift Package",
            "URLProtocol swizzle iOS",
            "iOS ANR detection",
            "mobile replay SDK",
            "iOS crash recovery session replay",
        ],
        topicTags: ["Swift", "iOS SDK", "SwiftPM", "Session Replay", "Mobile Observability"],
    },
    date: "May 05, 2026",
    urlDate: "2026-05-05",
    dateModified: "2026-05-05",
    readTime: "12 min read",
    author: {
        name: "Mohammad Rashid",
        url: "https://www.linkedin.com/in/mohammad-rashid7337/",
        github: "https://github.com/Mohammad-R-Rashid",
    },
    image: "https://rejourney.co/assets/engineering/swift-package-open-beta.png",
    schema: swiftPackageBetaArticleSchema,
    content: <SwiftPackageBetaArticleContent />,
};
