import type { Article } from "../engineeringTypes";

// --- Content: Scaling Rejourney Architecture ---

const SCALING_ARTICLE_URL = "https://rejourney.co/engineering/2026-04-23/rejourney-1-3-million-session-replays";

const scalingArticleSchema = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
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

export const rejourney13MillionSessionReplaysArticle: Article = {
    collection: "engineering",
    id: "rejourney-1-3-million-session-replays",
    title: "Rejourney Hits 1.3 Million Session Replays in 3 Months",
    subtitle: "Lessons in edge security, durable pipelines, and scaling during a 10x traffic spike.",
    seoKeywords:
        "session replay scaling, edge security, Cloudflare DDoS, durable ingestion pipeline, high availability Postgres Redis, multi-bucket storage, Rejourney architecture",
    seo: {
        primaryKeyword: "session replay scaling",
        metaTitle: "Scaling Session Replay to 1.3M Replays",
        metaDescription:
            "How Rejourney handled 1.3M session replays with Cloudflare edge security, Redis-buffered ingest, HA Postgres, and multi-bucket storage.",
        targetKeywords: [
            "session replay scaling",
            "mobile analytics scaling",
            "Cloudflare DDoS protection",
            "Redis ingest pipeline",
            "high availability Postgres",
            "session replay infrastructure",
            "durable upload pipeline",
        ],
        topicTags: ["Scaling", "Infrastructure", "Cloudflare", "Redis", "Session Replay"],
    },
    date: "Apr 23, 2026",
    urlDate: "2026-04-23",
    dateModified: "2026-04-23",
    readTime: "9 min read",
    author: {
        name: "Fowwaz Moeen",
        url: "https://www.linkedin.com/in/fowwaz-moeen/",
        github: "https://github.com/FowwazM",
    },
    image: "https://rejourney.co/assets/engineering/rejourney-1-3-million-session-replays.png",
    schema: scalingArticleSchema,
    content: <ScalingArticleContent />,
};
