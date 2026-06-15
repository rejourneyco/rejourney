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
  "/ai-funnel-leak-detection": {
    title: "AI funnel leak detection",
    subtitle: "Rank conversion leaks, rage taps, crashes, API failures, and journey loops from the leaks page.",
    guideTitle: "Start from the ranked leak",
    fitTitle: "Best fit",
    tradeoffTitle: "Use generic analytics when",
    heroBullets: ["Rank repeated leak signals", "Open replay evidence", "Create fix-ready context"],
    available: ["Product teams", "Growth teams", "Engineering"],
    showcaseTabs: ["Detect", "Rank", "Replay", "Package", "Fix"],
    showcaseTitle: "Turn the leaks page into a repair queue",
    showcaseCopy: "Start with the ranked leak, then inspect the sessions, journeys, failures, and context that explain why users dropped.",
    showcaseBullets: ["Group repeated issues", "Keep replay beside each leak", "Hand off evidence without rewriting it"],
    steps: ["Open the leaks page", "Inspect the ranked evidence", "Route the context to the owner"],
  },
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
  "/ai-agent-handoff": {
    title: "AI agent handoff",
    subtitle: "Package replay, event, request, crash, and journey evidence for developer AI workflows.",
    guideTitle: "Prepare the packet",
    fitTitle: "Best fit",
    tradeoffTitle: "Use manual tickets when",
    heroBullets: ["Replay links", "Markdown context", "Coding-agent ready"],
    available: ["Engineering", "Support", "Product"],
    showcaseTabs: ["Collect", "Summarize", "Review", "Paste", "Verify"],
    showcaseTitle: "Give the agent the facts it needs",
    showcaseCopy: "Turn session evidence into a structured packet a developer can review and hand to Cursor, Claude, Codex, or an IDE assistant.",
    showcaseBullets: ["Describe expected and observed behavior", "Attach technical signals", "Keep the replay link with the fix context"],
    steps: ["Open the issue", "Generate the context", "Review and hand off"],
  },
  "/autonomous-debugging": {
    title: "Autonomous debugging",
    subtitle: "Group repeated production failures with replay, stack, API, device, and release context.",
    guideTitle: "Start with reproducible evidence",
    fitTitle: "Best fit",
    tradeoffTitle: "Use crash-only triage when",
    heroBullets: ["Repeated signals", "Replay-linked bugs", "Fix-ready handoff"],
    available: ["Engineering", "Mobile apps", "Web apps"],
    showcaseTabs: ["Group", "Replay", "Inspect", "Handoff", "Verify"],
    showcaseTitle: "Debug from the session that proves the bug",
    showcaseCopy: "Autonomous debugging works when replay, crash, API, release, and user-path context stay together.",
    showcaseBullets: ["Avoid reconstructing evidence by hand", "Open sessions behind repeated issues", "Hand off reproducible context"],
    steps: ["Group the repeated signal", "Inspect replay and technical context", "Send the fix packet"],
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
    heroBullets: ["Record taps and gestures", "Inspect crashes and ANRs", "Support React Native, Expo, and iOS"],
    available: ["React Native", "Expo", "iOS"],
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
  "/images/heatmaps.png": { width: 998, height: 794 },
  "/images/hero-replay-workbench.png": { width: 1024, height: 597 },
  "/images/issues-feed.png": { width: 1024, height: 378 },
  "/images/landing-replay-theater.png": { width: 2018, height: 1080 },
  "/images/readme-general-demo.png": { width: 1440, height: 900 },
  "/images/readme-user-journeys.png": { width: 1078, height: 663 },
  "/images/session-replay-preview.png": { width: 1024, height: 598 },
  "/images/user-journeys.png": { width: 1024, height: 544 },
  "/images/engineering/ambiguity-api-error-rate-by-country.png": { width: 1680, height: 950 },
  "/images/engineering/product-tools-live-general.png": { width: 1440, height: 820 },
  "/images/engineering/product-tools-live-journeys.png": { width: 1440, height: 820 },
  "/images/engineering/product-tools-live-replay.png": { width: 1440, height: 820 },
  "/images/engineering/product-tools-live-stability.png": { width: 1440, height: 820 },
  "/images/engineering/record-sessions-ai-query-builder.png": { width: 943, height: 180 },
  "/images/engineering/record-sessions-journey-selection.png": { width: 1000, height: 640 },
  "/images/engineering/heatmaps-attention-docs.png": { width: 1006, height: 834 },
  "/images/engineering/heatmaps-dashboard.png": { width: 1972, height: 1226 },
  "/images/engineering/heatmaps-mobile-touch-map.png": { width: 540, height: 1010 },
  "/images/engineering/heatmaps-web-attention-map.png": { width: 1410, height: 1034 },
  "/images/engineering/smartlook-alternatives-heatmaps.png": { width: 1600, height: 980 },
  "/images/engineering/churn-mobile-heatmap.png": { width: 648, height: 990 },
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
  "/ai-funnel-leak-detection": [
    {
      src: "/images/landing-replay-theater.png",
      alt: "Rejourney leaks page showing ranked issue detection and funnel leak evidence",
      title: "Leaks page",
      copy: "Start from ranked leak signals instead of searching the whole replay archive.",
    },
    {
      src: "/images/issues-feed.png",
      alt: "Rejourney issues feed with replay-backed leak signals",
      title: "Issue feed",
      copy: "Review repeated issues with enough context to decide what deserves repair.",
    },
    {
      src: "/images/readme-general-demo.png",
      alt: "Rejourney issue detection dashboard with fix-ready context",
      title: "Leak context",
      copy: "Keep session, product, and technical context beside the issue.",
    },
    {
      src: "/images/readme-user-journeys.png",
      alt: "Rejourney journey ribbons showing funnel paths behind leaks",
      title: "Journey evidence",
      copy: "Use paths to understand whether the leak repeats across a flow.",
    },
  ],
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
  "/ai-agent-handoff": [
    {
      src: "/images/readme-general-demo.png",
      alt: "Rejourney issue detection dashboard for AI handoff context",
      title: "Fix packet",
      copy: "Prepare replay-backed context for a developer or coding agent.",
    },
    {
      src: "/images/issues-feed.png",
      alt: "Rejourney issue feed with repeated signals",
      title: "Repeated signals",
      copy: "Start the handoff from a grouped issue instead of a vague report.",
    },
    {
      src: "/images/session-replay-preview.png",
      alt: "Rejourney session replay evidence for AI handoff",
      title: "Replay evidence",
      copy: "Keep the exact session attached to the handoff.",
    },
  ],
  "/autonomous-debugging": [
    {
      src: "/images/anr-issues.png",
      alt: "Rejourney stability dashboard with ANR and crash context",
      title: "Stability issue",
      copy: "Group repeated production failures with replay and app context.",
    },
    {
      src: "/images/issues-feed.png",
      alt: "Rejourney issues feed for autonomous debugging",
      title: "Issue queue",
      copy: "Start from ranked issue signals before opening the technical detail.",
    },
    {
      src: "/images/session-replay-preview.png",
      alt: "Rejourney replay evidence for production debugging",
      title: "Replay context",
      copy: "Use the session to reproduce what the user experienced.",
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
      alt: "Rejourney web attention map over the Web SDK documentation page",
      title: "Web attention map",
      copy: "Use attention maps to see whether important web content was noticed, skimmed, or ignored.",
    },
    {
      src: "/images/engineering/heatmaps-dashboard.png",
      alt: "Rejourney heatmaps dashboard showing a mobile Profile touch map with route context",
      title: "Heatmap dashboard",
      copy: "Review route-level heatmap evidence beside traffic, replay, and product context.",
    },
    {
      src: "/images/engineering/heatmaps-mobile-touch-map.png",
      alt: "Rejourney mobile touch heatmap on a product discovery screen",
      title: "Mobile touch map",
      copy: "Use touch maps for taps, dead zones, repeated touches, and gesture confusion.",
    },
    {
      src: "/images/engineering/heatmaps-web-attention-map.png",
      alt: "Rejourney web attention map over a Next.js fixture page",
      title: "Web attention map",
      copy: "Use web attention maps to diagnose what page content visitors skimmed, missed, or focused on.",
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

function categoryDocsLink(page: SeoPage) {
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
          src={image.src}
          alt={image.alt}
          width={dimensions?.width}
          height={dimensions?.height}
          className="block h-auto w-full min-w-0 max-w-full"
          loading={variant === "hero" ? "eager" : "lazy"}
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
  "/ai-funnel-leak-detection": {
    sections: [
      {
        title: "Open the leaks page before opening random sessions",
        paragraphs: [
          "The leaks page is the triage surface for repeated friction. Instead of starting in a replay archive, the team starts with grouped issues that already point to a funnel drop, rage tap cluster, crash, API failure, journey loop, or blocked product path.",
          "That changes the review from clip hunting to issue ranking. Product can ask which leak costs the most intent, growth can look for revenue impact, and engineering can open the exact sessions that prove the failure.",
        ],
        bullets: [
          "Repeated product and technical signals grouped together.",
          "Replay evidence attached to the issue instead of stored elsewhere.",
          "Affected paths, sessions, and context ready for the owner.",
        ],
        imageIndex: 0,
        imageVariant: "wide",
      },
      {
        title: "Rank leaks by user impact and fixability",
        paragraphs: [
          "A useful leaks page should not treat every signal as equal. A one-off confusing session, a repeated checkout failure, and a release-specific crash all need different priority.",
          "Rejourney keeps the issue list tied to user impact and supporting evidence, so the team can see whether a leak is repeated, whether it blocks conversion, and whether the available context is enough for someone to repair it.",
        ],
        bullets: [
          "Prioritize repeated leaks over isolated oddities.",
          "Check the path and session sample before assigning work.",
          "Keep technical signals close enough to prove the likely cause.",
        ],
        imageIndex: 1,
        imageVariant: "wide",
      },
      {
        title: "Inspect the replay evidence behind the issue",
        paragraphs: [
          "The issue summary is only the door. The proof is still the session: what the user saw, which path they took, where they hesitated, what request failed, and whether a crash or UI state shaped the outcome.",
          "When the replay evidence stays attached, the team can verify that the issue description matches reality before it becomes roadmap work or an engineering ticket.",
        ],
        imageIndex: 2,
        imageVariant: "wide",
      },
      {
        title: "Use journey paths to prove the leak repeats",
        paragraphs: [
          "Some leaks are path-shaped. Users branch, loop, or drop after a transition rather than at a single obvious button. Journey ribbons make those patterns easier to spot and easier to explain.",
          "From the leaks page, the journey evidence helps the team decide whether the issue is a repeated funnel problem or just one strange session. That context matters before assigning priority.",
        ],
        imageIndex: 3,
        imageVariant: "wide",
      },
      {
        title: "Package the fix context for engineering or an AI workflow",
        paragraphs: [
          "Once a leak is real and repeated, the handoff should include the path, expected behavior, observed behavior, affected sessions, relevant events, failed requests, release or device context, and replay links.",
          "That gives an engineer or coding agent enough evidence to begin reproducing the issue instead of asking someone to rewrite the same investigation in a ticket.",
        ],
        bullets: [
          "Expected and observed behavior.",
          "Replay links and affected session examples.",
          "Events, requests, crashes, devices, releases, and journey context.",
          "A short fix hypothesis that can be tested.",
        ],
      },
    ],
    implementationNotes: [
      "Do not file a leak until the replay evidence supports the issue summary.",
      "Keep grouped issues tied to route, screen, release, platform, and affected user context.",
      "Use journey ribbons when the failure is a path or transition problem.",
      "Package expected behavior, observed behavior, replay links, and technical context before handing the leak to engineering or an AI coding workflow.",
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
      {page.kind === "category" ? (
        <CategoryFeatureArticlePage page={page} />
      ) : (
        <AlternativeComparisonArticlePage page={page} />
      )}
      <Footer />
    </div>
  );
}
