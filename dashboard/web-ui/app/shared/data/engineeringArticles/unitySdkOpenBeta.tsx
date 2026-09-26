import type { Article } from "../engineeringTypes";

const UNITY_SDK_BETA_ARTICLE_URL =
    "https://rejourney.co/engineering/2026-09-26/unity-sdk-open-beta";

const unitySdkBetaArticleSchema = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "Rejourney Unity SDK Is Now in Open Beta",
    description:
        "Inside Rejourney for Unity: GPU viewport readback, privacy shaders, gameplay markers that quiet rage taps, Mono.Cecil bytecode weaving, and native crash recovery.",
    url: UNITY_SDK_BETA_ARTICLE_URL,
    keywords: [
        "Unity session replay",
        "Unity mobile observability",
        "Unity SDK",
        "Unity GPU readback",
        "Unity gameplay markers",
        "Mono.Cecil bytecode weaving",
        "game-loop hang detection",
        "Unity crash recovery",
        "Rejourney Unity SDK",
    ],
    author: {
        "@type": "Person",
        name: "Mohammad Rashid",
        url: "https://www.linkedin.com/in/mohammad-rashid7337/",
        github: "https://github.com/Mohammad-R-Rashid",
    },
    datePublished: "2026-09-26",
    dateModified: "2026-09-26",
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
        "@id": UNITY_SDK_BETA_ARTICLE_URL,
    },
};

const UnitySdkBetaArticleContent = () => (
    <div className="space-y-6 text-lg font-medium leading-relaxed">
        <p>
            The <strong>Rejourney Unity SDK</strong> is now in open beta. The initial release is{" "}
            <code>0.1.0</code>, packaged for the Unity Package Manager (UPM). It targets Unity 6 LTS
            (including 6.3 and 6.6), iOS 15.1+, and Android API 24+ running IL2CPP and Mono scripting
            backends.
        </p>

        <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
            <pre className="text-xs sm:text-sm font-mono text-blue-900">{`// Packages/manifest.json
"co.rejourney.unity": "https://github.com/rejourneyco/rejourney.git?path=/packages/unity#unity-v0.1.0"

// App bootstrap (e.g. in your initial scene controller)
using RejourneySDK;

Rejourney.Init("pk_live_your_public_key");
var result = await Rejourney.StartAsync();`}</pre>
        </div>

        <p>
            Most mobile session replay tools treat games like web applications: they either record
            nothing because a game renders into a single native surface, or they drop frame rates into
            single digits while generating thousands of false-positive &ldquo;rage clicks&rdquo; when
            a player attacks or navigates a fast inventory screen.
        </p>
        <p>
            Building session replay and observability for games required rethinking visual capture,
            eliminating garbage collection on the Unity main thread, weaving HTTP calls at compilation
            time, and separating genuine UI frustration from active gameplay. Here is how the recorder
            works under the hood.
        </p>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    01 // THE RUNTIME BRIDGE
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Zero-Allocation Main Thread Architecture
                </h2>
            </div>
            <p>
                Mobile games live or die by frame stability. In garbage-collected runtimes like Mono and
                IL2CPP, allocating temporary objects during the game loop triggers stop-the-world GC
                sweeps that manifest as micro-stutters and dropped frames. An observability SDK cannot
                be the reason a game stutters.
            </p>
            <p className="mt-4">
                The Rejourney Unity SDK divides responsibility strictly between managed C# and native
                platform controllers (Swift on iOS, Kotlin on Android):
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
                <li>
                    <strong>Managed C# (<code>RejourneySDK.Rejourney</code> &amp; <code>RejourneyBehaviour</code>)</strong>:
                    Owns viewport composition, redaction geometry, touch and input observation, scene
                    transitions, managed error logging, bytecode instrumentation, and game-loop heartbeats.
                </li>
                <li>
                    <strong>Native Controllers (iOS &amp; Android)</strong>: Own session state machines,
                    cryptographic visitor keys, remote settings fetch, durable 32MB disk spooling, network
                    retries, and async-signal-safe crash recovery.
                </li>
            </ul>
            <p className="mt-4">
                To guarantee zero GC overhead on the engine thread:
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    Managed event serialization pipeline
                </div>
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`// Uses ThreadStatic writers to avoid allocation per event dispatch
[ThreadStatic] static JsonTextWriter sharedWriter;
[ThreadStatic] static StringBuilder sharedBuffer;

internal void CustomEvent(string name, IDictionary<string, object> properties)
{
    if (!Admit(null)) return;
    try {
        string payload = properties == null ? "null" : SdkJson.Serialize(properties);
        var writer = BeginEvent();
        writer.WritePropertyName("name"); writer.WriteValue(name);
        writer.WritePropertyName("payload"); writer.WriteValue(payload);
        Commit(EndEvent(writer, "custom", Timestamp, SessionId));
    } catch { Reject(); }
}`}</pre>
            </div>
            <p>
                All telemetry events serialize using thread-static <code>StringBuilder</code> buffers
                and push into lock-free <code>ConcurrentQueue&lt;string&gt;</code> queues. Native P/Invoke
                dispatches batch raw JSON strings directly into native memory, never holding locks that
                could stall the engine update loop.
            </p>
            <p className="mt-4">
                The SDK even tracks its own CPU footprint: <code>Rejourney.Health.MainThreadMilliseconds</code>{" "}
                continually measures cumulative SDK execution time on the Unity main thread so developers
                can verify performance impact with hard numbers.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    02 // GPU VIEWPORT CAPTURE
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    AsyncGPUReadback &amp; GPU Privacy Shaders
                </h2>
            </div>
            <p>
                Unlike standard mobile apps whose interfaces consist of view trees (UIKit or Android
                Views), Unity renders the entire game into a single framebuffer surface. Traditional
                view-tree capture sees nothing except a black box.
            </p>
            <p className="mt-4">
                Rejourney uses a dual-stage GPU pipeline:
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`// 1. Capture into GPU RenderTexture
ScreenCapture.CaptureScreenshotIntoRenderTexture(renderTexture);

// 2. Apply privacy redaction shader on GPU before pixels leave VRAM
Graphics.Blit(renderTexture, redactedTexture, redactionMaterial);

// 3. Asynchronous readback from VRAM to system memory
AsyncGPUReadback.Request(redactedTexture, 0, TextureFormat.RGB24, OnReadbackComplete);`}</pre>
            </div>
            <p>
                <strong>Asynchronous Readback:</strong> Reading pixels synchronously from the GPU with{" "}
                <code>Texture2D.ReadPixels()</code> forces a CPU pipeline stall waiting for the GPU to
                complete all rendering commands. Rejourney uses Unity&rsquo;s <code>AsyncGPUReadback</code>,
                which copies the rendered frame into system memory asynchronously across multiple frames
                without interrupting draw call throughput. If asynchronous readback is unavailable on an
                older GPU, a synchronous fallback scales down to a maximum 480px dimension to prevent
                frame drops.
            </p>
            <p className="mt-4">
                <strong>GPU Redaction Shaders:</strong> Privacy cannot wait until frames reach disk or
                cloud servers. Sensitive UI elements (such as uGUI <code>InputField</code>, TextMeshPro{" "}
                <code>TMP_InputField</code>, or UI Toolkit <code>TextField</code>) have their screen-space
                bounding boxes calculated before readback. A custom replacement shader (<code>RejourneyRedact.shader</code>)
                burns solid privacy placeholders over those exact coordinates directly in GPU texture
                memory. Text or credentials never exist in pixel data outside the GPU.
            </p>
            <p className="mt-4">
                For in-world objects or custom UI elements, developers simply attach the{" "}
                <code>RejourneyMask</code> component or call <code>Rejourney.Mask(gameObject)</code>.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    03 // GAMEPLAY MARKERS
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Quieting the Rage Tap Problem
                </h2>
            </div>
            <p>
                In SaaS web applications, repeated rapid tapping on a button indicates frustration: a
                broken checkout form, a dead link, or an unresponsive server. Product analytics tools
                rely on rage tap detectors to surface broken experiences.
            </p>
            <p className="mt-4">
                In gaming, rapid tapping is normal behavior. A player rapidly mashing the attack button
                during a boss fight or tapping rhythmically in a platformer would generate hundreds of
                false rage tap alerts, skewing frustration metrics and making issue feeds useless.
            </p>
            <p className="mt-4">
                Rejourney introduces first-class <strong>Gameplay Markers</strong>:
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`// When a round, level, match, or battle begins:
Rejourney.StartGameplay("arena_boss_3", new Dictionary<string, object> {
    ["difficulty"] = "nightmare",
    ["player_gear_score"] = 450
});

// When play concludes:
Rejourney.EndGameplay(GameplayOutcome.Completed, new Dictionary<string, object> {
    ["score"] = 14200,
    ["revives_used"] = 1
});

// Or using an automatic scope:
using (Rejourney.Gameplay("bonus_stage")) {
    // Play loop...
}`}</pre>
            </div>
            <p>
                <strong>The Atomic Segment Engine:</strong> Gameplay state lives in <code>GameplayTracker</code>.
                State is swapped atomically so that every touch and interaction recorded by the SDK
                checks active gameplay status with <em>zero locks and zero allocations</em>.
            </p>
            <p className="mt-4">
                When gameplay is active:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
                <li>
                    Touches are tagged with the active <code>gameplayId</code> and excluded from rage tap,
                    dead tap, and UI friction calculations.
                </li>
                <li>
                    Heatmaps separate gameplay taps from menu navigation, ensuring combat action does not
                    pollute UI heatmaps.
                </li>
                <li>
                    The session replay timeline displays a distinct amber gameplay lane, allowing QA and
                    designers to jump directly between menu screens and combat intervals.
                </li>
                <li>
                    Gameplay segments outlive session boundaries: if a game background rollover occurs
                    after 60 seconds of inactivity, the active segment seamlessly resumes in the new session.
                </li>
            </ul>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    04 // PERFORMANCE &amp; ENGINE STALLS
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Frame Pacing &amp; Game-Loop Hang Detection
                </h2>
            </div>
            <p>
                Games require real device performance monitoring far beyond basic crash reporting. The
                Unity SDK automatically collects engine health metrics without requiring custom developer
                code:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
                <li>
                    <strong>Frame Pacing:</strong> Samples frame rates every 5 seconds, calculating p50,
                    p95, and maximum frame times, alongside counting &ldquo;long frames&rdquo; (frames
                    taking 50ms or longer, corresponding to dips below 20 FPS).
                </li>
                <li>
                    <strong>Memory &amp; Garbage Collection:</strong> Tracks managed heap size, Unity native
                    allocated memory, and the count of GC collections occurring between samples, lining
                    up memory spikes directly with replay footage.
                </li>
                <li>
                    <strong>Scene Load Times:</strong> Wrapping scene transitions with{" "}
                    <code>using (Rejourney.BeginSceneLoad(&quot;Dungeon&quot;))</code> records the exact
                    monotonic duration of the load screen until completion.
                </li>
                <li>
                    <strong>Engine Context:</strong> Every session logs Unity engine version, scripting
                    backend (IL2CPP vs Mono), graphics API (Metal, Vulkan, OpenGLES), render pipeline
                    (URP, HDRP, Built-in), and the build GUID.
                </li>
            </ul>
            <p className="mt-4">
                <strong>Detecting Game-Loop Hangs:</strong> Traditional Android ANR detectors only track
                the Android UI main thread. If Unity&rsquo;s internal rendering loop freezes on a heavy
                asset load, shader compilation, or infinite script loop, the OS main thread may remain
                responsive while the game viewport is completely frozen.
            </p>
            <p className="mt-4">
                Rejourney includes a dedicated game-loop watchdog. If the Unity frame update cycle stalls
                for longer than <code>HangThresholdSeconds</code> (default 5s, configurable down to 2s),
                the SDK records an engine hang incident the moment the loop recovers, capturing the stall
                duration, the screen it froze on, and the preceding frame times.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    05 // COMPILATION WEAVING
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Mono.Cecil Bytecode Rewriting &amp; Linker Rules
                </h2>
            </div>
            <p>
                Capturing network requests in Unity is notoriously tricky. Developers make HTTP calls
                using <code>UnityWebRequest</code>, .NET <code>HttpClient</code>, coroutines, or modern{" "}
                <code>async</code>/<code>await</code> tasks. Wrapping network calls manually with SDK
                methods is tedious and prone to omission.
            </p>
            <p className="mt-4">
                Rejourney uses <strong>Mono.Cecil</strong> in an Editor post-processor (<code>NetworkPostProcessor.cs</code>)
                to rewrite IL bytecode during player compilation:
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    Compilation-time weaving (NetworkPostProcessor)
                </div>
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`// Rewrites calls to UnityWebRequest.SendWebRequest() into:
RejourneySDK.NetworkCapture.WrapSendWebRequest(request)

// Rewrites HttpClient constructors into:
RejourneySDK.NetworkCapture.CreateInstrumentedHttpClient()`}</pre>
            </div>
            <p>
                Because weaving happens on the compiled managed assemblies:
            </p>
            <ul className="list-disc pl-6 space-y-2 mt-4">
                <li>No source code changes are required in gameplay scripts.</li>
                <li>Async state machines, lambda closures, and coroutines are woven cleanly.</li>
                <li>The original handlers, TLS configurations, and custom certificates are fully preserved.</li>
                <li>
                    Request bodies and credentials are automatically omitted; URL query values and secrets
                    are stripped before network timing records leave the player.
                </li>
            </ul>
            <p className="mt-4">
                <strong>IL2CPP Linker Stripping:</strong> Unity&rsquo;s IL2CPP linker strips unreferenced
                code aggressively in release builds. Because Unity packages cannot register standalone{" "}
                <code>link.xml</code> files directly, <code>RejourneyLinkerProcessor</code> hooks into{" "}
                <code>UnityLinker</code> to ensure internal serialization adapters and optional uGUI/Input
                System bindings remain linked at every stripping level.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    06 // GETTING STARTED
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Try the Unity SDK Beta
                </h2>
            </div>
            <p>
                The open beta is available now. To install the package in your Unity project, add the Git
                URL to your <code>Packages/manifest.json</code>:
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`"co.rejourney.unity": "https://github.com/rejourneyco/rejourney.git?path=/packages/unity#unity-v0.1.0"`}</pre>
            </div>
            <p>
                Or download the standalone <code>co.rejourney.unity-0.1.0.tgz</code> tarball from the{" "}
                <a
                    href="https://github.com/rejourneyco/rejourney/releases/tag/unity-v0.1.0"
                    className="text-blue-700 underline font-semibold hover:text-blue-900"
                    target="_blank"
                    rel="noreferrer"
                >
                    GitHub Release
                </a>{" "}
                and install it via **Window &rarr; Package Manager &rarr; + &rarr; Install package from tarball**.
            </p>
            <p className="mt-4">
                Explore the full documentation in our{" "}
                <a
                    href="/docs/unity/overview"
                    className="text-blue-700 underline font-semibold hover:text-blue-900"
                >
                    Unity SDK Documentation
                </a>
                , review the runnable sample project in <code>examples/unity</code>, or copy the AI
                integration prompt directly into Cursor or Claude to instrument your game in minutes.
            </p>
        </div>
    </div>
);

export const unitySdkOpenBetaArticle: Article = {
    collection: "engineering",
    id: "unity-sdk-open-beta",
    title: "Rejourney Unity SDK Is Now in Open Beta",
    subtitle:
        "Inside Rejourney for Unity: GPU viewport readback, privacy shaders, gameplay markers that quiet rage taps, Mono.Cecil bytecode weaving, and crash recovery.",
    seoKeywords:
        "Unity session replay, Unity mobile observability, Unity SDK, Unity GPU readback, Unity gameplay markers, Mono.Cecil bytecode weaving, game-loop hang detection, Unity crash recovery, Rejourney Unity SDK",
    seo: {
        primaryKeyword: "Unity session replay SDK",
        metaTitle: "Unity Session Replay SDK: Rejourney Open Beta",
        metaDescription:
            "Inside Rejourney's Unity SDK: GPU viewport capture, privacy shaders, gameplay markers that quiet rage taps, Mono.Cecil bytecode weaving, frame pacing, and native crash recovery.",
        targetKeywords: [
            "Unity session replay SDK",
            "Rejourney Unity SDK",
            "Unity mobile observability",
            "Unity GPU readback",
            "Unity gameplay markers",
            "Mono.Cecil bytecode weaving",
            "Unity crash reporting",
        ],
        topicTags: ["Unity", "C#", "Mobile Games", "iOS SDK", "Android SDK", "Session Replay"],
    },
    date: "September 26, 2026",
    urlDate: "2026-09-26",
    dateModified: "2026-09-26",
    readTime: "14 min read",
    author: {
        name: "Mohammad Rashid",
        url: "https://www.linkedin.com/in/mohammad-rashid7337/",
        github: "https://github.com/Mohammad-R-Rashid",
    },
    image: "/images/readme/session-replay-workbench.png",
    imageAlt: "Rejourney Replay Workbench showing session replay with synchronized timeline and evidence",
    schema: unitySdkBetaArticleSchema,
    content: <UnitySdkBetaArticleContent />,
};
