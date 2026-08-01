import type { Article } from "../engineeringTypes";

// --- Content: How We Keep Mobile Session Replay Cheap ---

const PRICING_ARTICLE_URL = "https://rejourney.co/engineering/2026-05-06/mobile-session-replay-cost";

const pricingArticleSchema = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "How We Keep Mobile Session Replay 17× Cheaper Than PostHog",
    description:
        "A combo of cheap GDPR providers and SDK desgin choices.",
    url: PRICING_ARTICLE_URL,
    keywords: [
        "session replay pricing",
        "react native session replay cost",
        "mobile observability cost",
        "GDPR session replay",
        "EU mobile analytics",
        "cheap session replay",
        "cheap mobile session replay",
        "affordable session replay",
        "fixed price session replay",
        "Redis buffered ingest",
        "self-hosted Kubernetes session replay",
    ],
    author: {
        "@type": "Person",
        name: "Mohammad Rashid",
        url: "https://www.linkedin.com/in/mohammad-rashid7337/",
        github: "https://github.com/Mohammad-R-Rashid",
    },
    datePublished: "2026-05-06",
    dateModified: "2026-05-06",
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
        "@id": PRICING_ARTICLE_URL,
    },
};

const PricingArticleContent = () => (
    <div className="space-y-6 text-lg font-medium leading-relaxed">
        <p>
            PostHog bills $85/month for 25,000 sessions. We bill $5. The gap widens to 20× at
            350,000 sessions/month. This article is not about how our pricing works rather it is about
            why those numbers are sustainable for us when they are not for a usage-based model.
            The answer is a stack of deliberate engineering decisions that each remove a unit
            of cost that would otherwise compound with volume. If you are looking for cheap session
            replay that is still built for production mobile apps, this is the engineering behind it.
        </p>

        {/* Quick reference table — one clean table, no charts */}
        <div className="border-2 border-black bg-white overflow-hidden my-10">
            <div className="bg-black text-white px-5 py-3 font-mono text-[11px] font-black uppercase tracking-widest">
                Price Comparison — Rejourney vs PostHog Session Replay
            </div>
            <table className="w-full border-collapse">
                <thead>
                    <tr className="bg-slate-50 border-b-2 border-black">
                        <th className="text-left py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-black">Sessions/mo</th>
                        <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-black text-green-700">Rejourney</th>
                        <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-black text-red-600">PostHog</th>
                        <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest">Cheaper by</th>
                    </tr>
                </thead>
                <tbody>
                    {[
                        { sessions: "25,000", ours: "$5", theirs: "$85", x: "17×" },
                        { sessions: "100,000", ours: "$15", theirs: "$272.50", x: "18×" },
                        { sessions: "350,000", ours: "$35", theirs: "$712.50", x: "20×" },
                    ].map(({ sessions, ours, theirs, x }) => (
                        <tr key={sessions} className="border-b-2 border-black last:border-b-0">
                            <td className="py-3 px-4 font-mono text-sm border-r-2 border-black">{sessions}</td>
                            <td className="py-3 px-4 font-mono text-sm font-black text-right text-green-700 border-r-2 border-black">{ours}/mo</td>
                            <td className="py-3 px-4 font-mono text-sm font-black text-right text-red-600 border-r-2 border-black">{theirs}/mo</td>
                            <td className="py-3 px-4 font-mono text-sm font-black text-right text-blue-700">{x}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>

        {/* Section 01 — Capture scale */}
        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    01 // SDK BANDWIDTH
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Every Byte the SDK Produces Has to Be Stored and Served
                </h2>
            </div>
            <p>
                Most session replay tools default to capturing at the device's native resolution —
                1× or 2× Retina — because it is the simplest implementation. We do not. The
                SDK captures at 1.25× scale, which means we read the framebuffer at roughly
                80% of its linear dimension before any compression runs. The difference in raw
                pixel count between 3× Retina and 1.25× is approximately 5.8×. That is 5.8×
                less data going into the JPEG encoder before compression is even considered.
            </p>
            <p className="mt-4">
                The frame rate is also not what people assume. Our default is 1 frame per second,
                with the capture timer scheduled in UIKit's default run loop mode — intentionally
                not <code>.common</code>. Scheduling in the default mode means the timer
                automatically pauses while UIKit is handling active scroll events. It is not
                that we slow down capture during scrolls; the run loop simply does not fire
                the timer. Combined with our 1 FPS default, a tool capturing at 10 FPS will
                produce roughly 10× more screenshot data per session before any other factor
                is considered.
            </p>
            <p className="mt-4">
                The main thread is involved only for the pixel read itself. JPEG encoding,
                frame batching, gzip compression, and HTTP upload all run on a serial background{" "}
                <code>OperationQueue</code> at <code>.utility</code> QoS. The encode queue
                has a hard backpressure limit: 50 pending batches and 500 buffered frames. When
                either limit is reached, new frames are dropped rather than queued. This prevents
                a network outage from turning into unbounded memory growth, and it keeps the
                SDK's memory footprint predictable under any network condition.
            </p>
            <p className="mt-4">
                On-device redaction is part of this story too. Text inputs, password fields,
                and camera previews are blacked out in the pixel buffer before the JPEG encoder
                runs. The redacted pixels are never in the artifact. This eliminates the
                server-side blurring pipeline that most tools run as a post-processing step
                which is one less compute stage, one less storage operation per session. Small but still helpful.
            </p>
        </div>

        {/* Section 01b — Compression */}
        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    01b // COMPRESSION
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    How the Frame Bundle Format and Gzip Work
                </h2>
            </div>
            <p>
                After JPEG encoding, frames are not uploaded individually. They are packed into a
                binary archive and gzip-compressed as a single unit before the network call happens.
                The binary format is deliberately simple: for each frame, 8 bytes of big-endian
                timestamp offset from the session epoch, 4 bytes of big-endian JPEG size, then the
                raw JPEG bytes. Each frame record is just a header and a payload, no alignment
                padding, no per-frame metadata.
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">Binary frame bundle layout (per frame, repeated)</div>
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`[ 8 bytes — uint64 BE ] timestamp offset from session epoch (ms)
[ 4 bytes — uint32 BE ] JPEG byte length
[ N bytes            ] raw JPEG data

...repeated for each frame in the batch...

→ entire archive passed to gzipCompress()`}</pre>
            </div>
            <p>
                The gzip pass uses zlib's <code>deflateInit2_</code> with compression level 9 —
                maximum ratio, not the default level 6. The flag <code>MAX_WBITS + 16</code> selects
                the gzip container format specifically (as opposed to raw deflate or the zlib envelope).
                Memory level is 8, strategy is <code>Z_DEFAULT_STRATEGY</code>. The output buffer
                is pre-allocated at <code>input.count / 2</code> — assuming 50% compression upfront
                to avoid reallocation in the common case — and streams in 16 KB chunks until{" "}
                <code>avail_out</code> is non-zero.
            </p>
            <div className="bg-slate-50 border-2 border-black p-6 my-6 overflow-x-auto">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">zlib parameters</div>
                <pre className="text-xs sm:text-sm font-mono text-blue-900">{`deflateInit2_(
    &stream,
    9,               // level — Z_BEST_COMPRESSION
    Z_DEFLATED,
    MAX_WBITS + 16,  // +16 = gzip container (not raw deflate)
    8,               // memLevel
    Z_DEFAULT_STRATEGY,
    ZLIB_VERSION,
    MemoryLayout<z_stream>.size
)`}</pre>
            </div>
            <p>
                Level 9 costs slightly more CPU than level 6 but produces meaningfully smaller
                output for JPEG data that has already been compressed once. The trade-off is
                intentional: the encode queue runs at <code>.utility</code> QoS, so the extra
                compression work happens on spare CPU that the OS would not otherwise schedule
                for foreground work. The smaller payload wins at the storage and egress layer
                every time the artifact is read back.
            </p>
            <p className="mt-4">
                Batch flush triggers on whichever comes first: the buffer reaching the upload
                batch size (default 3 frames), or the oldest buffered frame having waited longer
                than <code>batchSize × snapshotInterval</code> milliseconds. The time-based
                flush exists specifically for short sessions that end before accumulating a full
                batch — without it, a 2-second session would sit in the buffer until shutdown.
                Hierarchy snapshots go through the same <code>gzipCompress()</code> call
                independently before upload, so every artifact type that leaves the device
                is compressed at level 9.
            </p>
        </div>

        {/* Section 02 — Async ingest */}
        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    03 // INGEST PIPELINE
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Object Storage Is Not in the SDK Request Path
                </h2>
            </div>
            <p>
                The typical implementation of session replay ingest is: SDK uploads → server
                presigns a PUT URL → SDK puts to object storage → server records the artifact.
                Object storage latency is now in the SDK's upload path. If S3 is slow, your
                ingest service is slow, and you pay for more compute to absorb the backlog.
            </p>
            <p className="mt-4">
                We separated the concerns. When the SDK uploads an artifact body, the ingest
                relay writes it into Redis under the key <code>artifact:buf:{"{artifactId}"}</code>{" "}
                with a 30-minute TTL and immediately responds with a 204. The SDK is done in
                under 50ms regardless of what object storage is doing. The actual write to object
                storage is dequeued asynchronously by a BullMQ worker from the{" "}
                <code>rj-artifact-flush</code> queue.
            </p>
            <p className="mt-4">
                BullMQ deduplicates flush jobs by <code>artifactId</code>. If a worker crashes
                mid-flush, the job becomes stalled and is automatically re-queued after 30 seconds
                for up to three attempts. The flush is idempotent — writing the same artifact
                to object storage twice is safe so re-processing never causes corruption.
                The Redis TTL provides a deadline: if the artifact is not flushed within 30
                minutes, it is dropped rather than left orphaned. In practice, flush jobs
                complete in seconds. The TTL is a circuit breaker for pathological failure, not
                normal operation.
            </p>
            <p className="mt-4">
                The result is that the ingest relay pod is fully stateless and cheap. It never
                holds a connection open to S3, never waits on object storage latency, and
                scales horizontally with session upload volume without requiring proportional
                object storage throughput in the hot path. The workers that actually flush to
                storage run separately and scale on BullMQ queue depth.
            </p>
        </div>

        {/* Section 03 — Storage routing */}
        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    04 // STORAGE ROUTING
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    Artifact Routing Without Hard-Coded Buckets
                </h2>
            </div>
            <p>
                Every artifact that lands in object storage is pinned to the endpoint that
                received it via a <code>storage_endpoints</code> table in Postgres. At write
                time, the flush worker resolves an endpoint — either a project-specific override
                or the global default, selected by weight — writes the artifact, and records the
                endpoint ID alongside the artifact metadata. Reads always look up the endpoint
                from that record rather than assuming a global bucket. 
            </p>
            <p className="mt-4">
                This makes bucket migrations and provider changes operational rather than
                engineering problems. We can add a new endpoint, shift its weight to 100%,
                and drain the old bucket without changing any application code or producing
                404s for artifacts already on the old endpoint. Every artifact knows where it
                lives. Bucket load balancing in sense. Our current provider, OVH, offers really cheap
                storage, free egress, free ingress, and no API costs. Each bucket has near unlimited objects,
                unlimited storage, and is a very mature platform. 
            </p>
            <p className="mt-4">
                After the primary write, shadow endpoints receive async copies for durability
                without adding latency to the flush path. Postgres WAL archiving and compressed
                database backups go to Cloudflare R2, which has zero egress fees on object
                reads. For backup and archival workloads where you read data rarely but need
                to pay nothing when you do, egress-free storage is meaningful.
            </p>
        </div>

        {/* Section 04 — Database */}
        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    05 // DATABASE
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    CloudNativePG Instead of a Managed Database Service
                </h2>
            </div>
            <p>
                Managed database services — RDS, Cloud SQL, Supabase — charge a premium for the
                operational overhead they take on. We run Postgres under CloudNativePG (CNPG), the
                CNCF-graduated Kubernetes operator for Postgres. The primary sits in one datacenter,
                a synchronous standby runs in a second. <code>synchronous_commit = remote_write</code>{" "}
                means no data is lost if the primary node fails the standby has the write
                before the primary acknowledges it. Auto-promotion takes roughly 30 seconds,
                and pgbouncer's connection pooler follows the new primary automatically.
            </p>
            <p className="mt-4">
                pgbouncer is important here. Session replay ingest generates many short-lived
                database connections. Each worker job may open and release a connection. Without
                a pooler, Postgres would spend a meaningful fraction of its CPU on connection
                setup and teardown. pgbouncer pools at 180 connections against Postgres while
                exposing a much higher limit to the application layer, keeping Postgres doing
                actual query work instead of connection management.
            </p>
            <p className="mt-4">
                Redis HA runs as a three-node Sentinel cluster. Sentinel requires a quorum of
                2 out of 3 nodes to elect a new master. The two datacenter split one node in
                one DC, two in another means either DC can elect a master independently if
                the other goes offline. One configuration decision that matters here:{" "}
                <code>maxmemory-policy</code> is set to <code>noeviction</code>. Redis will
                return an error rather than silently drop keys when memory is full. For BullMQ
                job state, silent eviction would mean jobs disappear without being processed.
                We surface the error as a queue backpressure signal instead.
            </p>
        </div>

        {/* Section 05 — Compute */}
        <div className="my-12">
            <div className="mb-6">
                <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-2 block">
                    06 // COMPUTE
                </span>
                <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-4">
                    k3s on European VPS Rather Than Managed Kubernetes
                </h2>
            </div>
            <p>
                Managed Kubernetes on AWS, GCP, or Azure has two costs: the node instances
                themselves, and the managed control plane. The control plane fee is fixed per
                cluster regardless of load, and the per-node overhead of running a full
                Kubernetes distribution can consume several gigabytes of RAM per node that would
                otherwise be available for workloads.
            </p>
            <p className="mt-4">
                k3s ships as a single binary. The control plane runs in-process on one of the
                nodes. There is no separate etcd cluster to operate — k3s embeds etcd. The
                memory footprint per node for k3s itself is a fraction of what a full kube
                distribution requires, which means more of the instance's RAM reaches actual
                application pods.
            </p>
            <p className="mt-4">
                We run this on Hetzner, a German cloud provider with VPS pricing that is
                consistently lower than AWS or GCP for equivalent CPU and RAM. The cluster
                spans two EU datacenters for cross-datacenter redundancy. The ingest and
                worker pods that handle bulk session processing run in the second datacenter
                specifically to keep the primary node's CPU available for low-latency API
                requests. Worker workloads are IO-bound — they wait on Redis reads and
                object storage writes — so they autoscale on BullMQ queue depth rather
                than CPU utilization.
            </p>
            <p className="mt-4">
                GDPR data residency follows from this naturally. All compute is in the EU —
                Germany and Finland. The ingest path goes SDK → Cloudflare WAF (TLS
                termination only, no data retention) → our load balancer → our API → our
                storage. No session data routes through a non-EU processor. The iOS SDK
                ships <code>PrivacyInfo.xcprivacy</code> with the correct API usage
                declarations, so App Store submission privacy nutrition labels are handled
                automatically.
            </p>
        </div>

    </div>
);

export const mobileSessionReplayCostArticle: Article = {
    collection: "engineering",
    id: "mobile-session-replay-cost",
    title: "How We Keep Mobile Session Replay 17× Cheaper Than PostHog",
    subtitle: "The specific engineering decisions and great GDPR providers.",
    seoKeywords:
        "cheap session replay, cheap mobile session replay, session replay pricing comparison, react native session replay cost, mobile observability budget, GDPR session replay, EU mobile analytics tool, affordable session replay, fixed price session recording, posthog alternative react native, logrocket alternative cost",
    seo: {
        primaryKeyword: "cheap session replay",
        metaTitle: "Cheap Session Replay: 17× Cheaper Than PostHog",
        metaDescription:
            "Cheap session replay without usage-based pricing: how Rejourney stays 17× cheaper than PostHog with mobile SDK and infrastructure choices.",
        targetKeywords: [
            "cheap session replay",
            "cheap mobile session replay",
            "affordable session replay",
            "session replay pricing",
            "PostHog session replay cost",
            "mobile session replay pricing",
            "mobile observability cost",
            "fixed price session replay",
            "PostHog alternative",
            "LogRocket alternative cost",
            "mobile crash reporting pricing",
        ],
        topicTags: ["Pricing", "Session Replay", "PostHog Alternative", "Mobile Analytics", "Mobile Observability"],
    },
    date: "May 06, 2026",
    urlDate: "2026-05-06",
    dateModified: "2026-05-06",
    readTime: "8 min read",
    author: {
        name: "Mohammad Rashid",
        url: "https://www.linkedin.com/in/mohammad-rashid7337/",
        github: "https://github.com/Mohammad-R-Rashid",
    },
    image: "https://rejourney.co/assets/engineering/mobile-session-replay-cost.png",
    schema: pricingArticleSchema,
    content: <PricingArticleContent />,
};
