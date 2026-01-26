/**
 * Rejourney Dashboard - Engineering Page Route
 */

import type { Route } from "./+types/engineering";
import { Header } from "~/components/layout/Header";
import { Footer } from "~/components/layout/Footer";

const articleSchema = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: "Engineering - Rejourney",
  description:
    "How Rejourney delivers stop-motion session replay without UI stutter. Learn about our heuristic capture scheduler, defensive frame strategy, and privacy-first rendering.",
  author: {
    "@type": "Person",
    name: "Mohammad Rashid",
    url: "https://www.linkedin.com/in/mohammad-rashid7337/",
  },
  datePublished: "2026-01-21",
  dateModified: "2026-01-21",
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
  { name: "frame_total", avg: "17.5", max: "66.0", min: "0.01" },
  { name: "screenshot_ui", avg: "22.8", max: "65.8", min: "8.4" },
  { name: "render_draw", avg: "12.8", max: "25.2", min: "7.2" },
  { name: "view_scan", avg: "5.1", max: "28.3", min: "0.69" },
  { name: "view_serialize", avg: "1.5", max: "3.6", min: "0.16" },
  { name: "downscale", avg: "58.6", max: "400.7", min: "9.4" },
  { name: "encode_append", avg: "0.20", max: "0.80", min: "0.07" },
  { name: "encode_h264", avg: "85.5", max: "1989.1", min: "0.34" },
  { name: "buffer_alloc", avg: "0.40", max: "1.30", min: "0.22" },
];

export const meta: Route.MetaFunction = () => [
  { title: "Engineering - Rejourney" },
  {
    name: "description",
    content:
      "How Rejourney delivers stop-motion session replay without UI stutter. Learn about our heuristic capture scheduler, defensive frame strategy, and privacy-first rendering.",
  },
  { property: "og:title", content: "Engineering - Rejourney" },
  { property: "og:url", content: "https://rejourney.co/engineering" },
  { property: "og:type", content: "article" },
  {
    property: "og:description",
    content:
      "How Rejourney delivers stop-motion session replay without UI stutter. Learn about our heuristic capture scheduler, defensive frame strategy, and privacy-first rendering.",
  },
  { name: "article:published_time", content: "2026-01-21" },
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
              on January 21st, 2026
            </div>
          </div>

          <section className="mb-20">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                01 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                Why not DOM-based replay?
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                Legacy session replay tools like Posthog, Logrocket, and Microsoft Clarity
                rely on <strong>DOM-based reconstruction</strong>. They serialize the
                HTML structure of your app and try to "simulate" it in a browser. While
                this works for simple react native apps, it fails catastrophically for complex
                mobile applications and complex rendering.
              </p>
              <p>
                DOM-based replay cannot capture <strong>Canvas</strong>, <strong>Maps</strong>,
                <strong>Camera previews</strong>, or <strong>GPU-accelerated animations</strong>.
                If your user sees a rendering glitch or a blank Map view, a DOM-based
                replay will show a perfect (but inaccurate) simulation, making it useless for
                seeing real issues and capturing many edge cases.
              </p>
              <p>
                Sentry is one of the only viable alternatives that offers pixel-perfect
                replay, but Rejourney rivals them by being <strong>lighter and safer</strong> against
                visible UI stutter. We handle the heavy lifting of recording and encoding
                off the main thread, while using <strong>Heuristic Gating</strong> to ensure we never
                interfere with user interaction.
              </p>
            </div>
          </section>

          <section className="mb-20">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                02 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                Invisible Replay: The Heuristic Engine
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                Rejourney is built around a stop-motion replay model. Each frame is
                a deliberate UI state captured at 1 FPS. To make this "invisible" and
                guarantee no UI stutter, we use a complex <strong>Heuristic Engine</strong> that
                monitors the system state in real-time.
              </p>
              <p>
                We intentionally do not render during active motion. No scroll
                drag. No deceleration. No keyboard animation. No interactive
                transition. We wait for the UI to settle, then take the frame.
                The capture is timed to moments when it is physically impossible
                for a user to notice any overhead.
              </p>

              <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                  Core: The Decision Matrix
                </div>
                <pre className="text-sm font-mono overflow-x-auto">
                  {`- (RJCaptureHeuristicsDecision *)decisionForSignature:(NSString *)sig {
  // We check 8+ blockers: Touch, Scroll, Bounce, Refresh, Transitions, 
  // Keyboard, Maps, and Big Animations (Lottie/Shimmer).
  [self considerBlockerSince:self.lastTouchTime
               quietInterval:kRJQuietTouchSeconds
                      reason:RJCaptureHeuristicsReasonDeferTouch
                earliestTime:&earliestSafeTime];
  
  [self considerBlockerSince:self.lastScrollTime
               quietInterval:kRJQuietScrollSeconds
                      reason:RJCaptureHeuristicsReasonDeferScroll
                earliestTime:&earliestSafeTime];
                
  if (earliestSafeTime > now) return decision.defer;
}`}
                </pre>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-slate-50 border-2 border-black p-6">
                  <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    Case: Keyboard Stability
                  </div>
                  <pre className="text-xs font-mono overflow-x-auto">
                    {`if (self.keyboardAnimating) {
  // Wait for keyboard frame to settle
  self.lastKeyboardTime = now;
  return RJCaptureHeuristicsReasonDeferKeyboard;
}`}
                  </pre>
                </div>
                <div className="bg-slate-50 border-2 border-black p-6">
                  <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                    Case: Map Momentum
                  </div>
                  <pre className="text-xs font-mono overflow-x-auto">
                    {`// Track 7D Map Signature
return [NSString stringWithFormat:
  @"%.5f:%.5f:%.5f:%.5f:%.1f:%.1f:%.1f",
  lat, lon, dLat, dLon, alt, hdg, pitch];`}
                  </pre>
                </div>
              </div>

              <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                  Case: Overscroll & Elasticity Detection
                </div>
                <pre className="text-sm font-mono overflow-x-auto">
                  {`- (BOOL)isOverscrolling:(UIScrollView *)scrollView {
  // Wait for the rubber-band bounce to finish settling
  CGFloat topLimit = -inset.top - kRJScrollEpsilon;
  if (offset.y < topLimit || offset.y > bottomLimit) {
    return YES; // Wait for bounce to finish
  }
}`}
                </pre>
              </div>

              <p>
                The result is a sequence that reads like a comic strip of the
                session: high fidelity, lightweight on the device, and precise
                for debugging. By waiting for these "quiet periods," Rejourney
                remains truly invisible to the user.
              </p>
            </div>
          </section>

          <section className="mb-20">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                03 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                Adaptive Promotion: Capturing the 1% that Matters
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                Rejourney doesn't believe in storing every single session. Continuous recording
                creates noise and wastes bandwidth. Instead, our <strong>Adaptive Promotion</strong> engine
                identifies the 1% of sessions that actually contain critical issues and automatically
                promotes them for high-fidelity replay.
              </p>
              <p>
                We use <strong>Journey Reconstruction</strong> to map user paths against your app's
                learned "Happy Path". If a user deviates from a critical funnel or encounters
                a friction point, the session is prioritized. Our criteria includes:
              </p>
              <ul className="list-disc pl-6 space-y-3">
                <li>
                  <strong>Critical Failures:</strong> Crashes, ANRs, and API errors are always
                  fast-tracked for instant debugging.
                </li>
                <li>
                  <strong>User Frustration:</strong> Our on-device heuristics detect rage-tapping
                  and loop behaviors that signal a broken UX.
                </li>
                <li>
                  <strong>Funnel Drop-offs:</strong> We identify when users enter a conversion
                  funnel but drop off before reaching the target screen.
                </li>
              </ul>

              <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                  Logic: Failed Funnel Detection
                </div>
                <pre className="text-sm font-mono overflow-x-auto">
                  {`// Check if session followed the start of the funnel but failed to finish
if (matchesHappyPathStart(sessionPath) && !reachedTarget(sessionPath)) {
  return { 
    promoted: true, 
    reason: 'failed_funnel' 
  };
}`}
                </pre>
              </div>

              <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <div className="font-mono text-xs font-black uppercase text-gray-500 mb-4">
                  Logic: Multi-Signal Promotion Scoring
                </div>
                <pre className="text-sm font-mono overflow-x-auto">
                  {`export function calculatePromotionScore(metrics) {
  let score = 0;
  for (const cond of SOFT_CONDITIONS) {
    if (metrics[cond.field] >= cond.threshold) {
      score += cond.weight;
    }
  }
  return score >= SCORE_THRESHOLD;
}`}
                </pre>
              </div>
            </div>
          </section>

          <section className="mb-20">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                04 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                Defensive Captures for Screen Changes
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                Screen changes and micro-interactions are the most valuable parts
                of a replay. We schedule defensive captures after navigation,
                taps, keyboard transitions, modal expansions, and large animation
                settles. These defensive captures reset the heartbeat timer, so
                you get the exact post-transition state without stutter.
              </p>

              <div className="bg-slate-50 border-2 border-black p-6 my-6">
                <pre className="text-sm font-mono overflow-x-auto">
                  {`// Defensive capture scheduling
requestDefensiveCapture(0.2, "navigation")
requestDefensiveCapture(0.15, "interaction")
requestDefensiveCapture(0.2, "scroll_stop")`}
                </pre>
              </div>

              <p>
                We also track layout signatures with tint, visibility, and
                content length. That means small UI changes (like a heart toggle)
                are detected even when the view tree structure remains unchanged.
              </p>
            </div>
          </section>

          <section className="mb-20">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                05 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                Benchmarks from Real Device Logs
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                The table below is pulled from live RJ-PERF logs on iPhone 15 Pro
                (iOS 26, Expo SDK 54, React Native New Architecture) running the
                production <a href="https://merchcampus.com" target="_blank" rel="noopener noreferrer" className="underline font-bold">Merch App</a>. The first
                three frames are excluded to remove cold-start noise. The main
                thread cost stays within a single frame budget while encoding
                and downscaling stay in the background.
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
                      Avg (ms)
                    </th>
                    <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest border-r-2 border-white">
                      Max (ms)
                    </th>
                    <th className="text-right py-3 px-4 text-[10px] font-black uppercase tracking-widest">
                      Min (ms)
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
                      <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">
                        {metric.avg}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono font-bold text-right border-r-2 border-black">
                        {metric.max}
                      </td>
                      <td className="py-3 px-4 text-xs font-mono font-bold text-right">
                        {metric.min}
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
                06 //
              </span>
              <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tighter mb-6">
                Privacy + Pixel Accuracy in One Pass
              </h2>
            </div>

            <div className="space-y-6 text-lg font-medium leading-relaxed">
              <p>
                We mask sensitive UI on-device before encoding. Text inputs,
                webviews, camera previews, and video layers are detected in the
                scan and blurred or blacked out in the frame buffer. Sensitive
                pixels never leave the device.
              </p>
              <p>
                Because we capture the real framebuffer, GPU content stays
                accurate: maps, live previews, and shader-based UI are recorded
                exactly as seen, while sensitive areas remain protected.
              </p>
            </div>
          </section>

          <section className="mb-20 border-t-4 border-black pt-12">
            <div className="mb-8">
              <span className="font-mono text-xs font-black uppercase tracking-widest text-gray-500 mb-4 block">
                CODE REFERENCES //
              </span>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tighter mb-6">
                Key Implementation Files
              </h2>
            </div>

            <div className="space-y-4 text-base font-medium">
              <div className="border-2 border-black p-4">
                <div className="font-mono text-sm font-black uppercase mb-2">
                  iOS Capture Engine
                </div>
                <div className="text-sm">
                  packages/react-native/ios/Capture/RJCaptureEngine.m
                </div>
                <div className="text-sm opacity-70 mt-1">
                  Intent clock, defensive scheduling, frame reuse, upload
                  orchestration
                </div>
              </div>

              <div className="border-2 border-black p-4">
                <div className="font-mono text-sm font-black uppercase mb-2">
                  Heuristic Scheduler
                </div>
                <div className="text-sm">
                  packages/react-native/ios/Capture/RJCaptureHeuristics.m
                </div>
                <div className="text-sm opacity-70 mt-1">
                  Scroll, keyboard, animation, and transition gating
                </div>
              </div>

              <div className="border-2 border-black p-4">
                <div className="font-mono text-sm font-black uppercase mb-2">
                  View Scanner
                </div>
                <div className="text-sm">
                  packages/react-native/ios/Capture/RJViewHierarchyScanner.m
                </div>
                <div className="text-sm opacity-70 mt-1">
                  Layout signature, sensitive view detection
                </div>
              </div>

              <div className="border-2 border-black p-4">
                <div className="font-mono text-sm font-black uppercase mb-2">
                  Privacy Masker
                </div>
                <div className="text-sm">
                  packages/react-native/ios/Privacy/RJPrivacyMask.m
                </div>
                <div className="text-sm opacity-70 mt-1">
                  On-device redaction for text, web, camera, and video
                </div>
              </div>

              <div className="border-2 border-black p-4">
                <div className="font-mono text-sm font-black uppercase mb-2">
                  Segment Uploader
                </div>
                <div className="text-sm">
                  packages/react-native/ios/Capture/RJSegmentUploader.m
                </div>
                <div className="text-sm opacity-70 mt-1">
                  Presigned URLs, S3 uploads, completion retries
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
