import React from "react";
import { Link, useLocation } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  ArrowRight,
  BadgeDollarSign,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleMinus,
  ExternalLink,
  Gauge,
  GitBranch,
  Infinity,
  Layers3,
  PlayCircle,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Header } from "~/shell/components/layout/Header";
import { Footer } from "~/shell/components/layout/Footer";
import { SITE_URL } from "~/shared/lib/internationalMarketing";
import { getSeoPageByPath, type SeoComparisonValue, type SeoPage } from "./seoPages";

const iconCycle = [PlayCircle, Infinity, Users, Layers3, Gauge, GitBranch];

const normalizePath = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname);

const alternativeTldrByPath: Record<string, string> = {
  "/alternatives/posthog-session-replay":
    "Choose Rejourney when session evidence, mobile stability, API context, and lightweight suite matter more than PostHog's OS and broader product set.",
  "/alternatives/sentry-session-replay":
    "Choose Rejourney when replay needs to explain product behavior, journeys, heatmaps, and API friction, not technical depth of issues.",
  "/alternatives/datadog-session-replay":
    "Choose Rejourney when product and support teams need a focused replay workspace instead of adopting Datadog's full observability suite.",
  "/alternatives/amplitude-session-replay":
    "Choose Rejourney when replay, stability, API context, and mobile evidence need to sit beside analytics without an enterprise analytics rollout.",
  "/alternatives/mixpanel-session-replay":
    "Choose Rejourney for a more indie-friendly yet full experience instead of deep enterprise software.",
  "/alternatives/pendo-session-replay":
    "Choose Rejourney when you need session evidence and technical context more than guides, surveys, and product adoption messaging.",
  "/alternatives/fullstory":
    "Choose Rejourney when you want one of the leaner Fullstory alternatives with source visibility, self-hosting, and mobile stability context.",
  "/alternatives/smartlook":
    "Choose Rejourney when Smartlook's Cisco end-of-life path creates migration risk and your team still needs replay, heatmaps, journeys, mobile evidence, and technical context.",
  "/alternatives/hotjar":
    "Choose Rejourney when heatmaps and recordings need replay, journeys, mobile context, and technical evidence in the same workflow.",
};

type FeatureDisplay = {
  title: string;
  subtitle: string;
  guideTitle: string;
  fitTitle: string;
  tradeoffTitle: string;
  heroBullets: string[];
  available: string[];
  showcaseTabs: string[];
  showcaseTitle: string;
  showcaseCopy: string;
  showcaseBullets: string[];
  supportingImages?: Array<{
    src: string;
    alt: string;
    title: string;
    copy: string;
  }>;
  steps: string[];
};

const defaultFeatureTabs = ["Watch sessions", "Find drop-offs", "Review launches", "Debug stability", "Share evidence"];

const featureDisplayByPath: Record<string, FeatureDisplay> = {
  "/record-user-sessions": {
    title: "Record user sessions",
    subtitle: "Find user friction with replay, real user sessions, heatmaps, journeys, crashes, and network context.",
    guideTitle: "From recorded session to fix",
    fitTitle: "Best fit",
    tradeoffTitle: "Not the best fit",
    heroBullets: [
      "Record user sessions on web and mobile",
      "Find rage clicks and friction points",
      "Jump from user behavior to metrics",
    ],
    available: ["Web apps", "Mobile apps", "Self-hosting"],
    showcaseTabs: defaultFeatureTabs,
    showcaseTitle: "See what happened before the complaint",
    showcaseCopy: "Start with the web or mobile session recording, then inspect the surrounding journey, heatmap, crash, ANR, and network context.",
    showcaseBullets: ["Identify user pain points", "Validate design changes", "Give product, support, and engineering the same evidence"],
    steps: ["Install the SDK", "Capture real user sessions", "Review and share the evidence"],
  },
  "/mobile-session-replay": {
    title: "Mobile session replay",
    subtitle: "Watch taps, swipes, crashes, ANRs, and slow moments from real app sessions.",
    guideTitle: "Mobile needs context",
    fitTitle: "Best fit",
    tradeoffTitle: "Use web-first tools when",
    heroBullets: ["Record taps and gestures", "Inspect crashes and ANRs", "Support React Native, Expo, and iOS"],
    available: ["React Native", "Expo", "iOS"],
    showcaseTabs: ["Watch taps", "Find rage taps", "Trace screens", "Debug ANRs", "Share sessions"],
    showcaseTitle: "Understand mobile behavior",
    showcaseCopy: "Replay is paired with device, screen, journey, heatmap, and stability context so mobile issues are easier to reproduce.",
    showcaseBullets: ["See screen-level friction", "Connect replay to crashes", "Review mobile journeys faster"],
    steps: ["Add the mobile SDK", "Capture real app sessions", "Open replay with stability context"],
  },
  "/web-session-replay": {
    title: "Web session replay",
    subtitle: "See the clicks, requests, journeys, and UI states behind website friction.",
    guideTitle: "Beyond pageviews",
    fitTitle: "Best fit",
    tradeoffTitle: "Analytics alone works when",
    heroBullets: ["Record browser sessions", "Connect clicks to requests", "Review funnels and journeys"],
    available: ["Web apps", "Websites", "SPAs"],
    showcaseTabs: ["Watch clicks", "Find drop-offs", "Inspect requests", "Review heatmaps", "Share clips"],
    showcaseTitle: "Explain the click path",
    showcaseCopy: "Browser replay becomes useful when it sits beside events, network context, heatmaps, and the path users took.",
    showcaseBullets: ["Find broken UI states", "Inspect failed requests", "Review checkout and signup friction"],
    steps: ["Install the web SDK", "Capture browser behavior", "Review replay with analytics"],
  },
  "/replay-first-mentality": {
    title: "Replay-first mentality",
    subtitle: "Start product decisions with what users actually saw.",
    guideTitle: "Start with the session",
    fitTitle: "Best fit",
    tradeoffTitle: "Charts are enough when",
    heroBullets: ["Watch before deciding", "Connect sessions to metrics", "Align product and engineering"],
    available: ["Product", "Support", "Engineering"],
    showcaseTabs: ["Observe", "Question", "Validate", "Prioritize", "Ship"],
    showcaseTitle: "Make replay the starting point",
    showcaseCopy: "A replay-first workflow keeps teams grounded in real behavior before they debate metrics or roadmap bets.",
    showcaseBullets: ["Reduce guessing", "Share the same evidence", "Turn sessions into action"],
    steps: ["Pick a key flow", "Watch real sessions", "Prioritize the repeated friction"],
  },
  "/importance-of-open-source": {
    title: "Open source replay",
    subtitle: "More visibility and control for behavioral product data.",
    guideTitle: "Control matters",
    fitTitle: "Best fit",
    tradeoffTitle: "Closed SaaS works when",
    heroBullets: ["Inspect how capture works", "Self-host when needed", "Keep control of replay data"],
    available: ["Open source", "Cloud", "Self-hosted"],
    showcaseTabs: ["Audit", "Host", "Control", "Extend", "Scale"],
    showcaseTitle: "Own the replay workflow",
    showcaseCopy: "Replay data is close to users. Open source gives technical teams more confidence in capture, deployment, and long-term control.",
    showcaseBullets: ["Review SDK behavior", "Choose deployment model", "Avoid opaque workflow lock-in"],
    steps: ["Review the source", "Choose cloud or self-host", "Invite the full team"],
  },
  "/what-is-session-replay": {
    title: "What is session replay?",
    subtitle: "A practical guide to watching real user sessions with useful context.",
    guideTitle: "The short version",
    fitTitle: "Best fit",
    tradeoffTitle: "Skip replay when",
    heroBullets: ["Reconstruct real sessions", "Pair replay with events", "Explain what users experienced"],
    available: ["Web apps", "Mobile apps", "Product teams"],
    showcaseTabs: ["Capture", "Replay", "Inspect", "Understand", "Act"],
    showcaseTitle: "Replay shows the moment",
    showcaseCopy: "Session replay helps teams move from vague reports to the exact path, screen, click, tap, or error a user experienced.",
    showcaseBullets: ["See the user's path", "Attach events and errors", "Find repeated friction"],
    steps: ["Install an SDK", "Capture sessions", "Review patterns with your team"],
  },
  "/how-to-see-what-your-users-do": {
    title: "See what users do",
    subtitle: "Use sessions, journeys, heatmaps, events, crashes, and API context.",
    guideTitle: "Less guessing",
    fitTitle: "Best fit",
    tradeoffTitle: "Indirect signals work when",
    heroBullets: ["Watch real behavior", "Map journeys and heatmaps", "Connect product and system context"],
    available: ["Web apps", "Mobile apps", "Support"],
    showcaseTabs: ["Watch", "Map", "Filter", "Debug", "Share"],
    showcaseTitle: "Move from reports to reality",
    showcaseCopy: "Use replay to see what happened, then journeys, heatmaps, events, crashes, and requests to understand why it repeated.",
    showcaseBullets: ["Find real user paths", "Spot repeated friction", "Connect behavior to errors"],
    steps: ["Capture user sessions", "Filter for friction", "Share the session with context"],
  },
  "/be-your-users": {
    title: "Be your users",
    subtitle: "Watch the product from the user's side before shipping.",
    guideTitle: "Real sessions sharpen empathy",
    fitTitle: "Best fit",
    tradeoffTitle: "Skip session review when",
    heroBullets: ["Review real sessions", "Catch confusing moments", "Ship with sharper evidence"],
    available: ["PMs", "Design", "Engineering"],
    showcaseTabs: ["Watch", "Notice", "Discuss", "Fix", "Ship"],
    showcaseTitle: "See the product from their side",
    showcaseCopy: "Replay makes user empathy concrete: the hesitation, the missed affordance, the repeated tap, and the path that felt obvious only internally.",
    showcaseBullets: ["Watch real product use", "Reduce assumption-led debates", "Find small moments that block users"],
    steps: ["Choose a release flow", "Watch sessions together", "Fix the repeated confusion"],
  },
};

function featureDisplay(page: SeoPage) {
  return featureDisplayByPath[page.path] ?? {
    title: page.title,
    subtitle: page.subtitle,
    guideTitle: page.whyTitle,
    fitTitle: "Best fit",
    tradeoffTitle: page.chooseOtherTitle,
    available: ["Web apps", "Mobile apps"],
    showcaseTabs: defaultFeatureTabs,
    showcaseTitle: page.whyTitle,
    showcaseCopy: page.whyParagraphs[0] ?? page.subtitle,
    showcaseBullets: page.chooseRejourney.slice(0, 3),
    steps: ["Install the SDK", "Capture sessions", "Review with your team"],
  };
}

type FeatureImage = {
  src: string;
  alt: string;
  title: string;
  copy: string;
};

const defaultFeatureImages: FeatureImage[] = [
  {
    src: "/images/session-replay-preview.png",
    alt: "Rejourney session replay with timeline and user context",
    title: "Replay",
    copy: "Watch the real session before deciding what the metric means.",
  },
  {
    src: "/images/heatmaps.png",
    alt: "Rejourney heatmap analytics view",
    title: "Heatmaps",
    copy: "See where attention and friction cluster across screens.",
  },
  {
    src: "/images/user-journeys.png",
    alt: "Rejourney user journey analytics",
    title: "Journeys",
    copy: "Move from one session to the repeated path behind it.",
  },
];

const featureImagesByPath: Record<string, FeatureImage[]> = {
  "/mobile-session-replay": [
    {
      src: "/images/heatmaps.png",
      alt: "Rejourney mobile heatmap screen analytics",
      title: "Touch heatmaps",
      copy: "Understand where users tap, hesitate, and repeat gestures.",
    },
    {
      src: "/images/anr-issues.png",
      alt: "Rejourney ANR issue details",
      title: "ANR context",
      copy: "Pair replay with app stability signals when the experience freezes.",
    },
    {
      src: "/images/user-journeys.png",
      alt: "Rejourney mobile user journey map",
      title: "Mobile journeys",
      copy: "Review screen paths before and after friction appears.",
    },
  ],
  "/web-session-replay": [
    {
      src: "/images/landing-replay-theater.png",
      alt: "Rejourney browser session replay theater",
      title: "Browser replay",
      copy: "See clicks, pages, and UI state as the user experienced them.",
    },
    {
      src: "/images/readme-general-demo.png",
      alt: "Rejourney web analytics dashboard",
      title: "Web analytics",
      copy: "Keep replay close to traffic, routes, and product events.",
    },
    {
      src: "/images/engineering/ambiguity-api-error-rate-by-country.png",
      alt: "Rejourney API error analytics by country",
      title: "Network context",
      copy: "Connect confusing behavior to failed or slow requests.",
    },
  ],
  "/replay-first-mentality": [
    {
      src: "/images/hero-replay-workbench.png",
      alt: "Rejourney replay workbench",
      title: "Start with replay",
      copy: "Use the real session as the first piece of evidence.",
    },
    {
      src: "/images/growth-engines.png",
      alt: "Rejourney growth analytics view",
      title: "Then zoom out",
      copy: "Use analytics to see whether the same behavior repeats.",
    },
    {
      src: "/images/team-alerts.png",
      alt: "Rejourney team alert workflow",
      title: "Share the signal",
      copy: "Bring the same context to product, support, and engineering.",
    },
  ],
  "/importance-of-open-source": [
    {
      src: "/images/readme-user-journeys.png",
      alt: "Rejourney open-source user journeys view",
      title: "Source-visible workflow",
      copy: "Keep the replay workflow inspectable and understandable.",
    },
    {
      src: "/images/session-replay-preview.png",
      alt: "Rejourney session replay preview",
      title: "Replay data",
      copy: "Review the behavior data your team depends on.",
    },
    {
      src: "/images/readme-alert-emails.png",
      alt: "Rejourney alert email preview",
      title: "Operational control",
      copy: "Build a workflow that can fit cloud or self-hosted needs.",
    },
  ],
  "/what-is-session-replay": [
    {
      src: "/images/landing-replay-theater.png",
      alt: "Rejourney session replay theater",
      title: "The session",
      copy: "Replay reconstructs the actual experience.",
    },
    {
      src: "/images/readme-general-demo.png",
      alt: "Rejourney analytics overview",
      title: "The context",
      copy: "Events and metrics explain what happened around it.",
    },
    {
      src: "/images/issues-feed.png",
      alt: "Rejourney issues feed",
      title: "The issue",
      copy: "Crashes and errors explain when the system shaped the experience.",
    },
  ],
  "/how-to-see-what-your-users-do": defaultFeatureImages,
  "/be-your-users": [
    {
      src: "/images/hero-replay-workbench.png",
      alt: "Rejourney replay workbench",
      title: "Observe",
      copy: "Watch the product from outside the team's assumptions.",
    },
    {
      src: "/images/user-journeys.png",
      alt: "Rejourney user journey view",
      title: "Discuss",
      copy: "Use the journey to align the team on what happened.",
    },
    {
      src: "/images/growth-engines.png",
      alt: "Rejourney product analytics view",
      title: "Decide",
      copy: "Tie empathy back to the product pattern.",
    },
  ],
};

function featureImages(page: SeoPage) {
  return featureImagesByPath[page.path] ?? defaultFeatureImages;
}

const alternativeQuickScanImages: Record<string, FeatureImage> = {
  "/alternatives/posthog-session-replay": {
    src: "/images/readme-general-demo.png",
    alt: "Rejourney analytics overview with replay evidence",
    title: "Analytics overview",
    copy: "Use a different product view in the TLDR card.",
  },
  "/alternatives/sentry-session-replay": {
    src: "/images/issues-feed.png",
    alt: "Rejourney issues feed with replay-backed triage",
    title: "Issues feed",
    copy: "Show triage context instead of repeating the hero.",
  },
  "/alternatives/datadog-session-replay": {
    src: "/images/engineering/ambiguity-api-error-rate-by-country.png",
    alt: "Rejourney API error analytics by country",
    title: "API context",
    copy: "Show network context beside replay positioning.",
  },
  "/alternatives/amplitude-session-replay": {
    src: "/images/user-journeys.png",
    alt: "Rejourney user journey map",
    title: "User journeys",
    copy: "Pair growth analytics with journey evidence.",
  },
  "/alternatives/mixpanel-session-replay": {
    src: "/images/growth-engines.png",
    alt: "Rejourney growth analytics dashboard",
    title: "Growth analytics",
    copy: "Use product analytics as the supporting visual.",
  },
  "/alternatives/pendo-session-replay": {
    src: "/images/readme-alert-emails.png",
    alt: "Rejourney alert email preview",
    title: "Team alerts",
    copy: "Show workflow context for product teams.",
  },
  "/alternatives/fullstory": {
    src: "/images/session-replay-preview.png",
    alt: "Rejourney session replay preview with timeline",
    title: "Replay preview",
    copy: "Use a separate replay screenshot from the hero workbench.",
  },
  "/alternatives/smartlook": {
    src: "/images/engineering/smartlook-alternatives-heatmaps.png",
    alt: "Rejourney live demo heatmap dashboard with priority route context",
    title: "Heatmap context",
    copy: "Show visual behavior evidence beside migration positioning.",
  },
  "/alternatives/hotjar": {
    src: "/images/engineering/hotjar-alternatives-replay.png",
    alt: "Rejourney live demo replay workbench with mobile replay and event context",
    title: "Replay workbench",
    copy: "Show session evidence beside heatmap positioning.",
  },
};

function alternativeQuickScanImage(page: SeoPage): FeatureImage {
  const configuredImage = alternativeQuickScanImages[page.path];
  if (configuredImage && configuredImage.src !== page.image) return configuredImage;

  return (
    defaultFeatureImages.find((image) => image.src !== page.image) ?? {
      src: "/images/readme-general-demo.png",
      alt: "Rejourney product analytics and replay dashboard",
      title: "Product context",
      copy: "Fallback supporting image.",
    }
  );
}

export function loader({ request }: LoaderFunctionArgs) {
  const page = getSeoPageByPath(new URL(request.url).pathname);
  if (!page) {
    throw new Response("Not Found", { status: 404 });
  }

  return null;
}

export const meta: MetaFunction = ({ location }) => {
  const page = getSeoPageByPath(location.pathname);
  if (!page) {
    return [
      { title: "Rejourney" },
      { name: "robots", content: "noindex, follow" },
    ];
  }

  const canonicalUrl = `${SITE_URL}${page.path}`;
  return [
    { title: page.metaTitle },
    { name: "description", content: page.metaDescription },
    { name: "keywords", content: page.keywords.join(", ") },
    { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
    { httpEquiv: "Content-Language", content: "en-US" },
    { property: "og:locale", content: "en_US" },
    { property: "og:title", content: page.metaTitle },
    { property: "og:description", content: page.metaDescription },
    { property: "og:url", content: canonicalUrl },
    { property: "og:type", content: "website" },
    { property: "og:image", content: `${SITE_URL}${page.image}` },
    { property: "og:image:alt", content: page.imageAlt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: page.metaTitle },
    { name: "twitter:description", content: page.metaDescription },
    { name: "twitter:image", content: `${SITE_URL}${page.image}` },
    { tagName: "link", rel: "canonical", href: canonicalUrl },
  ];
};

function valueLabel(value: SeoComparisonValue) {
  if (value === "yes") return "Included";
  if (value === "partial") return "Partial";
  if (value === "no") return "No";
  return value;
}

function ValueBadge({ value }: { value: SeoComparisonValue }) {
  const label = valueLabel(value);
  const isYes = value === "yes";
  const isNo = value === "no";
  const Icon = isYes ? Check : isNo ? X : CircleMinus;
  const className = isYes
    ? "border-emerald-700 bg-emerald-100 text-emerald-950"
    : isNo
      ? "border-rose-300 bg-rose-50 text-rose-800"
      : "border-amber-400 bg-amber-100 text-amber-950";

  return (
    <span className={`inline-flex min-h-10 w-full max-w-[11rem] items-center justify-center gap-2 border-2 px-3 py-2 text-sm font-extrabold leading-none ${className}`}>
      <Icon className="h-4 w-4 shrink-0" strokeWidth={3} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

function SectionHeader({ eyebrow, title, copy }: { eyebrow: string; title: string; copy?: string }) {
  return (
    <div className="mx-auto max-w-4xl text-center">
      <p className="inline-flex border-2 border-black bg-[#67e8f9] px-3 py-1 font-mono text-[10px] font-black uppercase text-black shadow-neo-sm">
        {eyebrow}
      </p>
      <h2 className="mt-4 text-3xl font-black uppercase leading-tight text-slate-950 sm:text-5xl">{title}</h2>
      {copy ? <p className="mt-5 text-base font-semibold leading-7 text-slate-600 sm:text-lg">{copy}</p> : null}
    </div>
  );
}



function CategoryHeroBullets({ page }: { page: SeoPage }) {
  const display = featureDisplay(page);

  return (
    <ul className="mt-8 grid max-w-2xl gap-3 border-l-2 border-black pl-5">
      {display.heroBullets.map((item) => (
        <li key={item} className="text-base font-black leading-6 text-slate-900">
          {item}
        </li>
      ))}
    </ul>
  );
}

function CategoryAvailability({ page }: { page: SeoPage }) {
  const display = featureDisplay(page);

  return (
    <div className="mt-7">
      <p className="font-mono text-[10px] font-black uppercase text-slate-500">Available for</p>
      <div className="mt-3 flex flex-wrap gap-3">
        {display.available.map((item) => (
          <span key={item} className="rounded-lg border-2 border-black bg-white px-4 py-2 text-xs font-bold text-slate-800">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function HeroVisual({ page }: { page: SeoPage }) {
  if (page.kind === "category") {
    return (
      <figure className="rounded-lg border-2 border-black bg-[#dbeafe] p-4 lg:justify-self-end">
        <img
          src={page.image}
          alt={page.imageAlt}
          className="h-auto max-h-[430px] w-full object-contain object-left-top lg:max-w-[560px]"
        />
      </figure>
    );
  }

  return (
    <div className="relative">
      <div className="absolute -right-3 -top-3 h-16 w-24 rotate-[5deg] border-2 border-black bg-[#86efac] shadow-neo-sm" aria-hidden />
      <div className="relative overflow-hidden border-2 border-black bg-white p-3 shadow-neo">
        <div className="border-2 border-black bg-[#ecfeff] p-2">
          <img src={page.image} alt={page.imageAlt} className="h-auto max-h-[420px] w-full object-contain object-left-top" />
        </div>
      </div>
    </div>
  );
}

function AlternativeQuickScan({ page }: { page: SeoPage }) {
  const tldr = alternativeTldrByPath[page.path] ?? page.subtitle;
  const quickScanImage = alternativeQuickScanImage(page);

  return (
    <section className="border-b-2 border-black bg-white px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-stretch">
        <div className="border-2 border-black bg-[#86efac] p-6 shadow-neo-sm sm:p-8">
          <p className="font-mono text-[10px] font-black uppercase text-slate-700">TLDR</p>
          <p className="mt-3 max-w-5xl text-2xl font-black leading-tight text-slate-950 sm:text-3xl">
            {tldr}
          </p>

        </div>

        <div className="hidden overflow-hidden border-2 border-black bg-[#ecfeff] p-3 shadow-neo-sm lg:block">
          <img src={quickScanImage.src} alt={quickScanImage.alt} className="h-full max-h-56 w-full object-contain object-left-top" />
        </div>
      </div>
    </section>
  );
}

function AlternativeFeatureDifferences({ page }: { page: SeoPage }) {
  if (page.kind !== "alternative" || !page.featureDifferences?.length) return null;

  return (
    <section className="border-b-2 border-black bg-[#f8fafc] px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 lg:grid-cols-[0.42fr_1fr] lg:items-start">
          <div>
            <p className="inline-flex border-2 border-black bg-[#fef08a] px-3 py-1 font-mono text-[10px] font-black uppercase text-black shadow-neo-sm">
              Feature differences
            </p>
            <h2 className="mt-4 text-3xl font-black uppercase leading-tight text-slate-950 sm:text-5xl">
              Core
            </h2>
            <p className="mt-5 text-base font-semibold leading-8 text-slate-600">
              Core usage, team needs, and product mentality. 
            </p>
          </div>

          <div className="overflow-hidden border-2 border-black bg-white shadow-neo-sm">
            <div className="grid grid-cols-[0.5fr_1fr_1fr] border-b-2 border-black bg-slate-950 text-white">
              <div className="p-3 font-mono text-[10px] font-black uppercase sm:p-4">Area</div>
              <div className="border-l-2 border-black p-3 font-mono text-[10px] font-black uppercase sm:p-4">Rejourney</div>
              <div className="border-l-2 border-black p-3 font-mono text-[10px] font-black uppercase sm:p-4">{page.otherColumnTitle}</div>
            </div>
            {page.featureDifferences.map((row, index) => (
              <div key={row.feature} className={`grid grid-cols-[0.5fr_1fr_1fr] ${index < page.featureDifferences!.length - 1 ? "border-b border-slate-200" : ""}`}>
                <div className="p-3 text-sm font-black uppercase leading-tight text-slate-900 sm:p-4">{row.feature}</div>
                <div className="border-l border-slate-200 p-3 text-sm font-semibold leading-6 text-slate-700 sm:p-4">
                  {row.rejourney}
                </div>
                <div className="border-l border-slate-200 p-3 text-sm font-semibold leading-6 text-slate-700 sm:p-4">
                  {row.other}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function WhySection({ page }: { page: SeoPage }) {
  return (
    <section className="border-b-2 border-black bg-white px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.65fr)] lg:items-start">
        <div>
          <p className="inline-flex border-2 border-black bg-[#c4b5fd] px-3 py-1 font-mono text-[10px] font-black uppercase text-black shadow-neo-sm">
            {page.kind === "alternative" ? "Why Rejourney" : "Why switch"}
          </p>
          <h2 className="mt-4 text-3xl font-black uppercase leading-tight text-slate-950 sm:text-5xl">
            {page.whyTitle}
          </h2>
          <div className="mt-6 space-y-5 text-base font-semibold leading-8 text-slate-600">
            {page.whyParagraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </div>
        <div className="border-2 border-black bg-[#f8fafc] p-5 shadow-neo-sm">
          <p className="font-mono text-[10px] font-black uppercase text-slate-500">Included advantages</p>
          <div className="mt-5 grid gap-3">
            {[
              "Replay-first session review",
              "Product analytics tied to real sessions",
              "Heatmaps and journey maps",
              "Crash, ANR, and API context",
              "Privacy controls for replay capture",
            ].map((item) => (
              <div key={item} className="flex items-start gap-3 border-2 border-black bg-white p-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" strokeWidth={3} aria-hidden />
                <span className="text-sm font-black uppercase leading-5 text-slate-800">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ComparisonSection({ page }: { page: SeoPage }) {
  const isAlternative = page.kind === "alternative";
  const title = isAlternative ? "Core Feature List Comparison" : page.comparisonTitle;
  const copy = isAlternative
    ? "Features and Mentality."
    : page.comparisonIntro;

  return (
    <section className="border-b-2 border-black bg-white px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader eyebrow={isAlternative ? "Core features" : "Comparison"} title={title} copy={copy} />
        <div className="mt-10 overflow-hidden border-2 border-black bg-white shadow-neo-sm">
          <div className="overflow-x-auto">
            <div className="min-w-[680px]">
              <div className="grid grid-cols-[minmax(260px,1.15fr)_minmax(170px,0.72fr)_minmax(170px,0.72fr)] border-b-2 border-black bg-slate-950 text-white">
                <div className="px-4 py-4 text-sm font-extrabold uppercase leading-none sm:px-5">Capability</div>
                <div className="border-l-2 border-black px-4 py-4 text-sm font-extrabold uppercase leading-none sm:px-5">Rejourney</div>
                <div className="border-l-2 border-black px-4 py-4 text-sm font-extrabold uppercase leading-none sm:px-5">{page.otherColumnTitle}</div>
              </div>
              {page.comparisonRows.map((row, index) => (
                <div
                  key={row.feature}
                  className={`grid grid-cols-[minmax(260px,1.15fr)_minmax(170px,0.72fr)_minmax(170px,0.72fr)] items-stretch ${
                    index < page.comparisonRows.length - 1 ? "border-b border-slate-200" : ""
                  } ${index % 2 === 0 ? "bg-white" : "bg-slate-50"}`}
                >
                  <div className="flex items-center px-4 py-4 text-base font-bold leading-6 text-slate-950 sm:px-5">
                    {row.feature}
                  </div>
                  <div className="flex items-center border-l border-slate-200 px-4 py-4 sm:px-5">
                    <ValueBadge value={row.rejourney} />
                  </div>
                  <div className="flex items-center border-l border-slate-200 px-4 py-4 sm:px-5">
                    <ValueBadge value={row.other} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PricingSection({ page }: { page: SeoPage }) {
  if (page.kind === "alternative") {
    const competitorFacts = page.competitorFacts ?? [];
    const pricingBullets = page.pricingBullets.slice(0, 4);

    return (
      <section className="border-b-2 border-black bg-[#ecfeff] px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[0.46fr_1fr] lg:items-start">
            <div>
              <p className="inline-flex border-2 border-black bg-[#fef08a] px-3 py-1 font-mono text-[10px] font-black uppercase text-black shadow-neo-sm">
                Pricing comparison
              </p>
              <h2 className="mt-4 text-3xl font-black uppercase leading-tight text-slate-950 sm:text-5xl">Pricing Comparison</h2>
              <p className="mt-5 text-base font-semibold leading-8 text-slate-700">{page.pricingIntro}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  to="/pricing"
                  className="inline-flex min-h-11 items-center justify-center gap-2 border-2 border-black bg-white px-4 py-2 text-xs font-black uppercase text-black shadow-neo-sm transition hover:bg-[#86efac]"
                >
                  Rejourney pricing
                  <ArrowRight className="h-4 w-4" strokeWidth={3} aria-hidden />
                </Link>
                {page.officialSources?.map((source) => (
                  <a
                    key={source.href}
                    href={source.href}
                    className="inline-flex min-h-11 items-center justify-center gap-2 border-2 border-black bg-white px-4 py-2 text-xs font-black uppercase text-black shadow-neo-sm transition hover:bg-[#fef08a]"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.label}
                    <ExternalLink className="h-4 w-4" strokeWidth={3} aria-hidden />
                  </a>
                ))}
              </div>
            </div>

            <div className="overflow-hidden border-2 border-black bg-white shadow-neo-sm">
              <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(280px,0.82fr)]">
                <div className="flex min-h-full flex-col">
                  <div className="border-b-2 border-black bg-slate-950 px-4 py-4 text-sm font-extrabold uppercase leading-none text-white sm:px-5">
                    Competitor facts
                  </div>
                  <div className="flex-1 divide-y divide-slate-200">
                    {competitorFacts.map((fact, index) => (
                      <div key={fact} className={`flex gap-4 p-4 sm:p-5 ${index % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                        <span className="grid h-8 w-8 shrink-0 place-items-center border-2 border-black bg-[#fef08a] text-sm font-black leading-none text-black">
                          {index + 1}
                        </span>
                        <p className="text-base font-semibold leading-7 text-slate-900">{fact}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex min-h-full flex-col border-t-2 border-black md:border-l-2 md:border-t-0">
                  <div className="border-b-2 border-black bg-slate-950 px-4 py-4 text-sm font-extrabold uppercase leading-none text-white sm:px-5">
                    Rejourney model
                  </div>
                  <div className="flex-1 bg-[#fff7df] p-4 sm:p-5">
                    <ul className="grid gap-4">
                      {pricingBullets.map((bullet) => (
                        <li key={bullet} className="flex items-start gap-3 text-base font-semibold leading-7 text-slate-950">
                          <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-700" strokeWidth={3} aria-hidden />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="border-b-2 border-black bg-[#ecfeff] px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.75fr_1fr] lg:items-start">
        <div>
          <p className="inline-flex border-2 border-black bg-[#fef08a] px-3 py-1 font-mono text-[10px] font-black uppercase text-black shadow-neo-sm">
            Pricing
          </p>
          <h2 className="mt-4 text-3xl font-black uppercase leading-tight text-slate-950 sm:text-5xl">{page.pricingTitle}</h2>
          <p className="mt-5 text-base font-semibold leading-8 text-slate-700">{page.pricingIntro}</p>
          <Link
            to="/pricing"
            className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 border-2 border-black bg-white px-5 py-3 text-sm font-black uppercase text-black shadow-neo-sm transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#86efac] hover:shadow-neo active:translate-x-0 active:translate-y-0 active:shadow-none"
          >
            Compare pricing
            <ArrowRight className="h-4 w-4" strokeWidth={3} aria-hidden />
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {page.pricingBullets.map((bullet, index) => {
            const Icon = [Infinity, ShieldCheck, Users, Layers3][index % 4];
            return (
              <div key={bullet} className="border-2 border-black bg-white p-5 shadow-neo-sm">
                <div className="grid h-11 w-11 place-items-center border-2 border-black bg-[#c4b5fd]">
                  <Icon className="h-5 w-5" strokeWidth={3} aria-hidden />
                </div>
                <p className="mt-4 text-[15px] font-bold leading-7 text-slate-700">{bullet}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}


function CategoryNarrativeSection({ page }: { page: SeoPage }) {
  const display = featureDisplay(page);

  return (
    <section className="border-b-2 border-black bg-white px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.42fr_1fr] lg:items-start">
        <div>
          <p className="font-mono text-xs font-black uppercase text-slate-500">Why it matters</p>
          <h2 className="mt-4 max-w-lg text-3xl font-black leading-tight text-slate-950 sm:text-5xl">
            {display.guideTitle}
          </h2>
        </div>

        <div className="max-w-4xl space-y-6 text-lg font-semibold leading-9 text-slate-700">
          {page.whyParagraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </div>
    </section>
  );
}

function CategoryShowcaseSection({ page }: { page: SeoPage }) {
  const display = featureDisplay(page);

  return (
    <section className="border-b-2 border-black bg-[#edf4ff] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex gap-x-4 gap-y-2 overflow-x-auto border-b border-slate-300 pb-4 text-xs font-black uppercase sm:flex-wrap sm:overflow-visible">
          {display.showcaseTabs.map((tab, index) => (
            <span
              key={tab}
              className={`whitespace-nowrap ${
                index === 0 ? "text-slate-950" : "border-l border-slate-300 pl-4 text-slate-500"
              }`}
            >
              {tab}
            </span>
          ))}
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-center">
          <div className="rounded-lg border-2 border-black bg-[#dbeafe] p-5">
            <img
              src={page.image}
              alt={page.imageAlt}
              className="mx-auto h-auto max-h-[420px] w-full object-contain"
            />
          </div>

          <div className="rounded-lg border-2 border-black bg-white p-7 sm:p-10">
            <h2 className="max-w-xl text-3xl font-black leading-tight text-slate-950 sm:text-4xl">
              {display.showcaseTitle}
            </h2>
            <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-slate-700">
              {display.showcaseCopy}
            </p>
            <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-slate-700">
              {page.comparisonIntro}
            </p>
            <ul className="mt-7 grid gap-4">
              {display.showcaseBullets.map((item) => (
                <li key={item} className="border-l-2 border-black pl-4 text-base font-semibold leading-7 text-slate-800">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function CategoryImageGallerySection({ page }: { page: SeoPage }) {
  const supportingImages = featureImages(page);

  return (
    <section className="border-b-2 border-black bg-white px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-3xl">
          <p className="font-mono text-xs font-black uppercase text-slate-500">Product views</p>
          <h2 className="mt-4 text-3xl font-black leading-tight text-slate-950 sm:text-5xl">
            More context than a recording.
          </h2>
          <p className="mt-5 text-base font-semibold leading-7 text-slate-700 sm:text-lg sm:leading-8">
            A session is the starting point. Rejourney keeps the adjacent views close so the team can
            understand whether the issue is visual friction, a repeated journey, a crash, or a slow
            request.
          </p>
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-3">
          {supportingImages.map((image) => (
            <article key={image.src} className="min-w-0">
              <div className="border-2 border-black bg-[#dbeafe] p-4">
                <img src={image.src} alt={image.alt} className="h-56 w-full object-contain" />
              </div>
              <div className="mt-4 border-t-2 border-black pt-4">
                <h3 className="text-2xl font-black leading-tight text-slate-950">{image.title}</h3>
                <p className="mt-3 text-sm font-semibold leading-6 text-slate-700">{image.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function CategoryDecisionSection({ page }: { page: SeoPage }) {
  const display = featureDisplay(page);

  return (
    <section className="border-b-2 border-black bg-[#fafafa] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.42fr_1fr] lg:items-start">
        <div>
          <p className="font-mono text-xs font-black uppercase text-slate-500">How to decide</p>
          <h2 className="mt-4 max-w-lg text-3xl font-black leading-tight text-slate-950 sm:text-5xl">
            Where Rejourney fits
          </h2>
          <p className="mt-5 max-w-md text-base font-semibold leading-7 text-slate-600">
            The goal is not to collect more recordings. It is to help the team move from a real
            user moment to a product decision, support answer, or engineering fix.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="border-b-2 border-black pb-3 text-2xl font-black leading-tight text-slate-950">
              {display.fitTitle}
            </h3>
            <div className="divide-y divide-slate-300">
              {page.chooseRejourney.map((item) => (
                <p key={item} className="py-4 text-base font-semibold leading-7 text-slate-700">
                  {item}
                </p>
              ))}
            </div>
          </div>

          <div>
            <h3 className="border-b-2 border-black pb-3 text-2xl font-black leading-tight text-slate-950">
              {display.tradeoffTitle}
            </h3>
            <div className="divide-y divide-slate-300">
              {page.chooseOther.map((item) => (
                <p key={item} className="py-4 text-base font-semibold leading-7 text-slate-700">
                  {item}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CategoryGettingStartedSection({ page }: { page: SeoPage }) {
  const display = featureDisplay(page);

  return (
    <section className="border-b-2 border-black bg-white px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-8 lg:grid-cols-[0.42fr_1fr] lg:items-start">
          <div>
            <p className="font-mono text-xs font-black uppercase text-slate-500">Getting started</p>
            <h2 className="mt-3 text-3xl font-black leading-tight text-slate-950 sm:text-4xl">
              Easy to try. Easy to share.
            </h2>
            <p className="mt-5 max-w-md text-base font-semibold leading-7 text-slate-600">
              Rejourney is built for teams that want replay to become part of the weekly product
              workflow, not a separate tool people forget to open.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {display.steps.map((step, index) => (
              <div key={step} className="rounded-lg border-2 border-black bg-[#fff7df] p-5">
                <p className="font-mono text-sm font-black text-slate-500">0{index + 1}</p>
                <p className="mt-4 text-xl font-black leading-tight text-slate-950">{step}</p>
                <p className="mt-4 text-sm font-semibold leading-6 text-slate-700">
                  {index === 0
                    ? "Add the SDK to the product surface you want to understand first."
                    : index === 1
                      ? "Let sessions, events, journeys, and technical context build up naturally."
                      : "Use the replay and surrounding context to decide what needs attention."}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CategoryLimitsSection({ page }: { page: SeoPage }) {
  const limits = ["Unlimited events", "Unlimited retention", "Unlimited team members", "Unlimited projects"];

  return (
    <section className="border-b-2 border-black bg-[#ecfeff] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.42fr_1fr] lg:items-center">
        <div>
          <p className="font-mono text-xs font-black uppercase text-slate-500">Pricing</p>
          <h2 className="mt-3 text-3xl font-black leading-tight text-slate-950 sm:text-4xl">
            Simple limits.
          </h2>
          <Link
            to="/pricing"
            className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border-2 border-black bg-white px-5 py-2.5 text-sm font-black text-black transition hover:bg-[#86efac]"
          >
            View pricing
          </Link>
        </div>

        <div>
          <p className="max-w-3xl text-base font-semibold leading-7 text-slate-700">
            {page.pricingIntro}
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {limits.map((limit) => (
              <div key={limit} className="rounded-lg border-2 border-black bg-white px-5 py-4 text-base font-black text-slate-950">
                {limit}
              </div>
            ))}
          </div>
          <div className="mt-6 grid gap-3">
            {page.pricingBullets.slice(0, 2).map((bullet) => (
              <p key={bullet} className="border-l-2 border-black pl-4 text-sm font-semibold leading-6 text-slate-700">
                {bullet}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FaqSection({ page }: { page: SeoPage }) {
  const containerClass =
    page.kind === "category"
      ? "mt-10 divide-y-2 divide-black border-y-2 border-black bg-white"
      : "mt-10 divide-y-2 divide-black border-2 border-black bg-white shadow-neo-sm";
  const title = page.kind === "category" ? "FAQ" : "Frequently asked questions";

  return (
    <section className="border-b-2 border-black bg-white px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <SectionHeader eyebrow="FAQ" title={title} />
        <div className={containerClass}>
          {page.faq.map((item) => (
            <details key={item.question} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 marker:hidden sm:p-7">
                <h3 className="text-left text-lg font-black uppercase leading-tight text-slate-950 sm:text-xl">{item.question}</h3>
                <span className="grid h-9 w-9 shrink-0 place-items-center border-2 border-black bg-[#fef08a] transition group-open:rotate-180">
                  <ChevronDown className="h-5 w-5" strokeWidth={3} aria-hidden />
                </span>
              </summary>
              <div className="px-5 pb-5 pt-0 sm:px-7 sm:pb-7">
                <p className="border-t border-slate-200 pt-4 text-[15px] font-semibold leading-7 text-slate-600">{item.answer}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function RelatedResourcesSection({ page }: { page: SeoPage }) {
  if (page.kind === "category") {
    return (
      <section className="border-b-2 border-black bg-[#fff7df] px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[260px_1fr] lg:items-start">
          <div>
            <p className="font-mono text-xs font-black uppercase text-slate-500">Resources</p>
            <h2 className="mt-3 text-3xl font-black uppercase leading-tight text-slate-950 sm:text-4xl">
              Helpful Links
            </h2>
          </div>
          <div className="divide-y-2 divide-black border-y-2 border-black">
            {page.related.map((item) => (
              <Link
                key={item.href}
                to={item.href}
                className="group flex items-center justify-between gap-4 py-4"
              >
                <span className="text-lg font-black uppercase leading-tight text-slate-950">{item.label}</span>
                <span className="inline-flex items-center gap-2 text-xs font-black uppercase text-slate-950">
                  Open
                  {item.href.startsWith("http") ? (
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                  ) : (
                    <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" strokeWidth={3} aria-hidden />
                  )}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="border-b-2 border-black bg-[#fff7df] px-4 py-14 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader eyebrow="Resources" title="Related resources" />
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {page.related.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="group flex min-h-44 flex-col border-2 border-black bg-white p-5 shadow-neo-sm transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo"
            >
              <span className="text-lg font-black uppercase leading-tight text-slate-950">{item.label}</span>
              <span className="mt-3 text-sm font-semibold leading-6 text-slate-600">{item.description}</span>
              <span className="mt-auto inline-flex items-center gap-2 pt-5 text-xs font-black uppercase text-slate-950">
                Open
                {item.href.startsWith("http") ? (
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" strokeWidth={3} aria-hidden />
                )}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function SeoLandingPage() {
  const location = useLocation();
  const page = getSeoPageByPath(normalizePath(location.pathname));

  if (!page) return null;

  const categoryDisplay = page.kind === "category" ? featureDisplay(page) : null;
  const visibleBadge = page.badge.trim();
  const canonicalUrl = `${SITE_URL}${page.path}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: page.metaTitle,
        description: page.metaDescription,
        inLanguage: "en-US",
        isPartOf: {
          "@type": "WebSite",
          "@id": `${SITE_URL}/#website`,
          name: "Rejourney",
          url: `${SITE_URL}/`,
        },
        primaryImageOfPage: {
          "@type": "ImageObject",
          url: `${SITE_URL}${page.image}`,
        },
      },
      {
        "@type": "Service",
        "@id": `${canonicalUrl}#service`,
        name: page.kind === "alternative" ? page.title : "Rejourney session replay",
        serviceType: "Session replay and product analytics",
        provider: {
          "@type": "Organization",
          "@id": `${SITE_URL}/#organization`,
          name: "Rejourney",
          url: `${SITE_URL}/`,
        },
        url: canonicalUrl,
      },
      ...(page.path === "/record-user-sessions"
        ? [
            {
              "@type": "SoftwareApplication",
              "@id": `${SITE_URL}/#software`,
              name: "Rejourney",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web, iOS, Android",
              description: "Record user sessions with web and mobile session replay, heatmaps, user journeys, crash context, API context, product analytics, and privacy masking.",
              url: `${SITE_URL}/`,
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
                url: `${SITE_URL}/pricing`,
              },
              publisher: {
                "@type": "Organization",
                "@id": `${SITE_URL}/#organization`,
                name: "Rejourney",
              },
            },
          ]
        : []),
      {
        "@type": "FAQPage",
        "@id": `${canonicalUrl}#faq`,
        mainEntity: page.faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      },
    ],
  };

  return (
    <div className="public-readable-scope min-h-screen bg-white text-slate-950">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header />
      <main className="w-full pt-16" aria-label={page.title}>
        <section className="border-b-2 border-black bg-[#fff7df]">
          <div className="mx-auto grid max-w-[1600px] gap-8 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(360px,560px)] lg:items-center lg:px-10 lg:py-16">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="border-2 border-black bg-[#fef08a] px-3 py-1 font-mono text-[10px] font-black uppercase text-black shadow-neo-sm">
                  {page.eyebrow}
                </span>
                {visibleBadge ? (
                  <span className="border-2 border-black bg-white px-3 py-1 font-mono text-[10px] font-black uppercase text-slate-700 shadow-neo-sm">
                    {visibleBadge}
                  </span>
                ) : null}
              </div>
              <h1 className={`mt-6 max-w-5xl break-words font-black uppercase leading-none text-slate-950 ${page.kind === "category" ? "text-4xl sm:text-5xl lg:text-6xl" : "text-4xl sm:text-6xl lg:text-7xl"}`}>
                {categoryDisplay?.title ?? page.title}
              </h1>
              <p className={`mt-5 max-w-3xl font-semibold text-slate-700 ${page.kind === "category" ? "text-base leading-7 sm:text-lg sm:leading-8" : "text-base leading-7 sm:text-xl sm:leading-8"}`}>
                {categoryDisplay?.subtitle ?? page.subtitle}
              </p>
              {page.kind === "category" ? <CategoryHeroBullets page={page} /> : null}
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  to="/demo/general"
                  className="inline-flex min-h-12 items-center justify-center gap-2 border-2 border-black bg-[#5dadec] px-5 py-3 text-sm font-black uppercase text-black shadow-neo-sm transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#86efac] hover:shadow-neo active:translate-x-0 active:translate-y-0 active:shadow-none"
                >
                  See live demo
                  <ArrowRight className="h-4 w-4" strokeWidth={3} aria-hidden />
                </Link>
                <Link
                  to="/pricing"
                  className="inline-flex min-h-12 items-center justify-center gap-2 border-2 border-black bg-white px-5 py-3 text-sm font-black uppercase text-black shadow-neo-sm transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#fef08a] hover:shadow-neo active:translate-x-0 active:translate-y-0 active:shadow-none"
                >
                  View pricing
                </Link>
              </div>
            </div>

            <HeroVisual page={page} />
          </div>
        </section>

        {page.kind === "alternative" ? (
          <>
            <AlternativeQuickScan page={page} />
            <ComparisonSection page={page} />
            <PricingSection page={page} />
          </>
        ) : (
          <>
            <CategoryNarrativeSection page={page} />
            <CategoryShowcaseSection page={page} />
            <CategoryImageGallerySection page={page} />
            <CategoryDecisionSection page={page} />
            <CategoryGettingStartedSection page={page} />
            <CategoryLimitsSection page={page} />
          </>
        )}

        <FaqSection page={page} />
        {page.kind === "category" ? <RelatedResourcesSection page={page} /> : null}

        <section className="bg-slate-950 px-4 py-14 text-white sm:px-6 lg:px-8">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="font-mono text-[10px] font-black uppercase text-[#86efac]">Replay-first analytics</p>
              <h2 className={`mt-3 max-w-4xl font-black uppercase leading-tight ${page.kind === "category" ? "text-3xl sm:text-4xl" : "text-3xl sm:text-5xl"}`}>
                {page.kind === "category" ? "Watch real sessions." : "See the user experience before the next release repeats it."}
              </h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
              <Link
                to="/demo/general"
                className="inline-flex min-h-12 items-center justify-center gap-2 border-2 border-white bg-[#86efac] px-5 py-3 text-sm font-black uppercase text-slate-950 shadow-[4px_4px_0_0_rgba(255,255,255,1)] transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#fef08a]"
              >
                Try demo
                <ArrowRight className="h-4 w-4" strokeWidth={3} aria-hidden />
              </Link>
              <Link
                to="/docs/web/getting-started"
                className="inline-flex min-h-12 items-center justify-center gap-2 border-2 border-white bg-slate-950 px-5 py-3 text-sm font-black uppercase text-white transition hover:bg-white hover:text-slate-950"
              >
                Read docs
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
