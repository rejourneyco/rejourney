import type { Article } from "../engineeringTypes";

const FLUTTER_SDK_BETA_ARTICLE_URL =
    "https://rejourney.co/engineering/2026-08-01/flutter-sdk-open-beta";

const flutterSdkBetaArticleSchema = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "Rejourney Flutter SDK Is Now in Open Beta",
    description:
        "Inside the Rejourney Flutter SDK: Android GPU capture, black-frame detection, retained-layer fallback, moving privacy masks, and bounded shutdown.",
    url: FLUTTER_SDK_BETA_ARTICLE_URL,
    keywords: [
        "Flutter session replay",
        "Flutter SDK",
        "Android PixelCopy",
        "Flutter GPU capture",
        "Flutter retained layer capture",
        "Flutter privacy masking",
        "mobile observability",
        "Rejourney Flutter SDK",
    ],
    author: {
        "@type": "Person",
        name: "Mohammad Rashid",
        url: "https://www.linkedin.com/in/mohammad-rashid7337/",
        github: "https://github.com/Mohammad-R-Rashid",
    },
    datePublished: "2026-08-01",
    dateModified: "2026-08-01",
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
        "@id": FLUTTER_SDK_BETA_ARTICLE_URL,
    },
};

const FlutterSdkBetaArticleContent = () => (
    <div className="space-y-6 text-lg font-medium leading-relaxed">
        <p>
            The <strong>Rejourney Flutter SDK</strong> is now in open beta on pub.dev. The current
            release is <code>0.3.1</code>. It supports Flutter 3.22+, Dart 3.3+, iOS 15.1+, and
            Android API 24+.
        </p>

        <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
            <pre className="text-xs sm:text-sm font-mono text-blue-900">{`flutter pub add rejourney

// Configure first. Recording starts only when start() is called.
await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();`}</pre>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    01 // THE BRIDGE
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Native Side Code & Dart For Translation 
                </h2>
            </div>
            <p>
                Rejourney already had native recorders for iOS and Android. Rewriting their
                lifecycle, upload, crash recovery, and capture logic in Dart would have created a
                third recorder with subtly different behavior. The Flutter package instead uses one
                method channel, <code>co.rejourney.flutter/methods</code>, as a narrow boundary
                around the native cores.
            </p>
            <p className="mt-4">
                Dart owns the parts that only Flutter can describe well: route changes, framework
                errors, widget bounds, and the retained render layer. Native code owns session
                state, remote recording policy, the capture timer, encoding, persistence, and
                upload. The boundary carries plain maps, lists, byte arrays, and scalar values.{" "}
                <code>Rejourney._channelValue</code> rejects anything the platform channel cannot
                carry before it reaches Kotlin or Swift.
            </p>
            <p className="mt-4">
                <code>init()</code> also does less than its name might suggest. It validates the
                project key and options, then configures both native sides. Capture waits for an
                explicit <code>start()</code>. That split gives an app a clean place to wait for
                consent. It also lets remote sampling and the recording kill switch run before a
                framebuffer read begins.
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    Platform boundary
                </div>
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`abstract class RejourneyPlatform extends PlatformInterface {
  Future<T?> invoke<T>(
    String method,
    [Map<String, Object?>? arguments],
  );

  Stream<Map<String, Object?>> get events;
}`}</pre>
            </div>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    02 // ANDROID GPU CAPTURE
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    PixelCopy & Flutter GPU Issues Solved
                </h2>
            </div>
            <p>
                A Flutter screen on Android is usually presented through a{" "}
                <code>FlutterSurfaceView</code>. Calling <code>draw()</code> on the surrounding
                Android view hierarchy gets the container, but not the GPU pixels on that surface.
                We use <code>PixelCopy</code> on the Flutter surface for the normal path.
            </p>
            <p className="mt-4">
                The first beta builds exposed a worse failure mode. On some renderer and device
                combinations, <code>PixelCopy</code> returned <code>SUCCESS</code> and handed us a
                correctly sized black bitmap. A toast could make the whole window look non-empty,
                leaving a replay with one small native overlay floating over a black Flutter app.
                Checking the result code was not enough.
            </p>
            <p className="mt-4">
                The recorder now samples a 24 by 24 grid and classifies the result. The detector
                checks near-black ratio, luma range, and how many pixels contain a meaningful
                signal. One branch requires at least 98.5% near-black samples with a maximum luma
                below 48. Another catches the sparse-overlay case. The classifier has no Android
                graphics dependency, so its edge cases run as ordinary JVM tests.
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    False-success classification
                </div>
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`val nearBlackRatio = nearBlack.toDouble() / visible.toDouble()
return (nearBlackRatio >= 0.985 && maximumLuma < 48) ||
    (nonBlack <= meaningfulSignalFloor && maximumLuma - minimumLuma < 12) ||
    (nearBlackRatio >= 0.975 && nonBlack <= sparseOverlayFloor)`}</pre>
            </div>
            <p>
                We also find Flutter by its typed <code>FlutterView</code> hierarchy. Matching a
                class-name string worked in debug builds and failed after Android minification
                changed the name. That was a small bug with a very convincing local test result.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    03 // RETAINED LAYERS
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Fallback Methods
                </h2>
            </div>
            <p>
                Once the native recorder recognizes a black Flutter surface, the method channel runs
                in the other direction. Android calls <code>_captureFlutterFrame</code>. Dart reads
                the root <code>OffsetLayer</code> from Flutter&apos;s <code>RenderView</code> and
                rasterizes that retained layer with <code>toImage()</code>.
            </p>
            <p className="mt-4">
                A request can arrive while Flutter is building a frame. During transient callbacks,
                mid-frame microtasks, or persistent callbacks, the capture waits for{" "}
                <code>endOfFrame</code>. It then calculates a pixel ratio for the native target
                dimensions, requests raw RGBA bytes, copies those bytes, and disposes the engine
                image. The copy matters because an engine may back <code>ByteData</code> with
                image-owned storage.
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    Retained Flutter scene readback
                </div>
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`final phase = SchedulerBinding.instance.schedulerPhase;
if (phase == SchedulerPhase.transientCallbacks ||
    phase == SchedulerPhase.midFrameMicrotasks ||
    phase == SchedulerPhase.persistentCallbacks) {
  await SchedulerBinding.instance.endOfFrame;
}

final layer = renderView.layer as OffsetLayer;
final image = await layer.toImage(bounds, pixelRatio: scale);
final bytes = await image.toByteData(format: ui.ImageByteFormat.rawRgba);`}</pre>
            </div>
            <p>
                Android turns the returned bytes into a bitmap, composites any native sheet roots,
                applies redaction, and sends JPEG work to its single-thread encode executor. The
                retained-layer request uses half the usual replay width and height. That cuts the
                readback to one quarter of the pixels on the devices already struggling with the
                normal path.
            </p>
            <p className="mt-4">
                Compatibility capture also runs less often. Its idle heartbeat is 15 seconds. A
                high-importance visual change can request a frame after a 5-second minimum interval,
                and navigation waits 2.5 seconds for the destination to settle. An in-flight guard
                drops overlapping ticks. A five-second timeout releases the guard if Dart never
                answers. The app&apos;s live <code>FlutterSurfaceView</code> stays in place
                throughout.
            </p>
            <p className="mt-4">
                The active source is visible through SDK metrics.{" "}
                <code>lastCaptureSource</code>, <code>flutterBlackFrameFallbackCount</code>, and
                retained-layer readback timings tell us whether a report came from the fast
                surface-copy path or the compatibility path. Without those counters, a replay can
                look fixed while a device quietly pays far more for every frame.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    04 // PRIVACY MASKS
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Masks Follow Time & Space
                </h2>
            </div>
            <p>
                <code>RejourneyMask</code> is a <code>RenderProxyBox</code>. It does not cover the
                widget in the live app. Before painting its child, it measures the child&apos;s
                global bounds and sends that rectangle to the native capture pipeline. Android
                converts Flutter logical pixels with the activity density; iOS can use the logical
                point coordinates directly.
            </p>
            <p className="mt-4">
                Reporting the latest rectangle sounds sufficient until the widget scrolls or an
                outgoing route animates away. Flutter&apos;s transform callbacks and the native pixel
                copy are asynchronous. A captured frame may contain the prior position after Dart
                has already reported the new one.
            </p>
            <p className="mt-4">
                While a masked widget is moving, the SDK sends the union of its previous and current
                rectangles. After movement settles, the mask shrinks to the current bounds. The
                first placement uses a shorter 750 ms safety window; later movement uses two
                seconds. When the render object detaches, its last rectangle stays registered for
                another two seconds because Flutter may still present cached pixels from the
                outgoing route.
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    Conservative movement mask
                </div>
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`final safeRect = _reportedRect?.expandToInclude(rect) ?? rect;
if (safeRect != _reportedRect) {
  _reportedRect = safeRect;
  _sendRegion(safeRect);
}

_settleTimer = Timer(safetyWindow, () {
  _reportedRect = rect;
  _sendRegion(rect);
});`}</pre>
            </div>
            <p>
                This choice occasionally leaves a stale white rectangle on the replay for a moment.
                We prefer that artifact to one frame of a card number or private message. Tests move
                a masked widget between paints and assert that the swept area remains covered.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    05 // NAVIGATION
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Route tracking waits for the screen it names
                </h2>
            </div>
            <p>
                <code>RejourneyNavigatorObserver</code> handles push, pop, replace, and remove. It
                resolves a name from an app callback, the route settings, or the route&apos;s runtime
                type, then drops consecutive duplicates. The screen event is recorded immediately.
            </p>
            <p className="mt-4">
                The matching visual marker is delayed until the next post-frame callback. Without
                that delay, a route event named <code>/checkout</code> can point at the final frame
                of <code>/cart</code>. On Android&apos;s retained-layer path, native code adds the
                settle delay and coalesces rapid requests. A navigation callback becomes a request
                for the first useful frame of the destination, not a command to read pixels at that
                exact instant.
            </p>
            <p className="mt-4">
                Flutter&apos;s Router ecosystem has more than one source of truth, so the observer is
                optional. Apps using a Router package can call <code>trackScreen()</code> from their
                own navigation callback and still get the same native session timeline.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    06 // ERRORS
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Error capture & Handlers
                </h2>
            </div>
            <p>
                Flutter framework failures arrive through <code>FlutterError.onError</code>.
                Uncaught root-isolate errors arrive through{" "}
                <code>PlatformDispatcher.instance.onError</code>. The SDK saves both existing
                handlers before installing its wrappers and calls them after recording the
                incident. Disposing the capture handle restores the originals.
            </p>
            <p className="mt-4">
                We do not put <code>runApp()</code> in a new zone during normal installation.
                Flutter expects binding initialization and <code>runApp()</code> to share a zone,
                and hiding a zone change inside an SDK is a good way to produce warnings in a host
                app. Teams that already use <code>runZonedGuarded</code> can keep doing so; the
                package exposes a guarded helper for explicit use.
            </p>
            <p className="mt-4">
                Every Dart incident gets a timestamped, cryptographically random ID before it
                crosses the channel. The ID survives both native bridges. Crash and ANR recovery
                paths use the same incident-ID scheme, so the backend can merge duplicate
                transports without guessing from stack text. Release-obfuscated Dart types add another
                wrinkle: names such as <code>_A</code> are not useful categories, so the SDK falls
                back to an <code>Error</code> or <code>Exception</code> name found in the message.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    07 // NETWORK AND STOP
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Measuring The Response to Caller 
                </h2>
            </div>
            <p>
                Dart networking does not pass through <code>URLSession</code> or OkHttp in a way a
                native interceptor can always see. <code>RejourneyHttpClient</code> wraps{" "}
                <code>package:http</code> instead. It records method, URL, status, content type,
                byte counts, and timing. Request and response bodies are never recorded.
            </p>
            <p className="mt-4">
                A streamed response is not finished when headers arrive. The wrapper counts chunks
                as the caller consumes them and emits its event on stream completion or error. That
                makes duration and response size describe the transfer the app experienced. The SDK
                host and configured ignore patterns are filtered before the event crosses the
                channel, which also prevents Rejourney from observing its own uploads.
            </p>
            <p className="mt-4">
                Shutdown has a separate bound. <code>stop()</code> gives the native recorder 10
                seconds by default to flush and finalize. If that deadline expires, Dart returns a
                successful local stop with <code>uploadSuccess: false</code> and the warning{" "}
                <code>native_flush_timeout</code>. The native call keeps running, and its persistence
                path can save pending work. An offline analytics SDK should not turn a sign-out or
                consent change into a frozen screen.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    08 // OPEN BETA
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    What we want to learn in beta
                </h2>
            </div>
            <p>
                The recorder and ingest format use the same native foundations as Rejourney&apos;s
                other mobile SDKs. The open-beta label is about the Flutter integration surface and
                the range of apps that sit on top of it. We are looking for signal in these areas:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
                <li>Renderer and device combinations outside our Android emulator and device matrix.</li>
                <li>Impeller, Flame, platform views, and custom rendering during animated transitions.</li>
                <li>Router packages whose navigation model does not map cleanly to a root <code>NavigatorObserver</code>.</li>
                <li>Add-to-app and multi-engine lifecycles where the active Android activity changes ownership.</li>
                <li>Mask timing around complex slivers, overlays, and nested navigators.</li>
            </ul>
            <p className="mt-6">
                A Flutter release is tagged only after Dart tests and benchmarks, Android native
                tests, emulator integration, an iOS simulator run, a standalone consumer build,
                and a <code>pub publish --dry-run</code> pass. CI checks the version in the pubspec,
                Dart API, Android package, CocoaPods spec, and both native runtime constants. The
                tag then publishes to pub.dev with a short-lived OIDC token.
            </p>
            <p className="mt-4">
                Install the beta with <code>flutter pub add rejourney</code>. The package includes a
                runnable example, capture metrics for the Android fallback path, and debug-only crash
                and ANR hooks for validating a project before release.
            </p>
        </div>
    </div>
);

export const flutterSdkOpenBetaArticle: Article = {
    collection: "engineering",
    id: "flutter-sdk-open-beta",
    title: "Rejourney Flutter SDK Is Now in Open Beta",
    subtitle:
        "How we built session replay to support Flutter GPU and Impeller on iOS and Android with performance in mind.",
    seoKeywords:
        "Rejourney Flutter SDK, Flutter session replay, Flutter observability SDK, Android PixelCopy black frame, Flutter GPU capture, Flutter retained layer capture, Flutter privacy masking",
    seo: {
        primaryKeyword: "Flutter session replay SDK",
        metaTitle: "Flutter Session Replay SDK: Rejourney Open Beta",
        metaDescription:
            "Inside Rejourney's Flutter SDK: Android GPU capture, black-frame recovery, retained layers, moving privacy masks, error correlation, and bounded shutdown.",
        targetKeywords: [
            "Flutter session replay SDK",
            "Rejourney Flutter SDK",
            "Flutter mobile observability",
            "Android PixelCopy black frame",
            "Flutter GPU capture",
            "Flutter retained layer capture",
            "Flutter privacy masking",
        ],
        topicTags: ["Flutter", "Dart", "Android", "iOS SDK", "Session Replay"],
    },
    date: "August 01, 2026",
    urlDate: "2026-08-01",
    dateModified: "2026-08-01",
    readTime: "12 min read",
    author: {
        name: "Mohammad Rashid",
        url: "https://www.linkedin.com/in/mohammad-rashid7337/",
        github: "https://github.com/Mohammad-R-Rashid",
    },
    image:
        "https://raw.githubusercontent.com/rejourneyco/rejourney/main/packages/rejourney/screenshots/flutter-session-replay-example.png",
    imageAlt: "Rejourney Replay Workbench showing a captured Flutter session with synchronized evidence",
    schema: flutterSdkBetaArticleSchema,
    content: <FlutterSdkBetaArticleContent />,
};
