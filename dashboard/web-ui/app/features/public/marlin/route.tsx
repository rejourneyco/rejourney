import { Link } from "react-router";
import type { MetaFunction } from "react-router";
import { ArrowRight, Github } from "lucide-react";
import { Footer } from "~/shell/components/layout/Footer";
import { Header } from "~/shell/components/layout/Header";
import { SITE_URL } from "~/shared/lib/internationalMarketing";

const MARLIN_APP_URL = "https://github.com/apps/rejourney-marlin/";
const MARLIN_IMAGE = "/images/rejourney-marlin.png";
const MARLIN_DISPLAY_IMAGE = "/images/rejourney-marlin.webp";
const ISSUE_FEED_IMAGE = "/images/issues-feed.webp";
const REPLAY_CONTEXT_IMAGE = "/images/landing-replay-theater.webp";
const REVENUE_IMAGE = "/images/growth-engines.webp";
const STABILITY_IMAGE = "/images/anr-issues.webp";

export const meta: MetaFunction = () => {
  const canonicalUrl = `${SITE_URL}/rejourney-marlin`;
  const title = "Rejourney Marlin | AI Fixes from Product Analytics";
  const description =
    "Rejourney Marlin is a GitHub App that turns lightweight product analytics, replay, funnel, crash, and API evidence into reviewable code-fix suggestions.";

  return [
    { title },
    { name: "description", content: description },
    {
      name: "keywords",
      content:
        "Rejourney Marlin, GitHub App, replay context, code fix suggestions, funnel leak detection, revenue leak fixes, AI debugging",
    },
    { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
    { property: "og:site_name", content: "Rejourney" },
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
    <div className="public-readable-scope min-h-screen overflow-x-hidden bg-[var(--dashboard-canvas,#f8fafd)] text-[#202124]">
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
                  "A GitHub App that turns Rejourney product analytics and replay context into reviewable code-fix suggestions.",
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
                  "GitHub App for suggesting code fixes from lightweight product analytics, replay, funnel, crash, and API evidence.",
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
          <div className="relative z-10 mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#1a73e8]">
                Rejourney Marlin for GitHub
              </p>
              <h1 className="mt-5 max-w-4xl font-display text-4xl font-extrabold leading-tight tracking-normal text-[#202124] sm:text-6xl lg:text-7xl">
                Fix the leaks your replays expose.
              </h1>
              <p className="mt-6 max-w-2xl text-lg font-medium leading-8 text-[#3c4043] sm:text-xl">
                Marlin is the Rejourney GitHub App that uses replay context to identify funnel and revenue issues, then suggests code fixes your team can review from the repository.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <a
                  href={MARLIN_APP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-none bg-[#1a73e8] px-7 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1765cc] active:bg-[#1967d2]"
                >
                  <Github className="h-4 w-4" />
                  Install GitHub App
                </a>
                <Link
                  to="/pricing"
                  className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-none border border-[#dadce0] bg-white px-7 text-sm font-semibold text-[#3c4043] shadow-sm transition hover:bg-[#f8fafd] hover:text-[#202124]"
                >
                  See pricing
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-xl">
              <div className="relative overflow-hidden rounded-none border border-[#dadce0] bg-white p-3 shadow-sm">
                <img
                  src={MARLIN_DISPLAY_IMAGE}
                  alt="Rejourney Marlin artwork"
                  className="aspect-square w-full rounded-none object-cover"
                  decoding="async"
                />
              </div>
              <div className="relative -mt-12 ml-auto w-[88%] rounded-none border border-[#dadce0] bg-white p-4 shadow-md sm:w-[78%]">
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#5f6368]">
                    Marlin suggestion
                  </span>
                  <span className="rounded-none border border-[#ceead6] bg-[#e6f4ea] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#137333]">
                    Found Fix
                  </span>
                </div>
                <div className="mt-3 space-y-2 font-mono text-xs font-semibold text-[#3c4043]">
                  <p>checkout/PaymentSheet.tsx</p>
                  <p className="text-[#137333]">+ retry failed intent before empty state</p>
                  <p className="text-[#1a73e8]">+ guard CTA when plan quote is stale</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[var(--dashboard-canvas,#f8fafd)] px-5 py-20 sm:px-8 lg:px-10">
          <div className="mx-auto max-w-7xl space-y-24">

            <section id="issue-detection" className="grid gap-10 lg:grid-cols-[0.48fr_0.52fr] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#5f6368]">Issue detection</p>
                <h3 className="mt-3 text-3xl font-extrabold tracking-tight text-[#202124] sm:text-4xl">
                  The fix starts from the recorded user sessions by Rejourney.
                </h3>
                <p className="mt-4 text-base font-medium leading-8 text-[#3c4043]">
                  Rejourney groups repeated checkout failures, rage taps, broken onboarding paths, and abandoned funnels into signals. Marlin reads the same evidence your team sees: affected users, session count, failure cluster, and why the leak matters.
                </p>
              </div>
              <figure className="overflow-hidden rounded-none border border-[#dadce0] bg-white p-2 shadow-sm">
                <img src={ISSUE_FEED_IMAGE} alt="Rejourney issue detection feed with ranked funnel leaks" className="w-full rounded-none object-cover" loading="lazy" decoding="async" />
              </figure>
            </section>

            <section id="replay-context" className="space-y-8">
              <div className="mx-auto max-w-4xl text-center">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#5f6368]">Replay context</p>
                <h3 className="mt-3 text-3xl font-extrabold tracking-tight text-[#202124] sm:text-4xl">
                  Then it creates a ranked "leaks" cause and fix feed.
                </h3>
                <p className="mt-4 text-base font-medium leading-8 text-[#3c4043]">
                  The repair note is grounded in the replay timeline: user actions, console events, network failures, DOM state, and the specific sessions that prove the leak is real.
                </p>
              </div>
              <figure className="overflow-hidden rounded-none border border-[#dadce0] bg-white p-2 shadow-sm">
                <img src={REPLAY_CONTEXT_IMAGE} alt="Rejourney replay theater showing session timeline and diagnostic context" className="w-full rounded-none object-cover" loading="lazy" decoding="async" />
              </figure>
            </section>

            <section id="revenue-impact" className="grid gap-10 lg:grid-cols-[0.58fr_0.42fr] lg:items-center">
              <figure className="overflow-hidden rounded-none border border-[#dadce0] bg-white p-2 shadow-sm lg:order-first">
                <img src={REVENUE_IMAGE} alt="Rejourney revenue growth dashboard with revenue trend and release markers" className="w-full rounded-none object-cover" loading="lazy" decoding="async" />
              </figure>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#5f6368]">Revenue priority</p>
                <h3 className="mt-3 text-3xl font-extrabold tracking-tight text-[#202124] sm:text-4xl">
                  The issue is ranked by business impact.
                </h3>
                <p className="mt-4 text-base font-medium leading-8 text-[#3c4043]">
                  Marlin can tell the difference between cosmetic noise and a checkout path that blocks revenue. Revenue movement, affected cohorts, and release timing travel into the GitHub suggestion so engineers know why the fix should move now.
                </p>
              </div>
            </section>

            <section id="stability" className="grid gap-10 lg:grid-cols-[0.42fr_0.58fr] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#5f6368]">Stability evidence</p>
                <h3 className="mt-3 text-3xl font-extrabold tracking-tight text-[#202124] sm:text-4xl">
                  Crashes, ANRs, and API spikes become fix paths too.
                </h3>
                <p className="mt-4 text-base font-medium leading-8 text-[#3c4043]">
                  When the leak is technical, Marlin uses the same issue feed to connect stack traces, device cohorts, endpoint spikes, and replay context to likely files. The result is a focused repair brief instead of a vague stability ticket.
                </p>
              </div>
              <figure className="overflow-hidden rounded-none border border-[#dadce0] bg-white p-2 shadow-sm">
                <img src={STABILITY_IMAGE} alt="Rejourney stability monitoring table with crashes, ANRs, API spikes, events, and affected users" className="w-full rounded-none object-cover" loading="lazy" decoding="async" />
              </figure>
            </section>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
