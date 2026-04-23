import { Cpu, Zap, Map } from "lucide-react";
import type { ReactNode } from "react";

export interface Article {
    id: string;
    title: string;
    subtitle: string;
    /** Comma-separated phrases for meta keywords — helps match long-tail searches to article topics */
    seoKeywords?: string;
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

// --- Content: Scaling Rejourney Architecture ---

const SCALING_ARTICLE_URL = "https://rejourney.co/engineering/2026-04-23/rejourney-1-3-million-session-replays";

const scalingArticleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Rejourney Hits 1.3 Million Session Replays in 3 Months",
    description:
        "Lessons in edge security, durable pipelines, and scaling during a 10x traffic spike.",
    url: SCALING_ARTICLE_URL,
    keywords: [
        "session replay scaling",
        "Cloudflare DDoS",
        "K3s ingestion",
        "durable pipeline",
        "Postgres queue",
        "high availability",
        "Redis failover",
        "multi-bucket storage",
    ],
    author: {
        "@type": "Person",
        name: "Fowwaz Moeen",
        url: "https://www.linkedin.com/in/fowwaz-moeen/",
        github: "https://github.com/FowwazM",
    },
    datePublished: "2026-04-23",
    dateModified: "2026-04-23",
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
        "@id": SCALING_ARTICLE_URL,
    },
};

const ScalingArticleContent = () => (
    <div className="space-y-6 text-lg font-medium leading-relaxed">
        <p>
            Quick growth for any startup is hard. However, the difficulty is far greater when your startup handles hundreds to thousands of small files ingested every minute. Every startup dreams of that "hockey stick" moment, but as we recently learned at Rejourney, the infrastructure that supports 10,000 sessions a day doesn't always handle 100,000 with the same grace.
        </p>
        <p>
            Last month, we officially onboarded new customers with expansive user bases across several high-traffic mobile apps. It was a milestone for our team, but it also quickly became an "all-hands-on-deck" engineering challenge.
        </p>

        <div className="my-10 border-2 border-black bg-white overflow-hidden">
            <div className="bg-black text-white px-5 py-3 font-mono text-[11px] font-black uppercase tracking-widest">
                Traffic Spike Snapshot
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3">
                <div className="border-t-2 sm:border-t-0 sm:border-r-2 border-black p-5 bg-slate-50">
                    <div className="font-mono text-[10px] font-black uppercase text-gray-500 mb-2">Replay volume</div>
                    <div className="text-3xl font-black leading-none">1.3M</div>
                    <div className="text-xs uppercase font-bold text-gray-500 mt-2">in roughly 3 months</div>
                </div>
                <div className="border-t-2 sm:border-t-0 sm:border-r-2 border-black p-5 bg-white">
                    <div className="font-mono text-[10px] font-black uppercase text-gray-500 mb-2">Ingress jump</div>
                    <div className="text-3xl font-black leading-none">10x</div>
                    <div className="text-xs uppercase font-bold text-gray-500 mt-2">minutes after go-live</div>
                </div>
                <div className="border-t-2 sm:border-t-0 border-black p-5 bg-slate-50">
                    <div className="font-mono text-[10px] font-black uppercase text-gray-500 mb-2">Total downtime</div>
                    <div className="text-3xl font-black leading-none">&lt; 5m</div>
                    <div className="text-xs uppercase font-bold text-gray-500 mt-2">during migration and fixes</div>
                </div>
            </div>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    THE INCIDENT
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    The "Accidental" DDoS
                </h2>
            </div>
            <p>
                The trouble started almost immediately after they loaded Rejourney live on their apps. Within minutes, our ingestion metrics spiked by an order of magnitude.
            </p>
            <p className="mt-4">
                At the edge, Cloudflare’s automated security systems saw this sudden, massive influx of traffic to our API and did exactly what they were programmed to do: they flagged it as a Distributed Denial of Service (DDoS) attack. Legitimate session data from thousands of users was being dropped before it even reached our infrastructure.
            </p>
            <p className="mt-4">
                Our immediate fix was to implement a bypass filter for our specific API endpoint. We wanted to ensure no data was lost and that the onboarding experience was seamless. We flipped the switch, the "Attack Mode" subsided, and the floodgates opened.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    THE CASCADE
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    The Thundering Herd
                </h2>
            </div>
            <p>
                Opening the floodgates is only a good idea if your reservoir can handle the volume. By bypassing the edge protection, we redirected the full, unthrottled weight of the traffic directly to our origin server.
            </p>
            <p className="mt-4">
                At the time, our backend was running on a single-node K3s cluster. While we’ve optimized our ingestion pipeline to be lean, no single node is immune to a "thundering herd." As thousands of concurrent connections hit our API, our Ingest Pods were pinned at Max CPU, and the server eventually became unresponsive.
            </p>
            <p className="mt-4">
                We realized that scaling "up" (getting a bigger VPS) was no longer enough. We needed to scale "out."
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    THE PIPELINE
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Decomposing the Ingestion Pipeline
                </h2>
            </div>

            <figure className="mb-8 border-2 border-black bg-slate-50 overflow-hidden">
                <img
                    src="/images/engineering/session-lifecycle.svg"
                    alt="Session lifecycle architecture from SDK start through upload lanes, workers, and reconciliation"
                    className="w-full h-auto object-cover"
                    loading="lazy"
                />
                <figcaption className="px-4 py-3 text-xs sm:text-sm font-mono font-bold uppercase tracking-wide text-gray-600 bg-white border-t-2 border-black">
                    Session lifecycle overview: upload lanes, durable queue boundary, workers, and reconciliation.
                </figcaption>
            </figure>

            <p>
                The biggest bottleneck in our old setup was the "monolithic" nature of ingestion. If a pod restarted, in-memory tasks were lost. We’ve now decomposed the pipeline into five specialized, durable stages:
            </p>

            <ol className="list-decimal pl-6 space-y-4 mt-4 ml-4">
                <li>
                    <strong>The Control Plane (API):</strong> Our API pods now focus exclusively on the "handshake." When the SDK calls our endpoints, we immediately create durable rows in Postgres (via PgBouncer) to track the session and ingest jobs.
                </li>
                <li>
                    <strong>The Upload Relay:</strong> We isolated heavy client upload traffic into its own <code>ingest-upload</code> layer. These pods act as a relay to Hetzner S3, ensuring that a flood of incoming bytes doesn't starve our core API of resources.
                </li>
                <li>
                    <strong>The Durable Queue Boundary:</strong> We moved away from in-memory task management. Work is now represented as durable rows in Postgres. If a worker pod crashes or restarts, the job still exists in the database, waiting to be claimed.
                </li>
                <li>
                    <strong>Specialized Worker Deployments:</strong> We split our processing power. <code>ingest-workers</code> handle lightweight metadata like events and crashes, while <code>replay-workers</code> tackle the heavy lifting of screenshots and hierarchies.
                </li>
                <li>
                    <strong>Self-Healing Reconciliation:</strong> A dedicated <code>session-lifecycle-worker</code> performs periodic sweeps to recover stuck states or abandon expired artifacts.
                </li>
            </ol>
            <p className="mt-4">
                By using Postgres as the source of truth for state and S3 for storage, our system is now remarkably resilient. Even if Redis or individual pods face transient issues, the state survives and processing resumes exactly where it left off.
            </p>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    THE HA LAYER
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    High-Availability Postgres and Redis
                </h2>
            </div>
            <p>
                We’ve moved away from the single-node bottleneck to a High Availability configuration. We now run HA Postgres and Redis with automated failover. If a VPS goes down, the databases automatically fall back to a replica. The platform keeps moving, and the data stays safe.
            </p>

            <figure className="mt-8 border-2 border-black bg-slate-50 overflow-hidden">
                <img
                    src="/images/engineering/k3s-cloud-setup.svg"
                    alt="K3s cloud setup showing ingress, API, workers, and data services"
                    className="w-full h-auto object-cover"
                    loading="lazy"
                />
                <figcaption className="px-4 py-3 text-xs sm:text-sm font-mono font-bold uppercase tracking-wide text-gray-600 bg-white border-t-2 border-black">
                    K3s cloud setup: ingress, app services, workers, and HA data plane.
                </figcaption>
            </figure>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                <div className="border-2 border-black bg-rose-50 p-5">
                    <div className="font-mono text-[10px] font-black uppercase tracking-widest text-gray-600 mb-3">
                        Before
                    </div>
                    <ul className="list-disc pl-5 space-y-2 text-base">
                        <li>Single-node Postgres and Redis tied to one VPS.</li>
                        <li>Infrastructure maintenance had direct outage risk.</li>
                        <li>No automated failover path during node loss.</li>
                    </ul>
                </div>
                <div className="border-2 border-black bg-emerald-50 p-5">
                    <div className="font-mono text-[10px] font-black uppercase tracking-widest text-gray-600 mb-3">
                        After
                    </div>
                    <ul className="list-disc pl-5 space-y-2 text-base">
                        <li>HA Postgres and Redis replicated across nodes.</li>
                        <li>Automated failover promotes healthy replicas quickly.</li>
                        <li>Platform continuity during host-level interruptions.</li>
                    </ul>
                </div>
            </div>
        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    THE STORAGE STRATEGY
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Navigating the 50 Million Object Limit
                </h2>
            </div>
            <p>
                As we scaled, we hit a literal physical limit: providers like Hetzner often impose a 50-million-object limit per bucket. To bypass this, we implemented a dynamic <strong>multi-bucket topology</strong>.
            </p>
            <p className="mt-4">
                Instead of hard-coding storage locations in environment variables, we moved the source of truth to a <code>storage_endpoints</code> table in Postgres. This allows us to manage storage with extreme granularity:
            </p>

            <figure className="mt-8 border-2 border-black bg-slate-50 overflow-hidden">
                <img
                    src="/images/engineering/multi-bucket-topology.svg"
                    alt="Multi-bucket topology with endpoint resolution, artifact pinning, and shadow replication"
                    className="w-full h-auto object-cover"
                    loading="lazy"
                />
                <figcaption className="px-4 py-3 text-xs sm:text-sm font-mono font-bold uppercase tracking-wide text-gray-600 bg-white border-t-2 border-black">
                    Multi-bucket topology: endpoint routing, artifact pinning, and shadow durability.
                </figcaption>
            </figure>
            <ul className="list-disc pl-6 space-y-4 mt-4 ml-4">
                <li>
                    <strong>Weighted Traffic Splitting:</strong> We can resolve active buckets and perform weighted random selection to balance load across providers.
                </li>
                <li>
                    <strong>Artifact Pinning:</strong> To avoid "File Not Found" errors during migrations, we store the specific <code>endpoint_id</code> on every artifact. This "pins" future reads to the correct bucket, even as global defaults change.
                </li>
                <li>
                    <strong>Shadow Copies for Durability:</strong> We implemented a "Shadow" role. Once a primary write succeeds, we fan out asynchronous writes to shadow targets for extra redundancy.
                </li>
            </ul>

        </div>

        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    THE OUTCOME
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Efficiency at Scale
                </h2>
            </div>
            <p>
                Despite the intensity of the traffic spike, we managed to implement these changes with <strong>less than five minutes of total downtime</strong>.
            </p>
            <p className="mt-4">
                This incident reinforced why we focus so much on performance. Our lightweight SDK ensures we aren't taxing the user’s device, while our new HA infrastructure ensures we can handle whatever volume the next "hockey stick" growth moment throws at us.
            </p>
            <p className="mt-4">
                We’re now back to 100% stability, with a much larger "reservoir" ready for the next wave of growth. If you’ve been looking for a session replay tool that respects your app’s performance as much as you do, we’re more ready for you than ever.
            </p>

            <div className="mt-8 border-2 border-black overflow-hidden">
                <div className="bg-black text-white px-5 py-3 font-mono text-[11px] font-black uppercase tracking-widest">
                    Rollout Timeline
                </div>
                <div className="p-5 bg-white">
                    <ol className="list-decimal pl-5 space-y-3 text-base">
                        <li>Detected false-positive edge protection and restored trusted API traffic.</li>
                        <li>Isolated upload traffic and shifted orchestration state to durable Postgres rows.</li>
                        <li>Split workers by workload, then added reconciliation for crash-safe recovery.</li>
                        <li>Enabled HA Postgres + Redis and finalized multi-bucket endpoint routing.</li>
                    </ol>
                </div>
            </div>
        </div>
    </div>
);

// --- Content: Map Performance (New) ---

const MAP_ARTICLE_URL = "https://rejourney.co/engineering/2026-02-17/maps-performance";

const mapArticleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Rejourney Session Replay: High-Performance Maps on iOS & Android",
    description:
        "How we solved 120Hz micro-stutter in map captures by hooking native SDK delegates for Mapbox, Apple Maps, and Google Maps.",
    url: MAP_ARTICLE_URL,
    keywords: [
        "React Native session replay",
        "Mapbox capture",
        "Apple Maps",
        "Google Maps",
        "120Hz ProMotion",
        "iOS Android maps",
        "delegate swizzling",
        "mobile observability",
    ],
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
        "@id": MAP_ARTICLE_URL,
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
            We discovered that simply scheduling captures on a timer wasn't enough.
            To achieve buttery-smooth 120Hz performance while recording, we had to get deeper:
            <strong> Hooking the native map SDK rendering delegates. In simiple terms, Rejourney only captures screenshots on maps when it is idle and not being panned or zoomed.</strong>
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

const TECH_ARTICLE_URL = "https://rejourney.co/engineering/2026-02-06/architecture-deep-dive";

const techArticleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Engineering - Rejourney Architecture",
    description:
        "How Rejourney delivers high-fidelity session replay without UI stutter. Learn about our async capture pipeline, run loop gating, and zero-trust privacy redaction.",
    url: TECH_ARTICLE_URL,
    keywords: [
        "React Native session replay",
        "pixel-perfect replay",
        "mobile observability",
        "Sentry alternative",
        "async capture",
        "GPU framebuffer",
        "PostHog LogRocket comparison",
        "privacy redaction",
    ],
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
        "@id": TECH_ARTICLE_URL,
    },
};

const TECH_METRICS = [
    { name: "Main: UIKit + Metal Capture", avg: "12.4", max: "28.2", min: "8.1", thread: "Main" },
    { name: "BG: Async Image Processing", avg: "42.5", max: "88.0", min: "32.4", thread: "Background" },
    { name: "BG: Tar+Gzip Compression", avg: "14.2", max: "32.5", min: "9.6", thread: "Background" },
    { name: "BG: Upload Handshake", avg: "0.8", max: "2.4", min: "0.3", thread: "Background" },
    { name: "Total Main Thread Impact", avg: "12.4", max: "28.2", min: "8.1", thread: "Main" },
];

const RN_PKG = "packages/react-native/";

type SdkPipelineStage = {
    title: string;
    summary: string;
    iosPaths: string[];
    androidPaths: string[];
};

const SDK_PIPELINE_STAGES: SdkPipelineStage[] = [
    {
        title: "Orchestration",
        summary: "Owns session lifecycle, remote configuration, and keeps capture, hierarchy, and upload in sync.",
        iosPaths: ["ios/Recording/ReplayOrchestrator.swift"],
        androidPaths: ["android/src/main/java/com/rejourney/recording/ReplayOrchestrator.kt"],
    },
    {
        title: "Visual capture",
        summary: "Framebuffer capture, background JPEG work, batching, and on-device redaction before bytes leave the app.",
        iosPaths: ["ios/Recording/VisualCapture.swift"],
        androidPaths: ["android/src/main/java/com/rejourney/recording/VisualCapture.kt"],
    },
    {
        title: "Structure & interactions",
        summary: "View tree snapshots and gesture / interaction metadata that align with the frame timeline.",
        iosPaths: ["ios/Recording/ViewHierarchyScanner.swift", "ios/Recording/InteractionRecorder.swift"],
        androidPaths: [
            "android/src/main/java/com/rejourney/recording/ViewHierarchyScanner.kt",
            "android/src/main/java/com/rejourney/recording/InteractionRecorder.kt",
        ],
    },
    {
        title: "Upload",
        summary: "Compressed segment packaging, HTTP/2-friendly uploads, and backoff / retry.",
        iosPaths: ["ios/Recording/SegmentDispatcher.swift"],
        androidPaths: ["android/src/main/java/com/rejourney/recording/SegmentDispatcher.kt"],
    },
    {
        title: "Health & telemetry",
        summary: "Main-thread watchdogs, stability signals, and the telemetry path that rides alongside replay.",
        iosPaths: ["ios/Recording/AnrSentinel.swift", "ios/Recording/StabilityMonitor.swift", "ios/Recording/TelemetryPipeline.swift"],
        androidPaths: [
            "android/src/main/java/com/rejourney/recording/AnrSentinel.kt",
            "android/src/main/java/com/rejourney/recording/StabilityMonitor.kt",
            "android/src/main/java/com/rejourney/recording/TelemetryPipeline.kt",
        ],
    },
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

        {/* Section 04 */}
        <div className="mb-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    04 //
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

        {/* Section 05 */}
        <div className="mb-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    05 //
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

        {/* Section 06 */}
        <div className="mb-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    06 //
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Rewrite from Obj-C to Swift
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

        {/* Section 07 — matches article: light surface, black rules, mono labels */}
        <div className="mb-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    07 //
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    SDK pipeline
                </h2>
            </div>
            <p className="mt-4">
                The same pipeline runs on both platforms: orchestration, capture, structure, upload, then health
                signals. Paths below are relative to{" "}
                <code className="font-mono text-sm font-bold bg-slate-100 px-1.5 py-0.5 border border-black">
                    {RN_PKG}
                </code>
                .
            </p>

            <div className="border-2 border-black bg-white overflow-hidden mt-8">
                <div className="grid grid-cols-1 md:grid-cols-2 divide-y-2 md:divide-y-0 md:divide-x-2 divide-black bg-black text-white">
                    <div className="font-mono text-[10px] font-black uppercase tracking-widest py-3 px-4 sm:px-5">
                        iOS · Swift
                    </div>
                    <div className="font-mono text-[10px] font-black uppercase tracking-widest py-3 px-4 sm:px-5">
                        Android · Kotlin
                    </div>
                </div>

                {SDK_PIPELINE_STAGES.map((stage, index) => (
                    <div
                        key={stage.title}
                        className="border-t-2 border-black px-4 py-6 sm:px-6 sm:py-8 bg-white"
                    >
                        <div className="font-mono text-xs font-black uppercase text-gray-500 mb-2">
                            {String(index + 1).padStart(2, "0")} — {stage.title}
                        </div>
                        <p className="text-base text-gray-600 font-medium leading-relaxed mb-6 m-0">
                            {stage.summary}
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-0 md:divide-x-2 divide-black">
                            <div className="md:pr-6">
                                <div className="bg-slate-50 border-2 border-black p-4 space-y-2">
                                    {stage.iosPaths.map((rel) => (
                                        <div
                                            key={rel}
                                            className="font-mono text-[11px] sm:text-xs text-blue-900 leading-snug break-all"
                                        >
                                            {rel}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="md:pl-6">
                                <div className="bg-slate-50 border-2 border-black p-4 space-y-2">
                                    {stage.androidPaths.map((rel) => (
                                        <div
                                            key={rel}
                                            className="font-mono text-[11px] sm:text-xs text-green-900 leading-snug break-all"
                                        >
                                            {rel}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>

    </div>
);

// --- Articles Export ---

export const ARTICLES: Article[] = [
    {
        id: "rejourney-1-3-million-session-replays",
        title: "Rejourney Hits 1.3 Million Session Replays in 3 Months",
        subtitle: "Lessons in edge security, durable pipelines, and scaling during a 10x traffic spike.",
        seoKeywords:
            "session replay scaling, edge security, Cloudflare DDoS, durable ingestion pipeline, high availability Postgres Redis, multi-bucket storage, Rejourney architecture",
        date: "Apr 23, 2026",
        urlDate: "2026-04-23",
        readTime: "9 min read",
        author: {
            name: "Fowwaz Moeen",
            url: "https://www.linkedin.com/in/fowwaz-moeen/",
            github: "https://github.com/FowwazM",
        },
        image: "https://rejourney.co/assets/engineering/rejourney-1-3-million-session-replays.png",
        schema: scalingArticleSchema,
        content: <ScalingArticleContent />,
    },
    {
        id: "maps-performance",
        title: "120Hz Map Performance: Hooking Native SDKs",
        subtitle: "Solving micro-stutter on Apple Maps, Google Maps, and Mapbox via delegate swizzling.",
        seoKeywords:
            "React Native session replay, Mapbox, Apple Maps, Google Maps, 120Hz ProMotion, map capture, iOS Android, delegate swizzling, mobile observability",
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
        title: "Rejourney Architecture",
        subtitle: "How we achieved pixel-perfect replay with 3 FPS and zero main-thread impact.",
        seoKeywords:
            "session replay architecture, React Native, pixel-perfect replay, GPU capture, observability, Sentry alternative, async pipeline, mobile crash monitoring",
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
