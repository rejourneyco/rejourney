import React from "react";
import { Link } from "react-router";
import type { Route } from "./+types/route";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { SITE_URL } from "~/shared/lib/internationalMarketing";

const LANDING_IMAGE_VERSION = "20260619";
const landingImage = (path: string) => `${path}?v=${LANDING_IMAGE_VERSION}`;

const SESSION_REPLAY_IMAGE = landingImage("/images/landing-replay-workbench.webp");
const ISSUE_FEED_IMAGE = landingImage("/images/issues-feed.webp");
const REVENUE_IMAGE = landingImage("/images/growth-engines.webp");
const STABILITY_IMAGE = landingImage("/images/anr-issues.webp");
const CONTEXT_HANDOFF_IMAGE = landingImage("/images/readme-general-demo.webp");
const GEO_IMAGE = landingImage("/images/geo-intelligence.webp");

export const meta: Route.MetaFunction = () => {
  const canonicalUrl = `${SITE_URL}/how-it-works`;

  return [
    { title: "How it Works | Rejourney" },
    {
      name: "description",
      content:
        "Learn how Rejourney records user sessions, groups repeated checkout failures and rage clicks, ranks by revenue impact, and exports developer context.",
    },
    { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
    { property: "og:title", content: "How it Works | Rejourney" },
    {
      property: "og:description",
      content:
        "Learn how Rejourney records user sessions, groups repeated checkout failures and rage clicks, ranks by revenue impact, and exports developer context.",
    },
    { property: "og:url", content: canonicalUrl },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: "How it Works" },
    { tagName: "link", rel: "canonical", href: canonicalUrl },
  ];
};

export default function HowItWorksPage() {
  return (
    <div className="public-readable-scope min-h-screen bg-[#f8fbff] text-slate-900 overflow-x-hidden">
      <Header />
      <main className="w-full" aria-label="How it Works">
        {/* Simple Page Hero */}
        <section className="relative overflow-hidden px-5 pb-16 pt-36 text-center sm:px-8 sm:pb-20 sm:pt-40 lg:px-10 lg:pb-24 lg:pt-44">
          <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center">
            <h1 className="bg-gradient-to-br from-slate-950 via-blue-950 to-sky-900 bg-clip-text font-display text-4xl font-extrabold leading-tight tracking-tight text-transparent sm:text-5xl lg:text-6xl">
              How Rejourney Works
            </h1>
            <p className="mt-6 max-w-2xl text-balance text-lg font-medium leading-relaxed text-slate-600 sm:text-xl">
              From lightweight session recordings to AI-assisted code repairs, see the full pipeline that helps heal conversion leaks.
            </p>
          </div>
        </section>

        {/* Detailed Sections (Moved from landing page) */}
        <div className="landing-after-hero relative z-10 overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#f4f7fe_25%,#faf6ff_50%,#f4faf6_75%,#f8fafc_100%)]">
          <div className="pointer-events-none absolute inset-0 z-[0] bg-[radial-gradient(circle_at_15%_9%,rgba(37,99,235,0.015),transparent_31%),radial-gradient(circle_at_86%_22%,rgba(139,92,246,0.015),transparent_34%),radial-gradient(circle_at_18%_52%,rgba(245,158,11,0.015),transparent_34%),radial-gradient(circle_at_82%_78%,rgba(16,185,129,0.015),transparent_34%)]" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(180deg,rgba(255,255,255,0.35)_0%,rgba(255,255,255,0.12)_28%,rgba(255,255,255,0.08)_56%,rgba(255,255,255,0.25)_100%)]" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-x-0 top-[33rem] z-[1] h-px bg-gradient-to-r from-transparent via-sky-200/45 to-transparent" aria-hidden="true" />

          <section className="landing-section relative z-10 overflow-hidden bg-transparent px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
            <div className="mx-auto max-w-7xl space-y-32">
              
              {/* Section: Replay Context */}
              <div className="space-y-8">
                <div className="mx-auto max-w-4xl text-center">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Replay context</p>
                  <h3 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                    First, Rejourney records the user sessions.
                  </h3>
                  <p className="mt-4 text-base font-medium leading-8 text-slate-600">
                    The user's session and journey is recorded as a video with collected metadata. 
                  </p>
                </div>
                <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70">
                  <img src={SESSION_REPLAY_IMAGE} alt="Rejourney session replay screen showing user journey steps and timeline context" loading="lazy" decoding="async" className="w-full rounded-[1.35rem] object-cover" />
                </div>
              </div>

              {/* Section: Issue Detection */}
              <div className="grid gap-12 lg:grid-cols-[0.42fr_0.58fr] lg:items-center">
                <div className="space-y-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Issue detection</p>
                  <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                    Then, Rejourney creates the ranked "leaks" feed.
                  </h3>
                  <p className="text-base font-medium leading-8 text-slate-600">
                    Rejourney groups repeated checkout failures, rage taps, broken onboarding paths, and abandoned funnels into signals. Marlin reads the same evidence your team sees: affected users, session count, failure cluster, and why the leak matters.
                  </p>
                </div>
                <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70">
                  <div className="overflow-hidden rounded-[1.35rem] aspect-[16/10]">
                    <img 
                      src={ISSUE_FEED_IMAGE} 
                      alt="Rejourney issue detection feed showing ranked leaks list" 
                      loading="lazy"
                      decoding="async"
                      className="w-[165%] max-w-none h-full object-cover object-left" 
                    />
                  </div>
                </div>
              </div>

              {/* Section: Revenue Priority */}
              <div className="grid gap-12 lg:grid-cols-[0.58fr_0.42fr] lg:items-center">
                <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70 lg:order-first">
                  <img src={REVENUE_IMAGE} alt="Rejourney revenue growth dashboard with revenue trend and release markers" loading="lazy" decoding="async" className="w-full rounded-[1.35rem] object-cover" />
                </div>
                <div className="space-y-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Revenue priority</p>
                  <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                    The issues are ranked by business impact.
                  </h3>
                  <p className="text-base font-medium leading-8 text-slate-600">
                    Marlin can tell the difference between cosmetic noise and a checkout path that blocks revenue. Revenue movement, affected cohorts, and release timing travel into the GitHub suggestion so engineers know why the fix should move now.
                  </p>
                </div>
              </div>

              {/* Section: Stability Evidence */}
              <div className="grid gap-12 lg:grid-cols-[0.42fr_0.58fr] lg:items-center">
                <div className="space-y-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Stability evidence</p>
                  <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                    Crashes, ANRs, and API spikes become fix paths too.
                  </h3>
                  <p className="text-base font-medium leading-8 text-slate-600">
                    When the leak is technical, Marlin uses the same issue feed to connect stack traces, device cohorts, endpoint spikes, and replay context to likely files. The result is a focused repair brief instead of a vague stability ticket.
                  </p>
                </div>
                <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70">
                  <img src={STABILITY_IMAGE} alt="Rejourney stability monitoring table with crashes, ANRs, API spikes, events, and affected users" loading="lazy" decoding="async" className="w-full rounded-[1.35rem] object-cover" />
                </div>
              </div>

              {/* Section: IDE Handoff */}
              <div className="grid gap-12 lg:grid-cols-[0.58fr_0.42fr] lg:items-center">
                <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70 lg:order-first">
                  <img src={CONTEXT_HANDOFF_IMAGE} alt="Rejourney Markdown context handoff showing Copy md and Open Cursor options" loading="lazy" decoding="async" className="w-full rounded-[1.35rem] object-cover" />
                </div>
                <div className="space-y-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">IDE Handoff</p>
                  <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                    Generate a copyable .MD context file for your coding agent.
                  </h3>
                  <p className="text-base font-medium leading-8 text-slate-600">
                    Once the issue is analyzed, Marlin packs the entire diagnostic context—replay events, affected user sessions, and console stack traces—into an LLM-optimized Markdown payload. Copy it straight to your clipboard to paste into Cursor, Claude, or Copilot for an instant, precise code fix.
                  </p>
                </div>
              </div>

              {/* Section: Conversion Growth */}
              <div className="grid gap-12 lg:grid-cols-[0.42fr_0.58fr] lg:items-center">
                <div className="space-y-4">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Growth impact</p>
                  <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                    Watch the conversion and growth impact.
                  </h3>
                  <p className="text-base font-medium leading-8 text-slate-600">
                    Track conversion recovery, regional cohorts, and revenue movement in real time. Verify that released fixes actually restored conversions and healed the leak.
                  </p>
                </div>
                <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70">
                  <img src={GEO_IMAGE} alt="Rejourney geographical growth dashboard showing conversion recovery by region" loading="lazy" decoding="async" className="w-full rounded-[1.35rem] object-cover" />
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
