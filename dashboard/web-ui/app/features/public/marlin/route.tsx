import { Link } from "react-router";
import type { MetaFunction } from "react-router";
import { ArrowRight, Github } from "lucide-react";
import { Footer } from "~/shell/components/layout/Footer";
import { Header } from "~/shell/components/layout/Header";
import { SITE_URL } from "~/shared/lib/internationalMarketing";
import { LandingThreeField } from "~/features/public/home/components/LandingThreeField";
import { FloatingDataNodes } from "~/features/public/home/components/SparseThreeAnimations";

const MARLIN_APP_URL = "https://github.com/apps/rejourney-marlin/";
const MARLIN_IMAGE = "/images/rejourney-marlin.png";
const ISSUE_FEED_IMAGE = "/images/issues-feed.png";
const REPLAY_CONTEXT_IMAGE = "/images/landing-replay-theater.png";
const REVENUE_IMAGE = "/images/growth-engines.png";
const STABILITY_IMAGE = "/images/anr-issues.png";

export const meta: MetaFunction = () => {
  const canonicalUrl = `${SITE_URL}/rejourney-marlin`;
  const title = "Rejourney Marlin GitHub App | Fix Revenue Leaks From Replay Context";
  const description =
    "Rejourney Marlin is a GitHub App that uses replay context, funnel evidence, and revenue impact signals to suggest code fixes for product leaks.";

  return [
    { title },
    { name: "description", content: description },
    {
      name: "keywords",
      content:
        "Rejourney Marlin, GitHub App, replay context, code fix suggestions, funnel leak detection, revenue leak fixes, AI debugging",
    },
    { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonicalUrl },
    { property: "og:type", content: "website" },
    { property: "og:image", content: `${SITE_URL}${MARLIN_IMAGE}` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "1200" },
    { property: "og:image:alt", content: "Rejourney Marlin artwork" },
    { property: "og:image:type", content: "image/png" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: `${SITE_URL}${MARLIN_IMAGE}` },
    { tagName: "link", rel: "canonical", href: canonicalUrl },
  ];
};

export default function RejourneyMarlinPage() {
  const canonicalUrl = `${SITE_URL}/rejourney-marlin`;

  return (
    <div className="public-readable-scope min-h-screen overflow-x-hidden bg-white text-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebPage",
                "@id": `${canonicalUrl}#webpage`,
                url: canonicalUrl,
                name: "Rejourney Marlin",
                description:
                  "A GitHub App that turns Rejourney replay context into code-fix suggestions for revenue and funnel leaks.",
                image: `${SITE_URL}${MARLIN_IMAGE}`,
                isPartOf: {
                  "@type": "WebSite",
                  name: "Rejourney",
                  url: SITE_URL,
                },
              },
              {
                "@type": "SoftwareApplication",
                name: "Rejourney Marlin",
                applicationCategory: "DeveloperApplication",
                operatingSystem: "GitHub",
                url: MARLIN_APP_URL,
                description:
                  "GitHub App for suggesting code fixes from Rejourney replay context, revenue leak evidence, and funnel diagnostics.",
                publisher: {
                  "@type": "Organization",
                  name: "Rejourney",
                  url: SITE_URL,
                },
              },
            ],
          }),
        }}
      />
      <Header noSpacer />
      <main aria-label="Rejourney Marlin GitHub App">
        <section className="relative overflow-hidden px-5 pb-20 pt-36 sm:px-8 sm:pb-28 sm:pt-44 lg:px-10">
          <LandingThreeField variant="landing-hero" seed={931} />
          <FloatingDataNodes className="opacity-55" seed={907} />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_24%,rgba(45,212,191,0.18),transparent_42%),radial-gradient(circle_at_82%_18%,rgba(37,99,235,0.16),transparent_44%),linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.86))]" aria-hidden="true" />

          <div className="relative z-10 mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                Rejourney Marlin for GitHub
              </p>
              <h1 className="mt-5 max-w-4xl font-display text-4xl font-extrabold leading-tight tracking-normal text-slate-950 sm:text-6xl lg:text-7xl">
                Fix the leaks your replays expose.
              </h1>
              <p className="mt-6 max-w-2xl text-lg font-medium leading-8 text-slate-600 sm:text-xl">
                Marlin is the Rejourney GitHub App that uses replay context to identify funnel and revenue issues, then suggests code fixes your team can review from the repository.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={MARLIN_APP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-full bg-slate-950 px-7 text-sm font-bold text-white shadow-xl shadow-slate-300/40 transition hover:-translate-y-0.5 hover:bg-slate-800"
                >
                  <Github className="h-4 w-4" />
                  Install GitHub App
                </a>
                <Link
                  to="/pricing"
                  className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-full border border-slate-300 bg-white/70 px-7 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-md transition hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white"
                >
                  See pricing
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-xl">
              <div className="absolute -inset-5 rounded-[2rem] bg-cyan-200/30 blur-3xl" aria-hidden="true" />
              <div className="relative overflow-hidden rounded-[1.75rem] border border-cyan-100 bg-white/70 p-3 shadow-2xl shadow-cyan-900/10 backdrop-blur-xl">
                <img
                  src={MARLIN_IMAGE}
                  alt="Rejourney Marlin artwork"
                  className="aspect-square w-full rounded-[1.35rem] object-cover"
                />
              </div>
              <div className="relative -mt-12 ml-auto w-[88%] rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-xl backdrop-blur-md sm:w-[78%]">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Marlin suggestion
                  </span>
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                    Found Fix
                  </span>
                </div>
                <div className="mt-3 space-y-2 font-mono text-xs font-semibold text-slate-700">
                  <p>checkout/PaymentSheet.tsx</p>
                  <p className="text-emerald-700">+ retry failed intent before empty state</p>
                  <p className="text-blue-700">+ guard CTA when plan quote is stale</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-white px-5 py-20 sm:px-8 lg:px-10">
          <div className="mx-auto max-w-7xl space-y-24">

            <section id="issue-detection" className="grid gap-10 lg:grid-cols-[0.48fr_0.52fr] lg:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Issue detection</p>
                <h3 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                  The fix starts from the recorded user sessions by Rejourney.
                </h3>
                <p className="mt-4 text-base font-medium leading-8 text-slate-600">
                  Rejourney groups repeated checkout failures, rage taps, broken onboarding paths, and abandoned funnels into signals. Marlin reads the same evidence your team sees: affected users, session count, failure cluster, and why the leak matters.
                </p>
              </div>
              <figure className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-2xl shadow-slate-200/70">
                <img src={ISSUE_FEED_IMAGE} alt="Rejourney issue detection feed with ranked funnel leaks" className="w-full object-cover" />
              </figure>
            </section>

            <section id="replay-context" className="space-y-8">
              <div className="mx-auto max-w-4xl text-center">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Replay context</p>
                <h3 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                  Then it creates a ranked "leaks" cause and fix feed.
                </h3>
                <p className="mt-4 text-base font-medium leading-8 text-slate-600">
                  The repair note is grounded in the replay timeline: user actions, console events, network failures, DOM state, and the specific sessions that prove the leak is real.
                </p>
              </div>
              <figure className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70">
                <img src={REPLAY_CONTEXT_IMAGE} alt="Rejourney replay theater showing session timeline and diagnostic context" className="w-full rounded-[1.35rem] object-cover" />
              </figure>
            </section>

            <section id="revenue-impact" className="grid gap-10 lg:grid-cols-[0.58fr_0.42fr] lg:items-center">
              <figure className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-2xl shadow-slate-200/70 lg:order-first">
                <img src={REVENUE_IMAGE} alt="Rejourney revenue growth dashboard with revenue trend and release markers" className="w-full object-cover" />
              </figure>
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Revenue priority</p>
                <h3 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                  The issue is ranked by business impact.
                </h3>
                <p className="mt-4 text-base font-medium leading-8 text-slate-600">
                  Marlin can tell the difference between cosmetic noise and a checkout path that blocks revenue. Revenue movement, affected cohorts, and release timing travel into the GitHub suggestion so engineers know why the fix should move now.
                </p>
              </div>
            </section>

            <section id="stability" className="grid gap-10 lg:grid-cols-[0.42fr_0.58fr] lg:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Stability evidence</p>
                <h3 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                  Crashes, ANRs, and API spikes become fix paths too.
                </h3>
                <p className="mt-4 text-base font-medium leading-8 text-slate-600">
                  When the leak is technical, Marlin uses the same issue feed to connect stack traces, device cohorts, endpoint spikes, and replay context to likely files. The result is a focused repair brief instead of a vague stability ticket.
                </p>
              </div>
              <figure className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-2xl shadow-slate-200/70">
                <img src={STABILITY_IMAGE} alt="Rejourney stability monitoring table with crashes, ANRs, API spikes, events, and affected users" className="w-full object-cover" />
              </figure>
            </section>

            
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
