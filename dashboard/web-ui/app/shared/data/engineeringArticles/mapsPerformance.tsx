import { Apple, Map } from "lucide-react";
import type { Article } from "../engineeringTypes";

// --- Content: Map Performance (New) ---

const MAP_ARTICLE_URL = "https://rejourney.co/engineering/2026-02-17/maps-performance";

const mapArticleSchema = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "Rejourney Session Replay: High-Performance Maps on iOS & Android",
    description:
        "How we solved 120Hz micro-stutter in map captures by hooking native SDK delegates for Mapbox, Apple Maps, and Google Maps.",
    url: MAP_ARTICLE_URL,
    keywords: [
        "mobile session replay",
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

const AndroidMark = ({ className }: { className?: string }) => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        aria-hidden
        className={className}
    >
        <path d="M7.5 8 5.5 5.5" />
        <path d="M16.5 8 18.5 5.5" />
        <path d="M6 11a6 6 0 0 1 12 0v6a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-6Z" />
        <path d="M3.5 12.5v4" />
        <path d="M20.5 12.5v4" />
        <path d="M9.25 14.5h.01" />
        <path d="M14.75 14.5h.01" />
    </svg>
);

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
                        <Apple size={20} className="text-black" />
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
                        <AndroidMark className="h-5 w-5 text-black" />
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

            <h4 className="text-2xl font-black uppercase tracking-tighter mb-4 relative z-10">
                SpecialCases.swift
            </h4>

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
                    <div className="font-black text-3xl mb-1">High</div>
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

export const mapsPerformanceArticle: Article = {
    collection: "engineering",
    id: "maps-performance",
    title: "120Hz Map Performance: Hooking Native SDKs",
    subtitle: "Solving micro-stutter on Apple Maps, Google Maps, and Mapbox via delegate swizzling.",
    seoKeywords:
        "mobile session replay, Mapbox, Apple Maps, Google Maps, 120Hz ProMotion, map capture, iOS Android, delegate swizzling, mobile observability",
    seo: {
        primaryKeyword: "mobile map session replay",
        metaTitle: "120Hz Map Session Replay",
        metaDescription:
            "How Rejourney captures Apple Maps, Google Maps, and Mapbox in mobile session replay without 120Hz ProMotion stutter.",
        targetKeywords: [
            "mobile map session replay",
            "Mapbox session replay",
            "Apple Maps session replay",
            "Google Maps session replay",
            "120Hz ProMotion performance",
            "delegate swizzling",
            "mobile map capture",
        ],
        topicTags: ["Maps", "Mobile SDK", "Mapbox", "Apple Maps", "Performance"],
    },
    date: "Feb 17, 2026",
    urlDate: "2026-02-17",
    dateModified: "2026-02-17",
    readTime: "4 min read",
    author: {
        name: "Mohammad Rashid",
        url: "https://www.linkedin.com/in/mohammad-rashid7337/",
        github: "https://github.com/Mohammad-R-Rashid",
    },
    image: "https://rejourney.co/assets/engineering/maps-performance.png",
    schema: mapArticleSchema,
    content: <MapArticleContent />,
};
