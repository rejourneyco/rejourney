import type { MetaFunction } from "react-router";
import { Footer } from "~/shell/components/layout/Footer";
import { Header } from "~/shell/components/layout/Header";
import { PerformanceMetrics } from "~/features/public/home/components/PerformanceMetrics";
import {
  MARKETING_LOCALES,
  SITE_URL,
  getMarketingHomeCopy,
} from "~/shared/lib/internationalMarketing";

export const meta: MetaFunction = () => {
  const canonicalUrl = `${SITE_URL}/benchmarks`;
  const title = "Rejourney Benchmarks | SDK Size and Runtime Cost";
  const description =
    "Review Rejourney benchmark data for SDK bundle size, upload weight, script time, task duration, and heap usage across mobile and web apps.";

  return [
    { title },
    { name: "description", content: description },
    {
      name: "keywords",
      content:
        "Rejourney benchmarks, SDK performance, session replay bundle size, web analytics benchmark, mobile SDK size",
    },
    { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonicalUrl },
    { property: "og:type", content: "website" },
    { property: "og:image", content: `${SITE_URL}/images/growth-engines.png` },
    { property: "og:image:alt", content: "Rejourney benchmark and analytics preview" },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: `${SITE_URL}/images/growth-engines.png` },
    { tagName: "link", rel: "canonical", href: canonicalUrl },
  ];
};

export default function BenchmarksPage() {
  const copy = getMarketingHomeCopy(MARKETING_LOCALES.en).performance;

  return (
    <div className="public-readable-scope min-h-screen overflow-x-hidden bg-white text-slate-950">
      <Header noSpacer />
      <main aria-label="Rejourney benchmarks">
        <section className="px-5 pb-4 pt-32 text-center sm:px-8 sm:pt-40 lg:px-10">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Benchmarks</p>
            <h1 className="mt-4 font-display text-4xl font-extrabold tracking-normal text-slate-950 sm:text-6xl">
              Lightweight replay, measured.
            </h1>
            <p className="mt-5 text-lg font-medium leading-8 text-slate-600">
              Rejourney publishes SDK size and web analytics benchmark data so teams can understand capture overhead before rolling it into production.
            </p>
          </div>
        </section>
        <PerformanceMetrics copy={copy} />
      </main>
      <Footer />
    </div>
  );
}
