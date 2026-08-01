import React from "react";
import { isbot } from "isbot";
import { data, Link, redirect, useLocation } from "react-router";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import {
  ArrowRight,
  BadgeDollarSign,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
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
import { MARKETING_LOCALES, SITE_URL } from "~/shared/lib/internationalMarketing";
import { getSeoPageByPath, type SeoComparisonValue, type SeoPage } from "./seoPages";
import {
  SEO_LOCALIZED_LOCALE_CODES,
  SEO_LOCALIZED_PAGE_PATHS,
  getLocalizedSeoAlternateLinks,
  getLocalizedSeoFaq,
  getLocalizedSeoPage,
  getLocalizedSeoPageByPath,
  getLocalizedSeoPath,
  getPreferredSeoLocaleCode,
  isSeoLocalizedPagePath,
  type LocalizedSeoPage,
} from "./seoLocalization";
import { SankeyPanel } from "../home/components/AiLeakHomepage";
import { EuFlag } from "../home/components/EuFlag";
import { GermanFlag } from "../home/components/GermanFlag";
import { PerformanceMetrics } from "../home/components/PerformanceMetrics";
import {
  MarkAngular,
  MarkExpo,
  MarkFlutter,
  MarkGatsby,
  MarkHydrogen,
  MarkNextJs,
  MarkReactNative,
  MarkRedux,
  MarkRemix,
  MarkShopify,
  MarkSvelte,
  MarkSwift,
  MarkVue,
} from "../home/components/PlatformMarks";

const iconCycle = [PlayCircle, Infinity, Users, Layers3, Gauge, GitBranch];

const normalizePath = (pathname: string) => (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname);

const ATTRIBUTION_PARAMETER_NAMES = new Set(["gclid", "gbraid", "wbraid", "dclid"]);

export function landingHrefWithAttribution(href: string, search: string): string {
  const source = new URLSearchParams(search);
  const destination = new URL(href, SITE_URL);
  source.forEach((value, key) => {
    if (ATTRIBUTION_PARAMETER_NAMES.has(key) || key.startsWith("utm_")) destination.searchParams.set(key, value);
  });
  if (/^https?:\/\//i.test(href)) return destination.toString();
  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function AttributionLinkPreserver() {
  const location = useLocation();

  React.useEffect(() => {
    if (!location.search) return;
    document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href");
      if (!href?.startsWith("/")) return;
      const destination = new URL(href, SITE_URL);
      const preservesAttribution = destination.pathname === "/login"
        || destination.pathname === "/demo"
        || destination.pathname === "/pricing"
        || destination.pathname === "/docs"
        || destination.pathname.startsWith("/docs/");
      if (preservesAttribution) anchor.setAttribute("href", landingHrefWithAttribution(href, location.search));
    });
  }, [location.search]);

  return null;
}

const OPTIMIZED_MARKETING_IMAGES: Record<string, string> = {
  "/images/anr-issues.png": "/images/anr-issues.webp",
  "/images/geo-analytics.png": "/images/geo-analytics.webp",
  "/images/geo-intelligence.png": "/images/geo-intelligence.webp",
  "/images/growth-engines.png": "/images/growth-engines.webp",
  "/images/heatmaps.png": "/images/heatmaps.webp",
  "/images/issues-feed.png": "/images/issues-feed.webp",
  "/images/landing-replay-theater.png": "/images/landing-replay-theater.webp",
  "/images/engineering/heatmaps-attention-docs.png": "/images/engineering/heatmaps-attention-docs.webp",
  "/images/engineering/product-tools-live-general.png": "/images/engineering/product-tools-live-general.webp",
  "/images/engineering/product-tools-live-replay.png": "/images/engineering/product-tools-live-replay.webp",
  "/images/landing-replay-workbench.png": "/images/landing-replay-workbench.webp",
  "/images/readme/analytics-overview.png": "/images/readme/analytics-overview.webp",
  "/images/readme-general-demo.png": "/images/readme-general-demo.webp",
  "/images/readme-user-journeys.png": "/images/readme-user-journeys.webp",
  "/images/session-replay-preview.png": "/images/session-replay-preview.webp",
  "/images/web-session-replay-workbench.png": "/images/web-session-replay-workbench.webp",
};

const optimizedMarketingImage = (src: string) => OPTIMIZED_MARKETING_IMAGES[src] ?? src;

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

const alternativeRejourneyChecklistByPath: Record<string, string[]> = {
  "/alternatives/posthog-session-replay": [
    "Replay is the investigation center, not one product inside a larger growth suite.",
    "Product, support, and engineering need the same session evidence without building a PostHog-wide operating model first.",
    "Mobile context, crashes, ANRs, API context, heatmaps, and journeys matter beside the replay.",
    "You want events, analytics history, projects, and seats to feel boring to budget for.",
  ],
  "/alternatives/sentry-session-replay": [
    "The problem is user behavior as much as developer diagnostics.",
    "You need replay for confusing flows, hesitation, drop-off, and support escalations where no exception fired.",
    "Product, design, support, and engineering all need to inspect the same session.",
    "Crashes and ANRs should sit beside journeys, heatmaps, product analytics, and API context.",
  ],
  "/alternatives/datadog-session-replay": [
    "You want a product and support workspace, not a full observability-suite rollout.",
    "The team starts from user sessions, journeys, heatmaps, crashes, ANRs, and API context.",
    "Replay decisions should be understandable to PMs, support, and platform teams.",
    "You care about source visibility or a self-hosting path for behavioral product data.",
  ],
  "/alternatives/amplitude-session-replay": [
    "The team needs the exact session behind a chart anomaly.",
    "Replay, journeys, heatmaps, crashes, API context, and mobile evidence should live together.",
    "You want broad team access without turning every collaborator or new event into a planning exercise.",
    "You have product questions that are too visual or technical for event analytics alone.",
  ],
  "/alternatives/mixpanel-session-replay": [
    "Replay has to explain the moment behind the event chart.",
    "Journeys, heatmaps, device context, crashes, and API context matter in the same review.",
    "Product and support need sessions they can inspect without asking analytics to build every view.",
    "You want a focused workflow for behavior and debugging evidence rather than event dashboards alone.",
  ],
  "/alternatives/pendo-session-replay": [
    "You need to understand user friction before deciding whether to guide, redesign, or fix it.",
    "Replay, crashes, ANRs, API context, heatmaps, and journeys matter more than in-app messaging.",
    "Engineering needs enough evidence to reproduce the issue from the same product workspace.",
    "The team wants behavior analytics for web and mobile apps, not mainly adoption campaigns.",
  ],
  "/alternatives/fullstory": [
    "You want a leaner replay-first workflow with source visibility and a self-hosting path.",
    "Mobile app context, crashes, ANRs, API context, heatmaps, and journeys should be easy to reach.",
    "Your team does not want a heavy digital-experience rollout before it can investigate sessions.",
    "Simple access for product, support, design, and engineering matters more than enterprise breadth.",
  ],
  "/alternatives/smartlook": [
    "Smartlook migration risk is forcing a decision before support winds down.",
    "The replacement should keep replay, heatmaps, journeys, mobile evidence, crashes, ANRs, and API context together.",
    "You want a workflow independent of the Cisco or Splunk migration path.",
    "Product and engineering need a clean place to keep behavior evidence after Smartlook stops being the center.",
  ],
  "/alternatives/hotjar": [
    "Heatmaps and recordings need to connect to journeys, product analytics, mobile replay, and technical evidence.",
    "Your app friction can come from UI state, device behavior, crashes, ANRs, failed requests, or backend delays.",
    "Product, design, support, and engineering need to work from the same evidence.",
    "You need more than website feedback widgets, surveys, and classic marketing-page behavior research.",
  ],
};

function alternativeRejourneyChecklist(page: SeoPage) {
  return alternativeRejourneyChecklistByPath[page.path] ?? page.chooseRejourney;
}

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
  "/funnel-replay-evidence": {
    title: "Funnel replay evidence",
    subtitle: "Use journey ribbons to open replay evidence for paths where users branch, loop, or drop.",
    guideTitle: "Follow the path",
    fitTitle: "Best fit",
    tradeoffTitle: "Use simple funnels when",
    heroBullets: ["Weighted journey ribbons", "Path-level replay evidence", "Drop-off labels"],
    available: ["Product teams", "Growth teams", "Web and mobile"],
    showcaseTabs: ["Map paths", "Find drops", "Open replays", "Compare paths", "Prioritize"],
    showcaseTitle: "Open the sessions behind the ribbon",
    showcaseCopy: "A funnel path becomes actionable when teams can inspect the replay evidence behind the drop.",
    showcaseBullets: ["Find high-volume leaks", "Compare healthy and degraded paths", "Share replay-backed findings"],
    steps: ["Choose a journey path", "Open matching sessions", "Prioritize the repeated drop"],
  },
  "/geographic-analytics": {
    title: "Geographic analytics",
    subtitle: "Map regional sentiment and UX friction with replay evidence behind the country clusters.",
    guideTitle: "Find the regional cluster",
    fitTitle: "Best fit",
    tradeoffTitle: "Use aggregate analytics when",
    heroBullets: ["Regional sentiment", "Country-level friction", "Replay by market"],
    available: ["Web apps", "Mobile apps", "Global products"],
    showcaseTabs: ["Map", "Segment", "Inspect", "Compare", "Prioritize"],
    showcaseTitle: "Spot the market where experience changed",
    showcaseCopy: "Regional analytics keeps the map connected to real sessions so teams can see what users experienced.",
    showcaseBullets: ["Catch market-specific UX issues", "Separate infra from product friction", "Open replay evidence by country"],
    steps: ["Select a region", "Inspect sentiment clusters", "Open sessions behind the signal"],
  },
  "/revenue-recovery-analytics": {
    title: "Revenue recovery analytics",
    subtitle: "Connect revenue, transactions, users, retention, releases, and sessions in one recovery workflow.",
    guideTitle: "Tie movement to sessions",
    fitTitle: "Best fit",
    tradeoffTitle: "Use BI reports when",
    heroBullets: ["Revenue trends", "Release markers", "Replay context"],
    available: ["Growth teams", "Product teams", "Revenue teams"],
    showcaseTabs: ["Track", "Compare", "Inspect", "Repair", "Confirm"],
    showcaseTitle: "Move from revenue change to session evidence",
    showcaseCopy: "Use the General dashboard to keep revenue movement close to the sessions and releases that explain it.",
    showcaseBullets: ["Watch revenue and transactions", "Check release impact", "Open affected sessions"],
    steps: ["Find the movement", "Inspect affected sessions", "Confirm recovery after the fix"],
  },
  "/standardized-context": {
    title: "Standardized context",
    subtitle: "Keep sessions, regions, events, releases, requests, and issues under shared identifiers.",
    guideTitle: "Normalize the evidence",
    fitTitle: "Best fit",
    tradeoffTitle: "Use ad hoc notes when",
    heroBullets: ["Shared session identifiers", "Reusable issue context", "Replay-linked evidence"],
    available: ["Data teams", "Product teams", "Engineering"],
    showcaseTabs: ["Capture", "Normalize", "Query", "Share", "Compare"],
    showcaseTitle: "Make session evidence reusable",
    showcaseCopy: "Standardized context lets teams reopen, compare, and hand off the same evidence without translating it each time.",
    showcaseBullets: ["Tie events to sessions", "Preserve region and release context", "Export fix-ready summaries"],
    steps: ["Name the signals", "Attach them to sessions", "Reuse the context in handoffs"],
  },
  "/stability-monitoring": {
    title: "Stability monitoring",
    subtitle: "Group crashes, errors, ANRs, and API spikes with replay, devices, releases, and users.",
    guideTitle: "Debug from the failing session",
    fitTitle: "Best fit",
    tradeoffTitle: "Use crash-only tools when",
    heroBullets: ["Crash groups", "Error and ANR context", "Replay-backed triage"],
    available: ["Mobile apps", "Web apps", "Engineering"],
    showcaseTabs: ["Group", "Prioritize", "Replay", "Inspect", "Resolve"],
    showcaseTitle: "Connect failures to the user path",
    showcaseCopy: "Stability monitoring is stronger when the failure carries the path, device, app version, and replay context that shaped it.",
    showcaseBullets: ["Group repeated failures", "See affected users and devices", "Open replay evidence before filing the fix"],
    steps: ["Open stability", "Filter by issue type", "Inspect replay and device context"],
  },
  "/api-endpoint-insights": {
    title: "API endpoint insights",
    subtitle: "Track endpoint volume, latency, failure codes, and risk beside affected session evidence.",
    guideTitle: "Find the endpoint users felt",
    fitTitle: "Best fit",
    tradeoffTitle: "Use server-only monitoring when",
    heroBullets: ["Endpoint risk", "Failure code filters", "Session-level impact"],
    available: ["Web apps", "Mobile apps", "Backend teams"],
    showcaseTabs: ["Volume", "Latency", "Failures", "Risk", "Replay"],
    showcaseTitle: "Turn API telemetry into product evidence",
    showcaseCopy: "Endpoint insights show which backend behavior became user-visible friction in captured sessions.",
    showcaseBullets: ["Sort by risk and latency", "Filter by status family", "Tie endpoint failures to user paths"],
    steps: ["Open API Insights", "Find risky endpoints", "Inspect affected sessions"],
  },
  "/device-insights": {
    title: "Device insights",
    subtitle: "Find device, platform, OS, and app-version friction hidden inside average metrics.",
    guideTitle: "Find the device cohort",
    fitTitle: "Best fit",
    tradeoffTitle: "Use aggregate analytics when",
    heroBullets: ["Device cohorts", "Issue pressure", "Engagement quality"],
    available: ["Flutter", "React Native", "iOS and Android"],
    showcaseTabs: ["Portfolio", "Engagement", "Stability", "Versions", "Replay"],
    showcaseTitle: "Spot device-specific product friction",
    showcaseCopy: "Device insights show which devices carry engagement, stability, duration, and issue patterns that averages hide.",
    showcaseBullets: ["Compare device models", "Track crash and ANR pressure", "Find device-version hotspots"],
    steps: ["Open Devices", "Review pressure leaders", "Connect the cohort to replay"],
  },
  "/record-user-sessions": {
    title: "Record user sessions",
    subtitle: "Find the sessions that answer a specific product, support, or engineering question.",
    guideTitle: "Search before you watch",
    fitTitle: "Best fit",
    tradeoffTitle: "Not the best fit",
    heroBullets: [
      "Start with a behavior query",
      "Keep the replay tied to the path and outcome",
      "Check whether the same pattern repeats",
    ],
    available: ["Web apps", "Mobile apps", "Self-hosting"],
    showcaseTabs: defaultFeatureTabs,
    showcaseTitle: "Turn a complaint into a reproducible session",
    showcaseCopy: "Start with the behavior you need to explain, then inspect the matching replay, journey, heatmap, request, crash, or ANR.",
    showcaseBullets: ["Avoid random clip review", "Preserve the query behind the replay", "Give engineering enough context to reproduce the issue"],
    steps: ["Define the behavior", "Capture searchable context", "Review the replay and pattern"],
  },
  "/mobile-session-replay": {
    title: "Mobile session replay",
    subtitle: "Watch taps, gestures, crashes, ANRs, and slow moments with app metadata attached.",
    guideTitle: "Record app semantics",
    fitTitle: "Best fit",
    tradeoffTitle: "Use web-first tools when",
    heroBullets: ["Record taps and gestures", "Inspect crashes and ANRs", "Support Flutter, React Native, Expo, and iOS"],
    available: ["Flutter", "React Native", "Expo", "Native iOS"],
    showcaseTabs: ["Watch taps", "Find rage taps", "Trace screens", "Debug ANRs", "Share sessions"],
    showcaseTitle: "See the app state around the failure",
    showcaseCopy: "Replay is paired with screen, device, journey, touch map, crash, ANR, and network context so mobile issues are easier to reproduce.",
    showcaseBullets: ["Record gestures and screen transitions", "Connect replay to freezes and crashes", "Compare device and release patterns"],
    steps: ["Name screens clearly", "Capture mobile sessions", "Review replay with stability context"],
  },
  "/web-session-replay": {
    title: "Web session replay",
    subtitle: "See the route changes, requests, loading states, and UI dead ends behind website friction.",
    guideTitle: "Capture the state",
    fitTitle: "Best fit",
    tradeoffTitle: "Analytics alone works when",
    heroBullets: ["Record browser sessions", "Connect clicks to requests", "Review funnels and journeys"],
    available: ["Web apps", "Websites", "SPAs"],
    showcaseTabs: ["Watch clicks", "Find drop-offs", "Inspect requests", "Review heatmaps", "Share clips"],
    showcaseTitle: "Explain the state behind the click",
    showcaseCopy: "Browser replay becomes useful when it sits beside route changes, events, network context, heatmaps, and the path users took.",
    showcaseBullets: ["Find broken UI states", "Inspect failed or slow requests", "Compare failed and successful flows"],
    steps: ["Install the web SDK", "Capture browser behavior", "Review replay with analytics"],
  },
  "/heatmaps": {
    title: "Heatmaps",
    subtitle: "Use web attention maps and mobile touch maps to understand what users notice, miss, and repeat.",
    guideTitle: "Separate attention from interaction",
    fitTitle: "Best fit",
    tradeoffTitle: "Use touch-only maps when",
    heroBullets: ["Web attention maps", "Mobile touch maps", "Replay-backed context"],
    available: ["Web attention maps", "Mobile touch maps", "Replay context"],
    showcaseTabs: ["Attention", "Touches", "Scroll", "Replay", "Ship"],
    showcaseTitle: "Look for the non-obvious hotspot",
    showcaseCopy: "Attention maps estimate what a web visitor consumed; touch maps show where app users tapped, retried, or hit dead zones.",
    showcaseBullets: ["Find skimmed copy", "Spot missed sections", "Avoid treating every hot button as insight"],
    steps: ["Pick a route or screen", "Compare the map with replay", "Fix the missed or confusing area"],
  },
  "/replay-first-mentality": {
    title: "Replay-first mentality",
    subtitle: "Make the real session the first shared artifact before the team names the problem.",
    guideTitle: "Start with evidence",
    fitTitle: "Best fit",
    tradeoffTitle: "Charts are enough when",
    heroBullets: ["Watch before deciding", "Connect sessions to metrics", "Align product and engineering"],
    available: ["Product", "Support", "Engineering"],
    showcaseTabs: ["Observe", "Question", "Validate", "Prioritize", "Ship"],
    showcaseTitle: "Watch before deciding",
    showcaseCopy: "A replay-first workflow keeps teams grounded in real behavior before they debate metrics, tickets, or roadmap bets.",
    showcaseBullets: ["Name the observed behavior", "Check the pattern around it", "Turn sessions into action"],
    steps: ["Pick a flow", "Watch real sessions", "Prioritize repeated friction"],
  },
  "/importance-of-open-source": {
    title: "Open source replay",
    subtitle: "Inspect how behavioral product data is captured, masked, stored, and deployed.",
    guideTitle: "Trust the capture boundary",
    fitTitle: "Best fit",
    tradeoffTitle: "Closed SaaS works when",
    heroBullets: ["Inspect how capture works", "Self-host when needed", "Keep control of replay data"],
    available: ["Open source", "Cloud", "Self-hosted"],
    showcaseTabs: ["Audit", "Host", "Control", "Extend", "Scale"],
    showcaseTitle: "Inspect the replay workflow",
    showcaseCopy: "Replay data is close to users. Open source gives technical teams more confidence in capture, deployment, masking, and long-term control.",
    showcaseBullets: ["Review SDK behavior", "Choose a deployment model", "Avoid opaque workflow lock-in"],
    steps: ["Review the source", "Choose cloud or self-host", "Document ownership"],
  },
  "/what-is-session-replay": {
    title: "What is session replay?",
    subtitle: "A practical guide to what replay shows, what it cannot show, and which context makes it useful.",
    guideTitle: "Replay is evidence",
    fitTitle: "Best fit",
    tradeoffTitle: "Skip replay when",
    heroBullets: ["Reconstruct real sessions", "Pair replay with events", "Explain what users experienced"],
    available: ["Web apps", "Mobile apps", "Product teams"],
    showcaseTabs: ["Capture", "Replay", "Inspect", "Understand", "Act"],
    showcaseTitle: "Replay reconstructs the moment",
    showcaseCopy: "Session replay helps teams move from vague reports to the path, screen, click, tap, loading state, or error a user experienced.",
    showcaseBullets: ["See the user's path", "Attach events and errors", "Check repeated friction"],
    steps: ["Install an SDK", "Capture sessions", "Review patterns with your team"],
  },
  "/how-to-see-what-your-users-do": {
    title: "See what users do",
    subtitle: "Use sessions, journeys, heatmaps, events, crashes, and API context without opening every dashboard at once.",
    guideTitle: "Pick the signal",
    fitTitle: "Best fit",
    tradeoffTitle: "Indirect signals work when",
    heroBullets: ["Watch real behavior", "Map journeys and heatmaps", "Connect product and system context"],
    available: ["Web apps", "Mobile apps", "Support"],
    showcaseTabs: ["Watch", "Map", "Filter", "Debug", "Share"],
    showcaseTitle: "Move from a report to a bounded question",
    showcaseCopy: "Use replay to see what happened, then journeys, heatmaps, events, crashes, and requests to understand whether it repeats.",
    showcaseBullets: ["Pick the observation layer", "Spot repeated friction", "Connect behavior to errors"],
    steps: ["Define the question", "Filter for matching behavior", "Share the evidence with context"],
  },
  "/be-your-users": {
    title: "Be your users",
    subtitle: "Watch the product from the user's side before shipping, then turn the observation into a concrete fix.",
    guideTitle: "Empathy needs evidence",
    fitTitle: "Best fit",
    tradeoffTitle: "Skip session review when",
    heroBullets: ["Review real sessions", "Catch confusing moments", "Ship with sharper evidence"],
    available: ["PMs", "Design", "Engineering"],
    showcaseTabs: ["Watch", "Notice", "Discuss", "Fix", "Ship"],
    showcaseTitle: "See where expectation breaks",
    showcaseCopy: "Replay makes user empathy concrete: hesitation, a missed affordance, a repeated tap, or a path that felt obvious only internally.",
    showcaseBullets: ["Watch real product use", "Write observed facts first", "Fix the repeated confusion"],
    steps: ["Choose a release flow", "Watch sessions together", "Turn the pattern into work"],
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

const featureImageDimensionsBySrc: Record<string, { width: number; height: number }> = {
  "/images/anr-issues.png": { width: 1800, height: 1110 },
  "/images/geo-analytics.png": { width: 1024, height: 755 },
  "/images/geo-intelligence.png": { width: 1024, height: 755 },
  "/images/growth-engines.png": { width: 1564, height: 1078 },
  "/images/heatmaps.png": { width: 1633, height: 846 },
  "/images/hero-replay-workbench.png": { width: 1024, height: 597 },
  "/images/issues-feed.png": { width: 1024, height: 378 },
  "/images/landing-replay-theater.png": { width: 2018, height: 1080 },
  "/images/readme-general-demo.png": { width: 1440, height: 900 },
  "/images/readme-user-journeys.png": { width: 1078, height: 663 },
  "/images/session-replay-preview.png": { width: 1024, height: 598 },
  "/images/user-journeys.png": { width: 1024, height: 544 },
  "/images/web-session-replay-workbench.png": { width: 2118, height: 1274 },
  "/images/engineering/ambiguity-api-error-rate-by-country.png": { width: 1680, height: 950 },
  "/images/engineering/product-tools-live-general.png": { width: 1440, height: 820 },
  "/images/engineering/product-tools-live-journeys.png": { width: 1440, height: 820 },
  "/images/engineering/product-tools-live-replay.png": { width: 1440, height: 820 },
  "/images/engineering/product-tools-live-stability.png": { width: 1440, height: 820 },
  "/images/engineering/product-tools-live-api-endpoints.png": { width: 1440, height: 900 },
  "/images/engineering/product-tools-live-devices.png": { width: 1440, height: 900 },
  "/images/engineering/record-sessions-ai-query-builder.png": { width: 943, height: 180 },
  "/images/engineering/record-sessions-journey-selection.png": { width: 1000, height: 640 },
  "/images/engineering/heatmaps-attention-docs.png": { width: 1633, height: 846 },
  "/images/engineering/heatmaps-dashboard.png": { width: 1633, height: 846 },
  "/images/engineering/heatmaps-mobile-touch-map.svg": { width: 1440, height: 900 },
  "/images/engineering/heatmaps-mobile-touch-map.png": { width: 1633, height: 846 },
  "/images/engineering/heatmaps-web-attention-map.png": { width: 1633, height: 846 },
  "/images/engineering/smartlook-alternatives-heatmaps.png": { width: 1633, height: 846 },
  "/images/engineering/churn-mobile-heatmap.png": { width: 1633, height: 846 },
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
  "/funnel-replay-evidence": [
    {
      src: "/images/readme-user-journeys.png",
      alt: "Rejourney journey ribbon map focused on the funnel path",
      title: "Journey ribbons",
      copy: "Find the weighted path where users branch, loop, or drop.",
    },
    {
      src: "/images/user-journeys.png",
      alt: "Rejourney user journey analytics dashboard",
      title: "Journey overview",
      copy: "Compare funnel paths and transition volume across the product.",
    },
    {
      src: "/images/session-replay-preview.png",
      alt: "Rejourney replay evidence for a selected funnel path",
      title: "Replay evidence",
      copy: "Open the sessions behind a path before turning it into work.",
    },
  ],
  "/geographic-analytics": [
    {
      src: "/images/geo-analytics.png",
      alt: "Rejourney geographic analytics map showing regional sentiment",
      title: "Sentiment by region",
      copy: "Spot frustrated, neutral, and positive session clusters by country.",
    },
    {
      src: "/images/geo-intelligence.png",
      alt: "Rejourney geographic intelligence card showing regional UX friction",
      title: "Regional friction",
      copy: "Use map-based context to prioritize local UX and infrastructure issues.",
    },
    {
      src: "/images/session-replay-preview.png",
      alt: "Rejourney replay evidence for regional sessions",
      title: "Regional replay",
      copy: "Open real sessions behind the regional signal.",
    },
  ],
  "/revenue-recovery-analytics": [
    {
      src: "/images/growth-engines.png",
      alt: "Rejourney revenue recovery analytics dashboard",
      title: "Revenue dashboard",
      copy: "Track revenue, transactions, users, retention, and release impact.",
    },
    {
      src: "/images/readme-general-demo.png",
      alt: "Rejourney general dashboard with leak and revenue context",
      title: "Issue context",
      copy: "Use issue evidence to explain movement in growth metrics.",
    },
    {
      src: "/images/session-replay-preview.png",
      alt: "Rejourney replay evidence for revenue movement",
      title: "Session evidence",
      copy: "Inspect the sessions behind a revenue change.",
    },
  ],
  "/standardized-context": [
    {
      src: "/images/growth-engines.png",
      alt: "Rejourney analytics dashboard with shared context identifiers",
      title: "Shared context",
      copy: "Keep revenue, sessions, releases, and user signals in the same vocabulary.",
    },
    {
      src: "/images/geo-analytics.png",
      alt: "Rejourney region analytics with session context",
      title: "Regional context",
      copy: "Tie regional signals back to real replay evidence.",
    },
    {
      src: "/images/readme-general-demo.png",
      alt: "Rejourney issue detection context",
      title: "Issue context",
      copy: "Preserve the facts another team needs to reopen an issue.",
    },
  ],
  "/stability-monitoring": [
    {
      src: "/images/engineering/product-tools-live-stability.png",
      alt: "Rejourney stability monitoring dashboard with grouped crashes errors ANRs and API spikes",
      title: "Stability dashboard",
      copy: "Review crashes, errors, ANRs, and API spikes from one stability workflow.",
    },
    {
      src: "/images/anr-issues.png",
      alt: "Rejourney ANR issue dashboard with production failure context",
      title: "ANR context",
      copy: "Use replay and issue context to understand freezes and unresponsive moments.",
    },
    {
      src: "/images/engineering/product-tools-live-devices.png",
      alt: "Rejourney device insights linked to stability monitoring",
      title: "Affected devices",
      copy: "Prioritize failures by the device and app-version cohorts that carry them.",
    },
  ],
  "/api-endpoint-insights": [
    {
      src: "/images/engineering/product-tools-live-api-endpoints.png",
      alt: "Rejourney API endpoint insights dashboard with risk latency and failure code filters",
      title: "Endpoint database",
      copy: "Sort endpoints by calls, errors, fail rate, latency, status codes, and risk.",
    },
    {
      src: "/images/engineering/ambiguity-api-error-rate-by-country.png",
      alt: "Rejourney API error analytics by country",
      title: "API error impact",
      copy: "Use regional and product context to understand where API errors shape user behavior.",
    },
    {
      src: "/images/session-replay-preview.png",
      alt: "Rejourney replay evidence for API failure sessions",
      title: "Replay evidence",
      copy: "Open sessions where endpoint behavior changed the user experience.",
    },
  ],
  "/device-insights": [
    {
      src: "/images/engineering/product-tools-live-devices.png",
      alt: "Rejourney device insights dashboard with device portfolio engagement and issue pressure",
      title: "Device insights",
      copy: "Compare session volume, engagement, duration, and issue pressure by device model.",
    },
    {
      src: "/images/anr-issues.png",
      alt: "Rejourney stability issue context for affected devices",
      title: "Stability by device",
      copy: "Connect device cohorts to crashes, ANRs, errors, and affected sessions.",
    },
    {
      src: "/images/engineering/product-tools-live-replay.png",
      alt: "Rejourney replay workbench for device-specific session evidence",
      title: "Replay by cohort",
      copy: "Open the sessions behind a device-specific pattern before deciding what to fix.",
    },
  ],
  "/record-user-sessions": [
    {
      src: "/images/engineering/product-tools-live-replay.png",
      alt: "Rejourney live demo replay workbench with a session timeline and event context",
      title: "Replay workbench",
      copy: "Start with the exact session, then inspect the timeline and surrounding evidence.",
    },
    {
      src: "/images/engineering/record-sessions-ai-query-builder.png",
      alt: "Rejourney AI query builder searching for sessions by behavior and failed outcome",
      title: "AI query builder",
      copy: "Ask for the behavior you need to investigate instead of opening random recordings.",
    },
    {
      src: "/images/engineering/record-sessions-journey-selection.png",
      alt: "Rejourney journey selection tool showing a selected path and matching replay evidence",
      title: "Journey selection",
      copy: "Select a path from the journey map and turn it into a replay search.",
    },
    {
      src: "/images/engineering/product-tools-live-general.png",
      alt: "Rejourney live demo general dashboard with product analytics and active users",
      title: "General dashboard",
      copy: "Use aggregate behavior to understand whether one recording is part of a larger pattern.",
    },
    {
      src: "/images/engineering/product-tools-live-journeys.png",
      alt: "Rejourney live demo user journey map showing paths between product screens",
      title: "Journey map",
      copy: "Move from one session to the repeated path users take before and after friction.",
    },
  ],
  "/mobile-session-replay": [
    {
      src: "/images/engineering/product-tools-live-replay.png",
      alt: "Rejourney live demo mobile replay workbench with touch events and session context",
      title: "Mobile replay",
      copy: "Review real taps, screen changes, and session context in the replay workbench.",
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
      src: "/images/engineering/product-tools-live-general.png",
      alt: "Rejourney live demo web dashboard with route and user analytics",
      title: "Web analytics",
      copy: "Keep browser replay close to routes, events, and active user behavior.",
    },
    {
      src: "/images/engineering/product-tools-live-replay.png",
      alt: "Rejourney live demo replay workbench with browser and mobile replay context",
      title: "Replay workbench",
      copy: "See clicks, UI state, and timeline context as the user experienced them.",
    },
    {
      src: "/images/engineering/ambiguity-api-error-rate-by-country.png",
      alt: "Rejourney API error analytics by country",
      title: "Network context",
      copy: "Connect confusing behavior to failed or slow requests.",
    },
  ],
  "/heatmaps": [
    {
      src: "/images/engineering/heatmaps-attention-docs.png",
      alt: "Rejourney web attention map showing interaction density across a product page",
      title: "Web attention map",
      copy: "Use attention maps to see whether important web content was noticed, skimmed, or ignored.",
    },
    {
      src: "/images/engineering/heatmaps-mobile-touch-map.svg",
      alt: "Rejourney mobile touch map showing repeated taps dead zones and matching sessions",
      title: "Mobile touch map",
      copy: "Use touch maps for taps, dead zones, repeated touches, and gesture confusion.",
    },
    {
      src: "/images/engineering/product-tools-live-replay.png",
      alt: "Rejourney replay workbench showing the mobile session behind a heatmap pattern",
      title: "Replay context",
      copy: "Open the sessions behind a heatmap pattern to verify what happened before changing the interface.",
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
      src: "/images/engineering/product-tools-live-replay.png",
      alt: "Rejourney live demo replay workbench used as shared product evidence",
      title: "Shared evidence",
      copy: "Bring the same replay, events, and context to product, support, and engineering.",
    },
  ],
  "/importance-of-open-source": [
    {
      src: "/images/session-replay-preview.png",
      alt: "Rejourney session replay preview",
      title: "Replay data",
      copy: "Review the behavior data your team depends on.",
    },
    {
      src: "/images/readme-general-demo.png",
      alt: "Rejourney issue detection inbox with ranked leak signals",
      title: "Issue detection",
      copy: "Build a workflow around ranked issues, replay evidence, and fix-ready context.",
    },
    {
      src: "/images/engineering/product-tools-live-stability.png",
      alt: "Rejourney live demo stability dashboard with crash and error context",
      title: "Stability context",
      copy: "Keep replay, stability, and operational signals in a workflow the team can inspect.",
    },
  ],
  "/what-is-session-replay": [
    {
      src: "/images/engineering/product-tools-live-replay.png",
      alt: "Rejourney live demo replay workbench showing session playback and timeline context",
      title: "The session",
      copy: "Replay reconstructs the actual experience.",
    },
    {
      src: "/images/engineering/product-tools-live-general.png",
      alt: "Rejourney live demo analytics overview with product metrics",
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
  "/how-to-see-what-your-users-do": [
    {
      src: "/images/session-replay-preview.png",
      alt: "Rejourney session replay preview with timeline and user context",
      title: "Watch the session",
      copy: "See the exact user path instead of relying on a vague report.",
    },
    {
      src: "/images/heatmaps.png",
      alt: "Rejourney heatmap analytics view",
      title: "Find attention",
      copy: "Use heatmaps to see where attention, hesitation, and repeated touches cluster.",
    },
    {
      src: "/images/engineering/product-tools-live-journeys.png",
      alt: "Rejourney live demo journey analytics map",
      title: "Map the journey",
      copy: "Connect individual sessions to the repeated route behind the behavior.",
    },
  ],
  "/be-your-users": [
    {
      src: "/images/hero-replay-workbench.png",
      alt: "Rejourney replay workbench",
      title: "Observe",
      copy: "Watch the product from outside the team's assumptions.",
    },
    {
      src: "/images/heatmaps.png",
      alt: "Rejourney heatmap analytics view for reviewing user attention",
      title: "Notice",
      copy: "Look for the repeated taps, pauses, and missed affordances that shape the session.",
    },
    {
      src: "/images/engineering/product-tools-live-general.png",
      alt: "Rejourney live demo product analytics dashboard",
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
    src: "/images/readme-general-demo.png",
    alt: "Rejourney issue detection inbox with ranked leak signals",
    title: "Issue detection",
    copy: "Show ranked product and technical issues with the context teams need to act.",
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

const SEO_LOCALE_VARY_HEADER = "Accept-Language, User-Agent";
const SEO_LOCALE_PRIVATE_CACHE_CONTROL = "private, no-store, max-age=0";

export function getSeoLocaleRedirectPath(request: Request): string | null {
  const url = new URL(request.url);
  const pathname = normalizePath(url.pathname);

  // Locale-prefixed pages are permanent, indexable destinations. Only the
  // English owner URL participates in browser-language negotiation.
  if (!isSeoLocalizedPagePath(pathname)) return null;

  // Search engines crawl every stable URL and use hreflang to choose the
  // language result. Redirecting crawlers here would undermine that contract.
  if (isbot(request.headers.get("user-agent") ?? "")) return null;

  const preferredLocaleCode = getPreferredSeoLocaleCode(
    request.headers.get("accept-language"),
  );
  if (preferredLocaleCode === "en") return null;

  return `${getLocalizedSeoPath(preferredLocaleCode, pathname)}${url.search}`;
}

export function loader({ request }: LoaderFunctionArgs) {
  const localeRedirectPath = getSeoLocaleRedirectPath(request);
  if (localeRedirectPath) {
    throw redirect(localeRedirectPath, {
      status: 302,
      headers: {
        "Cache-Control": SEO_LOCALE_PRIVATE_CACHE_CONTROL,
        Vary: SEO_LOCALE_VARY_HEADER,
      },
    });
  }

  const pathname = new URL(request.url).pathname;
  const localizedPage = getLocalizedSeoPageByPath(pathname);
  const page = getSeoPageByPath(localizedPage?.basePath ?? pathname);
  if (!page) {
    throw new Response("Not Found", { status: 404 });
  }

  if (!localizedPage && isSeoLocalizedPagePath(normalizePath(pathname))) {
    return data(null, {
      headers: {
        "Cache-Control": SEO_LOCALE_PRIVATE_CACHE_CONTROL,
        Vary: SEO_LOCALE_VARY_HEADER,
      },
    });
  }

  return null;
}

export const meta: MetaFunction = ({ location }) => {
  const localizedPage = getLocalizedSeoPageByPath(location.pathname);
  const page = getSeoPageByPath(localizedPage?.basePath ?? location.pathname);
  if (!page) {
    return [
      { title: "Rejourney" },
      { name: "robots", content: "noindex, follow" },
    ];
  }

  const canonicalPath = localizedPage?.localizedPath ?? page.path;
  const canonicalUrl = `${SITE_URL}${canonicalPath}`;
  const locale = localizedPage?.locale;
  const localizedTitle = localizedPage?.metaTitle ?? page.metaTitle;
  const localizedDescription = localizedPage?.metaDescription ?? page.metaDescription;
  const localizedKeywords = localizedPage
    ? [localizedPage.primaryKeyword, ...localizedPage.secondaryKeywords]
    : page.keywords;
  const alternateLinks = isSeoLocalizedPagePath(page.path)
    ? getLocalizedSeoAlternateLinks(page.path).map((alternate) => ({
        tagName: "link",
        rel: "alternate",
        hrefLang: alternate.hrefLang,
        href: alternate.href,
      }))
    : [];
  const alternateOgLocales = isSeoLocalizedPagePath(page.path)
    ? (["en", ...SEO_LOCALIZED_LOCALE_CODES] as const)
        .filter((localeCode) => localeCode !== (localizedPage?.localeCode ?? "en"))
        .map((localeCode) => ({
          property: "og:locale:alternate",
          content: MARKETING_LOCALES[localeCode].ogLocale,
        }))
    : [];

  return [
    { title: localizedTitle },
    { name: "description", content: localizedDescription },
    { name: "keywords", content: localizedKeywords.join(", ") },
    { name: "robots", content: "index, follow, max-image-preview:large, max-snippet:-1" },
    { httpEquiv: "Content-Language", content: locale?.languageTag ?? "en-US" },
    { property: "og:locale", content: locale?.ogLocale ?? "en_US" },
    { property: "og:site_name", content: "Rejourney" },
    ...alternateOgLocales,
    { property: "og:title", content: localizedTitle },
    { property: "og:description", content: localizedDescription },
    { property: "og:url", content: canonicalUrl },
    { property: "og:type", content: "website" },
    { property: "og:image", content: `${SITE_URL}${page.image}` },
    { property: "og:image:alt", content: page.imageAlt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: localizedTitle },
    { name: "twitter:description", content: localizedDescription },
    { name: "twitter:image", content: `${SITE_URL}${page.image}` },
    { name: "twitter:image:alt", content: page.imageAlt },
    { tagName: "link", rel: "canonical", href: canonicalUrl },
    ...alternateLinks,
  ];
};

function valueLabel(value: SeoComparisonValue) {
  if (value === "yes") return "Included";
  if (value === "partial") return "Limited";
  if (value === "no") return "Not listed";
  return value;
}

function ValueBadge({ value }: { value: SeoComparisonValue }) {
  const label = valueLabel(value);
  const isYes = value === "yes";
  const isNo = value === "no";
  const Icon = isYes ? Check : isNo ? X : CircleMinus;
  const className = isYes
    ? "text-emerald-800"
    : isNo
      ? "text-slate-500"
      : "text-amber-800";

  return (
    <span className={`inline-flex min-h-10 items-center gap-2 text-sm font-bold leading-none ${className}`}>
      <Icon className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
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
  if (page.kind !== "alternative") {
    return (
      <figure className="rounded-lg border-2 border-black bg-[#dbeafe] p-4 lg:justify-self-end">
        <img
          src={optimizedMarketingImage(page.image)}
          alt={page.imageAlt}
          className="h-auto max-h-[430px] w-full object-contain object-left-top lg:max-w-[560px]"
          decoding="async"
        />
      </figure>
    );
  }

  return (
    <div className="relative">
      <div className="absolute -right-3 -top-3 h-16 w-24 rotate-[5deg] border-2 border-black bg-[#86efac] shadow-neo-sm" aria-hidden />
      <div className="relative overflow-hidden border-2 border-black bg-white p-3 shadow-neo">
        <div className="border-2 border-black bg-[#ecfeff] p-2">
          <img
            src={optimizedMarketingImage(page.image)}
            alt={page.imageAlt}
            className="h-auto max-h-[420px] w-full object-contain object-left-top"
            decoding="async"
          />
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
          <img
            src={optimizedMarketingImage(quickScanImage.src)}
            alt={quickScanImage.alt}
            className="h-full max-h-56 w-full object-contain object-left-top"
            loading="lazy"
            decoding="async"
          />
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
              src={optimizedMarketingImage(page.image)}
              alt={page.imageAlt}
              className="mx-auto h-auto max-h-[420px] w-full object-contain"
              loading="lazy"
              decoding="async"
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
                <img
                  src={optimizedMarketingImage(image.src)}
                  alt={image.alt}
                  className="h-56 w-full object-contain"
                  loading="lazy"
                  decoding="async"
                />
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

function categoryDocsLink(page: SeoPage) {
  if (page.path === "/stability-monitoring" || page.path === "/device-insights") {
    return { href: "/docs/reactnative/overview", label: "React Native docs" };
  }

  if (page.path === "/mobile-session-replay") {
    return { href: "/docs/reactnative/overview", label: "React Native docs" };
  }

  if (page.path === "/importance-of-open-source") {
    return { href: "/docs/selfhosted", label: "Self-hosting docs" };
  }

  return { href: "/docs/web/getting-started", label: "Web SDK docs" };
}

function categoryArticleGalleryImages(page: SeoPage) {
  const seen = new Set<string>();
  return [...featureImages(page), ...defaultFeatureImages]
    .filter((image) => {
      if (seen.has(image.src) || image.src === page.image) return false;
      seen.add(image.src);
      return true;
    })
    .slice(0, 6);
}

function FeatureArticleFigure({
  image,
  variant = "standard",
}: {
  image: FeatureImage;
  variant?: "hero" | "wide" | "standard";
}) {
  const dimensions = featureImageDimensionsBySrc[image.src];
  const isPortrait = dimensions ? dimensions.height / dimensions.width > 1.25 : false;
  const figureClassName = isPortrait ? "mx-auto w-full min-w-0 max-w-[420px]" : "w-full min-w-0 max-w-full";

  return (
    <figure className={figureClassName}>
      <div className={`overflow-hidden border border-slate-200 ${variant === "hero" ? "bg-white" : "bg-slate-50"}`}>
        <img
          src={optimizedMarketingImage(image.src)}
          alt={image.alt}
          width={dimensions?.width}
          height={dimensions?.height}
          className="block h-auto w-full min-w-0 max-w-full"
          loading={variant === "hero" ? "eager" : "lazy"}
          decoding="async"
        />
      </div>
      <figcaption className="mt-3 text-sm leading-6 text-slate-600">
        <span className="block font-semibold text-slate-950">{image.title}</span>
        <span className="mt-1 block">{image.copy}</span>
      </figcaption>
    </figure>
  );
}

type MathNodeProps = {
  children: React.ReactNode;
  className?: string;
};

function MathSymbol({ base, sub }: { base: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <span className="inline-block whitespace-nowrap">
      <span className="italic">{base}</span>
      {sub ? <sub className="ml-0.5 align-sub text-[0.68em] italic leading-none">{sub}</sub> : null}
    </span>
  );
}

function MathOperator({ children, sub }: MathNodeProps & { sub?: React.ReactNode }) {
  return (
    <span className="inline-block whitespace-nowrap not-italic">
      {children}
      {sub ? <sub className="ml-0.5 align-sub text-[0.68em] italic leading-none">{sub}</sub> : null}
    </span>
  );
}

function MathFraction({ numerator, denominator, className = "" }: { numerator: React.ReactNode; denominator: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex translate-y-[0.18em] flex-col items-center px-0.5 align-middle text-[0.9em] leading-none ${className}`}>
      <span className="min-w-full border-b border-slate-950 px-1 pb-0.5 text-center">{numerator}</span>
      <span className="px-1 pt-0.5 text-center">{denominator}</span>
    </span>
  );
}

function MathUnder({ top, bottom }: { top: React.ReactNode; bottom: React.ReactNode }) {
  return (
    <span className="inline-flex translate-y-[0.16em] flex-col items-center px-0.5 align-middle leading-none">
      <span>{top}</span>
      <span className="pt-0.5 text-[0.52em] leading-none">{bottom}</span>
    </span>
  );
}

function MathEquation({ children, number }: MathNodeProps & { number: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2">
      <div className="flex min-h-[1.9rem] min-w-0 flex-wrap items-center justify-center gap-y-1">{children}</div>
      <span className="text-right text-[0.74em] text-slate-500">({number})</span>
    </div>
  );
}

function AttentionMapFormulaBlock() {
  return (
    <figure className="my-7 border-y border-slate-200 py-5">
      <figcaption className="mb-3 text-center text-sm font-semibold text-slate-500">
        Attention-map scoring model
      </figcaption>

      <div className="mx-auto max-w-[700px] font-serif text-[0.98rem] leading-[1.55] text-slate-950">
        <div className="space-y-2.5">
          <MathEquation number="1">
            <MathSymbol base="d" sub="i" />
            <span className="mx-2">=</span>
            <span className="inline-flex items-center">
              <span className="mr-2 text-[4.25em] font-light leading-[0.7]">{"{"}</span>
              <span className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-left">
                <span>0</span>
                <span className="text-[0.88em]">
                  if <MathSymbol base="Δt" sub="i" /> &lt; 150 ms
                </span>
                <MathSymbol base="Δt" sub="i" />
                <span className="text-[0.88em]">
                  if 150 ms ≤ <MathSymbol base="Δt" sub="i" /> ≤ 5 s
                </span>
                <span>5 s</span>
                <span className="text-[0.88em]">
                  if 5 s &lt; <MathSymbol base="Δt" sub="i" /> ≤ 20 s
                </span>
                <span>0.35 · 5 s</span>
                <span className="text-[0.88em]">
                  if <MathSymbol base="Δt" sub="i" /> &gt; 20 s
                </span>
              </span>
            </span>
          </MathEquation>

          <MathEquation number="2">
            <MathSymbol base="p" sub="i" />
            <span className="mx-2">=</span>
            <span>(</span>
            <MathFraction
              numerator={
                <>
                  <MathSymbol base="x" sub="i" /> + <MathSymbol base="s" sub="x" />
                </>
              }
              denominator={<MathSymbol base="w" sub={<span className="not-italic">page</span>} />}
            />
            <span className="mx-1">,</span>
            <MathFraction
              numerator={
                <>
                  <MathSymbol base="y" sub="i" /> + <MathSymbol base="s" sub="y" />
                </>
              }
              denominator={<MathSymbol base="h" sub={<span className="not-italic">page</span>} />}
            />
            <span>)</span>
          </MathEquation>

          <MathEquation number="3">
            <MathSymbol base="ρ" sub="jk" />
            <span className="mx-2">=</span>
            <MathFraction
              numerator={
                <>
                  <MathSymbol base="r" sub="j" />
                  <MathSymbol base="c" sub="k" />
                </>
              }
              denominator={
                <>
                  <MathUnder top="Σ" bottom="m" />
                  <MathUnder top="Σ" bottom="n" />
                  <MathSymbol base="r" sub="m" />
                  <MathSymbol base="c" sub="n" />
                </>
              }
            />
            <span className="mx-5">,</span>
            <MathSymbol base="A" sub="i" />
            <span className="mx-2">=</span>
            <span>0.45</span>
            <MathSymbol base="d" sub="i" />
            <span className="mx-1">+</span>
            <span>0.55</span>
            <MathSymbol base="d" sub="i" />
            <MathSymbol base="ρ" sub="jk" />
          </MathEquation>

          <MathEquation number="4">
            <MathSymbol base="W" sub="b" />
            <span className="mx-2">=</span>
            <MathUnder top="Σ" bottom={<><MathSymbol base="i" />∈<MathSymbol base="b" /></>} />
            <MathSymbol base="A" sub="i" />
            <span className="mx-1">+</span>
            <span>40</span>
            <MathSymbol base="M" sub="b" />
            <span className="mx-1">+</span>
            <span>1600</span>
            <MathSymbol base="C" sub="b" />
            <span className="mx-1">+</span>
            <span>2800</span>
            <MathSymbol base="R" sub="b" />
          </MathEquation>

          <MathEquation number="5">
            <MathSymbol base="I" sub="b" />
            <span className="mx-2">=</span>
            <MathOperator>min</MathOperator>
            <span className="mx-1">(1,</span>
            <span>(</span>
            <MathFraction
              numerator={<MathSymbol base="W" sub="b" />}
              denominator={
                <>
                  <MathOperator sub="k">max</MathOperator>
                  <span className="mx-0.5" />
                  <MathSymbol base="W" sub="k" />
                </>
              }
            />
            <span>)</span>
            <sup className="ml-0.5 align-super text-[0.68em] leading-none">0.72</sup>
            <span>)</span>
          </MathEquation>
        </div>
      </div>

      <div className="mt-4 border-t border-slate-200 pt-3 text-sm leading-6 text-slate-600">
        Here <span className="font-serif italic">r</span> and <span className="font-serif italic">c</span> are weak F-pattern row and column priors, while <span className="font-serif italic">M</span>
        <sub>b</sub>, <span className="font-serif italic">C</span><sub>b</sub>, and <span className="font-serif italic">R</span><sub>b</sub> are bucketed movement, click or touch, and rage-click evidence. The result is a normalized attention estimate, not literal eye tracking.
      </div>
    </figure>
  );
}

type FeatureArticleSection = {
  title: string;
  paragraphs: string[];
  bullets?: string[];
  imageIndex?: number;
  imageVariant?: "wide" | "standard";
  formula?: "web-attention-map";
};

type FeatureArticleContent = {
  sections: FeatureArticleSection[];
  implementationNotes: string[];
};

const defaultFeatureArticleContent: FeatureArticleContent = {
  sections: [
    {
      title: "Start from the question the team needs to answer",
      paragraphs: [
        "Replay is most useful when it is tied to a specific product or support question: why a flow dropped, why a user got stuck, why a release created tickets, or why a screen behaved differently in production than it did in QA.",
        "For developers, the implementation goal is to make that session searchable and explainable later. Capture the route or screen, release version, platform, product events, and the technical signals that explain what happened around the visual session.",
      ],
      bullets: ["Route or screen name", "SDK and app version", "Key product events", "Failed requests, console logs, crashes, or ANRs"],
      imageIndex: 0,
      imageVariant: "wide",
    },
    {
      title: "Use the replay to find the pattern behind the clip",
      paragraphs: [
        "A single recording can show the first clue, but it should not become the whole argument. After watching the session, filter for similar routes, devices, versions, failed requests, or journeys to see whether the behavior repeats.",
        "The productive loop is to move between the individual session and the aggregate views. Replay explains the moment; journeys, heatmaps, events, and stability views show whether that moment deserves engineering time.",
      ],
      imageIndex: 1,
    },
    {
      title: "Keep capture boring, private, and reliable",
      paragraphs: [
        "Treat replay instrumentation like production telemetry. Mask sensitive fields by default, verify the SDK does not capture private content, and roll the integration out first on a flow where the team can quickly validate data quality.",
        "Once the basics are trustworthy, expand coverage intentionally. Good replay data is consistent enough that a ticket, release review, or bug report can point to a session and everyone can inspect the same facts.",
      ],
      imageIndex: 2,
    },
  ],
  implementationNotes: [
    "Name routes, screens, and important states clearly enough that another engineer can search for them later.",
    "Attach release, app version, browser, OS, and device context before relying on replay for triage.",
    "Mask private UI by default, then explicitly allow only the surfaces the team needs.",
    "Verify one successful and one failed session for the target flow before calling the integration ready.",
  ],
};

const featureArticleContentByPath: Record<string, FeatureArticleContent> = {
  "/stability-monitoring": {
    sections: [
      {
        title: "Group failures before assigning priority",
        paragraphs: [
          "Stability triage gets noisy when every crash, error, ANR, and API spike becomes a separate task. Grouping repeated failures lets the team see affected users, event count, last occurrence, and the context that makes the issue worth repairing.",
          "Rejourney's stability page keeps those groups beside replay availability, device context, app versions, and API spikes so engineering and product can judge impact from the same evidence.",
        ],
        bullets: [
          "Crashes, errors, ANRs, and API spikes in one workflow.",
          "Affected users and event counts visible before drilldown.",
          "Replay links and device context preserved for reproduction.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Use replay to understand what happened before the failure",
        paragraphs: [
          "A failure often depends on the path that led to it: a gesture, a loading state, a failed request, or a device-specific state that never appears in local testing.",
          "Opening the replay before writing the ticket helps the team describe expected behavior, observed behavior, and the smallest reproduction path without asking the user to recreate the failure.",
        ],
        imageIndex: 1,
      },
      {
        title: "Separate release, device, and API causes",
        paragraphs: [
          "The same symptom can come from different causes. A crash spike after a release, an ANR concentrated on one device family, and an API spike during checkout should not be handled as the same class of work.",
          "Use stability monitoring with device insights and endpoint insights to split those causes before assigning ownership.",
        ],
        imageIndex: 2,
        imageVariant: "wide",
      },
    ],
    implementationNotes: [
      "Capture app version, SDK version, device model, OS version, route, and screen context with stability events.",
      "Link crash, error, and ANR groups back to representative sessions when available.",
      "Track API spikes beside stability issues so backend regressions are not mistaken for frontend bugs.",
      "Filter by issue type and affected cohort before assigning severity.",
    ],
  },
  "/api-endpoint-insights": {
    sections: [
      {
        title: "Track the endpoint behavior users actually felt",
        paragraphs: [
          "API endpoint analytics is most useful when it explains product impact. A high-volume endpoint, a slow endpoint, and an endpoint with a small but repeated 500 rate can each matter differently depending on where users encounter it.",
          "Rejourney's endpoint database keeps calls, errors, fail rate, latency, status codes, filters, and risk together so teams can find the backend behavior most likely to explain user friction.",
        ],
        bullets: [
          "Sort endpoints by volume, errors, fail rate, latency, and risk.",
          "Filter by method, status family, failure code, latency, volume, and endpoint path.",
          "Use endpoint insights beside replay, stability, journeys, and device context.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Do not stop at the status code",
        paragraphs: [
          "A 500 during checkout and a 500 on a background refresh do not carry the same product cost. Endpoint insights should show enough context to separate noisy failures from failures that block intent.",
          "Use status codes, latency, request volume, and risk as the starting point, then inspect the affected sessions and journeys before turning the endpoint into engineering work.",
        ],
        imageIndex: 1,
        imageVariant: "wide",
      },
      {
        title: "Connect API failures to funnel and retention work",
        paragraphs: [
          "API issues often look like product confusion to users: a button that appears ignored, a stale feed, a form with no confirmation, or a checkout step that silently fails.",
          "When endpoint insights sit beside session replay, teams can explain not just which endpoint failed, but how the failure changed the user's path.",
        ],
        imageIndex: 2,
      },
    ],
    implementationNotes: [
      "Capture endpoint path, method, status code, latency, route or screen, release, and sanitized request context.",
      "Avoid capturing sensitive request bodies or tokens in endpoint context.",
      "Filter out health checks and low-signal endpoints before ranking product risk.",
      "Attach one or more affected sessions when turning an endpoint issue into a ticket.",
    ],
  },
  "/device-insights": {
    sections: [
      {
        title: "Find the device cohort hiding inside the average",
        paragraphs: [
          "Device issues rarely announce themselves in the top-line metric. One device model, OS version, or app version can carry worse engagement, longer sessions, crashes, ANRs, or rage taps while the global dashboard still looks acceptable.",
          "Rejourney's device page shows the portfolio, platform mix, engagement leaders, issue pressure, and device-version hotspots so teams can decide whether a problem is broad UX friction or a cohort-specific production issue.",
        ],
        bullets: [
          "Compare device models by sessions, engagement, duration, and issue pressure.",
          "Review platform mix and device-version hotspots.",
          "Connect device cohorts to stability and replay evidence.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Separate device pressure from product friction",
        paragraphs: [
          "A user path that fails only on one device family should not trigger the same response as a flow that fails everywhere. Device insights help the team avoid broad redesigns when the evidence points to hardware, OS, app version, or performance pressure.",
          "That distinction matters for prioritization. Engineering can reproduce the device-specific issue while product keeps the broader funnel work focused.",
        ],
        imageIndex: 1,
      },
      {
        title: "Open sessions from the affected cohort",
        paragraphs: [
          "A device ranking is a clue. The proof is in sessions from that cohort: what the user tried, how the UI responded, whether a crash or ANR occurred, and which app or OS version shaped the outcome.",
          "Pair device insights with replay and stability monitoring before deciding whether the fix belongs to UI, performance, networking, or instrumentation.",
        ],
        imageIndex: 2,
        imageVariant: "wide",
      },
    ],
    implementationNotes: [
      "Capture device model, OS version, app version, platform, route or screen, and stability signals.",
      "Rank device cohorts by issue pressure as well as volume so small but severe cohorts are visible.",
      "Compare device-specific failures against successful sessions from the same flow.",
      "Link device hotspots to replay and stability evidence before filing engineering work.",
    ],
  },
  "/record-user-sessions": {
    sections: [
      {
        title: "Start with the failure shape",
        paragraphs: [
          "The slow way to use replay is to open the archive and hope a useful recording appears. That turns review into anecdote hunting, and the loudest clip tends to win.",
          "Start with the shape of the failure: users who opened checkout but did not pay, sessions with rage taps on pricing, mobile users who froze during onboarding, or web sessions where a payment request failed. A query gives the review a population before anyone presses play.",
        ],
        bullets: [
          "The flow or screen being investigated.",
          "The event that proves progress or success.",
          "The request, error, journey branch, or UI state that marks failure.",
          "The release, platform, segment, or device group that narrows the search.",
        ],
      },
      {
        title: "Let AI build the search, then inspect the rules",
        paragraphs: [
          "Rejourney's AI query builder is useful when it turns a plain-language investigation into filters based on screens, pages, events, metadata, and setup. The value is not mystique. It is speed and consistency.",
          "A developer should be able to type the scenario from a support ticket, inspect the generated filters, and keep the query with the issue. That way someone else can reopen the same search after a fix ships.",
        ],
        bullets: [
          "Describe the behavior in product language.",
          "Review generated rules before trusting the sample.",
          "Save the query with the issue so the search can be repeated.",
        ],
        imageIndex: 1,
        imageVariant: "wide",
      },
      {
        title: "Make one replay reproducible",
        paragraphs: [
          "A good replay makes the sequence obvious: where the user entered, what they tried, what changed on screen, and which event or request happened at the same time.",
          "The handoff should include expected behavior, observed behavior, affected platform, release version, relevant event or request, and the smallest reproduction path. If that cannot be written from the recording, the session needs more context.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Use journeys when the failure is path-shaped",
        paragraphs: [
          "Some failures are not single events. They are paths: home to new arrivals, pricing to checkout, search to product detail, settings to cancel, onboarding to a dead end. In those cases, the journey map is a better starting point than a replay list.",
          "Selecting a journey ribbon in Rejourney builds a replay query from that path and shows matching sessions. That gives engineering the sessions behind the route instead of asking someone to guess which clips belong together.",
        ],
        bullets: [
          "Select the transition or path that looks suspicious.",
          "Open matched sessions from the same route and release.",
          "Compare healthy paths with degraded or high-drop-off paths before deciding priority.",
        ],
        imageIndex: 2,
        imageVariant: "wide",
      },
      {
        title: "Decide whether the clip matters",
        paragraphs: [
          "One recording is evidence, not a trend. After the first replay explains the symptom, use journeys, heatmaps, and analytics to see whether the behavior repeats across users, devices, versions, referrers, or regions.",
          "That keeps the team from overreacting to one strange session while still giving engineering a concrete path to debug. The clip explains what happened. The surrounding views explain whether it deserves work this week.",
        ],
        imageIndex: 3,
        imageVariant: "wide",
      },
      {
        title: "Capture the context the next reviewer will need",
        paragraphs: [
          "The screen is only the visual layer. A useful session travels with structured context so another reviewer can search for it, compare it, and understand the likely cause without asking the first reviewer to narrate the recording.",
          "At minimum, capture route or screen names, product events, release version, platform, device, browser, important metadata, failed requests, console output, crashes, ANRs, and privacy masking state.",
        ],
        bullets: [
          "Route or screen name.",
          "Release, app version, browser, OS, and device.",
          "Product events that mark progress or abandonment.",
          "Failed requests, console errors, crashes, ANRs, rage taps, or dead taps.",
          "Masking rules for private UI and user-entered data.",
        ],
        imageIndex: 4,
        imageVariant: "wide",
      },
    ],
    implementationNotes: [
      "Capture route changes, core product events, failed requests, console logs, release version, and user or account identifiers where allowed.",
      "Add privacy masking before broad rollout; do not depend on reviewers remembering what not to inspect.",
      "Test replay on the most important happy path and at least one known failure path.",
      "Document how support and product should link sessions in tickets so engineering receives the same evidence every time.",
    ],
  },
  "/mobile-session-replay": {
    sections: [
      {
        title: "Record app semantics, not a tiny browser",
        paragraphs: [
          "Mobile sessions are not smaller browser sessions. Engineers need taps, gestures, screen transitions, device model, OS version, app version, orientation, network state, and foreground or background changes to understand what happened.",
          "Name screens and important states deliberately. A replay that says the user visited `CheckoutPaymentScreen` and tapped `SubmitPayment` is much easier to debug than a recording with unlabeled frames.",
        ],
        bullets: [
          "Screen names and navigation transitions.",
          "App version, build number, OS, and device model.",
          "Touch events and gesture-heavy UI states.",
          "Network calls and slow or failed endpoints.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Use replay to explain freezes and crashes",
        paragraphs: [
          "A stack trace can tell you where code failed. Replay shows what the user was doing before the app froze or crashed, which is often the missing piece for gesture races, bad loading states, flaky connectivity, and state that appears only after several screens.",
          "For ANRs, look at the last meaningful user action, the active screen, slow network calls, and expensive UI work nearby. The useful question is where the thread blocked and why the user reached that state.",
        ],
        imageIndex: 1,
      },
      {
        title: "Validate on messy devices",
        paragraphs: [
          "Start on flows where the value is obvious and the privacy boundary is easy to reason about: onboarding, search, subscription, checkout, or a support-heavy feature.",
          "Validate performance on older devices, slow networks, and noisy gesture paths. Replay should help diagnose production behavior without becoming another production behavior the team has to diagnose.",
        ],
        imageIndex: 2,
      },
      {
        title: "Make gestures searchable",
        paragraphs: [
          "Mobile friction often looks like gesture confusion: a swipe that should advance but scrolls, a dead tap on a card, a repeated tap while loading, or a back gesture that resets state. Those moments need names and events alongside pixels.",
          "Tag the interactions that define the flow. Then support can search for the gesture shape, product can compare it across screens, and engineering can inspect the replay with device and release context attached.",
        ],
        bullets: [
          "Repeated tap or rage tap on the same control.",
          "Dead tap on a non-interactive surface.",
          "Gesture conflict between scroll, swipe, and navigation.",
          "Foreground, background, resume, or offline transition before failure.",
        ],
      },
    ],
    implementationNotes: [
      "Verify screen names, app version, OS version, device model, and region appear beside the replay.",
      "Mask sensitive text, images, and screens before enabling broad mobile capture.",
      "Test sessions on a low-end device or simulator profile and on a fast developer phone.",
      "Confirm crash and ANR views link back to the preceding replay context.",
      "Tag gesture-heavy states so repeated taps, dead taps, and navigation loops are searchable.",
    ],
  },
  "/web-session-replay": {
    sections: [
      {
        title: "Capture the state around the click",
        paragraphs: [
          "Web replay should explain more than pointer movement. In modern apps, route changes, async requests, console errors, feature flags, auth state, and loading states often explain the behavior better than the visual recording alone.",
          "Install the SDK at the app shell, then verify it sees client-side navigation instead of only the first page load. Single-page apps need route and event context or the archive becomes painful to search.",
        ],
        bullets: [
          "Client-side route changes.",
          "Meaningful product events.",
          "Failed and slow network requests.",
          "Console errors, feature flags, and release version.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Compare failed sessions with successful ones",
        paragraphs: [
          "A funnel can tell you users dropped between two steps. Replay can show whether they saw an empty state, clicked a disabled button, missed a validation message, retried a failed request, or got stuck behind a modal.",
          "Compare failed sessions with successful sessions from the same route, release, and segment. The useful question is what failed and what was different in the UI state before the failure.",
        ],
        imageIndex: 1,
      },
      {
        title: "Attach network and console context with restraint",
        paragraphs: [
          "Network and console context can make web replay dramatically faster to debug, but capture should stay purposeful. Record the request path, status, timing, and sanitized metadata that identify ownership. Avoid leaking tokens, bodies, or user-entered content.",
          "The goal is a replay where an engineer can see the failed request, route, release, and user action in one place without turning the browser SDK into an unfiltered log drain.",
        ],
        imageIndex: 2,
      },
      {
        title: "Treat privacy as part of the DOM work",
        paragraphs: [
          "Browser replay can get close to sensitive UI. Mask form fields, account data, customer content, tokens, uploaded files, and internal admin surfaces before the SDK becomes broadly available.",
          "Ship with conservative defaults, then explicitly allow the UI that helps investigation. Privacy should not depend on a reviewer remembering which session is safe to open.",
        ],
      },
    ],
    implementationNotes: [
      "Confirm route changes are recorded correctly in your framework.",
      "Capture failed requests and console errors with enough metadata to find the backend or release owner.",
      "Mask forms and private content before sharing replay links across the team.",
      "Review one successful and one failed session from each critical browser flow after release.",
      "Compare failed and successful sessions from the same route before rewriting the UI.",
    ],
  },
  "/heatmaps": {
    sections: [
      {
        title: "Separate attention from interaction",
        paragraphs: [
          "A hot button is usually not a discovery. Buttons are supposed to get touched. The more useful heatmap question is whether users noticed the content and controls that were meant to guide the next action.",
          "Use attention maps for web pages where copy, layout, scroll depth, and content exposure matter. Use touch maps for mobile screens where taps, repeated taps, reachability, and dead zones matter. Mixing the two creates confident but sloppy conclusions.",
        ],
        bullets: [
          "Use attention maps for docs, pricing, onboarding, checkout, settings, and content-heavy web pages.",
          "Use touch maps for repeated taps, dead zones, reachability, and gesture confusion.",
          "Treat a cold required section as a comprehension problem until replay proves otherwise.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Web attention maps need a model, not mouse paint",
        paragraphs: [
          "Web attention maps work because the browser can provide page exposure, viewport changes, scroll depth, pointer behavior, content density, and reading priors. That combination can reveal skimmed hero text, ignored docs warnings, or pricing copy that absorbed attention before conversion.",
          "The model is deliberately conservative. Nielsen Norman Group's F-pattern research informs the reading prior, Chartbeat's engaged-time work keeps the signal tied to active exposure, and cursor studies keep pointer movement in the model as a useful but noisy proxy.",
          "That is why the score does not simply paint every mouse trail. Very short gaps are ignored, long idle gaps are capped, dwell is split between cursor evidence and reading bands, and click or rage evidence is layered in as interaction context.",
        ],
        imageIndex: 2,
        imageVariant: "wide",
        formula: "web-attention-map",
      },
      {
        title: "Touch maps are useful when they surprise you",
        paragraphs: [
          "Touch maps answer a narrower question: where did users put their fingers, tap, or click? On mobile, that is still valuable for dead zones, repeated taps, thumb reach, bottom navigation friction, gesture confusion, and controls that look interactive but do nothing.",
          "The signal becomes interesting when touches cluster on a non-control, repeat after no feedback, or appear where the UI should have guided the user somewhere else. A map full of red around primary buttons is mostly proof that the UI has primary buttons.",
        ],
        bullets: [
          "Look for repeated taps on disabled, loading, or non-interactive UI.",
          "Check whether users tap labels, cards, images, or empty areas that look tappable.",
          "Pair touch hotspots with replay before filing a ticket.",
        ],
        imageIndex: 1,
      },
      {
        title: "Open replay before writing the ticket",
        paragraphs: [
          "A heatmap shows the population pattern. Replay explains the individual moment. When attention pools around the wrong content or touch events cluster on a confusing control, open sessions from the same route, screen, version, device, and outcome.",
          "That keeps the engineering handoff concrete. Instead of reporting that a map is red, the ticket can say users skimmed the hero copy, missed the installation callout, repeatedly tapped a non-interactive card, or reached the CTA only after a failed request changed state.",
        ],
        bullets: [
          "Attach the map type: web attention map or mobile touch map.",
          "Attach the selected route, screen, release, device, and segment.",
          "Include at least one replay that shows the behavior before and after the hotspot.",
          "State whether the likely fix is copy, layout, feedback, interaction, or instrumentation.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Use heatmaps after a release",
        paragraphs: [
          "Heatmaps are especially useful after a change ships. On web, compare whether attention moved toward the intended headline, form, callout, or CTA. On mobile, compare whether repeated taps moved away from confusing areas and toward responsive controls.",
          "If attention improves but conversion does not, the problem may be trust, pricing, performance, backend reliability, or the next step in the journey. If conversion improves without a visible attention shift, the fix may have removed friction rather than changed what people read.",
        ],
        bullets: [
          "Compare the same route or screen before and after the release.",
          "Separate web attention movement from mobile touch movement.",
          "Check journeys and replay when the heatmap improves but the outcome does not.",
        ],
      },
    ],
    implementationNotes: [
      "Keep product language precise: attention maps are web-only; touch maps are interaction maps.",
      "Label routes and screens consistently so maps can be compared across releases.",
      "Use touch maps for taps, repeated taps, dead zones, reachability, and gesture friction.",
      "Use attention maps for skimmed copy, ignored callouts, missed sections, and content hierarchy problems.",
      "Attach replay samples before turning a heatmap hotspot into an engineering ticket.",
      "Mask sensitive page and screen regions before sharing heatmap screenshots broadly.",
    ],
  },
  "/replay-first-mentality": {
    sections: [
      {
        title: "Watch the session before naming the problem",
        paragraphs: [
          "Replay-first does not mean ignoring metrics. It means putting a real user experience in front of the team before everyone argues from charts, screenshots, and half-remembered support tickets.",
          "For engineers, the value is practical. A replay can turn a vague complaint into a path, browser or device, release, request, event timeline, and concrete place to start debugging.",
        ],
        bullets: [
          "Watch the session before writing the fix.",
          "Link the replay in the issue.",
          "Capture the event or request that explains the symptom.",
          "Check whether the pattern repeats.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Turn the clip into a pattern check",
        paragraphs: [
          "A replay is vivid, which makes it useful and dangerous. After watching it, zoom out into journeys, heatmaps, events, and analytics to see whether the same behavior shows up across users.",
          "This habit keeps replay from becoming anecdote theater. The team sees the lived experience, then checks whether the evidence is broad enough to justify product or engineering work.",
        ],
        imageIndex: 1,
      },
      {
        title: "Give each role the same artifact",
        paragraphs: [
          "The same replay can answer different questions. Product looks for expectation breaks. Support checks what the customer actually saw. Design looks for affordance problems. Engineering looks for state, requests, errors, device details, and reproduction steps.",
          "That shared artifact reduces the usual translation loss between ticket, screenshot, chart, and bug report. Everyone can disagree about priority while looking at the same session.",
        ],
        imageIndex: 2,
      },
      {
        title: "Build a small ritual around it",
        paragraphs: [
          "The workflow sticks when it has a small place in existing rituals: release review, support escalation, incident review, onboarding review, or weekly product planning.",
          "Ask the same questions each time: what did the user try, where did expectation break, what technical signal explains it, how many sessions show the same pattern, and who can act on it.",
        ],
      },
    ],
    implementationNotes: [
      "Require a replay link, or a reason it is unavailable, for user-facing bug reports.",
      "Watch multiple sessions before using replay to justify roadmap work.",
      "Pair each replay observation with an aggregate check such as journeys, heatmaps, or event counts.",
      "Write the observed behavior in neutral language before jumping to the proposed fix.",
    ],
  },
  "/importance-of-open-source": {
    sections: [
      {
        title: "The SDK boundary is where trust is earned",
        paragraphs: [
          "Replay tools run close to user behavior. They sit in the browser or mobile app, observe UI state, and send telemetry to infrastructure your team may depend on during incidents and support escalations.",
          "Open source gives engineers a way to inspect that boundary: what the SDK records, how masking works, how payloads move, and what happens when you need to self-host or debug the telemetry path.",
        ],
        bullets: [
          "SDK capture behavior.",
          "Masking and redaction rules.",
          "Network payload shape.",
          "Storage, retention, and self-hosting path.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Audit before capture goes broad",
        paragraphs: [
          "Before replay goes broad, review what leaves the app. Look for user-entered text, private account data, internal admin views, tokens, uploaded files, and anything your privacy policy does not clearly support.",
          "A source-visible tool does not remove privacy work. It makes that work inspectable, repeatable, and easier to discuss with security, legal, and engineering.",
        ],
        imageIndex: 1,
      },
      {
        title: "Self-hosting is an operating model",
        paragraphs: [
          "Self-hosting is useful only if the team knows who owns upgrades, backups, retention, alerts, and incident response. Treat replay infrastructure like a production service, because the product team will depend on it during real incidents.",
          "The payoff is control. If requirements change, engineers can inspect the system, tune capture, change deployment posture, and keep product evidence available without being boxed into an opaque workflow.",
        ],
        imageIndex: 2,
      },
      {
        title: "Source visibility lowers exit risk",
        paragraphs: [
          "Closed analytics tools can become hard to leave because the team builds habits, queries, alerts, and support workflows around them. That lock-in is sharper for replay because the data is behavioral and operational, not a simple event table.",
          "With source visibility, the team can understand the capture model, export assumptions, deployment shape, and parts of the stack it may need to keep if business or compliance requirements change.",
        ],
      },
    ],
    implementationNotes: [
      "Review SDK capture behavior and masking rules before enabling sensitive flows.",
      "Document which environments use cloud, self-hosted, or disabled replay capture.",
      "Define retention and access rules for replay data the same way you define them for logs.",
      "Assign owners for upgrades, backups, and incident response if you self-host.",
      "Keep an internal note for export, deletion, and incident-response workflows before replay becomes a support dependency.",
    ],
  },
  "/what-is-session-replay": {
    sections: [
      {
        title: "Replay reconstructs context, not intent",
        paragraphs: [
          "Session replay reconstructs enough of a user session for the team to inspect what happened: the path, visible state, interaction, and events or errors around the moment.",
          "It does not tell you what the user felt or intended. It gives you observable behavior. That distinction matters because the next step is to compare the replay with journeys, heatmaps, events, and technical signals before deciding what to fix.",
        ],
        bullets: [
          "What the user saw.",
          "What the user clicked, tapped, typed, retried, or abandoned.",
          "What events and requests happened nearby.",
          "Which device, browser, app version, or release was involved.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Good replay carries surrounding evidence",
        paragraphs: [
          "A bare recording is often enough to understand the symptom, but not enough to assign the fix. Good replay carries route, event, request, device, release, error, and privacy context with it.",
          "That context lets teams move from 'this looked broken' to a concrete question: is the problem copy, layout, frontend state, backend reliability, mobile performance, or instrumentation?",
        ],
        imageIndex: 1,
      },
      {
        title: "Replay is not a replacement for analytics",
        paragraphs: [
          "Replay explains the moment. Analytics explains the population. You need both if you want to avoid overreacting to one dramatic session or missing a subtle pattern that appears across hundreds of users.",
          "A good workflow starts with a session, then checks events, journeys, heatmaps, and stability signals to understand scope and priority.",
        ],
        imageIndex: 2,
      },
      {
        title: "Privacy and performance decide whether replay is usable",
        paragraphs: [
          "A replay tool is only useful if teams trust it. That means masking sensitive UI, avoiding unnecessary payload volume, sampling where appropriate, and making sure the SDK does not damage the experience it observes.",
          "When evaluating session replay, ask how the tool handles redaction, retention, access control, SDK cost, and the link between replay and technical diagnostics.",
        ],
      },
    ],
    implementationNotes: [
      "Use replay for concrete user behavior rather than broad traffic reporting.",
      "Pair sessions with events, requests, errors, device details, and release data.",
      "Mask sensitive UI before sharing sessions outside the immediate engineering group.",
      "Check repeated patterns before turning one recording into roadmap work.",
    ],
  },
  "/how-to-see-what-your-users-do": {
    sections: [
      {
        title: "Choose the signal based on the question",
        paragraphs: [
          "Different signals answer different questions. Replay shows the individual session, events show sequence, heatmaps show attention or repeated interaction, journeys show paths, and errors or requests show where the system changed the experience.",
          "For developers, the useful setup is not maximum data. It is a small set of signals that connect cleanly: route, event, request, replay, release, and user context.",
        ],
        bullets: [
          "Replay for the exact moment.",
          "Events for sequence and search.",
          "Heatmaps for attention, repeated taps, and missed UI.",
          "Journeys for path-level patterns.",
          "Errors and requests for technical cause.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Write the query before opening sessions",
        paragraphs: [
          "Do not start with 'what are users doing?' Start with a bounded question: users who opened checkout but did not pay, users who retried search, users who abandoned onboarding, or users on a new release who hit a slow endpoint.",
          "That framing tells engineering what to instrument and tells product which sessions are worth reviewing. It also keeps the team from browsing replay until someone finds a clip that confirms their hunch.",
        ],
        imageIndex: 1,
      },
      {
        title: "Move between the individual and the population",
        paragraphs: [
          "A vivid replay can be persuasive, which is useful and dangerous. After watching a session, check whether the same behavior repeats across routes, segments, devices, versions, or cohorts.",
          "This is how replay becomes a reliable product tool instead of a collection of dramatic clips. The session explains the experience. The aggregate views explain priority.",
        ],
        imageIndex: 2,
      },
      {
        title: "Make the evidence useful to the next person",
        paragraphs: [
          "A good behavior investigation leaves behind more than a link. It should include the query, representative session, affected path, expected outcome, observed outcome, release window, and the signal that explains why the user experience changed.",
          "That is the difference between 'watch this weird clip' and a handoff another teammate can verify, reproduce, and close.",
        ],
        bullets: [
          "Save the replay query or selected journey.",
          "Attach one representative session and the repeated-pattern check.",
          "Record expected behavior, observed behavior, route, release, segment, and owner.",
        ],
      },
    ],
    implementationNotes: [
      "Define the flow and outcome before opening recordings.",
      "Capture route, event, request, release, and user context for the flow.",
      "Review both successful and failed sessions from the same release window.",
      "Use journeys, heatmaps, and analytics to validate that a replayed behavior repeats.",
    ],
  },
  "/be-your-users": {
    sections: [
      {
        title: "Run session review like real work",
        paragraphs: [
          "Being your users should not mean loosely watching clips until someone has a strong opinion. Pick a flow, watch a few sessions, write observed facts, and separate what happened from what the team thinks caused it.",
          "For developers, this is a fast way to see production-only states: slow loading, confusing disabled buttons, repeated taps, missing feedback, validation loops, unexpected redirects, and errors that never appear in local testing.",
        ],
        bullets: [
          "Choose one flow.",
          "Watch without narrating the fix first.",
          "Write observed behavior.",
          "Attach technical signals.",
          "Turn repeated issues into tickets.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Look for expectation breaks",
        paragraphs: [
          "A useful session review focuses on the moment user expectation diverges from product behavior. That might be a button that appears enabled but does nothing, a form error below the fold, a spinner with no explanation, or a screen that loads after the user has already given up.",
          "These moments are usually small. They still create support tickets, abandoned flows, and release anxiety later.",
        ],
        imageIndex: 1,
      },
      {
        title: "Turn empathy into work someone can do",
        paragraphs: [
          "A replay review should end with an artifact an engineer can act on: a reproduction path, affected versions or devices, relevant event or request, expected behavior, observed behavior, and a link to the supporting session.",
          "That keeps empathy from becoming theater. The team understands the user's experience and leaves with evidence that can change the product.",
        ],
        imageIndex: 2,
      },
      {
        title: "Make it part of release hygiene",
        paragraphs: [
          "The habit works best when it is small and predictable: watch sessions after a major funnel change, during release review, after support escalations, and before declaring a confusing issue solved.",
          "Five focused minutes with real sessions can catch the awkward parts that internal demos smooth over: missing feedback, a misleading empty state, copy that reads well in a mockup but fails in production, or a path that only makes sense to the team that built it.",
        ],
      },
    ],
    implementationNotes: [
      "Review sessions during release retrospectives, support escalations, and major funnel changes.",
      "Write observed facts before proposing fixes.",
      "Tag repeated expectation breaks by route, screen, device, and release.",
      "Create tickets with replay links, reproduction steps, expected behavior, and technical context.",
    ],
  },
};

function featureArticleContent(page: SeoPage) {
  return featureArticleContentByPath[page.path] ?? defaultFeatureArticleContent;
}

function CategoryFeatureArticlePage({ page }: { page: SeoPage }) {
  const display = featureDisplay(page);
  const docs = categoryDocsLink(page);
  const supportingImages = categoryArticleGalleryImages(page);
  const articleContent = featureArticleContent(page);
  const articleSections = articleContent.sections;
  const heroImage: FeatureImage = {
    src: page.image,
    alt: page.imageAlt,
    title: display.showcaseTitle,
    copy: display.showcaseCopy,
  };

  return (
    <main className="engineering-article-page flex-grow bg-[#fbfbf8] pt-16" aria-label={page.title}>
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-6 lg:px-8">
        <article className="mx-auto max-w-[760px]">
          <header className="mb-14 border-b border-slate-200 pb-10">
            <div className="mb-6 flex flex-wrap items-center gap-3 text-sm font-semibold text-sky-700">
              <span>{page.eyebrow}</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>{page.badge}</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>{display.available.join(", ")}</span>
            </div>

            <h1 className="mb-7 text-pretty font-display text-[2.45rem] font-extrabold leading-[1.06] tracking-normal text-slate-950 sm:text-5xl">
              {page.title}
            </h1>

            <p className="max-w-[720px] text-[1.15rem] font-normal leading-8 text-slate-600">
              {page.subtitle}
            </p>

            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold">
              <Link to="/demo" className="inline-flex items-center gap-2 text-sky-700 underline decoration-sky-300 underline-offset-4 hover:text-sky-900">
                <PlayCircle className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                Open live demo
              </Link>
              <Link to={docs.href} className="inline-flex items-center gap-2 text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-950">
                Read {docs.label}
                <ArrowRight className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              </Link>
            </div>
          </header>
        </article>

        <div className="relative mx-auto max-w-7xl">
          <div className="engineering-article-body mx-auto max-w-[760px] space-y-8">
            <FeatureArticleFigure image={heroImage} variant="hero" />

            <section id="overview">
              <h2>{page.whyTitle}</h2>
              {page.whyParagraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>

            {articleSections.map((section) => {
              const sectionImage =
                typeof section.imageIndex === "number" ? supportingImages[section.imageIndex] : null;

              return (
                <section key={section.title}>
                  <h2>{section.title}</h2>
                  {section.paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {section.formula === "web-attention-map" ? <AttentionMapFormulaBlock /> : null}
                  {section.bullets?.length ? (
                    <ul>
                      {section.bullets.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                  {sectionImage ? (
                    <FeatureArticleFigure
                      image={sectionImage}
                      variant={section.imageVariant ?? "standard"}
                    />
                  ) : null}
                </section>
              );
            })}

            <section id="decision">
              <h2>Implementation notes</h2>
              <p>These are the checks another engineer should be able to use before trusting the feature in production.</p>

              <ul>
                {articleContent.implementationNotes.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <h3>When to use a lighter signal</h3>
              <ul>
                {page.chooseOther.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section id="faq">
              <h2>Questions teams usually ask</h2>
              {page.faq.map((item) => (
                <details key={item.question}>
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </section>

            <section id="resources">
              <h2>Related reading</h2>
              <ul>
                {page.related.map((item) => (
                  <li key={item.href}>
                    <Link to={item.href}>{item.label}</Link>: {item.description}
                  </li>
                ))}
              </ul>
            </section>

            {page.officialSources?.length ? (
              <section id="sources">
                <h2>Sources</h2>
                <ul>
                  {page.officialSources.map((source) => (
                    <li key={source.href}>
                      <a href={source.href} target="_blank" rel="noreferrer">
                        {source.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function ArticleValueBadge({ value }: { value: SeoComparisonValue }) {
  const label = valueLabel(value);
  const className =
    value === "yes"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : value === "partial"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <span className={`inline-flex min-h-8 items-center rounded-full border px-3 text-xs font-semibold ${className}`}>
      {label}
    </span>
  );
}

function AlternativeArticleComparisonTable({ page }: { page: SeoPage }) {
  return (
    <div className="my-8 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="grid grid-cols-[minmax(180px,1.25fr)_minmax(110px,0.55fr)_minmax(110px,0.55fr)] border-b border-slate-200 bg-slate-950 text-white">
        <div className="px-4 py-3 text-sm font-semibold">Capability</div>
        <div className="border-l border-slate-700 px-4 py-3 text-sm font-semibold">Rejourney</div>
        <div className="border-l border-slate-700 px-4 py-3 text-sm font-semibold">{page.otherColumnTitle}</div>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[620px] divide-y divide-slate-100">
          {page.comparisonRows.map((row) => (
            <div
              key={`${row.feature}-${row.rejourney}-${row.other}`}
              className="grid grid-cols-[minmax(180px,1.25fr)_minmax(110px,0.55fr)_minmax(110px,0.55fr)] items-center bg-white"
            >
              <div className="px-4 py-4 text-sm font-semibold leading-6 text-slate-900">{row.feature}</div>
              <div className="border-l border-slate-100 px-4 py-4">
                <ArticleValueBadge value={row.rejourney} />
              </div>
              <div className="border-l border-slate-100 px-4 py-4">
                <ArticleValueBadge value={row.other} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AlternativeComparisonArticlePage({ page }: { page: SeoPage }) {
  const tldr = alternativeTldrByPath[page.path] ?? page.subtitle;
  const heroImage: FeatureImage = {
    src: page.image,
    alt: page.imageAlt,
    title: page.title,
    copy: tldr,
  };

  return (
    <main className="engineering-article-page flex-grow bg-[#fbfbf8] pt-16" aria-label={page.title}>
      <div className="mx-auto max-w-7xl px-5 py-14 sm:px-6 lg:px-8">
        <article className="mx-auto max-w-[760px]">
          <header className="mb-14 border-b border-slate-200 pb-10">
            <div className="mb-6 flex flex-wrap items-center gap-3 text-sm font-semibold text-sky-700">
              <span>{page.eyebrow}</span>
              <span className="h-1 w-1 rounded-full bg-slate-300" />
              <span>{page.otherColumnTitle}</span>
              {page.lastReviewed ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-slate-300" />
                  <span>Reviewed {page.lastReviewed}</span>
                </>
              ) : null}
            </div>

            <h1 className="mb-7 text-pretty font-display text-[2.45rem] font-extrabold leading-[1.06] tracking-normal text-slate-950 sm:text-5xl">
              {page.title}
            </h1>

            <p className="max-w-[720px] text-[1.15rem] font-normal leading-8 text-slate-600">
              {page.subtitle}
            </p>

            <div className="mt-8 flex flex-wrap gap-x-5 gap-y-3 text-sm font-semibold">
              <Link to="/demo" className="inline-flex items-center gap-2 text-sky-700 underline decoration-sky-300 underline-offset-4 hover:text-sky-900">
                <PlayCircle className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                Open live demo
              </Link>
              <Link to="/pricing" className="inline-flex items-center gap-2 text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-950">
                Compare pricing
                <ArrowRight className="h-4 w-4" strokeWidth={2.25} aria-hidden />
              </Link>
            </div>
          </header>
        </article>

        <div className="relative mx-auto max-w-7xl">
          <div className="engineering-article-body mx-auto max-w-[760px] space-y-8">
            <FeatureArticleFigure image={heroImage} variant="hero" />

            <section id="quick-read">
              <h2>The short version</h2>
              <p>{tldr}</p>
              {page.proofPoints.length ? (
                <ul>
                  {page.proofPoints.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section id="why-compare">
              <h2>{page.whyTitle}</h2>
              {page.whyParagraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </section>

            <section id="decision-checklist">
              <h2>Decision checklist</h2>
              <p>
                Treat this as a buying conversation, not a winner-take-all scorecard. The right tool depends on the job your team needs the comparison page to do.
              </p>
              <h3>Choose Rejourney when</h3>
              <ul>
                {alternativeRejourneyChecklist(page).map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <h3>{page.chooseOtherTitle}</h3>
              <ul>
                {page.chooseOther.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>

            <section id="feature-table">
              <h2>{page.comparisonTitle}</h2>
              <p>{page.comparisonIntro}</p>
              <AlternativeArticleComparisonTable page={page} />
            </section>

            {page.featureDifferences?.length ? (
              <section id="where-they-differ">
                <h2>Where the tools differ</h2>
                {page.featureDifferences.map((row) => (
                  <div key={row.feature}>
                    <h3>{row.feature}</h3>
                    <p>
                      <strong>Rejourney:</strong> {row.rejourney}
                    </p>
                    <p>
                      <strong>{page.otherColumnTitle}:</strong> {row.other}
                    </p>
                  </div>
                ))}
              </section>
            ) : null}

            <section id="pricing-context">
              <h2>{page.pricingTitle}</h2>
              <p>{page.pricingIntro}</p>

              {page.competitorFacts?.length ? (
                <>
                  <h3>Official facts to verify</h3>
                  <ul>
                    {page.competitorFacts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              <h3>Rejourney model</h3>
              <ul>
                {page.pricingBullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </section>

            <section id="faq">
              <h2>Questions teams usually ask</h2>
              {page.faq.map((item) => (
                <details key={item.question}>
                  <summary>{item.question}</summary>
                  <p>{item.answer}</p>
                </details>
              ))}
            </section>

            <section id="resources">
              <h2>Related reading</h2>
              <ul>
                {page.related.map((item) => (
                  <li key={`${item.href}-${item.label}`}>
                    <Link to={item.href}>{item.label}</Link>: {item.description}
                  </li>
                ))}
              </ul>
            </section>

            {page.officialSources?.length ? (
              <section id="sources">
                <h2>Sources</h2>
                <ul>
                  {page.officialSources.map((source) => (
                    <li key={source.href}>
                      <a href={source.href} target="_blank" rel="noreferrer">
                        {source.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

function FaqSection({ page }: { page: SeoPage }) {
  const containerClass =
    page.kind !== "alternative"
      ? "mt-10 divide-y-2 divide-black border-y-2 border-black bg-white"
      : "mt-10 divide-y-2 divide-black border-2 border-black bg-white shadow-neo-sm";
  const title = page.kind !== "alternative" ? "FAQ" : "Frequently asked questions";

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
  if (page.kind !== "alternative") {
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

const AD_LANDING_PATHS = [
  "/website-analytics",
  "/app-analytics",
  "/web-session-replay",
  "/mobile-session-replay",
  "/stability-monitoring",
  "/funnel-replay-evidence",
  "/revenue-recovery-analytics",
  "/alternatives/posthog-session-replay",
  "/alternatives/sentry-session-replay",
  "/alternatives/smartlook"
];

const AD_LANDING_HEADLINES: Record<string, string> = {
  "/website-analytics": "User Experience Analytics for Websites",
  "/app-analytics": "Mobile App Analytics with Session Replay",
  "/web-session-replay": "Web Session Replay Software",
  "/mobile-session-replay": "Mobile App Session Replay",
  "/stability-monitoring": "Mobile App Crash Reporting with Replay",
  "/funnel-replay-evidence": "Funnel Analysis with Replay Evidence",
  "/revenue-recovery-analytics": "Product Analytics For Revenue Leaks",
  "/alternatives/posthog-session-replay": "PostHog Alternative",
  "/alternatives/sentry-session-replay": "Sentry Alternative",
  "/alternatives/datadog-session-replay": "Datadog Alternative",
  "/alternatives/amplitude-session-replay": "Amplitude Alternative",
  "/alternatives/mixpanel-session-replay": "Mixpanel Alternative",
  "/alternatives/pendo-session-replay": "Pendo Alternative",
  "/alternatives/fullstory": "Fullstory Alternative",
  "/alternatives/hotjar": "Hotjar Alternative",
  "/alternatives/smartlook": "Smartlook Alternative",
};

export function getSeoLandingHeadline(page: SeoPage): string {
  return page.kind === "alternative"
    ? page.hero.title
    : AD_LANDING_HEADLINES[page.path] ?? page.hero.title;
}

const AD_LANDING_SUBHEADLINES: Record<string, string> = {
  "/website-analytics": "Understand traffic, engagement, funnels, errors, and complete user sessions with one lightweight web SDK. Unlimited analytics events included.",
  "/app-analytics": "Understand flows, retention, crashes, and API failures with lightweight product analytics and replay for Flutter, React Native, Expo, and iOS.",
  "/web-session-replay": "Connect lightweight web session replay with funnels, product events, network requests, console context, and the exact moment users leave.",
  "/mobile-session-replay": "Replay Flutter, iOS, React Native, and Expo screens with lightweight product analytics, crash context, API evidence, and journey data.",
  "/stability-monitoring": "Monitor crashes, ANRs, and API failures. Pair error diagnostics with replay context to fix bugs that block transactions.",
  "/funnel-replay-evidence": "Analyze journey ribbons and backtrack loops. Pinpoint where visitors abandon flows and watch replays of drops.",
  "/revenue-recovery-analytics": "Link gross revenue drops directly to failed checkouts and releases. Recover leaked carts with replay evidence.",
  "/alternatives/posthog-session-replay": "Compare PostHog with Rejourney's lighter product analytics stack for web and mobile replay, journeys, heatmaps, and debugging context.",
  "/alternatives/sentry-session-replay": "Compare Sentry's developer-first monitoring with lightweight product analytics, replay, funnels, heatmaps, crashes, and API context.",
  "/alternatives/datadog-session-replay": "Compare Datadog's broad observability platform with lightweight product analytics built around user sessions and product evidence.",
  "/alternatives/amplitude-session-replay": "Compare Amplitude's analytics-first platform with lightweight product analytics that keeps replay and technical context close.",
  "/alternatives/mixpanel-session-replay": "Compare Mixpanel's event analytics with lightweight product analytics, web and mobile replay, heatmaps, and debugging context.",
  "/alternatives/pendo-session-replay": "Compare Pendo's adoption suite with lightweight product analytics focused on replay, product behavior, and engineering evidence.",
  "/alternatives/fullstory": "Compare Fullstory with a lighter, self-hostable product analytics and replay workflow for web and mobile teams.",
  "/alternatives/hotjar": "Compare Hotjar and Contentsquare with lightweight product analytics for web and mobile replay, journeys, and technical context.",
  "/alternatives/smartlook": "Compare Smartlook with an active lightweight product analytics platform for replay, heatmaps, journeys, mobile apps, and technical context.",
};

const AD_LANDING_HERO_IMAGES: Record<string, string> = {
  "/website-analytics": "/images/readme/analytics-overview.png",
  "/app-analytics": "/images/engineering/product-tools-live-general.png",
  "/web-session-replay": "/images/web-session-replay-workbench.png",
  "/mobile-session-replay": "/images/engineering/product-tools-live-replay.png",
  "/stability-monitoring": "/images/anr-issues.png",
  "/funnel-replay-evidence": "/images/readme-user-journeys.png",
  "/revenue-recovery-analytics": "/images/growth-engines.png",
  "/alternatives/posthog-session-replay": "/images/readme-general-demo.png",
  "/alternatives/sentry-session-replay": "/images/anr-issues.png",
  "/alternatives/smartlook": "/images/engineering/smartlook-alternatives-heatmaps.png",
};

function AdHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-[100] border-b border-slate-200/80 bg-white/90 py-3 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <img src="/rejourneyIcon-removebg-preview.png" alt="Rejourney logo" className="h-8 w-8 object-contain" />
          <span className="text-lg font-black uppercase tracking-tight text-slate-950">Rejourney</span>
          <span className="hidden border-l border-slate-200 pl-3 text-xs font-bold text-slate-500 md:inline">Lightweight Product Analytics</span>
        </Link>
        <Link
          to="/login"
          className="group inline-flex min-h-[40px] items-center justify-center rounded-md border border-slate-950 bg-[#86efac] px-5 text-sm font-extrabold uppercase text-black shadow-[2px_2px_0_#0f172a] transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#6ee7a0] active:translate-y-0 active:shadow-none"
        >
          Start free
        </Link>
      </div>
    </header>
  );
}

function AdHero({ page }: { page: SeoPage }) {
  const headline = AD_LANDING_HEADLINES[page.path] ?? page.title;
  const subheadline = AD_LANDING_SUBHEADLINES[page.path] ?? page.subtitle;
  const heroImage = AD_LANDING_HERO_IMAGES[page.path] ?? page.image;
  const eyebrow = page.path === "/website-analytics"
    ? "Analytics tool for websites"
    : page.path === "/app-analytics"
      ? "In-app behavior analytics"
      : page.kind === "alternative"
        ? "Lightweight product analytics alternative"
        : "Lightweight product analytics";

  return (
    <section className="relative overflow-hidden bg-[#fdfbf7] pb-20 pt-28 px-4 sm:px-6 lg:px-8">
      {/* Soft Ambient Glows */}
      <div className="absolute top-[-10%] left-[-10%] h-[500px] w-[500px] rounded-full bg-indigo-200/15 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] h-[500px] w-[500px] rounded-full bg-emerald-200/15 blur-[120px] pointer-events-none" />

      <div className="relative z-10 mx-auto max-w-7xl grid gap-12 lg:grid-cols-12 lg:items-center">
        <div className="lg:col-span-6 flex flex-col items-start text-left">
          <span className="text-xs font-black uppercase text-indigo-600 tracking-wider mb-6 flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-indigo-500 animate-pulse" />
            {eyebrow}
          </span>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-tight text-slate-950 leading-[0.98] mb-6">
            {headline}
          </h1>
          <p className="text-lg sm:text-xl font-bold leading-relaxed text-slate-600 mb-8 max-w-xl">
            {subheadline}
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full sm:w-auto mb-8">
            <Link
              to="/login"
              className="group inline-flex min-h-[52px] min-w-[190px] items-center justify-center gap-2 rounded-md border border-slate-950 bg-[#86efac] px-8 text-[0.95rem] font-extrabold uppercase text-black shadow-[2px_2px_0_#0f172a] transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#6ee7a0] active:translate-y-0 active:shadow-none text-center"
            >
              <span>Start Free</span>
              <ArrowRight className="h-4.5 w-4.5 transition-transform group-hover:translate-x-0.5" strokeWidth={3} />
            </Link>
            <Link
              to="/demo"
              className="group inline-flex min-h-[52px] min-w-[190px] items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-8 text-[0.95rem] font-extrabold uppercase text-black shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-slate-350 hover:bg-[#ecfeff] hover:shadow-md active:translate-y-0 text-center"
            >
              Open live demo
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs sm:text-sm font-bold text-slate-800">
            <span className="flex items-center gap-1.5">
              <Check className="h-4 w-4 text-emerald-600" strokeWidth={3} />
              5,000 sessions free / mo
            </span>
            <span className="flex items-center gap-1.5">
              <Check className="h-4 w-4 text-emerald-600" strokeWidth={3} />
              No credit card required
            </span>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-sky-600" strokeWidth={2.5} />
              Privacy masking controls
            </span>
            <span className="flex items-center gap-1.5">
              <EuFlag className="h-4 w-6 shrink-0" />
              GDPR compliant
            </span>
          </div>
        </div>

        <div className="lg:col-span-6">
          <div className="relative">
            {/* Ambient drop shadow backdrop */}
            <div className="absolute inset-2 bg-indigo-500/10 blur-xl rounded-2xl pointer-events-none" />
            <div className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
              {/* Browser control bar */}
              <div className="flex items-center gap-1.5 pb-2.5 border-b border-slate-100 mb-2">
                <div className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                <div className="h-4 w-48 rounded bg-slate-50 ml-4 flex items-center px-2 text-[8px] text-slate-400 font-bold select-none">rejourney.co{page.path}</div>
              </div>
              <img
                src={optimizedMarketingImage(heroImage)}
                alt={page.imageAlt}
                className="h-auto max-h-[460px] w-full rounded-lg object-contain"
                decoding="async"
              />
            </div>
            {page.kind === "alternative" ? (
              <div className="absolute -bottom-10 -right-2 z-20 rounded-full bg-[#fff19c] p-1.5 shadow-[3px_4px_0_#0f172a] sm:-right-6">
                <img
                  src="/images/rejourney-cat.webp"
                  alt="Rejourney cat mascot"
                  width={288}
                  height={288}
                  className="h-20 w-20 drop-shadow-[0_8px_8px_rgba(15,23,42,0.14)] sm:h-24 sm:w-24"
                  decoding="async"
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function AdTrustBanner() {
  const [activeStory, setActiveStory] = React.useState<'burst' | 'merch'>('burst');

  return (
    <section className="border-y border-slate-200/80 bg-[#fafafa] py-16 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 mb-10">
          <div className="text-left">
            <span className="text-xs font-black uppercase text-indigo-600 tracking-wider mb-3 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse" />
              Success Stories
            </span>
            <h2 className="text-2xl sm:text-4xl font-black uppercase text-slate-950 leading-none">
              Real Teams. Real Revenue Recovered.
            </h2>
          </div>
        </div>

        <div className="relative px-14 sm:px-20">
          {/* Side Gallery Navigation */}
          <button
            onClick={() => setActiveStory(activeStory === 'burst' ? 'merch' : 'burst')}
            className="absolute left-0 sm:left-2 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-800 shadow-md hover:bg-slate-50 hover:text-black transition-all active:scale-95 shrink-0"
            aria-label="Previous story"
          >
            <ChevronLeft className="h-5 w-5 stroke-[2.5px]" />
          </button>
          <button
            onClick={() => setActiveStory(activeStory === 'burst' ? 'merch' : 'burst')}
            className="absolute right-0 sm:right-2 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-800 shadow-md hover:bg-slate-50 hover:text-black transition-all active:scale-95 shrink-0"
            aria-label="Next story"
          >
            <ChevronRight className="h-5 w-5 stroke-[2.5px]" />
          </button>

          {/* Case study card */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 sm:p-10 shadow-sm">
            {activeStory === 'burst' ? (
              <div>
                {/* Top: logo circle + headline */}
                <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-5 mb-10 pb-10 border-b border-slate-100">
                  <div className="h-16 w-16 rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm shrink-0 flex items-center justify-center p-1.5">
                    <img
                      src="/images/burst-creatine-logo-red.webp"
                      alt="Burst Creatine"
                      className="h-full w-full object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-sans text-xl sm:text-2xl font-black uppercase leading-tight tracking-tight text-slate-955">
                      Burst Creatine Increased Sales by 103%
                    </h3>
                    <p className="text-sm font-bold leading-relaxed text-slate-500 max-w-xl">
                      Rejourney surfaced the UX friction points causing checkout drop-offs. Simple fixes, no guesswork.
                    </p>
                  </div>
                </div>

                {/* Sankey diagrams */}
                <div className="grid gap-8 lg:grid-cols-2">
                  <SankeyPanel
                    title="Before Rejourney"
                    addToCart={6810}
                    checkout={2130}
                    accent="#ef4444"
                    accentLight="rgba(239,68,68,0.15)"
                    dropColor="#94a3b8"
                    dropLight="rgba(148,163,184,0.1)"
                  />
                  <SankeyPanel
                    title="After Rejourney"
                    addToCart={6810}
                    checkout={4319}
                    accent="#10b981"
                    accentLight="rgba(16,185,129,0.15)"
                    dropColor="#94a3b8"
                    dropLight="rgba(148,163,184,0.08)"
                  />
                </div>

                {/* Result line */}
                <p className="mt-8 text-center text-sm font-extrabold text-slate-700">
                  Same Meta Ads Budget. <span className="text-emerald-600 font-black">+2,189 more checkouts</span> from fixing easy UX leaks.
                </p>
              </div>
            ) : (
              <div>
                {/* Top: logo circle + headline */}
                <div className="flex flex-col sm:flex-row items-center sm:items-start text-center sm:text-left gap-5 mb-10 pb-10 border-b border-slate-100">
                  <div className="h-16 w-16 rounded-2xl overflow-hidden border border-slate-200 bg-white shadow-sm shrink-0 flex items-center justify-center p-1">
                    <img
                      src="/images/customer-onboarding-logo.webp"
                      alt="Campus Merch Live"
                      className="h-full w-full object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <div className="space-y-2">
                    <h3 className="font-sans text-xl sm:text-2xl font-black uppercase leading-tight tracking-tight text-slate-955">
                      Campus Merch Live Increased Onboarding to 93%
                    </h3>
                    <p className="text-sm font-bold leading-relaxed text-slate-500 max-w-xl">
                      Rejourney revealed where new users were getting stuck, turning onboarding friction into a clear path.
                    </p>
                  </div>
                </div>

                {/* Sankey diagrams */}
                <div className="grid gap-8 lg:grid-cols-2">
                  <SankeyPanel
                    title="Before Rejourney"
                    addToCart={4500}
                    checkout={3555}
                    accent="#ef4444"
                    accentLight="rgba(239,68,68,0.15)"
                    dropColor="#94a3b8"
                    dropLight="rgba(148,163,184,0.1)"
                    sourceLabel="Signups"
                    completionLabel="Verified"
                  />
                  <SankeyPanel
                    title="After Rejourney"
                    addToCart={4500}
                    checkout={4185}
                    accent="#10b981"
                    accentLight="rgba(16,185,129,0.15)"
                    dropColor="#94a3b8"
                    dropLight="rgba(148,163,184,0.08)"
                    sourceLabel="Signups"
                    completionLabel="Verified"
                  />
                </div>

                {/* Result line */}
                <p className="mt-8 text-center text-sm font-extrabold text-slate-700">
                  Same Onboarding Traffic. <span className="text-emerald-600 font-black">+630 more verified users</span> from fixing safari layout bug.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function AdBenefits({ page }: { page: SeoPage }) {
  const defaultBenefits = [
    {
      title: "Identify UX Friction",
      desc: "Watch session replays of gestures, screen paths, backtrack loops, and rage clicks. Investigate the sessions behind checkout drops and conversion friction.",
      image: "/images/landing-replay-workbench.png",
      imageAlt: "Rejourney Session Replay Workbench",
      badge: "Session Replay",
      color: "indigo"
    },
    {
      title: "Quantify Revenue Severity",
      desc: "Connect replays to Stripe, RevenueCat, or Superwall events. Review conversion leaks and API errors beside the sessions and revenue events they affected.",
      image: "/images/growth-engines.png",
      imageAlt: "Rejourney Revenue Analytics",
      badge: "Revenue Analytics",
      color: "emerald"
    },
    {
      title: "Exact Reproduction Steps",
      desc: "Triage stability issues with console logs, network payloads, and stack traces. Share the replay and diagnostic context with engineering for reproduction.",
      image: "/images/anr-issues.png",
      imageAlt: "Rejourney Crash Triage Dashboard",
      badge: "Crash & ANR Triage",
      color: "amber"
    }
  ];
  const benefitsByPath: Record<string, typeof defaultBenefits> = {
    "/website-analytics": [
      {
        title: "Know What Changed",
        desc: "Track active users, engagement, retention, traffic sources, releases, and stability in one view. Spot the segment or route that deserves a closer look.",
        image: "/images/readme/analytics-overview.png",
        imageAlt: "Website analytics overview with active users, engagement, retention, and stability",
        badge: "Website Analytics",
        color: "indigo"
      },
      {
        title: "See Why Visitors Leave",
        desc: "Open the real sessions behind signup, onboarding, and checkout drop-offs. Watch the clicks, route changes, hesitation, and interface state a chart cannot explain.",
        image: "/images/engineering/conversion-funnel-journey-map.png",
        imageAlt: "Conversion funnel and journey map connected to user sessions",
        badge: "Funnels + Replay",
        color: "emerald"
      },
      {
        title: "See What Gets Attention",
        desc: "Use click, scroll, and attention heatmaps to see which sections visitors notice, where they stop, and where repeated clicks signal confusion. Open the matching replays to understand why the pattern formed.",
        image: "/images/engineering/heatmaps-attention-docs.png",
        imageAlt: "Website attention heatmap showing viewed sections, clicks, and visitor engagement",
        badge: "Heatmaps + Replay",
        color: "indigo"
      },
      {
        title: "Find the Broken Step",
        desc: "Connect failed requests, console errors, releases, and browser context to the affected session. Give engineering evidence instead of a vague conversion dip.",
        image: "/images/engineering/api-error-rate-spike.png",
        imageAlt: "API error-rate spike with failing endpoints and diagnostic context",
        badge: "Technical Context",
        color: "amber"
      }
    ],
    "/app-analytics": [
      {
        title: "Measure In-App Behavior",
        desc: "Follow active users, engagement, retention, session volume, releases, and degraded sessions across your mobile product—not just installs at the store.",
        image: "/images/engineering/product-tools-live-general.png",
        imageAlt: "Mobile app analytics dashboard with active users, retention, sessions, and stability",
        badge: "App Analytics",
        color: "indigo"
      },
      {
        title: "Replay the Exact Mobile Session",
        desc: "Watch screens, taps, gestures, and navigation with console and network context. Investigate real sessions across Flutter, React Native, Expo, and Swift.",
        image: "/images/engineering/product-tools-live-replay.png",
        imageAlt: "Mobile session replay with timeline, console, network, and device context",
        badge: "Mobile Replay",
        color: "emerald"
      },
      {
        title: "Connect Crashes to Real Users",
        desc: "See crashes, errors, and ANRs beside the app version, device, affected route, and replay evidence. Start debugging from the experience that actually failed.",
        image: "/images/engineering/product-tools-live-stability.png",
        imageAlt: "Mobile stability dashboard showing crashes, errors, ANRs, and affected users",
        badge: "Stability",
        color: "amber"
      }
    ]
  };
  const benefits = benefitsByPath[page.path] ?? defaultBenefits;
  const sectionCopy = page.path === "/website-analytics"
    ? {
        eyebrow: "From metric to session",
        title: "UNDERSTAND WHAT CHANGED—AND WHY",
      }
    : page.path === "/app-analytics"
      ? {
          eyebrow: "Built for in-app behavior",
          title: "ONE VIEW FROM ENGAGEMENT TO CRASH",
        }
      : {
          eyebrow: "Recovery Workflow",
          title: "EVIDENCE FOR CONVERSION AND PRODUCT WORK",
        };

  return (
    <section className="border-b border-slate-200/85 bg-white py-20 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl text-center">
        <span className="text-xs font-black uppercase text-emerald-600 tracking-wider mb-6 flex items-center justify-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          {sectionCopy.eyebrow}
        </span>
        <h2 className="text-3xl sm:text-5xl font-black uppercase text-slate-950 mb-16 max-w-3xl mx-auto leading-none">
          {sectionCopy.title}
        </h2>
        
        <div className="space-y-24 text-left">
          {benefits.map((b, idx) => {
            const isEven = idx % 2 === 0;
            return (
              <div key={b.title} className="grid gap-12 lg:grid-cols-12 lg:items-center">
                <div className={`lg:col-span-5 space-y-5 ${isEven ? "lg:order-first" : "lg:order-last"}`}>
                  <span className={`text-xs font-black uppercase tracking-wide flex items-center gap-1.5 ${
                    b.color === "indigo" ? "text-indigo-600" :
                    b.color === "emerald" ? "text-emerald-600" :
                    "text-amber-600"
                  }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${
                      b.color === "indigo" ? "bg-indigo-500 animate-pulse" :
                      b.color === "emerald" ? "bg-emerald-500 animate-pulse" :
                      "bg-amber-500 animate-pulse"
                    }`} />
                    {b.badge}
                  </span>
                  <h3 className="text-2xl sm:text-3xl font-black uppercase text-slate-950 leading-tight">
                    {b.title}
                  </h3>
                  <p className="text-base sm:text-lg font-bold leading-relaxed text-slate-500">
                    {b.desc}
                  </p>
                </div>
                
                <div className="lg:col-span-7">
                  <div className="relative">
                    <div className="absolute inset-2 bg-slate-900/5 blur-xl rounded-2xl pointer-events-none" />
                    <div className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-white p-2 shadow-md">
                      {/* Browser control bar */}
                      <div className="flex items-center gap-1.5 pb-2 border-b border-slate-100 mb-1.5">
                        <div className="h-2 w-2 rounded-full bg-rose-400" />
                        <div className="h-2 w-2 rounded-full bg-amber-400" />
                        <div className="h-2 w-2 rounded-full bg-emerald-400" />
                      </div>
                      <img
                        src={optimizedMarketingImage(b.image)}
                        alt={b.imageAlt}
                        className="h-auto max-h-[360px] w-full rounded-md object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const websiteAnalyticsPlatforms = [
  { label: "Next.js / React", Icon: MarkNextJs, iconClass: "text-slate-950", href: "/docs/web/getting-started#nextjs" },
  { label: "Redux Toolkit", Icon: MarkRedux, iconClass: "text-[#764abc]", href: "/docs/web/getting-started#redux-and-redux-toolkit" },
  { label: "Vue / Nuxt", Icon: MarkVue, iconClass: "text-[#42b883]", href: "/docs/web/getting-started#vue" },
  { label: "Angular", Icon: MarkAngular, iconClass: "text-[#dd0031]", href: "/docs/web/getting-started#angular" },
  { label: "SvelteKit", Icon: MarkSvelte, iconClass: "text-[#ff3e00]", href: "/docs/web/getting-started#svelte-sveltekit" },
  { label: "Remix", Icon: MarkRemix, iconClass: "text-slate-950", href: "/docs/web/getting-started#remix" },
  { label: "Gatsby", Icon: MarkGatsby, iconClass: "text-[#663399]", href: "/docs/web/getting-started" },
  { label: "Shopify", Icon: MarkShopify, iconClass: "text-[#95bf47]", href: "/docs/shopify/getting-started" },
  { label: "Hydrogen", Icon: MarkHydrogen, iconClass: "text-[#00a878]", href: "/docs/web/getting-started" },
];

function WebsiteAnalyticsInstallation() {
  const setupLines = [
    <><span className="text-fuchsia-300">import</span> <span className="text-slate-100">&#123; Rejourney &#125;</span> <span className="text-fuchsia-300">from</span> <span className="text-emerald-300">'@rejourneyco/browser'</span>;</>,
    <>Rejourney.<span className="text-sky-300">init</span>(<span className="text-emerald-300">'rj_live_your_key'</span>);</>,
    <>Rejourney.<span className="text-sky-300">start</span>();</>,
  ];

  return (
    <section className="border-b border-slate-200/80 bg-[#fffaf0] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto mb-12 max-w-3xl text-center">
          <span className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-amber-800">
            One lightweight web SDK
          </span>
          <h2 className="text-balance font-display text-4xl font-black leading-[1.02] tracking-[-0.04em] text-slate-950 sm:text-5xl">
            Three lines from install to insight
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base font-bold leading-relaxed text-slate-600 sm:text-lg">
            Install the browser package once, initialize Rejourney, and start capturing website analytics with replay, heatmaps, journeys, and technical context attached.
          </p>
        </div>

        <div className="grid overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)] lg:grid-cols-[0.8fr_1.2fr]">
          <div className="flex flex-col justify-between border-b border-slate-200 bg-[#fdfbf7] p-6 sm:p-8 lg:border-b-0 lg:border-r">
            <div>
              <span className="text-sm font-semibold text-emerald-800">
                One package
              </span>
              <h3 className="mt-4 text-2xl font-black leading-tight text-slate-950 sm:text-3xl">
                Add it without rebuilding your stack
              </h3>
              <p className="mt-4 text-base font-bold leading-relaxed text-slate-600">
                The same web SDK works across modern frameworks and traditional browser apps. Your analytics events stay connected to the session that explains them.
              </p>
              <div className="mt-6 space-y-3">
                {["Unlimited analytics events", "Replay and heatmaps included", "Privacy controls built in"].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-sm font-extrabold text-slate-800">
                    <Check className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={3} />
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-8 rounded-xl border border-slate-800 bg-slate-950 px-4 py-4 font-mono text-sm text-emerald-300 shadow-inner sm:text-base">
              <span className="mr-2 text-slate-500">$</span>
              npm install @rejourneyco/browser
            </div>
          </div>

          <div className="bg-slate-950 p-4 text-left sm:p-6 lg:p-8">
            <div className="mb-6 border-b border-slate-800 pb-4 text-right font-mono text-xs font-medium text-slate-400">
              Three-line setup
            </div>

            <div className="space-y-3 font-mono text-[10px] sm:text-sm lg:text-base">
              {setupLines.map((line, index) => (
                <div key={index} className="grid min-w-0 grid-cols-[2rem_1fr] items-start overflow-hidden border-b border-slate-800 bg-slate-900/35 sm:grid-cols-[2.25rem_1fr]">
                  <span className="grid h-full min-h-14 place-items-center border-r border-slate-800 bg-slate-900 text-xs font-black text-sky-300">
                    {index + 1}
                  </span>
                  <code className="overflow-x-auto whitespace-nowrap px-3 py-4 text-slate-100 sm:px-4">
                    {line}
                  </code>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-2 text-xs font-bold text-slate-400">
              <span className="rounded border border-slate-800 px-3 py-1.5">No build-time plugin</span>
              <span className="rounded border border-slate-800 px-3 py-1.5">No framework lock-in</span>
              <span className="rounded border border-slate-800 px-3 py-1.5">Starts immediately</span>
            </div>
          </div>
        </div>

        <div className="mt-12 border-y border-slate-200 px-2 py-7 sm:px-4">
          <div className="mb-6 text-center">
            <span className="text-sm font-semibold text-emerald-800">Works with your web stack</span>
            <p className="mt-2 text-sm font-bold text-slate-500">Use the same three-line setup across every supported web platform.</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {websiteAnalyticsPlatforms.map(({ label, Icon, iconClass, href }) => (
              <Link
                key={label}
                to={href}
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 font-mono text-[11px] font-semibold text-slate-800 transition-colors hover:border-emerald-300 hover:bg-emerald-50/30"
              >
                <Icon className={`h-4 w-4 shrink-0 ${iconClass}`} />
                {label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AdInstallation({ page }: { page: SeoPage }) {
  const allTabs = [
    { id: "web", label: "Web / React", command: "npm install @rejourneyco/browser", code: `import { Rejourney } from '@rejourneyco/browser';\n\nRejourney.init('rj_live_your_key');\nRejourney.start();` },
    { id: "reactnative", label: "React Native / Expo", command: "npm install @rejourneyco/react-native", code: `import { Rejourney } from '@rejourneyco/react-native';\n\nRejourney.init('rj_live_your_key');\nRejourney.start();` },
    { id: "flutter", label: "Flutter", command: "flutter pub add rejourney", code: `import 'package:rejourney/rejourney.dart';\n\nawait Rejourney.init('rj_live_your_key');\nawait Rejourney.start();` },
    { id: "swift", label: "Swift / iOS", command: "SPM: https://github.com/rejourneyco/rejourney", code: `import Rejourney\n\nRejourney.configure(publicKey: "rj_your_key")\nTask { await Rejourney.start() }` }
  ];
  const isWebsiteAnalytics = page.path === "/website-analytics";
  const isAppAnalytics = page.path === "/app-analytics";
  const tabs = isWebsiteAnalytics
    ? allTabs.filter((tab) => tab.id === "web")
    : isAppAnalytics
      ? allTabs.filter((tab) => tab.id !== "web")
      : allTabs;
  const defaultTab = isAppAnalytics ? "reactnative" : "web";
  const [activeTab, setActiveTab] = React.useState(defaultTab);
  const effectiveActiveTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : defaultTab;
  const currentTab = tabs.find(t => t.id === effectiveActiveTab) || tabs[0];

  if (isWebsiteAnalytics) {
    return <WebsiteAnalyticsInstallation />;
  }

  const installationCopy = isWebsiteAnalytics
    ? {
        eyebrow: "One lightweight web SDK",
        title: "Add website analytics in minutes",
        description: "Install the browser package, initialize Rejourney, and start connecting analytics events to complete website sessions.",
      }
    : isAppAnalytics
      ? {
          eyebrow: "Mobile SDKs included",
          title: "Start with your app framework",
          description: "Choose React Native / Expo, Flutter, or Swift and add in-app analytics, replay, and stability context with the matching SDK.",
        }
      : {
          eyebrow: "Developer friendly",
          title: "Get set up with your SDK",
          description: "Choose the web, React Native / Expo, Flutter, or Swift setup and follow the matching SDK documentation.",
        };
  const setupPills = isWebsiteAnalytics
    ? ["Web SDK", "React", "Framework adapters", "Privacy controls"]
    : isAppAnalytics
      ? ["React Native", "Expo Plugin", "Flutter", "Swift iOS", "CocoaPods"]
      : ["Web SDK", "React Native", "Expo Plugin", "Flutter", "Swift iOS", "CocoaPods"];

  return (
    <section className="border-b border-slate-200/80 bg-[#fdfbf7] px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <span className="mb-4 flex items-center justify-center text-sm font-semibold text-amber-800">
          {installationCopy.eyebrow}
        </span>
        <h2 className="text-balance font-display text-4xl font-black leading-[1.02] tracking-[-0.04em] text-slate-950 sm:text-5xl mb-4">
          {installationCopy.title}
        </h2>
        <p className="text-base sm:text-lg font-bold text-slate-500 mb-10 max-w-2xl mx-auto">
          {installationCopy.description}
        </p>

        {/* Custom Tab selectors */}
        <div className={`mb-8 rounded-lg border border-slate-200 bg-slate-100 p-1 ${tabs.length === 1 ? "inline-flex" : "inline-grid grid-cols-2 sm:inline-flex"}`}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`rounded-md px-4 py-2 text-center font-sans text-xs font-semibold transition-colors sm:px-5 sm:text-sm ${
                effectiveActiveTab === tab.id
                  ? "bg-white text-slate-950 shadow-sm border border-slate-200/50"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Sleek Terminal / Code Box */}
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-left font-mono text-white shadow-[0_8px_28px_rgba(15,23,42,0.1)]">
          <div className="flex items-center justify-end border-b border-slate-800 bg-slate-900/50 px-4 py-3 text-xs text-slate-500 select-none">
            <span>Terminal setup</span>
          </div>
          <div className="p-4 sm:p-5 select-all text-sm sm:text-base text-emerald-400 leading-normal">
            <span className="text-slate-600 mr-2">$</span>
            {currentTab.command}
          </div>
          
          <div className="border-t border-slate-850 bg-slate-900/30 px-4 py-2 flex items-center justify-between text-xs text-slate-500 select-none">
            <span>Setup file</span>
          </div>
          <pre className="p-4 sm:p-5 text-xs sm:text-sm text-slate-100 overflow-x-auto whitespace-pre leading-relaxed select-all">
            {currentTab.code}
          </pre>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-x-5 gap-y-3 border-y border-slate-200 py-5">
          {setupPills.map((pill) => (
            <span key={pill} className="text-xs font-semibold text-slate-600">
              {pill}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

type ReplayPlatform = "web" | "mobile";

type CompetitorPricingModel =
  | "posthog"
  | "sentry"
  | "datadog"
  | "amplitude"
  | "mixpanel"
  | "pendo"
  | "smartlook"
  | "contentsquare"
  | "fullstory";

type CompetitorPricingConfig = {
  model: CompetitorPricingModel;
  name: string;
  sourceLabel: string;
  sourceHref: string;
  publicFact: string;
};

const replayVolumeSteps = [5_000, 10_000, 25_000, 50_000, 100_000, 350_000, 1_000_000] as const;

const competitorPricingByPath: Record<string, CompetitorPricingConfig> = {
  "/alternatives/posthog-session-replay": {
    model: "posthog",
    name: "PostHog",
    sourceLabel: "PostHog pricing",
    sourceHref: "https://posthog.com/pricing",
    publicFact: "5K web or 2.5K mobile replays free, then progressive per-recording rates.",
  },
  "/alternatives/sentry-session-replay": {
    model: "sentry",
    name: "Sentry",
    sourceLabel: "Sentry pricing",
    sourceHref: "https://sentry.io/pricing/",
    publicFact: "50 replays included; Team starts at $26/mo billed annually, with replay usage billed separately.",
  },
  "/alternatives/datadog-session-replay": {
    model: "datadog",
    name: "Datadog",
    sourceLabel: "Datadog RUM pricing",
    sourceHref: "https://www.datadoghq.com/pricing/?product=real-user-monitoring",
    publicFact: "Session Replay starts at $2.50 per 1K sessions on annual billing, in addition to RUM.",
  },
  "/alternatives/amplitude-session-replay": {
    model: "amplitude",
    name: "Amplitude",
    sourceLabel: "Amplitude pricing",
    sourceHref: "https://amplitude.com/pricing",
    publicFact: "10K monthly replays on Free, 20K on Growth, and 50K on Enterprise; paid prices are volume-based or custom.",
  },
  "/alternatives/mixpanel-session-replay": {
    model: "mixpanel",
    name: "Mixpanel",
    sourceLabel: "Mixpanel pricing",
    sourceHref: "https://mixpanel.com/pricing/",
    publicFact: "10K monthly replays on Free and 20K on Growth; larger replay allowances are customizable.",
  },
  "/alternatives/pendo-session-replay": {
    model: "pendo",
    name: "Pendo",
    sourceLabel: "Pendo pricing",
    sourceHref: "https://www.pendo.io/pricing/",
    publicFact: "Session Replay is included on Core and Ultimate, both with custom MAU-based pricing.",
  },
  "/alternatives/smartlook": {
    model: "smartlook",
    name: "Smartlook",
    sourceLabel: "Cisco Smartlook EOL notice",
    sourceHref: "https://www.cisco.com/c/en/us/products/collateral/software/smartlook-com-eol.html",
    publicFact: "Smartlook reached end of sale on May 31, 2026; new standalone pricing is no longer a buying path.",
  },
  "/alternatives/hotjar": {
    model: "contentsquare",
    name: "Contentsquare",
    sourceLabel: "Contentsquare pricing",
    sourceHref: "https://contentsquare.com/pricing/",
    publicFact: "Free captures 5% up to 10K replays; Growth starts at $49/mo annually with session-based sampling.",
  },
  "/alternatives/fullstory": {
    model: "fullstory",
    name: "Fullstory",
    sourceLabel: "Fullstory plans",
    sourceHref: "https://www.fullstory.com/plans/",
    publicFact: "FullstoryFree includes 30K web sessions; paid plans and Mobile require pricing requests.",
  },
};

const formatReplayVolume = (sessions: number) => {
  if (sessions >= 1_000_000) return `${sessions / 1_000_000}M`;
  if (sessions >= 1_000) return `${sessions / 1_000}K`;
  return sessions.toLocaleString("en-US");
};

const formatMonthlyPrice = (price: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(price) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(price);

const rejourneyReplayPrice = (sessions: number) => {
  if (sessions <= 5_000) return { price: 0, plan: "Free" };
  if (sessions <= 25_000) return { price: 5, plan: "Starter" };
  if (sessions <= 100_000) return { price: 15, plan: "Growth" };
  if (sessions <= 350_000) return { price: 35, plan: "Pro" };
  return { price: 149, plan: "Scale" };
};

const progressiveReplayPrice = (
  sessions: number,
  tiers: Array<{ from: number; to?: number; rate: number }>,
) => tiers.reduce((total, tier) => {
  const upper = Math.min(sessions, tier.to ?? sessions);
  return upper > tier.from ? total + (upper - tier.from) * tier.rate : total;
}, 0);

const postHogReplayPrice = (sessions: number, platform: ReplayPlatform) => {
  const tiers = platform === "mobile"
    ? [
        { from: 2_500, to: 15_000, rate: 0.01 },
        { from: 15_000, to: 50_000, rate: 0.007 },
        { from: 50_000, to: 150_000, rate: 0.004 },
        { from: 150_000, to: 500_000, rate: 0.0034 },
        { from: 500_000, rate: 0.003 },
      ]
    : [
        { from: 5_000, to: 15_000, rate: 0.005 },
        { from: 15_000, to: 50_000, rate: 0.0035 },
        { from: 50_000, to: 150_000, rate: 0.002 },
        { from: 150_000, to: 500_000, rate: 0.0017 },
        { from: 500_000, rate: 0.0015 },
      ];

  return progressiveReplayPrice(sessions, tiers);
};

type CompetitorPriceResult = {
  priceLabel: string;
  detail: string;
  numericMonthly?: number;
};

type SeoCalculatorLocale = "en" | LocalizedSeoPage["localeCode"];

const seoCalculatorLabels: Record<SeoCalculatorLocale, {
  replayCalculator: string;
  priceSessions: (volume: string) => string;
  replayIntro: string;
  capturedSessions: string;
  web: string;
  mobile: string;
  replayPlanDetail: string;
  customQuote: string;
  vendorPricingNote: (vendor: string) => string;
  saves: (amount: string) => string;
  methodology: string;
  analyticsCalculator: string;
  websiteHeading: string;
  appHeading: string;
  websiteIntro: string;
  appIntro: string;
  capturedReplays: string;
  analyticsEvents: string;
  activeUsers: string;
  compareWith: string;
  analyticsPlanDetail: (sessions: string) => string;
  howCalculated: string;
  included: string;
  estimateInputs: string;
  unlimited: string;
  pricing: string;
  perMonth: string;
}> = {
  en: {
    replayCalculator: "Replay pricing calculator", priceSessions: (volume) => `Price ${volume} captured sessions`, replayIntro: "One monthly replay volume, compared against each vendor's current public pricing.", capturedSessions: "Captured sessions / month", web: "web", mobile: "mobile", replayPlanDetail: "The same replay allowance for web and mobile, with unlimited analytics events included.", customQuote: "Custom quote", vendorPricingNote: (vendor) => `${vendor} pricing depends on its plan and usage allowances. Review the official source for the current rate.`, saves: (amount) => `Rejourney saves ${amount}/mo at this volume`, methodology: "Estimates exclude taxes, negotiated discounts, retention upgrades, and unrelated add-ons. Custom means the vendor does not publish enough data for an honest dollar estimate.", analyticsCalculator: "Analytics pricing calculator", websiteHeading: "Price the full website signal", appHeading: "Price the full app signal", websiteIntro: "Compare website replay, analytics events, and active users—not a replay allowance in isolation.", appIntro: "Compare mobile replay, in-app events, and active users—not an app-store metric in isolation.", capturedReplays: "Captured session replays / month", analyticsEvents: "Analytics events / month", activeUsers: "Monthly active users", compareWith: "Compare with", analyticsPlanDetail: (sessions) => `${sessions} replays with unlimited analytics events, active users, and retention.`, howCalculated: "How this estimate is calculated", included: "Included with Rejourney", estimateInputs: "estimate inputs", unlimited: "unlimited", pricing: "Rejourney pricing", perMonth: "/mo",
  },
  ar: {
    replayCalculator: "حاسبة أسعار إعادة الجلسات", priceSessions: (volume) => `سعّر ${volume} جلسة مسجلة`, replayIntro: "قارن حجم إعادة الجلسات الشهري نفسه بالأسعار العامة الحالية لكل مزود.", capturedSessions: "الجلسات المسجلة شهريًا", web: "الويب", mobile: "الجوال", replayPlanDetail: "الحصة نفسها للويب والجوال، مع أحداث تحليلات غير محدودة.", customQuote: "عرض سعر مخصص", vendorPricingNote: (vendor) => `يعتمد سعر ${vendor} على الباقة وحصص الاستخدام. راجع المصدر الرسمي للسعر الحالي.`, saves: (amount) => `يوفر Rejourney مبلغ ${amount} شهريًا عند هذا الحجم`, methodology: "لا تشمل التقديرات الضرائب والخصومات المتفاوض عليها وترقيات الاحتفاظ والإضافات غير المرتبطة. السعر المخصص يعني أن المزود لا ينشر بيانات كافية لتقدير دقيق.", analyticsCalculator: "حاسبة أسعار التحليلات", websiteHeading: "سعّر إشارات الموقع كاملة", appHeading: "سعّر إشارات التطبيق كاملة", websiteIntro: "قارن إعادة جلسات الموقع وأحداث التحليلات والمستخدمين النشطين، لا حصة الإعادة وحدها.", appIntro: "قارن إعادة جلسات الجوال والأحداث داخل التطبيق والمستخدمين النشطين.", capturedReplays: "إعادات الجلسات المسجلة شهريًا", analyticsEvents: "أحداث التحليلات شهريًا", activeUsers: "المستخدمون النشطون شهريًا", compareWith: "قارن مع", analyticsPlanDetail: (sessions) => `${sessions} جلسة مع أحداث تحليلات ومستخدمين نشطين واحتفاظ غير محدودة.`, howCalculated: "كيف حُسب هذا التقدير", included: "المشمول مع Rejourney", estimateInputs: "مدخلات التقدير", unlimited: "غير محدودة", pricing: "أسعار Rejourney", perMonth: "/شهر",
  },
  es: {
    replayCalculator: "Calculadora de precios de replay", priceSessions: (volume) => `Calcula ${volume} sesiones capturadas`, replayIntro: "Compara el mismo volumen mensual con los precios públicos actuales de cada proveedor.", capturedSessions: "Sesiones capturadas al mes", web: "web", mobile: "móvil", replayPlanDetail: "La misma cuota para web y móvil, con eventos de analítica ilimitados.", customQuote: "Presupuesto personalizado", vendorPricingNote: (vendor) => `El precio de ${vendor} depende del plan y sus cuotas de uso. Consulta la fuente oficial.`, saves: (amount) => `Rejourney ahorra ${amount} al mes con este volumen`, methodology: "Las estimaciones excluyen impuestos, descuentos negociados, mejoras de retención y complementos no relacionados. Personalizado indica que no hay datos públicos suficientes.", analyticsCalculator: "Calculadora de precios de analítica", websiteHeading: "Calcula toda la señal del sitio web", appHeading: "Calcula toda la señal de la aplicación", websiteIntro: "Compara replay web, eventos de analítica y usuarios activos, no solo una cuota de replay.", appIntro: "Compara replay móvil, eventos dentro de la aplicación y usuarios activos.", capturedReplays: "Replays capturados al mes", analyticsEvents: "Eventos de analítica al mes", activeUsers: "Usuarios activos mensuales", compareWith: "Comparar con", analyticsPlanDetail: (sessions) => `${sessions} replays con eventos, usuarios activos y retención ilimitados.`, howCalculated: "Cómo se calcula esta estimación", included: "Incluido con Rejourney", estimateInputs: "datos de la estimación", unlimited: "ilimitados", pricing: "Precios de Rejourney", perMonth: "/mes",
  },
  fr: {
    replayCalculator: "Calculateur de prix du replay", priceSessions: (volume) => `Estimez ${volume} sessions capturées`, replayIntro: "Comparez le même volume mensuel aux tarifs publics actuels de chaque fournisseur.", capturedSessions: "Sessions capturées par mois", web: "web", mobile: "mobile", replayPlanDetail: "Le même quota pour le web et le mobile, avec des événements analytics illimités.", customQuote: "Devis personnalisé", vendorPricingNote: (vendor) => `Le prix de ${vendor} dépend du forfait et des quotas d’usage. Consultez la source officielle.`, saves: (amount) => `Rejourney économise ${amount} par mois à ce volume`, methodology: "Les estimations excluent taxes, remises négociées, extensions de rétention et options sans rapport. Personnalisé signifie que les données publiques ne suffisent pas.", analyticsCalculator: "Calculateur de prix analytics", websiteHeading: "Estimez tous les signaux du site", appHeading: "Estimez tous les signaux de l’application", websiteIntro: "Comparez replay web, événements analytics et utilisateurs actifs, pas seulement un quota de replay.", appIntro: "Comparez replay mobile, événements dans l’application et utilisateurs actifs.", capturedReplays: "Replays capturés par mois", analyticsEvents: "Événements analytics par mois", activeUsers: "Utilisateurs actifs mensuels", compareWith: "Comparer avec", analyticsPlanDetail: (sessions) => `${sessions} replays avec événements, utilisateurs actifs et rétention illimités.`, howCalculated: "Méthode de calcul", included: "Inclus avec Rejourney", estimateInputs: "données de l’estimation", unlimited: "illimités", pricing: "Tarifs Rejourney", perMonth: "/mois",
  },
  de: {
    replayCalculator: "Replay-Preisrechner", priceSessions: (volume) => `${volume} aufgezeichnete Sitzungen kalkulieren`, replayIntro: "Vergleichen Sie dasselbe Monatsvolumen mit den aktuellen öffentlichen Preisen der Anbieter.", capturedSessions: "Aufgezeichnete Sitzungen pro Monat", web: "Web", mobile: "Mobil", replayPlanDetail: "Dasselbe Kontingent für Web und Mobile, einschließlich unbegrenzter Analytics-Events.", customQuote: "Individuelles Angebot", vendorPricingNote: (vendor) => `Der Preis von ${vendor} hängt von Tarif und Nutzungskontingent ab. Prüfen Sie die offizielle Quelle.`, saves: (amount) => `Rejourney spart bei diesem Volumen ${amount} pro Monat`, methodology: "Schätzungen verstehen sich ohne Steuern, ausgehandelte Rabatte, Aufbewahrungs-Upgrades und sachfremde Add-ons. Individuell bedeutet, dass keine ausreichenden öffentlichen Daten vorliegen.", analyticsCalculator: "Analytics-Preisrechner", websiteHeading: "Das vollständige Website-Signal kalkulieren", appHeading: "Das vollständige App-Signal kalkulieren", websiteIntro: "Vergleichen Sie Website-Replay, Analytics-Events und aktive Nutzer, nicht nur ein Replay-Kontingent.", appIntro: "Vergleichen Sie Mobile Replay, In-App-Events und aktive Nutzer.", capturedReplays: "Aufgezeichnete Replays pro Monat", analyticsEvents: "Analytics-Events pro Monat", activeUsers: "Monatlich aktive Nutzer", compareWith: "Vergleichen mit", analyticsPlanDetail: (sessions) => `${sessions} Replays mit unbegrenzten Analytics-Events, aktiven Nutzern und Aufbewahrung.`, howCalculated: "So wird die Schätzung berechnet", included: "In Rejourney enthalten", estimateInputs: "Schätzungsgrundlagen", unlimited: "unbegrenzt", pricing: "Rejourney-Preise", perMonth: "/Monat",
  },
};

const getCompetitorReplayPrice = (
  config: CompetitorPricingConfig,
  sessions: number,
  platform: ReplayPlatform,
): CompetitorPriceResult => {
  switch (config.model) {
    case "posthog": {
      const price = postHogReplayPrice(sessions, platform);
      return {
        priceLabel: `${formatMonthlyPrice(price)}/mo`,
        detail: `Published ${platform} replay tiers, including the monthly free quota.`,
        numericMonthly: price,
      };
    }
    case "sentry":
      return sessions <= 50
        ? { priceLabel: "$0/mo", detail: "Developer includes 50 replays per month.", numericMonthly: 0 }
        : { priceLabel: "From $26/mo + usage", detail: "Team base on annual billing; Sentry meters replay volume above the included 50." };
    case "datadog": {
      const replayLine = (sessions / 1_000) * 2.5;
      return {
        priceLabel: `At least ${formatMonthlyPrice(replayLine)}/mo`,
        detail: "Annual Session Replay line item only. Required RUM charges are additional.",
        numericMonthly: replayLine,
      };
    }
    case "amplitude":
      if (sessions <= 10_000) return { priceLabel: "$0/mo", detail: "Free includes 10K monthly replays.", numericMonthly: 0 };
      if (sessions <= 20_000) return { priceLabel: "Custom Growth price", detail: "Growth lists 20K monthly replays; its event-based price is not public." };
      if (sessions <= 50_000) return { priceLabel: "Custom Enterprise price", detail: "Enterprise lists 50K monthly replays; its price is not public." };
      return { priceLabel: "Custom replay package", detail: "Amplitude sells custom monthly replay volume on Growth and Enterprise." };
    case "mixpanel":
      if (sessions <= 10_000) return { priceLabel: "$0/mo", detail: "Free includes 10K monthly replays.", numericMonthly: 0 };
      if (sessions <= 20_000) return { priceLabel: "$0 replay allowance", detail: "Growth includes 20K replays; the plan starts at $0 while usage stays inside its free event allowance.", numericMonthly: 0 };
      return { priceLabel: "Custom replay allowance", detail: "Mixpanel publishes customizable replay volume, but not its replay dollar rate." };
    case "pendo":
      return { priceLabel: "Custom quote", detail: "Replay is included on Core and Ultimate; both use custom MAU-based pricing." };
    case "smartlook":
      return { priceLabel: "Not available to buy", detail: "Cisco lists May 31, 2026 as Smartlook's end-of-sale date." };
    case "contentsquare":
      return sessions <= 10_000
        ? { priceLabel: "$0/mo", detail: "Free captures 5% of analyzed sessions, capped at 10K monthly replays.", numericMonthly: 0 }
        : { priceLabel: "From $49/mo", detail: "Growth starts at $49 annually and samples replays; exact cost depends on total analyzed sessions." };
    case "fullstory":
      if (platform === "web" && sessions <= 30_000) {
        return { priceLabel: "$0/mo", detail: "FullstoryFree includes 30K web sessions per month.", numericMonthly: 0 };
      }
      return {
        priceLabel: "Custom quote",
        detail: platform === "mobile"
          ? "Mobile is not included in FullstoryFree and is packaged through paid plans."
          : "Paid session volume is handled through a pricing request.",
      };
  }
};

function AdReplayPricingCalculator({ page, localizedPage }: { page: SeoPage; localizedPage?: LocalizedSeoPage }) {
  const config = competitorPricingByPath[page.path];
  const [volumeIndex, setVolumeIndex] = React.useState(4);
  const [platform, setPlatform] = React.useState<ReplayPlatform>("web");

  if (!config) return null;

  const sessions = replayVolumeSteps[volumeIndex];
  const rejourney = rejourneyReplayPrice(sessions);
  const competitor = getCompetitorReplayPrice(config, sessions, platform);
  const exactSavings = competitor.numericMonthly !== undefined && competitor.numericMonthly > rejourney.price
    ? competitor.numericMonthly - rejourney.price
    : null;
  const labels = seoCalculatorLabels[localizedPage?.localeCode ?? "en"];
  const localizedCompetitorPrice = localizedPage
    ? competitor.numericMonthly !== undefined
      ? `${formatMonthlyPrice(competitor.numericMonthly)}${labels.perMonth}`
      : labels.customQuote
    : competitor.priceLabel;
  const localizedCompetitorDetail = localizedPage
    ? labels.vendorPricingNote(config.name)
    : competitor.detail;

  return (
    <section className="border-b border-black/10 bg-[#f7f6f1] px-5 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto mb-9 max-w-3xl text-center">
          <span className="mb-5 flex items-center justify-center gap-1.5 text-sm font-semibold text-emerald-800">
            <BadgeDollarSign className="h-4 w-4" aria-hidden />
            {labels.replayCalculator}
          </span>
          <h2 className="text-balance font-display text-4xl font-black leading-[1.02] tracking-[-0.04em] text-slate-950 sm:text-5xl">
            {labels.priceSessions(formatReplayVolume(sessions))}
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base font-bold leading-7 text-slate-500">
            {labels.replayIntro}
          </p>
        </div>

        <div className="border-y border-slate-300 bg-white px-1 py-7 sm:px-5">
          <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-end">
            <label className="block">
              <span className="flex items-center justify-between gap-4 text-sm font-bold text-slate-900">
                {labels.capturedSessions}
                <output className="font-mono text-lg text-emerald-700">{formatReplayVolume(sessions)}</output>
              </span>
              <input
                type="range"
                min="0"
                max={replayVolumeSteps.length - 1}
                step="1"
                value={volumeIndex}
                onChange={(event) => setVolumeIndex(Number(event.target.value))}
                className="mt-4 h-2 w-full cursor-pointer accent-emerald-600"
                aria-label={labels.capturedSessions}
                aria-valuetext={`${labels.capturedSessions}: ${sessions.toLocaleString(localizedPage?.locale.languageTag)}`}
              />
              <span className="mt-2 flex justify-between font-mono text-[10px] font-bold uppercase text-slate-400">
                <span>5K</span><span>1M</span>
              </span>
            </label>

            <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1" aria-label={localizedPage?.ui.platformHeading ?? "Replay platform"}>
              {(["web", "mobile"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPlatform(option)}
                  aria-pressed={platform === option}
                  className={`rounded-md px-5 py-2 text-xs font-bold transition ${
                    platform === option ? "bg-slate-950 text-white shadow-sm" : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  {option === "web" ? labels.web : labels.mobile}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-7 grid border-t border-slate-200 md:grid-cols-2">
            <div className="border-b border-slate-200 py-6 md:border-b-0 md:border-e md:pe-7">
              <p className="text-sm font-semibold text-emerald-800">Rejourney · {rejourney.plan}</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{formatMonthlyPrice(rejourney.price)}<span className="text-base text-slate-500">{labels.perMonth}</span></p>
              <p className="mt-3 text-sm font-bold leading-6 text-slate-600">{labels.replayPlanDetail}</p>
            </div>

            <div className="py-6 md:ps-7">
              <p className="text-sm font-semibold text-slate-600">{config.name}</p>
              <p className="mt-2 text-3xl font-black text-slate-950">{localizedCompetitorPrice}</p>
              <p className="mt-3 text-sm font-bold leading-6 text-slate-600">{localizedCompetitorDetail}</p>
            </div>
          </div>

          {exactSavings !== null ? (
            <div className="border-t border-emerald-200 py-4 text-center text-sm font-bold text-emerald-900">
              {labels.saves(formatMonthlyPrice(exactSavings))}
              {!localizedPage && config.model === "datadog" ? " before required RUM charges" : ""}.
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-3 border-t border-slate-100 pt-5 text-xs font-bold leading-5 text-slate-500 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl">
              {localizedPage ? labels.methodology : `${config.publicFact} ${labels.methodology}`}
            </p>
            <a
              href={config.sourceHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex shrink-0 items-center gap-1.5 font-bold text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-950"
            >
              {localizedPage ? config.name : config.sourceLabel}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

type AnalyticsCompetitorModel = "posthog" | "mixpanel" | "amplitude" | "pendo";

type AnalyticsCompetitor = {
  model: AnalyticsCompetitorModel;
  name: string;
  sourceHref: string;
  sourceLabel: string;
};

const analyticsEventSteps = [100_000, 1_000_000, 2_000_000, 10_000_000, 50_000_000, 100_000_000] as const;
const analyticsUserSteps = [500, 1_000, 10_000, 50_000, 100_000, 500_000] as const;

const websiteAnalyticsCompetitors: AnalyticsCompetitor[] = [
  {
    model: "posthog",
    name: "PostHog",
    sourceHref: "https://posthog.com/pricing",
    sourceLabel: "PostHog pricing",
  },
  {
    model: "mixpanel",
    name: "Mixpanel",
    sourceHref: "https://mixpanel.com/pricing/",
    sourceLabel: "Mixpanel pricing",
  },
  {
    model: "amplitude",
    name: "Amplitude",
    sourceHref: "https://amplitude.com/pricing",
    sourceLabel: "Amplitude pricing",
  },
];

const appAnalyticsCompetitors: AnalyticsCompetitor[] = [
  {
    model: "mixpanel",
    name: "Mixpanel",
    sourceHref: "https://mixpanel.com/pricing/",
    sourceLabel: "Mixpanel pricing",
  },
  {
    model: "amplitude",
    name: "Amplitude",
    sourceHref: "https://amplitude.com/pricing",
    sourceLabel: "Amplitude pricing",
  },
  {
    model: "pendo",
    name: "Pendo",
    sourceHref: "https://www.pendo.io/pricing/",
    sourceLabel: "Pendo pricing",
  },
];

type AnalyticsCompetitorPrice = {
  priceLabel: string;
  detail: string;
  eventLine: string;
  userLine: string;
  replayLine: string;
};

const getAnalyticsCompetitorPrice = (
  competitor: AnalyticsCompetitor,
  sessions: number,
  events: number,
  monthlyActiveUsers: number,
): AnalyticsCompetitorPrice => {
  switch (competitor.model) {
    case "posthog": {
      const analyticsPrice = Math.max(0, events - 1_000_000) * 0.00005;
      const replayPrice = postHogReplayPrice(sessions, "web");
      const total = analyticsPrice + replayPrice;
      return {
        priceLabel: `${formatMonthlyPrice(total)}/mo estimate`,
        detail: "Uses PostHog's published free allowances and first paid rates. Its rates decrease at higher volume, so verify the live estimate before buying.",
        eventLine: events <= 1_000_000
          ? `${formatReplayVolume(events)} events inside the 1M free allowance`
          : `${formatMonthlyPrice(analyticsPrice)} estimated analytics usage`,
        userLine: `${formatReplayVolume(monthlyActiveUsers)} MAU are represented through event usage`,
        replayLine: `${formatMonthlyPrice(replayPrice)} estimated web replay usage`,
      };
    }
    case "mixpanel": {
      const analyticsPrice = Math.max(0, events - 1_000_000) / 1_000 * 0.28;
      const needsReplayAddOn = sessions > 20_000;
      return {
        priceLabel: needsReplayAddOn
          ? `At least ${formatMonthlyPrice(analyticsPrice)}/mo + replay`
          : `${formatMonthlyPrice(analyticsPrice)}/mo`,
        detail: needsReplayAddOn
          ? "Mixpanel publishes the event charge, but replay volume above 20K requires a customizable allowance without a public dollar rate."
          : "Growth includes the first 1M events and 20K session replays each month.",
        eventLine: events <= 1_000_000
          ? `${formatReplayVolume(events)} events inside the 1M free allowance`
          : `${formatMonthlyPrice(analyticsPrice)} for events above 1M`,
        userLine: `${formatReplayVolume(monthlyActiveUsers)} MAU are represented through event usage`,
        replayLine: needsReplayAddOn
          ? `${formatReplayVolume(sessions)} replays require a customized allowance`
          : `${formatReplayVolume(sessions)} replays inside the Growth allowance`,
      };
    }
    case "amplitude": {
      const insideFreeUsage = events <= 2_000_000 && sessions <= 10_000;
      return {
        priceLabel: insideFreeUsage ? "$0/mo" : "Usage-based or custom",
        detail: insideFreeUsage
          ? "Amplitude Free includes up to 2M events and 10K monthly session replays."
          : "Amplitude publishes event and replay allowances, but not enough paid rates for an honest dollar estimate at this usage.",
        eventLine: events <= 2_000_000
          ? `${formatReplayVolume(events)} events inside the 2M free allowance`
          : `${formatReplayVolume(events)} events move beyond the Free allowance`,
        userLine: `${formatReplayVolume(monthlyActiveUsers)} MAU; current Free usage is measured by event volume`,
        replayLine: sessions <= 10_000
          ? `${formatReplayVolume(sessions)} replays inside the Free allowance`
          : `${formatReplayVolume(sessions)} replays require paid or custom volume`,
      };
    }
    case "pendo":
      return {
        priceLabel: "Custom MAU quote + replay tier",
        detail: "Pendo prices paid plans by MAU and bundle. Session Replay is an add-on on lower tiers and included on Core and Ultimate, all without public paid dollar rates.",
        eventLine: `${formatReplayVolume(events)} events are not the published billing meter`,
        userLine: monthlyActiveUsers <= 500
          ? `${formatReplayVolume(monthlyActiveUsers)} MAU fit the Free analytics limit`
          : `${formatReplayVolume(monthlyActiveUsers)} MAU require custom paid pricing`,
        replayLine: `${formatReplayVolume(sessions)} replays require an add-on or Core / Ultimate`,
      };
  }
};

function AnalyticsPricingCalculator({ page, localizedPage }: { page: SeoPage; localizedPage?: LocalizedSeoPage }) {
  const isWebsite = page.path === "/website-analytics";
  const competitors = isWebsite ? websiteAnalyticsCompetitors : appAnalyticsCompetitors;
  const [replayIndex, setReplayIndex] = React.useState(4);
  const [eventIndex, setEventIndex] = React.useState(3);
  const [userIndex, setUserIndex] = React.useState(3);
  const [competitorModel, setCompetitorModel] = React.useState<AnalyticsCompetitorModel>(competitors[0].model);

  const sessions = replayVolumeSteps[replayIndex];
  const events = analyticsEventSteps[eventIndex];
  const monthlyActiveUsers = analyticsUserSteps[userIndex];
  const selectedCompetitor = competitors.find((competitor) => competitor.model === competitorModel) ?? competitors[0];
  const rejourney = rejourneyReplayPrice(sessions);
  const competitorPrice = getAnalyticsCompetitorPrice(selectedCompetitor, sessions, events, monthlyActiveUsers);
  const labels = seoCalculatorLabels[localizedPage?.localeCode ?? "en"];
  const heading = isWebsite ? labels.websiteHeading : labels.appHeading;
  const intro = isWebsite ? labels.websiteIntro : labels.appIntro;
  const competitorDollarAmount = competitorPrice.priceLabel.match(/\$[\d,.]+/)?.[0];
  const localizedCompetitorPrice = localizedPage
    ? competitorDollarAmount
      ? `${competitorDollarAmount}${labels.perMonth}`
      : labels.customQuote
    : competitorPrice.priceLabel;
  const localizedCompetitorDetail = localizedPage
    ? labels.vendorPricingNote(selectedCompetitor.name)
    : competitorPrice.detail;

  const sliderRows = [
    {
      label: labels.capturedReplays,
      value: replayIndex,
      max: replayVolumeSteps.length - 1,
      formattedValue: formatReplayVolume(sessions),
      ariaValue: `${labels.capturedReplays}: ${sessions.toLocaleString(localizedPage?.locale.languageTag)}`,
      onChange: setReplayIndex,
      minLabel: "5K",
      maxLabel: "1M",
    },
    {
      label: labels.analyticsEvents,
      value: eventIndex,
      max: analyticsEventSteps.length - 1,
      formattedValue: formatReplayVolume(events),
      ariaValue: `${labels.analyticsEvents}: ${events.toLocaleString(localizedPage?.locale.languageTag)}`,
      onChange: setEventIndex,
      minLabel: "100K",
      maxLabel: "100M",
    },
    {
      label: labels.activeUsers,
      value: userIndex,
      max: analyticsUserSteps.length - 1,
      formattedValue: formatReplayVolume(monthlyActiveUsers),
      ariaValue: `${labels.activeUsers}: ${monthlyActiveUsers.toLocaleString(localizedPage?.locale.languageTag)}`,
      onChange: setUserIndex,
      minLabel: "500",
      maxLabel: "500K",
    },
  ];

  return (
    <section className="border-b border-black/10 bg-[#f7f6f1] px-5 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto mb-10 max-w-3xl text-center">
          <span className="mb-5 flex items-center justify-center gap-1.5 text-sm font-semibold text-emerald-800">
            <BadgeDollarSign className="h-4 w-4" aria-hidden />
            {labels.analyticsCalculator}
          </span>
          <h2 className="text-balance font-display text-4xl font-black leading-[1.02] tracking-[-0.04em] text-slate-950 sm:text-5xl">{heading}</h2>
          <p className="mx-auto mt-4 max-w-2xl text-base font-bold leading-7 text-slate-500">{intro}</p>
        </div>

        <div className="border-y border-slate-300 bg-white">
          <div className="grid gap-6 border-b border-slate-200 p-5 sm:p-7 lg:grid-cols-3">
            {sliderRows.map((row) => (
              <label key={row.label} className="block">
                <span className="flex items-start justify-between gap-3 text-xs font-bold leading-5 text-slate-900">
                  {row.label}
                  <output className="shrink-0 font-mono text-base text-emerald-700">{row.formattedValue}</output>
                </span>
                <input
                  type="range"
                  min="0"
                  max={row.max}
                  step="1"
                  value={row.value}
                  onChange={(event) => row.onChange(Number(event.target.value))}
                  className="mt-4 h-2 w-full cursor-pointer accent-emerald-600"
                  aria-label={row.label}
                  aria-valuetext={row.ariaValue}
                />
                <span className="mt-2 flex justify-between font-mono text-[10px] font-bold uppercase text-slate-400">
                  <span>{row.minLabel}</span><span>{row.maxLabel}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="px-5 sm:px-7">
            <div className="flex flex-col gap-4 border-b border-slate-200 py-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-semibold text-slate-600">{labels.compareWith}</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Analytics competitor">
                {competitors.map((competitor) => (
                  <button
                    key={competitor.model}
                    type="button"
                    onClick={() => setCompetitorModel(competitor.model)}
                    aria-pressed={selectedCompetitor.model === competitor.model}
                    className={`border-b-2 px-1 py-2 text-sm font-bold transition-colors ${
                      selectedCompetitor.model === competitor.model
                        ? "border-slate-950 text-slate-950"
                        : "border-transparent text-slate-500 hover:text-slate-900"
                    }`}
                  >
                    {competitor.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid lg:grid-cols-2">
              <div className="border-b border-slate-200 py-7 lg:border-b-0 lg:border-e lg:pe-8">
                <p className="text-sm font-semibold text-emerald-800">Rejourney · {rejourney.plan}</p>
                <p className="mt-2 text-4xl font-black text-slate-950">
                  {formatMonthlyPrice(rejourney.price)}<span className="text-base text-slate-500">{labels.perMonth}</span>
                </p>
                <p className="mt-3 text-sm font-medium leading-6 text-slate-600">
                  {labels.analyticsPlanDetail(formatReplayVolume(sessions))}
                </p>
              </div>

              <div className="py-7 lg:ps-8">
                <p className="text-sm font-semibold text-slate-600">{selectedCompetitor.name}</p>
                <p className="mt-2 text-3xl font-black leading-tight text-slate-950">{localizedCompetitorPrice}</p>
                <p className="mt-3 text-sm font-medium leading-6 text-slate-600">{localizedCompetitorDetail}</p>
              </div>
            </div>

            <details className="group border-t border-slate-200 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-bold text-slate-700 marker:hidden">
                {labels.howCalculated}
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-90" aria-hidden />
              </summary>
              <div className="grid gap-6 pt-6 text-sm font-medium leading-6 text-slate-600 lg:grid-cols-2">
                <div>
                  <p className="font-bold text-slate-900">{labels.included}</p>
                  <ul className="mt-3 space-y-2">
                    {[
                      `${formatReplayVolume(sessions)} · ${labels.capturedReplays}`,
                      `${formatReplayVolume(events)} · ${labels.analyticsEvents} · ${labels.unlimited}`,
                      `${formatReplayVolume(monthlyActiveUsers)} · ${labels.activeUsers} · ${labels.unlimited}`,
                      `${labels.unlimited} · ${localizedPage?.ui.platformHeading ?? "analytics data retention"}`,
                    ].map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </div>
                <div>
                  <p className="font-bold text-slate-900">{selectedCompetitor.name} · {labels.estimateInputs}</p>
                  <ul className="mt-3 space-y-2">
                    {(localizedPage
                      ? [
                          `${formatReplayVolume(sessions)} · ${labels.capturedReplays}`,
                          `${formatReplayVolume(events)} · ${labels.analyticsEvents}`,
                          `${formatReplayVolume(monthlyActiveUsers)} · ${labels.activeUsers}`,
                        ]
                      : [competitorPrice.replayLine, competitorPrice.eventLine, competitorPrice.userLine]
                    ).map((line) => <li key={line}>{line}</li>)}
                  </ul>
                </div>
              </div>
              <div className="mt-6 flex flex-col gap-4 border-t border-slate-200 pt-5 text-xs font-medium leading-5 text-slate-500 sm:flex-row sm:items-start sm:justify-between">
                <p className="max-w-3xl">
                  {localizedPage ? labels.methodology : `Public list-price model reviewed August 1, 2026. ${labels.methodology}`}
                </p>
                <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
                  <a href={selectedCompetitor.sourceHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-bold text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-950">
                    {localizedPage ? selectedCompetitor.name : selectedCompetitor.sourceLabel}<ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                  <Link to="/pricing" className="font-bold text-slate-700 underline decoration-slate-300 underline-offset-4 hover:text-slate-950">{labels.pricing}</Link>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>
    </section>
  );
}

function AdComparison({ page }: { page: SeoPage }) {
  if (page.kind !== "alternative") return null;

  return (
    <section className="border-b border-black/10 bg-white px-5 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mx-auto max-w-3xl text-center mb-12">
          <span className="mb-5 block text-sm font-semibold text-emerald-800">
            Full capability comparison
          </span>
          <h2 className="text-balance font-display text-4xl font-black leading-[1.02] tracking-[-0.04em] text-slate-950 sm:text-5xl">
            Rejourney vs {page.otherColumnTitle}
          </h2>
          <p className="text-base sm:text-lg font-bold text-slate-500 max-w-xl mx-auto">
            Public capabilities reviewed {page.lastReviewed ?? "recently"}. Plan and platform details can change, so verify the linked vendor sources before buying.
          </p>
        </div>

        <div className="mb-12 overflow-hidden border-y border-slate-300 bg-white">
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-[1.25fr_0.75fr_0.75fr] border-b border-slate-200 bg-slate-950 text-xs font-bold text-white select-none">
                <div className="px-6 py-4.5">Capability</div>
                <div className="border-l border-slate-800 px-6 py-4.5">Rejourney</div>
                <div className="border-l border-slate-800 px-6 py-4.5">{page.otherColumnTitle}</div>
              </div>

              {page.comparisonRows.map((row, idx) => (
                <div
                  key={row.feature}
                  className={`grid grid-cols-[1.25fr_0.75fr_0.75fr] items-center border-b border-slate-100 last:border-0 ${
                    idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"
                  }`}
                >
                  <div className="px-6 py-4.5 text-base font-bold text-slate-900">{row.feature}</div>
                  <div className="flex self-stretch items-center border-l border-slate-100 bg-emerald-500/[0.015] px-6 py-4.5">
                    <ValueBadge value={row.rejourney} />
                  </div>
                  <div className="border-l border-slate-100 px-6 py-4.5 self-stretch flex items-center">
                    <ValueBadge value={row.other} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {page.officialSources?.length ? (
          <div className="mx-auto mb-12 max-w-4xl border-y border-slate-200 px-5 py-4 text-sm text-slate-600">
            <p className="font-bold leading-6">
              “Limited” means plan-, platform-, or scope-dependent. “Not listed” means we did not find a directly comparable capability in the public materials reviewed; it is not a claim that the vendor can never support it.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2" aria-label={`${page.otherColumnTitle} official sources`}>
              {page.officialSources.map((source) => (
                <a
                  key={source.href}
                  href={source.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-extrabold text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-950"
                >
                  {source.label}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ))}
            </div>
          </div>
        ) : null}

      </div>
    </section>
  );
}

function AdRepeatedCTA({ page, isBottom = false }: { page: SeoPage; isBottom?: boolean }) {
  const copy = page.path === "/website-analytics"
    ? {
        title: "TURN WEBSITE TRAFFIC INTO ANSWERS",
        description: "Connect analytics to the sessions behind every website drop-off. Start with 5,000 monthly replays and unlimited analytics events.",
      }
    : page.path === "/app-analytics"
      ? {
          title: "SEE WHY APP USERS DROP",
          description: "Measure in-app behavior, replay the session, and connect crashes to real users. No credit card required.",
        }
      : {
          title: "START INVESTIGATING PRODUCT FRICTION",
          description: "The Free plan includes 5,000 monthly sessions. No credit card required.",
        };

  return (
    <section className={`relative overflow-hidden border-b border-slate-200/80 py-20 px-4 sm:px-6 lg:px-8 text-center ${isBottom ? "bg-gradient-to-br from-[#ecfeff]/40 to-[#fff7df]/40" : "bg-white"}`}>
      {/* Background visual element */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[350px] w-[350px] rounded-full bg-indigo-300/10 blur-[80px] pointer-events-none" />
      
      <div className="relative z-10 mx-auto max-w-4xl">
        <h2 className="text-3xl sm:text-5xl font-black uppercase text-slate-950 mb-4 leading-none">
          {copy.title}
        </h2>
        <p className="text-base sm:text-lg font-bold text-slate-500 mb-8 max-w-2xl mx-auto">
          {copy.description}
        </p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-4 max-w-md mx-auto">
          <Link
            to="/login"
            className="group inline-flex min-h-[52px] items-center justify-center gap-2 rounded-md border border-slate-950 bg-[#86efac] px-8 text-base font-extrabold uppercase text-black shadow-[2px_2px_0_#0f172a] transition-[background-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:bg-[#6ee7a0] active:translate-y-0 active:shadow-none text-center w-full sm:w-auto"
          >
            Start free now
            <ArrowRight className="h-4.5 w-4.5 transition-transform group-hover:translate-x-0.5" strokeWidth={3} />
          </Link>
        </div>
      </div>
    </section>
  );
}

function AdFaq({ page, localizedPage }: { page: SeoPage; localizedPage?: LocalizedSeoPage }) {
  const ui = localizedPage?.ui;
  return (
    <section className="border-b border-black/10 bg-[#fdfbf7] px-5 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <div className="text-center mb-12">
          <span className="mb-4 block text-sm font-semibold text-emerald-800">
            {ui?.faqEyebrow ?? "FAQ"}
          </span>
          <h2 className="text-balance font-display text-4xl font-black leading-[1.02] tracking-[-0.04em] text-slate-950 sm:text-5xl">
            {ui?.questionsAnswered ?? "Questions, answered."}
          </h2>
        </div>
        <div className="border-t border-black/10">
          {page.faq.map((item) => (
            <details key={item.question} className="group border-b border-black/10 bg-transparent">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 marker:hidden sm:p-6 focus:outline-none">
                <h3 className="text-start text-base font-black leading-tight text-slate-900 transition-colors group-hover:text-black sm:text-lg">
                  {item.question}
                </h3>
                <span className="grid h-7 w-7 shrink-0 place-items-center transition group-open:rotate-90">
                  <ChevronRight className="h-4 w-4 text-slate-500" strokeWidth={2.5} />
                </span>
              </summary>
              <div className="px-5 pb-5 pt-0 sm:px-6 sm:pb-6">
                <p className="max-w-2xl pb-2 text-sm font-medium leading-7 text-slate-600 sm:text-base">
                  {item.answer}
                </p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function AdFooter() {
  return (
    <footer className="bg-slate-950 py-12 px-4 sm:px-6 lg:px-8 text-white font-sans text-xs border-t border-slate-900">
      <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-white p-1 shadow-sm">
            <img src="/rejourneyIcon-removebg-preview.png" alt="" className="h-full w-full object-contain" />
          </span>
          <span className="text-sm font-black uppercase tracking-tight">Rejourney</span>
        </div>
        <div className="flex flex-wrap justify-center gap-6 font-bold uppercase tracking-wider text-slate-400">
          <Link to="/privacy-policy" className="hover:text-white transition">Privacy Policy</Link>
          <Link to="/terms-of-service" className="hover:text-white transition">Terms of Service</Link>
          <Link to="/dpa" className="hover:text-white transition">Data Processing Agreement (DPA)</Link>
        </div>
        <p className="text-slate-500 font-medium">
          &copy; {new Date().getFullYear()} Rejourney. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

function landingOutcomeImages(page: SeoPage): FeatureImage[] {
  if (page.kind !== "alternative") return featureImages(page).slice(0, 3);

  const quickScan = alternativeQuickScanImage(page);
  const technicalAlternative = page.path.includes("sentry") || page.path.includes("datadog");
  const experienceAlternative = page.path.includes("hotjar")
    || page.path.includes("smartlook")
    || page.path.includes("fullstory");

  if (technicalAlternative) {
    return [
      quickScan,
      {
        src: "/images/engineering/product-tools-live-stability.png",
        alt: "Rejourney stability workspace with crashes errors ANRs and affected sessions",
        title: "Stability context",
        copy: "Keep crashes, ANRs, API failures, and the user session in one investigation.",
      },
      {
        src: "/images/engineering/product-tools-live-replay.png",
        alt: "Rejourney replay workbench with timeline network and console context",
        title: "Replay evidence",
        copy: "Start from what the user experienced, then inspect the technical evidence around it.",
      },
    ];
  }

  if (experienceAlternative) {
    return [
      quickScan,
      {
        src: "/images/engineering/product-tools-live-replay.png",
        alt: "Rejourney web and mobile replay workbench",
        title: "Web and mobile replay",
        copy: "Review real sessions across browser and native app surfaces.",
      },
      {
        src: "/images/engineering/product-tools-live-journeys.png",
        alt: "Rejourney journey analytics showing real product paths",
        title: "Journey evidence",
        copy: "Move from one recording to the repeated path behind the behavior.",
      },
    ];
  }

  return [
    quickScan,
    {
      src: "/images/engineering/product-tools-live-general.png",
      alt: "Rejourney lightweight product analytics overview",
      title: "Product analytics",
      copy: "Keep active users, retention, releases, and degraded sessions close to replay.",
    },
    {
      src: "/images/engineering/product-tools-live-replay.png",
      alt: "Rejourney session replay workbench with complete context",
      title: "The session behind the metric",
      copy: "Open the exact experience behind a chart, path, or support report.",
    },
  ];
}

function LightweightLandingHero({ page, localizedPage }: { page: SeoPage; localizedPage?: LocalizedSeoPage }) {
  const location = useLocation();
  const headline = localizedPage?.h1 ?? getSeoLandingHeadline(page);
  const subheadline = localizedPage?.intro ?? AD_LANDING_SUBHEADLINES[page.path] ?? page.hero.subtitle;
  const heroImage = AD_LANDING_HERO_IMAGES[page.path] ?? page.image;
  const dimensions = featureImageDimensionsBySrc[heroImage] ?? { width: 1440, height: 900 };
  const primaryHref = landingHrefWithAttribution(page.cta.primaryHref, location.search);
  const secondaryHref = landingHrefWithAttribution(page.cta.secondaryHref, location.search);
  const headlineParts = headline.split(/(Lightweight)/i);
  const reassurance = localizedPage?.ui.reassurance ?? (page.kind === "alternative"
    ? "Evaluate Rejourney alongside your current stack. You do not need to migrate before you know it fits."
    : page.kind === "educational"
      ? "Read the practical answer first, then inspect the product without creating an account."
      : "Install alongside your existing analytics and evaluate it with real sessions before committing.");
  const isRtl = localizedPage?.locale.dir === "rtl";

  return (
    <section className="border-b border-black/10 bg-[#fdfbf7] px-5 pb-14 pt-16 sm:px-6 sm:pb-16 sm:pt-20 lg:px-8 lg:pb-20">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-14">
        <div className="max-w-2xl">
          <p className="mb-4 inline-flex items-center gap-3 text-sm font-semibold text-emerald-800">
            <span className="h-px w-6 bg-emerald-600" aria-hidden />
            {localizedPage?.ui.eyebrow ?? page.hero.eyebrow}
          </p>
          <h1 className="text-balance font-display text-4xl font-black leading-[1.01] tracking-[-0.045em] text-slate-950 sm:text-5xl lg:text-6xl">
            {headlineParts.map((part, index) => part.toLowerCase() === "lightweight"
              ? <span key={`${part}-${index}`} className="font-semibold">{part}</span>
              : part)}
          </h1>
          <p className="mt-6 max-w-xl text-pretty text-lg font-medium leading-8 text-slate-600 sm:text-xl">
            {subheadline}
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to={primaryHref}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#86efac] px-7 text-sm font-extrabold text-slate-950 transition-colors hover:bg-[#74e89c] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
            >
              {localizedPage?.ui.startFree ?? page.cta.primaryLabel}
              <ArrowRight className={`h-4 w-4 ${isRtl ? "rotate-180" : ""}`} strokeWidth={2.75} aria-hidden />
            </Link>
            <Link
              to={secondaryHref}
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-300 bg-white px-7 text-sm font-extrabold text-slate-950 transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
            >
              {localizedPage?.ui.liveDemo ?? page.cta.secondaryLabel}
            </Link>
          </div>

          <p className="mt-5 max-w-xl text-sm font-medium leading-6 text-slate-600">{reassurance}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-semibold text-slate-600">
            <span>{localizedPage?.ui.freeSessions ?? "5,000 sessions free"}</span>
            <span aria-hidden>·</span>
            <span>{localizedPage?.ui.noCreditCard ?? "No credit card"}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5"><EuFlag className="h-3.5 w-5" />{localizedPage?.ui.gdprCompliant ?? "GDPR compliant"}</span>
          </div>
        </div>

        <div className="min-w-0">
          <figure className="overflow-hidden rounded-xl border border-black/10 bg-white p-3 shadow-[0_10px_32px_rgba(15,23,42,0.06)]">
            <img
              src={optimizedMarketingImage(heroImage)}
              alt={localizedPage?.h1 ?? page.imageAlt}
              width={dimensions.width}
              height={dimensions.height}
              fetchPriority="high"
              decoding="async"
              style={{ width: "100%", maxWidth: "100%", height: "auto", maxHeight: "520px" }}
              className="h-auto max-h-[520px] w-full object-contain"
            />
          </figure>
        </div>
      </div>
    </section>
  );
}

type LandingPlatformLogo = {
  label: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  color: string;
};

const webLandingPlatformLogos: LandingPlatformLogo[] = [
  { label: "React", icon: MarkReactNative, color: "#149eca" },
  { label: "Next.js", icon: MarkNextJs, color: "#0f172a" },
  { label: "Vue", icon: MarkVue, color: "#42b883" },
  { label: "Angular", icon: MarkAngular, color: "#dd0031" },
  { label: "SvelteKit", icon: MarkSvelte, color: "#ff3e00" },
];

const mobileLandingPlatformLogos: LandingPlatformLogo[] = [
  { label: "React Native", icon: MarkReactNative, color: "#149eca" },
  { label: "Expo", icon: MarkExpo, color: "#0f172a" },
  { label: "Flutter", icon: MarkFlutter, color: "#54c5f8" },
  { label: "Swift", icon: MarkSwift, color: "#f97316" },
];

const allLandingPlatformLogos: LandingPlatformLogo[] = [
  { label: "Next.js", icon: MarkNextJs, color: "#0f172a" },
  { label: "React Native", icon: MarkReactNative, color: "#149eca" },
  { label: "Expo", icon: MarkExpo, color: "#0f172a" },
  { label: "Flutter", icon: MarkFlutter, color: "#54c5f8" },
  { label: "Swift", icon: MarkSwift, color: "#f97316" },
];

function LandingPlatformLogos({
  setupVariant,
  ariaLabel,
}: {
  setupVariant: SeoPage["setupVariant"];
  ariaLabel: string;
}) {
  const platforms = setupVariant === "web"
    ? webLandingPlatformLogos
    : setupVariant === "mobile"
      ? mobileLandingPlatformLogos
      : allLandingPlatformLogos;

  return (
    <div className="flex flex-wrap items-center gap-2" role="list" aria-label={ariaLabel}>
      {platforms.map((platform) => {
        const PlatformIcon = platform.icon;
        return (
          <span
            key={platform.label}
            role="listitem"
            aria-label={platform.label}
            title={platform.label}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm"
          >
            <PlatformIcon className="h-5 w-5" style={{ color: platform.color }} />
          </span>
        );
      })}
    </div>
  );
}

function LandingTrustStrip({ page, localizedPage }: { page: SeoPage; localizedPage?: LocalizedSeoPage }) {

  return (
    <section className="border-b border-black/10 bg-white px-5 py-6 sm:px-6 lg:px-8" aria-label={localizedPage?.ui.trustAriaLabel ?? "Product trust signals"}>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm font-semibold text-slate-700">
          <span>{localizedPage?.ui.lightweightSdks ?? "Lightweight SDKs"}</span>
          <span className="text-slate-300" aria-hidden>/</span>
          <span>{localizedPage?.ui.privacyMasking ?? "Privacy masking"}</span>
          <span className="text-slate-300" aria-hidden>/</span>
          <span className="inline-flex items-center gap-2"><GermanFlag className="h-4 w-6" />{localizedPage?.ui.hostedInGermany ?? "Hosted in Germany"}</span>
        </div>
        <LandingPlatformLogos
          setupVariant={page.setupVariant}
          ariaLabel={localizedPage?.ui.supports ?? "Supported platforms"}
        />
      </div>
    </section>
  );
}

function LandingKeywordSections({ page, localizedPage }: { page: SeoPage; localizedPage?: LocalizedSeoPage }) {
  if (!page.keywordSections?.length) return null;

  return (
    <section className="border-b border-black/10 bg-[#f7f6f1] px-5 py-16 sm:px-6 lg:px-8 lg:py-20" aria-labelledby={`${page.path.slice(1)}-questions`}>
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold text-emerald-800">{localizedPage?.ui.investigationEyebrow ?? "Questions Rejourney can answer"}</p>
            <h2 id={`${page.path.slice(1)}-questions`} className="mt-3 text-balance font-display text-4xl font-black leading-[1.04] tracking-[-0.04em] text-slate-950 sm:text-5xl">
              {localizedPage?.ui.benefitsHeading ?? "Start with the signal. Leave with evidence."}
            </h2>
          </div>
          <Link
            to="/demo"
            className="group inline-flex w-fit items-center gap-2 text-sm font-black text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:text-emerald-950"
          >
            {localizedPage?.ui.liveDemo ?? "Open live demo"}
            <ArrowRight className={`h-4 w-4 transition-transform ${localizedPage?.locale.dir === "rtl" ? "rotate-180 group-hover:-translate-x-0.5" : "group-hover:translate-x-0.5"}`} aria-hidden />
          </Link>
        </div>

        <div className="mt-10 grid border-y border-black/10 lg:grid-cols-3">
          {page.keywordSections.map((section, index) => (
            <article
              key={section.title}
              className="border-b border-black/10 py-7 last:border-b-0 lg:border-b-0 lg:border-r lg:px-7 lg:first:pl-0 lg:last:border-r-0 lg:last:pr-0"
            >
              <p className="font-mono text-xs font-bold tracking-[0.12em] text-emerald-700" aria-hidden>
                {String(index + 1).padStart(2, "0")}
              </p>
              <h3 className="mt-4 text-balance text-2xl font-black leading-tight tracking-[-0.025em] text-slate-950">{section.title}</h3>
              <p className="mt-4 max-w-sm text-base font-medium leading-7 text-slate-600">{section.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function LandingOutcomeSections({ page, localizedPage }: { page: SeoPage; localizedPage?: LocalizedSeoPage }) {
  const images = landingOutcomeImages(page);
  return (
    <section className="border-b border-black/10 bg-white px-5 py-20 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold text-emerald-800">
            {localizedPage?.ui.outcomesEyebrow ?? (page.kind === "educational" ? "From idea to evidence" : page.kind === "alternative" ? "Why teams switch" : "From signal to answer")}
          </p>
          <h2 className="mt-3 text-balance font-display text-4xl font-black leading-[1.04] tracking-[-0.04em] text-slate-950 sm:text-5xl">
            {page.kind === "alternative" ? "What changes when the stack gets lighter." : page.whyTitle}
          </h2>
        </div>

        <div className="mt-14 space-y-16 lg:space-y-24">
          {images.map((image, index) => {
            const outcome = page.outcomes[index];
            const dimensions = featureImageDimensionsBySrc[image.src] ?? { width: 1440, height: 900 };
            return (
              <article key={`${image.src}-${index}`} className="grid gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
                <div className={index % 2 ? "lg:order-2" : undefined}>
                  <p className="text-sm font-semibold text-emerald-800">{index + 1}. {outcome?.title ?? image.title}</p>
                  <h3 className="mt-4 text-balance text-3xl font-black leading-tight tracking-[-0.035em] text-slate-950 sm:text-4xl">
                    {outcome?.title ?? image.title}
                  </h3>
                  <p className="mt-5 text-pretty text-lg font-medium leading-8 text-slate-600">
                    {outcome?.description ?? image.copy}
                  </p>
                </div>
                <div className={index % 2 ? "lg:order-1" : undefined}>
                  <figure className="overflow-hidden rounded-xl border border-black/10 bg-[#fafaf8] p-3">
                    <img
                      src={optimizedMarketingImage(image.src)}
                      alt={outcome?.title ?? image.alt}
                      width={dimensions.width}
                      height={dimensions.height}
                      loading="lazy"
                      decoding="async"
                      style={{ width: "100%", maxWidth: "100%", height: "auto", maxHeight: "430px" }}
                      className="h-auto max-h-[430px] w-full object-contain"
                    />
                  </figure>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function EducationalAnswerSection({ page, localizedPage }: { page: SeoPage; localizedPage?: LocalizedSeoPage }) {
  if (page.kind !== "educational") return null;
  return (
    <section className="border-b border-black/10 bg-[#f7f6f1] px-5 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.75fr_1.25fr]">
        <div>
          <p className="text-sm font-semibold text-emerald-800">{localizedPage?.ui.shortAnswer ?? "The short answer"}</p>
          <h2 className="mt-4 text-balance text-3xl font-black leading-tight tracking-[-0.035em] text-slate-950 sm:text-4xl">{page.whyTitle}</h2>
        </div>
        <div className="space-y-5 text-lg font-medium leading-8 text-slate-700">
          {page.whyParagraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <div className="grid border-t border-black/10 pt-2 sm:grid-cols-2 sm:gap-x-8">
            {page.chooseRejourney.slice(0, 4).map((item) => (
              <div key={item} className="flex gap-3 border-b border-black/10 py-4 text-sm font-semibold leading-6 text-slate-700">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                {item}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AlternativeAtAGlance({ page }: { page: SeoPage }) {
  if (page.kind !== "alternative") return null;
  return (
    <section className="border-b border-black/10 bg-[#f7f6f1] px-5 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold text-emerald-800">At a glance</p>
            <h2 className="mt-4 text-balance text-4xl font-black leading-[1.02] tracking-[-0.04em] text-slate-950">A fair first comparison.</h2>
          </div>
          <div className="border-y border-black/10 py-6">
            <p className="text-lg font-medium leading-8 text-slate-700">{alternativeTldrByPath[page.path] ?? page.comparisonIntro}</p>
            <p className="mt-5 text-sm font-medium text-slate-500">Capabilities and public pricing reviewed {page.lastReviewed ?? "recently"}.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function AlternativeFitSection({ page }: { page: SeoPage }) {
  if (page.kind !== "alternative") return null;
  return (
    <section className="border-b border-black/10 bg-white px-5 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
        <article className="border-l-2 border-emerald-600 bg-emerald-50/35 p-7 sm:p-9">
          <p className="text-sm font-semibold text-emerald-800">Choose Rejourney when</p>
          <ul className="mt-6 space-y-4">
            {alternativeRejourneyChecklist(page).slice(0, 4).map((item) => (
              <li key={item} className="flex gap-3 text-base font-bold leading-7 text-slate-800"><Check className="mt-1 h-5 w-5 shrink-0 text-emerald-700" strokeWidth={3} />{item}</li>
            ))}
          </ul>
        </article>
        <article className="border-l-2 border-slate-300 bg-[#f7f6f1] p-7 sm:p-9">
          <p className="text-sm font-semibold text-slate-600">{page.chooseOtherTitle}</p>
          <ul className="mt-6 space-y-4">
            {page.chooseOther.slice(0, 4).map((item) => (
              <li key={item} className="flex gap-3 text-base font-bold leading-7 text-slate-700"><CircleMinus className="mt-1 h-5 w-5 shrink-0 text-slate-500" />{item}</li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

function LandingProofStory({ page, localizedPage }: { page: SeoPage; localizedPage?: LocalizedSeoPage }) {
  const customerLogo = page.proofStory.customer === "Burst Creatine"
    ? "/images/burst-creatine-logo-red.webp"
    : "/images/customer-onboarding-logo.webp";

  return (
    <section className="border-b border-black/10 bg-white px-5 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl border-y border-black/10 py-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-center lg:gap-12">
        <div>
          <p className="text-sm font-semibold text-emerald-800">{localizedPage?.ui.verifiedResult ?? "Verified customer result"}</p>
          <p className="mt-3 text-3xl font-black leading-tight tracking-[-0.04em] text-slate-950 sm:text-4xl">{page.proofStory.metric}</p>
        </div>
        <div className="mt-7 lg:mt-0">
          <div className="flex items-center gap-3">
            <img
              src={customerLogo}
              alt={`${page.proofStory.customer} logo`}
              width="40"
              height="40"
              loading="eager"
              decoding="async"
              className="h-10 w-10 shrink-0 rounded-lg object-cover"
            />
            <p className="text-sm font-bold text-slate-950">{page.proofStory.customer}</p>
          </div>
          <p className="mt-3 max-w-2xl text-base font-medium leading-7 text-slate-600">{page.proofStory.summary}</p>
        </div>
      </div>
    </section>
  );
}

function LandingRelatedPages({ page, localizedPage }: { page: SeoPage; localizedPage?: LocalizedSeoPage }) {
  const relatedPages = page.relatedPages.filter((related) => related.href !== "/demo").slice(0, 4);
  if (!relatedPages.length) return null;

  return (
    <section className="border-b border-black/10 bg-white px-5 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold text-emerald-800">{localizedPage?.ui.keepExploring ?? "Keep exploring"}</p>
        <h2 className="mt-4 max-w-3xl text-balance font-display text-4xl font-black leading-[1.02] tracking-[-0.045em] text-slate-950 sm:text-5xl">
          {localizedPage?.ui.continueHeading ?? "Continue with the most relevant next step."}
        </h2>
        <div className="mt-10 grid border-t border-black/10 sm:grid-cols-2 lg:grid-cols-3">
          {relatedPages.map((related) => (
            <Link
              key={related.href}
              to={related.href}
              className="group flex min-h-40 flex-col justify-between border-b border-black/10 p-6 transition-colors hover:bg-[#fdfbf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500 lg:border-r lg:last:border-r-0"
            >
              <div>
                <h3 className="text-xl font-black tracking-[-0.025em] text-slate-950">{related.label}</h3>
                <p className="mt-3 text-sm font-medium leading-6 text-slate-600">{related.description}</p>
              </div>
              <span className="mt-6 inline-flex items-center gap-2 text-sm font-black text-emerald-800">
                {localizedPage?.ui.readNext ?? "Read next"} <ArrowRight className={`h-4 w-4 transition ${localizedPage?.locale.dir === "rtl" ? "rotate-180 group-hover:-translate-x-0.5" : "group-hover:translate-x-0.5"}`} aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function LandingFinalCta({ page, localizedPage }: { page: SeoPage; localizedPage?: LocalizedSeoPage }) {
  const location = useLocation();
  const primaryHref = landingHrefWithAttribution(page.cta.primaryHref, location.search);
  const secondaryHref = landingHrefWithAttribution(page.cta.secondaryHref, location.search);
  return (
    <section className="border-b border-black/10 bg-[#f7f6f1] px-5 py-16 sm:px-6 lg:px-8 lg:py-20">
      <div className="mx-auto max-w-4xl text-center">
        <p className="text-sm font-semibold text-emerald-800">{localizedPage?.ui.startProduct ?? "Start with a real product"}</p>
        <h2 className="mt-4 text-balance font-display text-4xl font-black leading-[1.02] tracking-[-0.045em] text-slate-950 sm:text-6xl">{localizedPage?.ui.finalHeading ?? "Turn product behavior into an answer."}</h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg font-medium leading-8 text-slate-600">{localizedPage?.ui.finalCopy ?? "Start free with 5,000 monthly sessions, unlimited analytics events, and no credit card."}</p>
        <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
          <Link to={primaryHref} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#86efac] px-8 text-sm font-extrabold text-slate-950 transition-colors hover:bg-[#74e89c]">
            {localizedPage?.ui.startFree ?? page.cta.primaryLabel}<ArrowRight className={`h-4 w-4 ${localizedPage?.locale.dir === "rtl" ? "rotate-180" : ""}`} strokeWidth={3} />
          </Link>
          <Link to={secondaryHref} className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-300 bg-white px-8 text-sm font-extrabold text-slate-950 transition-colors hover:border-slate-400 hover:bg-slate-50">
            {localizedPage?.ui.liveDemo ?? page.cta.secondaryLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}

export function buildLocalizedSeoRenderPage(localizedPage: LocalizedSeoPage, englishPage: SeoPage): SeoPage {
  const translatedRelatedCandidates = SEO_LOCALIZED_PAGE_PATHS.filter((path) => path !== localizedPage.basePath);
  const usedRelatedPaths = new Set<string>();
  const relatedPages = englishPage.relatedPages.map((related) => {
    const preferredPath = isSeoLocalizedPagePath(related.href)
      ? related.href
      : undefined;
    const relatedBasePath = preferredPath && !usedRelatedPaths.has(preferredPath)
      ? preferredPath
      : translatedRelatedCandidates.find((path) => !usedRelatedPaths.has(path)) ?? translatedRelatedCandidates[0];
    usedRelatedPaths.add(relatedBasePath);
    const translated = getLocalizedSeoPage(localizedPage.localeCode, relatedBasePath);
    return {
      label: translated.h1,
      href: translated.localizedPath,
      description: translated.intro,
    };
  });
  const keywordBulletPool = [
    ...localizedPage.secondaryKeywords,
    localizedPage.evidence,
    localizedPage.platforms,
  ];
  const keywordSections = englishPage.keywordSections?.map((section, index) => {
    const benefit = localizedPage.benefits[index % localizedPage.benefits.length];
    return {
      title: benefit.title,
      description: benefit.description,
      bullets: section.bullets.map((_, bulletIndex) => keywordBulletPool[(index + bulletIndex) % keywordBulletPool.length]),
    };
  });
  const localizedFaq = getLocalizedSeoFaq(localizedPage);
  const isRevenuePage = englishPage.path.includes("funnel") || englishPage.path.includes("revenue");
  const supportingCopy = [
    ...localizedPage.benefits.map((benefit) => benefit.description),
    localizedPage.evidence,
    localizedPage.platforms,
  ];

  return {
    ...englishPage,
    hero: {
      eyebrow: localizedPage.ui.eyebrow,
      title: localizedPage.h1,
      subtitle: localizedPage.intro,
    },
    outcomes: englishPage.outcomes.map((_, index) => localizedPage.benefits[index % localizedPage.benefits.length]),
    proofStory: {
      ...englishPage.proofStory,
      metric: isRevenuePage ? localizedPage.ui.salesMetric : localizedPage.ui.onboardingMetric,
      summary: isRevenuePage ? localizedPage.ui.salesProof : localizedPage.ui.onboardingProof,
    },
    relatedPages,
    badge: localizedPage.primaryKeyword,
    eyebrow: localizedPage.ui.eyebrow,
    title: localizedPage.h1,
    subtitle: localizedPage.intro,
    metaTitle: localizedPage.metaTitle,
    metaDescription: localizedPage.metaDescription,
    primaryKeyword: localizedPage.primaryKeyword,
    secondaryKeywords: localizedPage.secondaryKeywords,
    keywords: [localizedPage.primaryKeyword, ...localizedPage.secondaryKeywords],
    keywordSections,
    imageAlt: localizedPage.h1,
    proofPoints: englishPage.proofPoints.map((_, index) => supportingCopy[index % supportingCopy.length]),
    whyTitle: localizedPage.ui.evidenceHeading,
    whyParagraphs: englishPage.whyParagraphs.map((_, index) => [localizedPage.evidence, localizedPage.platforms][index % 2]),
    chooseRejourney: englishPage.chooseRejourney.map((_, index) => supportingCopy[index % supportingCopy.length]),
    pricingTitle: localizedPage.ui.benefitsHeading,
    pricingIntro: localizedPage.intro,
    pricingBullets: englishPage.pricingBullets.map((_, index) => supportingCopy[index % supportingCopy.length]),
    faq: localizedFaq,
    related: relatedPages,
  };
}

function PaidAdLandingPage({ page, localizedPage }: { page: SeoPage; localizedPage?: LocalizedSeoPage }) {
  return (
    <div
      className="public-readable-scope flex min-h-screen flex-col bg-[#fdfbf7] text-slate-950"
      lang={localizedPage?.locale.languageTag ?? "en-US"}
      dir={localizedPage?.locale.dir ?? "ltr"}
    >
      <AttributionLinkPreserver />
      <Header />
      <main className="flex-grow">
        <LightweightLandingHero page={page} localizedPage={localizedPage} />
        <LandingTrustStrip page={page} localizedPage={localizedPage} />
        {page.kind !== "educational" && <LandingProofStory page={page} localizedPage={localizedPage} />}
        <LandingKeywordSections page={page} localizedPage={localizedPage} />
        <EducationalAnswerSection page={page} localizedPage={localizedPage} />
        <AlternativeAtAGlance page={page} />
        <AlternativeFitSection page={page} />
        <LandingOutcomeSections page={page} localizedPage={localizedPage} />
        {page.pricingVariant === "analytics" && <AnalyticsPricingCalculator page={page} localizedPage={localizedPage} />}
        {page.pricingVariant === "replay" && <AdReplayPricingCalculator page={page} localizedPage={localizedPage} />}
        {page.setupVariant !== "none" && (
          <PerformanceMetrics
            key={localizedPage?.localizedPath ?? page.path}
            dir={localizedPage?.locale.dir}
            locale={localizedPage?.localeCode}
            initialPlatform={page.setupVariant === "mobile" ? "mobile" : "web"}
          />
        )}
        {page.comparison.enabled && <AdComparison page={page} />}
        <LandingRelatedPages page={page} localizedPage={localizedPage} />
        <AdFaq page={page} localizedPage={localizedPage} />
        <LandingFinalCta page={page} localizedPage={localizedPage} />
      </main>
      <Footer />
    </div>
  );
}

export function buildSeoJsonLd(page: SeoPage) {
  const canonicalUrl = `${SITE_URL}${page.path}`;
  return {
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
        about: {
          "@id": `${SITE_URL}/#software`,
        },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: "Rejourney",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, iOS, Android",
        description: "Lightweight product analytics for web and mobile apps with session replay, funnels, heatmaps, crash and API context, unlimited events, and privacy controls.",
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
          url: `${SITE_URL}/`,
        },
      },
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
      {
        "@type": "BreadcrumbList",
        "@id": `${canonicalUrl}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Rejourney",
            item: `${SITE_URL}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: page.title,
          },
        ],
      },
    ],
  };
}

export function buildLocalizedSeoJsonLd(page: LocalizedSeoPage, englishPage: SeoPage) {
  const canonicalUrl = `${SITE_URL}${page.localizedPath}`;
  const faq = getLocalizedSeoFaq(page);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${canonicalUrl}#webpage`,
        url: canonicalUrl,
        name: page.metaTitle,
        headline: page.h1,
        description: page.metaDescription,
        inLanguage: page.locale.languageTag,
        keywords: [page.primaryKeyword, ...page.secondaryKeywords],
        isPartOf: {
          "@type": "WebSite",
          "@id": `${SITE_URL}/#website`,
          name: "Rejourney",
          url: `${SITE_URL}/`,
        },
        primaryImageOfPage: {
          "@type": "ImageObject",
          url: `${SITE_URL}${englishPage.image}`,
        },
        about: { "@id": `${SITE_URL}/#software` },
      },
      {
        "@type": "SoftwareApplication",
        "@id": `${SITE_URL}/#software`,
        name: "Rejourney",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, iOS, Android",
        description: page.intro,
        inLanguage: page.locale.languageTag,
        url: `${SITE_URL}/`,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
          url: `${SITE_URL}/pricing`,
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${canonicalUrl}#faq`,
        inLanguage: page.locale.languageTag,
        mainEntity: faq.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${canonicalUrl}#breadcrumb`,
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Rejourney",
            item: `${SITE_URL}/`,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: page.h1,
            item: canonicalUrl,
          },
        ],
      },
    ],
  };
}

function LocalizedSeoLandingPage({ page, englishPage }: { page: LocalizedSeoPage; englishPage: SeoPage }) {
  const location = useLocation();
  const faq = getLocalizedSeoFaq(page);
  const relatedPages = SEO_LOCALIZED_PAGE_PATHS
    .filter((path) => path !== page.basePath)
    .slice(0, 3)
    .map((path) => getLocalizedSeoPage(page.localeCode, path));
  const primaryHref = landingHrefWithAttribution("/login", location.search);
  const secondaryHref = landingHrefWithAttribution("/demo", location.search);
  const heroImage = AD_LANDING_HERO_IMAGES[englishPage.path] ?? englishPage.image;
  const heroDimensions = featureImageDimensionsBySrc[heroImage] ?? { width: 1440, height: 900 };
  const isRevenuePage = englishPage.path.includes("funnel") || englishPage.path.includes("revenue");
  return (
    <div
      className="public-readable-scope flex min-h-screen flex-col bg-[#fdfbf7] text-slate-950"
      lang={page.locale.languageTag}
      dir={page.locale.dir}
    >
      <AttributionLinkPreserver />
      <Header />
      <main className="flex-grow">
        <section className="border-b border-black/10 bg-[#fdfbf7] px-5 pb-14 pt-16 sm:px-6 sm:pb-16 sm:pt-20 lg:px-8 lg:pb-20" aria-labelledby="localized-seo-title">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center lg:gap-14">
              <div className="max-w-2xl">
                <p className="mb-4 inline-flex items-center gap-3 text-sm font-semibold text-emerald-800">
                  <span className="h-px w-6 bg-emerald-600" aria-hidden />
                  {page.ui.eyebrow}
                </p>
                <h1 id="localized-seo-title" className="text-balance font-display text-4xl font-black leading-[1.01] tracking-[-0.045em] text-slate-950 sm:text-5xl lg:text-6xl">
                  {page.h1}
                </h1>
                <p className="mt-6 max-w-xl text-pretty text-lg font-medium leading-8 text-slate-600 sm:text-xl">{page.intro}</p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link to={primaryHref} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#86efac] px-7 text-sm font-extrabold text-slate-950 transition-colors hover:bg-[#74e89c]">
                    {page.ui.startFree}<ArrowRight className={`h-4 w-4 ${page.locale.dir === "rtl" ? "rotate-180" : ""}`} aria-hidden />
                  </Link>
                  <Link to={secondaryHref} className="inline-flex min-h-12 items-center justify-center rounded-lg border border-slate-300 bg-white px-7 text-sm font-extrabold text-slate-950 transition-colors hover:border-slate-500">
                    {page.ui.liveDemo}
                  </Link>
                </div>
                <p className="mt-5 max-w-xl text-sm font-medium leading-6 text-slate-600">{page.ui.reassurance}</p>
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-semibold text-slate-600">
                  <span>{page.ui.freeSessions}</span>
                  <span aria-hidden>·</span>
                  <span>{page.ui.noCreditCard}</span>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1.5"><EuFlag className="h-3.5 w-5" />{page.ui.gdprCompliant}</span>
                </div>
              </div>

              <div className="min-w-0">
                <figure className="overflow-hidden rounded-xl border border-black/10 bg-white p-3 shadow-[0_10px_32px_rgba(15,23,42,0.06)]">
                  <img
                    src={optimizedMarketingImage(heroImage)}
                    alt={page.h1}
                    width={heroDimensions.width}
                    height={heroDimensions.height}
                    decoding="async"
                    className="h-auto max-h-[520px] w-full object-contain"
                  />
                </figure>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-black/10 bg-white px-5 py-6 sm:px-6 lg:px-8" aria-label={page.ui.trustAriaLabel}>
          <div className="mx-auto flex max-w-6xl flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm font-semibold text-slate-700">
              <span>{page.ui.lightweightSdks}</span>
              <span className="text-slate-300" aria-hidden>/</span>
              <span>{page.ui.privacyMasking}</span>
              <span className="text-slate-300" aria-hidden>/</span>
              <span className="inline-flex items-center gap-2"><GermanFlag className="h-4 w-6" />{page.ui.hostedInGermany}</span>
            </div>
            <LandingPlatformLogos
              setupVariant={englishPage.setupVariant}
              ariaLabel={page.ui.supports}
            />
          </div>
        </section>

        {englishPage.kind !== "educational" ? (
          <section className="border-b border-black/10 bg-white px-5 py-10 sm:px-6 lg:px-8">
            <div className="mx-auto grid max-w-6xl border-y border-black/10 py-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-center lg:gap-12">
              <div>
                <p className="text-sm font-semibold text-emerald-800">{page.ui.verifiedResult}</p>
                <p className="mt-3 text-3xl font-black leading-tight tracking-[-0.04em] text-slate-950 sm:text-4xl">
                  {isRevenuePage ? page.ui.salesMetric : page.ui.onboardingMetric}
                </p>
              </div>
              <div className="mt-7 lg:mt-0">
                <p className="text-sm font-bold text-slate-950">{isRevenuePage ? "Burst Creatine" : "Campus Merch"}</p>
                <p className="mt-3 max-w-2xl text-base font-medium leading-7 text-slate-600">
                  {isRevenuePage ? page.ui.salesProof : page.ui.onboardingProof}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        <section className="border-b border-slate-200 bg-[#f7f6f1] px-5 py-16 sm:px-8 lg:py-20" aria-labelledby="localized-benefits-title">
          <div className="mx-auto max-w-6xl">
            <h2 id="localized-benefits-title" className="max-w-4xl text-balance font-display text-3xl font-black tracking-[-0.035em] sm:text-5xl">
              {page.ui.benefitsHeading}
            </h2>
            <div className="mt-10 grid gap-5 lg:grid-cols-3">
              {page.benefits.map((benefit) => (
                <article key={benefit.title} className="border border-slate-200 bg-white p-7">
                  <h3 className="text-2xl font-black tracking-[-0.025em]">{benefit.title}</h3>
                  <p className="mt-4 text-base font-medium leading-7 text-slate-600">{benefit.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white px-5 py-16 sm:px-8 lg:py-20">
          <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-2 lg:gap-14">
            <article className="border-s-4 border-emerald-400 ps-6">
              <h2 className="text-3xl font-black tracking-[-0.03em]">{page.ui.evidenceHeading}</h2>
              <p className="mt-5 text-lg font-medium leading-8 text-slate-600">{page.evidence}</p>
            </article>
            <article className="border-s-4 border-sky-400 ps-6">
              <h2 className="text-3xl font-black tracking-[-0.03em]">{page.ui.platformHeading}</h2>
              <p className="mt-5 text-lg font-medium leading-8 text-slate-600">{page.platforms}</p>
            </article>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-[#f7f6f1] px-5 py-16 sm:px-8 lg:py-20" aria-labelledby="localized-faq-title">
          <div className="mx-auto max-w-4xl">
            <h2 id="localized-faq-title" className="text-4xl font-black tracking-[-0.04em]">{page.ui.faqHeading}</h2>
            <div className="mt-8 divide-y divide-slate-200 border-y border-slate-200">
              {faq.map((item) => (
                <details key={item.question} className="group py-6">
                  <summary className="cursor-pointer list-none text-xl font-black">{item.question}</summary>
                  <p className="mt-4 text-base font-medium leading-7 text-slate-600">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-slate-200 bg-white px-5 py-16 sm:px-8" aria-labelledby="localized-related-title">
          <div className="mx-auto max-w-6xl">
            <h2 id="localized-related-title" className="text-3xl font-black tracking-[-0.03em]">{page.ui.relatedHeading}</h2>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {relatedPages.map((relatedPage) => (
                <Link key={relatedPage.localizedPath} to={relatedPage.localizedPath} className="group border border-slate-200 bg-[#f7f6f1] p-6 transition-colors hover:border-slate-500">
                  <h3 className="text-xl font-black">{relatedPage.h1}</h3>
                  <p className="mt-3 text-sm font-medium leading-6 text-slate-600">{relatedPage.intro}</p>
                  <ArrowRight className={`mt-5 h-5 w-5 transition-transform group-hover:translate-x-1 ${page.locale.dir === "rtl" ? "rotate-180 group-hover:-translate-x-1" : ""}`} aria-hidden />
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-slate-950 px-5 py-16 text-white sm:px-8 lg:py-20">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="text-balance text-4xl font-black tracking-[-0.04em] sm:text-5xl">{page.ui.finalHeading}</h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg font-medium leading-8 text-slate-300">{page.ui.finalCopy}</p>
            <Link to={primaryHref} className="mt-8 inline-flex min-h-12 items-center justify-center rounded-lg bg-[#86efac] px-8 text-sm font-extrabold text-slate-950 transition-colors hover:bg-[#74e89c]">
              {page.ui.startFree}
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

export default function SeoLandingPage() {
  const location = useLocation();
  const localizedPage = getLocalizedSeoPageByPath(location.pathname);
  const page = getSeoPageByPath(localizedPage?.basePath ?? normalizePath(location.pathname));

  if (!page) return null;

  const jsonLd = localizedPage
    ? buildLocalizedSeoJsonLd(localizedPage, page)
    : buildSeoJsonLd(page);
  const renderPage = localizedPage ? buildLocalizedSeoRenderPage(localizedPage, page) : page;

  return (
    <div className="public-readable-scope min-h-screen bg-[#fdfbf7] text-slate-950" lang={localizedPage?.locale.languageTag ?? "en-US"} dir={localizedPage?.locale.dir ?? "ltr"}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PaidAdLandingPage page={renderPage} localizedPage={localizedPage ?? undefined} />
    </div>
  );
}
