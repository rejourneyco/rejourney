export type SeoPageKind = "capability" | "educational" | "alternative";

export type SeoSearchIntent = "commercial" | "comparison" | "informational";

export type SeoKeywordEvidence = {
  geography: string;
  volume: number | null;
  organicKd: number | null;
  volumeSource: string;
  kdSource: string;
  checkedAt: string;
};

export type SeoKeywordSection = {
  title: string;
  description: string;
  bullets: string[];
};

export type SeoOutcome = {
  title: string;
  description: string;
};

export type SeoProofStory = {
  customer: "Burst Creatine" | "Campus Merch";
  metric: string;
  summary: string;
};

export type SeoComparisonValue = "yes" | "partial" | "no";

export type SeoSource = {
  label: string;
  href: string;
};

export type SeoComparisonRow = {
  feature: string;
  rejourney: SeoComparisonValue;
  other: SeoComparisonValue;
};

export type SeoFeatureDifference = {
  feature: string;
  rejourney: string;
  other: string;
};

export type SeoPage = {
  kind: SeoPageKind;
  pageFamily: SeoPageKind;
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
  };
  outcomes: SeoOutcome[];
  proofStory: SeoProofStory;
  setupVariant: "web" | "mobile" | "all" | "none";
  pricingVariant: "analytics" | "replay" | "none";
  comparison: { enabled: boolean; summaryRows: number };
  navigationMode: "focused";
  cta: {
    primaryLabel: "Start free";
    primaryHref: "/login";
    secondaryLabel: "Open live demo";
    secondaryHref: "/demo";
  };
  relatedPages: Array<{ label: string; href: string; description: string }>;
  path: string;
  badge: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  metaTitle: string;
  metaDescription: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: SeoSearchIntent;
  keywordEvidence?: SeoKeywordEvidence;
  keywords: string[];
  keywordSections?: SeoKeywordSection[];
  lastModified: string;
  image: string;
  imageAlt: string;
  proofPoints: string[];
  whyTitle: string;
  whyParagraphs: string[];
  chooseRejourney: string[];
  chooseOtherTitle: string;
  chooseOther: string[];
  comparisonTitle: string;
  comparisonIntro: string;
  otherColumnTitle: string;
  comparisonRows: SeoComparisonRow[];
  featureDifferences?: SeoFeatureDifference[];
  lastReviewed?: string;
  competitorFacts?: string[];
  officialSources?: SeoSource[];
  pricingTitle: string;
  pricingIntro: string;
  pricingBullets: string[];
  faq: Array<{ question: string; answer: string }>;
  related: Array<{ label: string; href: string; description: string }>;
};

type CoreFeatureStatuses = {
  revenueLeakPrediction: SeoComparisonValue;
  frictionAlertEmails: SeoComparisonValue;
  replayFirst: SeoComparisonValue;
  webSessionReplay: SeoComparisonValue;
  mobileSessionReplay: SeoComparisonValue;
  productAnalytics: SeoComparisonValue;
  heatmaps: SeoComparisonValue;
  journeyMaps: SeoComparisonValue;
  crashOrErrorContext: SeoComparisonValue;
  networkApiContext: SeoComparisonValue;
  nativeApiCalls: SeoComparisonValue;
  consoleLogs: SeoComparisonValue;
  privacyMasking: SeoComparisonValue;
};

const coreFeatureRows = (other: CoreFeatureStatuses): SeoComparisonRow[] => [
  { feature: "Automated revenue leak prediction", rejourney: "yes", other: other.revenueLeakPrediction },
  { feature: "Replay-linked friction alert emails", rejourney: "yes", other: other.frictionAlertEmails },
  { feature: "Web session replay", rejourney: "yes", other: other.webSessionReplay },
  { feature: "Mobile session replay", rejourney: "yes", other: other.mobileSessionReplay },
  { feature: "Product analytics", rejourney: "yes", other: other.productAnalytics },
  { feature: "Heatmaps", rejourney: "yes", other: other.heatmaps },
  { feature: "Journey / funnel analysis", rejourney: "yes", other: other.journeyMaps },
  { feature: "Crash / error context", rejourney: "yes", other: other.crashOrErrorContext },
  { feature: "Network / API context", rejourney: "yes", other: other.networkApiContext },
  { feature: "Console logs", rejourney: "yes", other: other.consoleLogs },
  { feature: "Privacy masking controls", rejourney: "yes", other: other.privacyMasking },
];

const featureDifferenceRows = (
  rows: Array<{ feature: string; other: SeoComparisonValue }>,
): SeoComparisonRow[] => rows.map((row) => ({ feature: row.feature, rejourney: "yes", other: row.other }));

const comparisonRows = (
  core: CoreFeatureStatuses,
  differences: Array<{ feature: string; other: SeoComparisonValue }>,
): SeoComparisonRow[] => [
  ...coreFeatureRows(core),
  ...featureDifferenceRows(differences),
];

const categoryFeatureRows = (otherColumn: SeoComparisonValue): SeoComparisonRow[] => [
  { feature: "Revenue leak prediction", rejourney: "yes", other: "no" },
  { feature: "Replay-First", rejourney: "yes", other: otherColumn },
  { feature: "Web session replay", rejourney: "yes", other: otherColumn },
  { feature: "Mobile session replay", rejourney: "yes", other: otherColumn },
  { feature: "Product analytics", rejourney: "yes", other: otherColumn },
  { feature: "Heatmaps", rejourney: "yes", other: otherColumn },
  { feature: "Journey maps", rejourney: "yes", other: otherColumn },
  { feature: "Crash / error context", rejourney: "yes", other: otherColumn },
  { feature: "Network / API context", rejourney: "yes", other: otherColumn },
  { feature: "Native API calls", rejourney: "yes", other: otherColumn },
  { feature: "Console logs", rejourney: "yes", other: otherColumn },
  { feature: "Privacy masking controls", rejourney: "yes", other: otherColumn },
];

const commonPricingBullets = [
  "Unlimited events so product analytics does not get punished for instrumenting more detail.",
  "Unlimited analytics data retention for long-horizon product, support, and release analysis.",
  "Unlimited team members and projects so PM, design, engineering, and support can use the same workspace.",
  "Replay, heatmaps, journeys, crash context, API context, and product analytics in one dashboard.",
];

const educationalPaths = new Set([
  "/replay-first-mentality",
  "/importance-of-open-source",
  "/what-is-session-replay",
  "/how-to-see-what-your-users-do",
  "/be-your-users",
]);

const relatedPagesFor = (path: string, kind: SeoPageKind): SeoPage["relatedPages"] => {
  const alternatives = [
    { label: "PostHog comparison", href: "/alternatives/posthog-session-replay", description: "Compare replay, analytics, mobile evidence, and technical context." },
    { label: "Sentry comparison", href: "/alternatives/sentry-session-replay", description: "Compare product evidence with an error-monitoring-first workflow." },
    { label: "Fullstory comparison", href: "/alternatives/fullstory", description: "Compare replay coverage, mobile support, and product analytics." },
    { label: "Hotjar comparison", href: "/alternatives/hotjar", description: "Compare heatmaps and replay with a broader web and mobile workspace." },
  ];
  const educational = [
    { label: "What is session replay?", href: "/what-is-session-replay", description: "Understand what replay records, what it explains, and where it falls short." },
    { label: "Replay-first mentality", href: "/replay-first-mentality", description: "Learn when to start with session evidence instead of another aggregate chart." },
    { label: "How to see what users do", href: "/how-to-see-what-your-users-do", description: "Turn observed product behavior into a bounded investigation." },
    { label: "Be your users", href: "/be-your-users", description: "Use real product evidence to make user empathy concrete." },
  ];
  const mobile = [
    { label: "Mobile session replay", href: "/mobile-session-replay", description: "Replay native app sessions with touch, crash, and network context." },
    { label: "App analytics", href: "/app-analytics", description: "Connect engagement and retention metrics to the sessions behind them." },
    { label: "Stability monitoring", href: "/stability-monitoring", description: "Investigate crashes, ANRs, errors, and affected sessions together." },
    { label: "Device insights", href: "/device-insights", description: "Find device, OS, and app-version friction hidden by averages." },
  ];
  const revenue = [
    { label: "Funnel replay evidence", href: "/funnel-replay-evidence", description: "Open the sessions behind a checkout, signup, or onboarding drop-off." },
    { label: "Revenue recovery analytics", href: "/revenue-recovery-analytics", description: "Connect conversion loss to the product behavior that caused it." },
    { label: "Website analytics", href: "/website-analytics", description: "Measure conversion paths with the session evidence attached." },
    { label: "Revenue leak guide", href: "/guides/2026-07-12/revenue-leak-detection", description: "Use a practical framework for finding product revenue leaks." },
  ];
  const web = [
    { label: "Web session replay", href: "/web-session-replay", description: "Replay browser behavior with route, console, and request context." },
    { label: "Website analytics", href: "/website-analytics", description: "Connect website metrics, journeys, and sessions in one workspace." },
    { label: "Record user sessions", href: "/record-user-sessions", description: "See how to capture useful sessions with privacy controls." },
    { label: "Heatmaps", href: "/heatmaps", description: "Add aggregate click and scroll evidence to individual sessions." },
  ];
  const operational = [
    { label: "API endpoint insights", href: "/api-endpoint-insights", description: "Rank endpoint failures and latency by affected product traffic." },
    { label: "Stability monitoring", href: "/stability-monitoring", description: "Connect crashes, errors, and ANRs to real user sessions." },
    { label: "Geographic analytics", href: "/geographic-analytics", description: "See where product and infrastructure problems concentrate." },
    { label: "Standardized context", href: "/standardized-context", description: "Prepare replay evidence for consistent human and AI investigation." },
  ];
  const alternativeCapabilityPages: Record<string, SeoPage["relatedPages"]> = {
    "/alternatives/posthog-session-replay": [mobile[1], web[0]],
    "/alternatives/sentry-session-replay": [mobile[2], mobile[0]],
    "/alternatives/datadog-session-replay": [web[0], mobile[2]],
    "/alternatives/amplitude-session-replay": [mobile[1], web[0]],
    "/alternatives/mixpanel-session-replay": [mobile[1], web[0]],
    "/alternatives/pendo-session-replay": [mobile[1], revenue[0]],
    "/alternatives/smartlook": [web[0], mobile[0], web[3]],
    "/alternatives/hotjar": [web[3], web[0], mobile[0]],
    "/alternatives/fullstory": [web[0], mobile[0], web[3]],
  };

  const candidates = kind === "alternative"
    ? [...(alternativeCapabilityPages[path] ?? [web[0], mobile[0]]), ...alternatives]
    : kind === "educational"
      ? educational
      : path.includes("mobile") || path === "/app-analytics" || path === "/device-insights"
        ? mobile
        : path.includes("revenue") || path.includes("funnel")
          ? revenue
          : path.includes("web") || path.includes("website") || path === "/record-user-sessions" || path === "/heatmaps"
            ? web
            : operational;

  return candidates.filter((related) => related.href !== path).slice(0, 3);
};

const setupVariantForPath = (path: string, kind: SeoPageKind): SeoPage["setupVariant"] => {
  if (kind === "educational") return "none";
  if (path.includes("web") || path === "/website-analytics") return "web";
  if (
    path.includes("mobile")
    || path === "/app-analytics"
    || path === "/stability-monitoring"
    || path === "/device-insights"
  ) return "mobile";
  return "all";
};

const proofStoryForPath = (path: string): SeoProofStory => (
  path.includes("revenue") || path.includes("funnel") || path.includes("checkout")
    ? {
        customer: "Burst Creatine",
        metric: "103% sales increase",
        summary: "Replay evidence exposed conversion friction in a revenue-critical journey so the team could fix the proven failure first.",
      }
    : {
        customer: "Campus Merch",
        metric: "93% onboarding completion",
        summary: "Session evidence helped the team isolate a Safari layout failure and restore a critical onboarding path.",
      }
);

const commonCta: SeoPage["cta"] = {
  primaryLabel: "Start free",
  primaryHref: "/login",
  secondaryLabel: "Open live demo",
  secondaryHref: "/demo",
};

const buildOutcomes = (
  proofPoints: string[],
  whyParagraphs: string[],
  subtitle: string,
): SeoOutcome[] => {
  const fallbackTitles = ["Find the signal", "Open the evidence", "Make the next decision"];
  return fallbackTitles.map((fallbackTitle, index) => ({
    title: proofPoints[index] ?? fallbackTitle,
    description: whyParagraphs[index] ?? whyParagraphs[0] ?? subtitle,
  }));
};

const categoryPage = (config: {
  path: string;
  badge: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  metaTitle: string;
  metaDescription: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  searchIntent?: SeoSearchIntent;
  keywordEvidence?: SeoKeywordEvidence;
  keywords: string[];
  keywordSections?: SeoKeywordSection[];
  lastModified?: string;
  image: string;
  imageAlt: string;
  proofPoints: string[];
  whyTitle: string;
  whyParagraphs: string[];
  chooseOtherTitle: string;
  chooseOther: string[];
  comparisonTitle: string;
  comparisonIntro: string;
  otherColumnTitle: string;
  comparisonOther: SeoComparisonValue;
  officialSources?: SeoSource[];
  faq: SeoPage["faq"];
}): SeoPage => {
  const kind: SeoPageKind = educationalPaths.has(config.path) ? "educational" : "capability";
  const relatedPages = relatedPagesFor(config.path, kind);
  const primaryKeyword = config.primaryKeyword ?? config.keywords[0];
  const secondaryKeywords = config.secondaryKeywords
    ?? config.keywords.filter((keyword) => keyword !== primaryKeyword);

  return {
  kind,
  pageFamily: kind,
  hero: {
    eyebrow: config.eyebrow,
    title: config.title,
    subtitle: config.subtitle,
  },
  outcomes: buildOutcomes(config.proofPoints, config.whyParagraphs, config.subtitle),
  proofStory: proofStoryForPath(config.path),
  setupVariant: setupVariantForPath(config.path, kind),
  pricingVariant: config.path === "/website-analytics" || config.path === "/app-analytics" ? "analytics" : "none",
  comparison: { enabled: false, summaryRows: 0 },
  navigationMode: "focused",
  cta: commonCta,
  relatedPages,
  chooseRejourney: [
    "You want replay, product analytics, heatmaps, journeys, crashes, and network context together.",
    "You need predictable pricing with unlimited events, retention, projects, and team members.",
    "You want a lightweight SDK that is easy to add to web, React Native, Expo, Flutter, and iOS apps.",
    "You want a product team and engineering team to investigate the same real session.",
  ],
  pricingTitle: "Pricing built for teams that instrument deeply",
  pricingIntro:
    "Rejourney is designed so you do not have to ration events, projects, seats, or historical analytics data. Replay volume can be planned, while the broader product analytics workspace stays open to the whole team.",
  pricingBullets: commonPricingBullets,
  related: relatedPages,
  ...config,
  primaryKeyword,
  secondaryKeywords,
  searchIntent: config.searchIntent ?? (kind === "educational" ? "informational" : "commercial"),
  keywordEvidence: config.keywordEvidence,
  keywordSections: config.keywordSections,
  lastModified: config.lastModified ?? "2026-08-01",
  keywords: Array.from(new Set(["lightweight product analytics", primaryKeyword, ...secondaryKeywords])),
  comparisonRows: categoryFeatureRows(config.comparisonOther),
  };
};

const alternativePage = (config: {
  path: string;
  competitor: string;
  badge: string;
  subtitle: string;
  metaTitle: string;
  metaDescription: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  keywords: string[];
  image: string;
  imageAlt: string;
  proofPoints: string[];
  whyParagraphs: string[];
  chooseOther: string[];
  comparisonRows: SeoComparisonRow[];
  featureDifferences: SeoFeatureDifference[];
  competitorFacts: string[];
  officialSources: SeoSource[];
  pricingIntro: string;
  faq: SeoPage["faq"];
}): SeoPage => {
  const relatedPages = relatedPagesFor(config.path, "alternative");
  const primaryKeyword = config.primaryKeyword ?? config.keywords[0];
  const secondaryKeywords = config.secondaryKeywords
    ?? config.keywords.filter((keyword) => keyword !== primaryKeyword);

  return {
  kind: "alternative",
  pageFamily: "alternative",
  hero: {
    eyebrow: "Alternative comparison",
    title: `Rejourney vs ${config.competitor}`,
    subtitle: config.subtitle,
  },
  outcomes: buildOutcomes(config.proofPoints, config.whyParagraphs, config.subtitle),
  proofStory: proofStoryForPath(config.path),
  setupVariant: "all",
  pricingVariant: "replay",
  comparison: { enabled: true, summaryRows: 5 },
  navigationMode: "focused",
  cta: commonCta,
  relatedPages,
  path: config.path,
  badge: config.badge,
  eyebrow: "Alternative comparison",
  title: `Rejourney vs ${config.competitor}`,
  subtitle: config.subtitle,
  metaTitle: config.metaTitle,
  metaDescription: config.metaDescription,
  primaryKeyword,
  secondaryKeywords,
  searchIntent: "comparison",
  keywords: Array.from(new Set(["lightweight product analytics", primaryKeyword, ...secondaryKeywords])),
  lastModified: "2026-07-21",
  image: config.image,
  imageAlt: config.imageAlt,
  proofPoints: config.proofPoints,
  whyTitle: `Why consider Rejourney over ${config.competitor}?`,
  whyParagraphs: config.whyParagraphs,
  chooseRejourney: [
    "You want lightweight product analytics and replay for web and mobile apps in one workspace.",
    "You care about unlimited events, analytics retention, projects, and team members.",
    "You want session replay connected to journeys, heatmaps, crashes, ANRs, and network context.",
    "You prefer a focused tool that product, support, and engineering can all understand quickly.",
  ],
  chooseOtherTitle: `Choose ${config.competitor} if...`,
  chooseOther: config.chooseOther,
  comparisonTitle: `Checklist comparison: Rejourney and ${config.competitor}`,
  comparisonIntro:
    `Use this table as a starting point, then verify ${config.competitor}'s current packaging and limits against the official source before buying.`,
  otherColumnTitle: config.competitor,
  comparisonRows: config.comparisonRows,
  featureDifferences: config.featureDifferences,
  lastReviewed: "July 21, 2026",
  competitorFacts: config.competitorFacts,
  officialSources: config.officialSources,
  pricingTitle: "Pricing comparison",
  pricingIntro: config.pricingIntro,
  pricingBullets: commonPricingBullets,
  faq: config.faq,
  related: relatedPages,
  };
};

export const SEO_PAGES: SeoPage[] = [
  categoryPage({
    path: "/funnel-replay-evidence",
    badge: "Funnels",
    eyebrow: "Funnel replay evidence",
    title: "Funnel Analysis with Replay Evidence",
    subtitle:
      "Use journey ribbons to find the highest-volume paths, then open the replay evidence behind each branch, loop, and drop-off.",
    metaTitle: "Funnel Analysis with Session Replay | Rejourney",
    metaDescription:
      "Funnel analysis with session replay, journey paths, and drop-off evidence for web and mobile product teams.",
    primaryKeyword: "funnel analysis",
    secondaryKeywords: ["funnel analysis with session replay", "funnel analysis software", "funnel drop-off analysis", "funnel replay evidence"],
    searchIntent: "commercial",
    keywordEvidence: {
      geography: "United States",
      volume: 1000,
      organicKd: 16,
      volumeSource: "Ahrefs lower-bound volume bucket",
      kdSource: "Ahrefs",
      checkedAt: "2026-08-01",
    },
    keywords: ["funnel analysis", "funnel analysis with session replay", "funnel analysis software", "funnel drop-off analysis", "funnel replay evidence"],
    keywordSections: [
      {
        title: "Where does the highest-value path break?",
        description: "Rank drop-offs by affected users and conversion impact instead of chasing the loudest chart movement.",
        bullets: ["Step conversion", "Drop-off cohorts", "Release and segment comparisons"],
      },
      {
        title: "Are users dropping—or taking a detour?",
        description: "See loops, backtracks, and alternate routes that a linear step funnel hides.",
        bullets: ["Weighted journey paths", "Backtracking and loops", "Healthy versus degraded routes"],
      },
      {
        title: "What happened in the sessions behind the loss?",
        description: "Open only the replays from the affected path and hand off evidence your team can reproduce.",
        bullets: ["Matching session replay", "Crash and request context", "Replay-backed handoff"],
      },
    ],
    image: "/images/readme-user-journeys.png",
    imageAlt: "Rejourney journey ribbon map showing funnel paths and replay evidence",
    proofPoints: ["Journey ribbons", "Path drop-offs", "Replay-backed decisions"],
    whyTitle: "Funnel paths are easier to fix when the replay stays attached",
    whyParagraphs: [
      "Most funnel charts flatten the path into a few steps. Real users branch, loop, backtrack, skip, and stall. Rejourney's journey ribbons show those paths with enough weight to reveal which flows carry users forward and which ones leak.",
      "The important part is that the ribbon is not just a picture. A product team can use the path to open matching sessions, compare healthy and degraded journeys, and hand engineering the replay evidence behind the drop.",
      "That makes funnel repair less like debating a dashboard and more like reviewing the exact path users took before intent disappeared.",
    ],
    chooseOtherTitle: "Use a simple funnel report if...",
    chooseOther: [
      "Your flow is linear and a step-count chart answers the full question.",
      "You do not need to inspect sessions from a specific path before prioritizing work.",
      "Your team already ties funnel paths to replay samples and issue context elsewhere.",
    ],
    comparisonTitle: "Funnel replay evidence checklist",
    comparisonIntro:
      "Funnel evidence should show the path, the volume, the drop, and the sessions that prove what happened.",
    otherColumnTitle: "Step funnel",
    comparisonOther: "partial",
    faq: [
      {
        question: "What is funnel replay evidence?",
        answer:
          "It is the combination of journey-path analytics and the matching session replays behind those paths, so teams can watch the sessions that explain a branch, loop, or drop-off.",
      },
      {
        question: "Can Rejourney show non-linear funnels?",
        answer:
          "Yes. Journey ribbons are designed for paths where users branch, loop, or return to earlier screens instead of moving through a perfect sequence.",
      },
      {
        question: "How does this help product teams?",
        answer:
          "It helps product teams prioritize the highest-volume leaks and give engineering replay-backed context instead of only a funnel percentage.",
      },
    ],
  }),
  categoryPage({
    path: "/geographic-analytics",
    badge: "Regions",
    eyebrow: "Geographic analytics",
    title: "Geographic Analytics",
    subtitle:
      "Map positive, neutral, and frustrated sessions by region so teams can see where UX, network, language, or market-specific friction is clustering.",
    metaTitle: "Geographic Product Analytics | Rejourney",
    metaDescription:
      "Geographic product analytics with regional engagement, friction, sentiment, and session replay context by country.",
    keywords: ["geographic analytics", "regional sentiment analytics", "session replay by country", "UX friction by region", "product analytics map"],
    image: "/images/geo-analytics.png",
    imageAlt: "Rejourney geographic analytics map showing session sentiment by region",
    proofPoints: ["Regional sentiment", "Country-level friction", "Replay context"],
    whyTitle: "Regional friction hides inside global averages",
    whyParagraphs: [
      "A global conversion rate can look fine while one market is getting slow requests, confusing copy, missing payment options, or frustrated sessions. Geographic analytics makes those regional clusters visible before they become a support pattern.",
      "Rejourney maps session sentiment and friction by country, then keeps the underlying replay evidence close enough to inspect what users actually experienced in that market.",
      "That gives product, growth, and support teams a shared way to decide whether a regional issue is UX, infrastructure, localization, or funnel design.",
    ],
    chooseOtherTitle: "Use aggregate analytics if...",
    chooseOther: [
      "Your product does not vary meaningfully by market, language, infrastructure, or payment method.",
      "You do not need country-level replay evidence behind a regional spike.",
      "Your current analytics already connects region, sentiment, and session context.",
    ],
    comparisonTitle: "Geographic analytics checklist",
    comparisonIntro:
      "Regional analytics should connect the map to the session evidence behind each cluster.",
    otherColumnTitle: "Aggregate analytics",
    comparisonOther: "partial",
    faq: [
      {
        question: "What does geographic analytics show?",
        answer:
          "It shows where session volume, sentiment, and friction cluster by country or region, with replay context for the sessions behind each cluster.",
      },
      {
        question: "Why track sentiment by region?",
        answer:
          "Regional sentiment helps teams catch local UX, network, language, payment, or infrastructure issues that disappear inside global averages.",
      },
      {
        question: "Can I open sessions from a region?",
        answer:
          "Yes. The workflow is designed to connect regional signals back to replay evidence so teams can inspect the actual sessions behind the map.",
      },
    ],
  }),
  categoryPage({
    path: "/revenue-recovery-analytics",
    badge: "Growth",
    eyebrow: "Revenue recovery",
    title: "Revenue Recovery Analytics",
    subtitle:
      "Track revenue, transactions, active users, retention, and releases beside the sessions that explain movement.",
    metaTitle: "Revenue Recovery Product Analytics | Rejourney",
    metaDescription:
      "Connect revenue movement, transactions, releases, retention, funnels, and session replay evidence with lightweight product analytics.",
    keywords: ["revenue recovery analytics", "growth analytics", "revenue leak detection", "retention analytics", "session replay revenue"],
    image: "/images/growth-engines.png",
    imageAlt: "Rejourney revenue analytics dashboard with growth and retention metrics",
    proofPoints: ["Revenue movement", "Release markers", "Session context"],
    whyTitle: "Growth metrics are easier to repair when they keep their sessions",
    whyParagraphs: [
      "Revenue drops rarely explain themselves. A release, a checkout change, a slow screen, or a confusing path can move gross revenue, transaction count, active users, and retention at the same time.",
      "Rejourney keeps the revenue view close to session evidence, so growth teams can move from a metric change to the user behavior and product state that likely caused it.",
      "That makes growth work less about dashboard watching and more about recovery: identify the movement, inspect the sessions, prioritize the leak, and confirm the fix.",
    ],
    chooseOtherTitle: "Use a warehouse dashboard if...",
    chooseOther: [
      "You only need monthly reporting and do not investigate the sessions behind movement.",
      "Revenue analysis is handled entirely in a BI workflow that already links to replay context.",
      "Growth and engineering do not share work based on session evidence.",
    ],
    comparisonTitle: "Revenue recovery checklist",
    comparisonIntro:
      "Revenue analytics should connect movement to releases, affected users, and replay evidence.",
    otherColumnTitle: "BI dashboard",
    comparisonOther: "partial",
    faq: [
      {
        question: "How does Rejourney connect revenue to sessions?",
        answer:
          "It keeps revenue and product metrics near replay, journey, and issue evidence so teams can inspect the sessions behind a movement instead of stopping at the chart.",
      },
      {
        question: "Can growth teams use this without engineering?",
        answer:
          "Yes. Growth teams can identify affected flows and users, then bring engineering a bounded issue with replay evidence when a fix is needed.",
      },
      {
        question: "What metrics are useful for recovery?",
        answer:
          "Revenue trend, transaction count, active users, retention, release markers, affected segments, and matching sessions are the most useful starting points.",
      },
    ],
  }),
  categoryPage({
    path: "/standardized-context",
    badge: "Context",
    eyebrow: "Standardized context",
    title: "Standardized Session Context",
    subtitle:
      "Turn sessions, regional signals, events, and technical evidence into consistent context that teams can query, share, compare, and hand off.",
    metaTitle: "Unified Product Analytics Context | Rejourney",
    metaDescription:
      "Keep product events, replay, journeys, regions, crashes, devices, and API evidence connected through consistent analytics context.",
    keywords: ["standardized context", "session context", "replay context", "product analytics context", "debugging context"],
    image: "/images/growth-engines.png",
    imageAlt: "Rejourney analytics dashboard showing standardized product context",
    proofPoints: ["Shared identifiers", "Replay-linked context", "Exportable evidence"],
    whyTitle: "Context loses value when every team names it differently",
    whyParagraphs: [
      "A session ID, route, screen, region, event, release, request, crash, and user segment are only useful if they mean the same thing across product, data, support, and engineering.",
      "Rejourney standardizes those signals around the session so teams can compare issues, reopen evidence, and avoid rewriting the same debugging notes in every ticket.",
      "That gives data teams a cleaner layer for analysis while keeping the evidence attached to real user behavior.",
    ],
    chooseOtherTitle: "Use ad hoc notes if...",
    chooseOther: [
      "Only one person reviews sessions and the context never needs to travel.",
      "Your team already has a shared schema for replay, events, regions, releases, and issues.",
      "You do not need to compare behavior across sessions, regions, or releases.",
    ],
    comparisonTitle: "Standardized context checklist",
    comparisonIntro:
      "A context layer should make session evidence reusable across product, data, support, and engineering.",
    otherColumnTitle: "Ad hoc notes",
    comparisonOther: "partial",
    faq: [
      {
        question: "What is standardized context?",
        answer:
          "It is a consistent way to describe sessions, screens, events, regions, releases, requests, crashes, and issues so different teams can interpret the same evidence.",
      },
      {
        question: "Why does this matter for replay?",
        answer:
          "Replay is easier to trust when the session carries structured metadata that can be searched, compared, and reopened later.",
      },
      {
        question: "Who uses standardized context?",
        answer:
          "Data teams use it for clean analysis, product teams use it for prioritization, and engineering teams use it for reproducible debugging.",
      },
    ],
  }),
  categoryPage({
    path: "/stability-monitoring",
    badge: "Stability",
    eyebrow: "Mobile app crash reporting",
    title: "Mobile App Crash Reporting with Replay",
    subtitle:
      "Group crashes, errors, ANRs, and API spikes with affected users, devices, releases, and replay evidence.",
    metaTitle: "Mobile App Crash Reporting with Replay | Rejourney",
    metaDescription:
      "Mobile app crash reporting, ANR monitoring, and error tracking with affected devices, releases, users, and session replay context.",
    primaryKeyword: "mobile app crash reporting",
    secondaryKeywords: [
      "mobile crash reporting",
      "app stability monitoring",
      "ANR monitoring",
      "error tracking",
      "JavaScript error tracking",
      "mobile crash analytics",
    ],
    searchIntent: "commercial",
    keywordEvidence: {
      geography: "United States",
      volume: null,
      organicKd: 2,
      volumeSource: "Ahrefs did not return a reliable exact value",
      kdSource: "Ahrefs",
      checkedAt: "2026-08-01",
    },
    keywords: ["mobile app crash reporting", "mobile crash reporting", "app stability monitoring", "ANR monitoring", "error tracking", "JavaScript error tracking", "mobile crash analytics"],
    keywordSections: [
      {
        title: "Which failure is hurting the most users?",
        description: "Rank crashes, ANRs, and error spikes by affected sessions instead of raw occurrence count.",
        bullets: ["Crash cohorts", "Release and device impact", "Replay before the failure"],
      },
      {
        title: "What happened immediately before it failed?",
        description: "See the active screen, last gesture, request, and replay leading into the failure.",
        bullets: ["ANR signals", "Screen and gesture context", "Affected-session prioritization"],
      },
      {
        title: "Is one release or device causing the spike?",
        description: "Compare affected versions, operating systems, and device cohorts before prioritizing the fix.",
        bullets: ["Fatal and nonfatal errors", "Request and console context", "Replay-backed reproduction"],
      },
    ],
    image: "/images/engineering/product-tools-live-stability.png",
    imageAlt: "Rejourney stability monitoring dashboard with crashes errors ANRs and API spikes",
    proofPoints: ["Crashes", "Errors + ANRs", "Replay context"],
    whyTitle: "Stability issues are easier to fix when the session is attached",
    whyParagraphs: [
      "A stack trace can explain where code failed, but it does not always explain what the user was doing, which device was involved, or which release introduced the pattern.",
      "Rejourney's stability workflow groups crashes, errors, ANRs, and API spikes, then keeps session replay, affected devices, app versions, and user impact close to the issue.",
      "That gives engineering a faster starting point and gives product teams a clearer view of which stability issues are actually shaping conversion, retention, and support volume.",
    ],
    chooseOtherTitle: "Use crash-only reporting if...",
    chooseOther: [
      "A stack trace is usually enough to reproduce your production bugs.",
      "You do not need replay, device, release, or API context around stability issues.",
      "Product and support teams do not participate in stability prioritization.",
    ],
    comparisonTitle: "Stability monitoring checklist",
    comparisonIntro:
      "Stability monitoring should connect the failure type, affected users, device context, and replay evidence.",
    otherColumnTitle: "Crash-only tools",
    comparisonOther: "partial",
    faq: [
      {
        question: "What stability signals does Rejourney track?",
        answer:
          "Rejourney tracks crashes, errors, ANRs, and API error spikes, with replay and context that help teams understand the user experience around the failure.",
      },
      {
        question: "Why pair replay with crash analytics?",
        answer:
          "Replay shows the path, screen, gesture, device, and state before the failure, which can make a crash or ANR much easier to reproduce.",
      },
      {
        question: "Can product teams use stability monitoring?",
        answer:
          "Yes. Product teams can see which failures affect real user flows, while engineering gets the technical evidence needed to repair the issue.",
      },
    ],
  }),
  categoryPage({
    path: "/api-endpoint-insights",
    badge: "API insights",
    eyebrow: "API endpoint insights",
    title: "API Endpoint Insights",
    subtitle:
      "Track endpoint volume, latency, failure codes, and risk while keeping the affected session evidence close.",
    metaTitle: "API Analytics with Session Context | Rejourney",
    metaDescription:
      "API endpoint analytics for latency, failure codes, user impact, and the web or mobile sessions affected by each request problem.",
    primaryKeyword: "API endpoint analytics",
    secondaryKeywords: ["API error analytics", "endpoint analytics", "session-linked request failures", "API endpoint insights"],
    searchIntent: "commercial",
    keywords: [
      "API endpoint analytics",
      "API error analytics",
      "endpoint analytics",
      "session-linked request failures",
      "API endpoint insights",
    ],
    image: "/images/engineering/product-tools-live-api-endpoints.png",
    imageAlt: "Rejourney API endpoint insights dashboard with endpoint risk latency and failure codes",
    proofPoints: ["Endpoint risk", "Failure codes", "Session context"],
    whyTitle: "API failures become product problems when users feel them",
    whyParagraphs: [
      "Endpoint health is not only an infrastructure metric. A slow checkout request, failed profile load, or repeated 500 during onboarding can become product friction even when the rest of the system looks healthy.",
      "Rejourney's API endpoint insights show calls, latency, failure rates, status codes, and risk across captured sessions so product and engineering can identify which backend problems users actually experienced.",
      "That keeps endpoint evidence close to replay, journeys, stability, device context, and release impact instead of making teams translate raw logs into product consequences by hand.",
    ],
    chooseOtherTitle: "Use infrastructure monitoring alone if...",
    chooseOther: [
      "Your API questions are only about uptime and server health.",
      "You do not need to connect endpoint errors to users, sessions, funnels, or releases.",
      "Your observability stack already shows which product experiences each endpoint affected.",
    ],
    comparisonTitle: "API endpoint insights checklist",
    comparisonIntro:
      "API endpoint analytics should explain volume, latency, failure, and product impact together.",
    otherColumnTitle: "Server-only monitoring",
    comparisonOther: "partial",
    faq: [
      {
        question: "What are API endpoint insights?",
        answer:
          "They are per-endpoint views of request volume, latency, failure rate, status codes, and risk, tied back to product sessions where users experienced the API behavior.",
      },
      {
        question: "How is this different from backend monitoring?",
        answer:
          "Backend monitoring shows system health. Rejourney focuses on the product impact by connecting endpoint behavior to sessions, journeys, devices, and replay evidence.",
      },
      {
        question: "Can Rejourney help find API-driven funnel leaks?",
        answer:
          "Yes. When users drop after slow or failed requests, API endpoint insights can help teams connect the technical failure to the affected session and product path.",
      },
    ],
  }),
  categoryPage({
    path: "/device-insights",
    badge: "Devices",
    eyebrow: "Device insights",
    title: "Mobile Device Analytics",
    subtitle:
      "Compare device models, platforms, app versions, issue rates, engagement, and session quality to find device-specific friction.",
    metaTitle: "Mobile Device Analytics | Rejourney",
    metaDescription:
      "Mobile device analytics with engagement, versions, crashes, ANRs, error rates, and replay evidence for React Native, Flutter, and iOS apps.",
    keywords: [
      "device analytics",
      "mobile device analytics",
      "device-specific crash analytics",
      "mobile app device analytics",
      "device insights",
      "ANR device analytics",
      "mobile app stability by device",
    ],
    image: "/images/engineering/product-tools-live-devices.png",
    imageAlt: "Rejourney device insights dashboard with device engagement and issue pressure",
    proofPoints: ["Device cohorts", "Issue pressure", "Engagement quality"],
    whyTitle: "Device-specific friction hides inside average product metrics",
    whyParagraphs: [
      "A product can look healthy overall while a device model, platform, OS version, or app version quietly carries lower engagement, longer sessions, crashes, ANRs, or rage taps.",
      "Rejourney's device insights show the device portfolio, platform mix, engagement leaders, issue pressure, and device-version hotspots so teams can find friction that averages hide.",
      "When device data stays connected to replay and stability context, engineering can reproduce issues faster and product can avoid treating a device-specific problem like a broad UX failure.",
    ],
    chooseOtherTitle: "Use aggregate analytics if...",
    chooseOther: [
      "Your product experience does not vary by device, OS, app version, or platform.",
      "You do not need to prioritize device-specific stability or engagement issues.",
      "Your analytics already links device cohorts to replay and stability evidence.",
    ],
    comparisonTitle: "Device insights checklist",
    comparisonIntro:
      "Device analytics should connect engagement, stability, app version, platform, and replay context.",
    otherColumnTitle: "Aggregate analytics",
    comparisonOther: "partial",
    faq: [
      {
        question: "What do device insights show?",
        answer:
          "They show which devices, platforms, app versions, and device-version combinations carry session volume, engagement, duration, crashes, ANRs, errors, and other issue pressure.",
      },
      {
        question: "Why does device analytics matter for mobile apps?",
        answer:
          "Mobile issues often appear only on certain devices, operating systems, or app versions. Device analytics helps teams find those pockets before they distort retention or support volume.",
      },
      {
        question: "Can device insights connect to replay?",
        answer:
          "Yes. Rejourney keeps device and stability context near replay evidence so teams can inspect the sessions behind device-specific friction.",
      },
    ],
  }),
  categoryPage({
    path: "/record-user-sessions",
    badge: "Session replay tools",
    eyebrow: "Record user sessions",
    title: "Session Replay Tools for Recording User Sessions",
    subtitle:
      "Capture the session, the search that found it, and the signals that explain whether the behavior is a one-off or a pattern worth fixing.",
    metaTitle: "Session Replay Tools to Record User Sessions | Rejourney",
    metaDescription:
      "Compare session replay tools and record web or mobile user sessions with privacy controls, analytics, heatmaps, journeys, crashes, and request context.",
    primaryKeyword: "session replay tools",
    secondaryKeywords: ["session replay software", "record user sessions", "user session replay software", "website session recording"],
    searchIntent: "comparison",
    keywordEvidence: {
      geography: "United States",
      volume: 75,
      organicKd: null,
      volumeSource: "Wordtracker",
      kdSource: "Ahrefs Easy category",
      checkedAt: "2026-08-01",
    },
    keywords: ["session replay tools", "session replay software", "record user sessions", "user session replay software", "website session recording"],
    keywordSections: [
      {
        title: "Can I find the session behind this complaint?",
        description: "Search by route, event, device, user, or failure instead of opening random recordings.",
        bullets: ["Web and mobile coverage", "Search and filtering", "Replay-linked technical evidence"],
      },
      {
        title: "What changed before the user got stuck?",
        description: "Keep the path, interface state, requests, and errors attached to the moment worth watching.",
        bullets: ["Behavior-based capture", "Privacy masking", "Shareable session evidence"],
      },
      {
        title: "Does the same problem keep happening?",
        description: "Use journeys, heatmaps, crashes, and matching sessions to separate a pattern from a one-off.",
        bullets: ["Journey and funnel context", "Heatmap validation", "Crash and error correlation"],
      },
    ],
    image: "/images/session-replay-preview.png",
    imageAlt: "Rejourney user session replay preview with event context",
    proofPoints: ["Replay search", "Heatmaps + journeys", "Crash context"],
    whyTitle: "A useful recording starts with a question",
    whyParagraphs: [
      "Most teams do not need more recordings. They need fewer, better recordings: the sessions that explain why checkout stalled, why onboarding looped, why a user rage-clicked a dead control, or why support keeps seeing the same complaint.",
      "Start with a behavior query instead of opening random clips. A good recorded session includes the path, the intended outcome, the failed or delayed step, and the product or technical signal that made the moment worth watching.",
      "Rejourney keeps replay beside heatmaps, journeys, crashes, ANRs, privacy rules, and network context, so a recording can become evidence another teammate can reopen and verify.",
    ],
    chooseOtherTitle: "Choose a heavier suite if...",
    chooseOther: [
      "Your main problem is warehouse modeling, not user-session investigation.",
      "Your team already has a trusted replay workflow tied to support and engineering tickets.",
      "You do not need mobile app context, crash context, or request-level debugging next to replay.",
    ],
    comparisonTitle: "Record user sessions checklist",
    comparisonIntro:
      "Use this checklist when comparing session replay tools. The tool should make the search, the recording, and the engineering handoff easy to reproduce.",
    otherColumnTitle: "Typical replay tool",
    comparisonOther: "partial",
    faq: [
      {
        question: "How do I record user sessions without guessing?",
        answer:
          "Define the behavior first, then capture replay with route, event, request, device, release, and privacy context. Rejourney lets teams search for that behavior and inspect the matching session with heatmaps, journeys, and stability signals nearby.",
      },
      {
        question: "Can recorded sessions improve user experience?",
        answer:
          "Yes, when the team uses recordings to find the moment expectation breaks. A replay of a failed signup, slow checkout, or confusing settings screen is much more useful when journeys and heatmaps show whether the same pattern repeats.",
      },
      {
        question: "Can developers use Rejourney for bugs?",
        answer:
          "Yes. Developers can inspect replay context alongside crashes, ANRs, device details, API failures, and user events while keeping sensitive data masked.",
      },
    ],
  }),
  categoryPage({
    path: "/website-analytics",
    badge: "User experience analytics",
    eyebrow: "Website UX analytics",
    title: "User Experience Analytics for Websites",
    subtitle:
      "Understand traffic, engagement, funnels, errors, and the real sessions behind every website drop-off.",
    metaTitle: "User Experience Analytics for Websites | Rejourney",
    metaDescription:
      "User experience analytics for websites with funnels, retention, session replay, heatmaps, and error context. Start free.",
    primaryKeyword: "user experience analytics",
    secondaryKeywords: ["UX analytics", "website behavior analytics", "website user behavior analytics", "website UX analytics"],
    searchIntent: "commercial",
    keywordEvidence: {
      geography: "United States",
      volume: 210,
      organicKd: 0,
      volumeSource: "Google Keyword Planner",
      kdSource: "Ahrefs",
      checkedAt: "2026-08-01",
    },
    keywords: [
      "user experience analytics",
      "UX analytics",
      "website behavior analytics",
      "website user behavior analytics",
      "website UX analytics",
    ],
    keywordSections: [
      {
        title: "Which route or release lost conversion?",
        description: "Compare engagement and funnel movement by route, release, source, or user cohort.",
        bullets: ["Engagement and retention", "Release comparisons", "Behavioral cohorts"],
      },
      {
        title: "What did visitors see before leaving?",
        description: "Open the sessions and attention patterns behind a signup, onboarding, or checkout drop.",
        bullets: ["Website funnels", "Journey paths", "Error and request context"],
      },
      {
        title: "Was it UX friction, code, or an API failure?",
        description: "Review the interface, console, and request timeline together before deciding what to fix.",
        bullets: ["Web session replay", "Click and attention heatmaps", "Replay-backed prioritization"],
      },
    ],
    image: "/images/readme/analytics-overview.png",
    imageAlt:
      "Rejourney website analytics dashboard showing active users, engagement, retention, and stability",
    proofPoints: ["Unlimited analytics events", "5,000 free replays", "Funnels + error context"],
    whyTitle: "Website owners need more than traffic totals",
    whyParagraphs: [
      "Pageviews and traffic sources can show that something changed. They cannot show whether a visitor hit a broken form, missed an important message, waited on a failed request, or abandoned a confusing step.",
      "Rejourney connects active users, engagement, retention, funnels, releases, and sources to session replay. When a number moves, you can open the sessions behind it instead of guessing from another chart.",
      "It is built for teams and independent owners who want one understandable workspace for website behavior and technical context, with a free plan that does not require a credit card.",
    ],
    chooseOtherTitle: "Choose traffic-only analytics if...",
    chooseOther: [
      "Your only questions are about acquisition channels, ad attribution, and top-level pageviews.",
      "You do not need to inspect the sessions behind signup, checkout, or onboarding drop-offs.",
      "Your current analytics, replay, and error tools already share context cleanly.",
    ],
    comparisonTitle: "Website analytics should explain behavior, not just count it",
    comparisonIntro:
      "A useful website analytics tool connects trends and funnels to the sessions, requests, and interface states that produced them.",
    otherColumnTitle: "Traffic-only analytics",
    comparisonOther: "partial",
    faq: [
      {
        question: "What does a website analytics tool track?",
        answer:
          "Rejourney tracks product events, active users, engagement, retention, funnels, routes, releases, traffic sources, and technical signals. Session replay lets you inspect the visitor experience behind those measurements.",
      },
      {
        question: "Does Rejourney replace Google Analytics?",
        answer:
          "It can complement acquisition analytics. Rejourney is focused on what people do after they arrive: journeys, drop-offs, session replay, requests, console context, errors, and product behavior.",
      },
      {
        question: "Does Rejourney work with single-page websites and web apps?",
        answer:
          "Yes. The web SDK supports modern browser applications and keeps route changes, events, replay, and network context together.",
      },
      {
        question: "Can I try website analytics for free?",
        answer:
          "Yes. The Free plan includes 5,000 monthly session replays, unlimited analytics events, and no credit-card requirement.",
      },
    ],
  }),
  categoryPage({
    path: "/app-analytics",
    badge: "Mobile app analytics",
    eyebrow: "Mobile app analytics",
    title: "Mobile App Analytics",
    subtitle:
      "Measure engagement, retention, journeys, crashes, and the exact mobile sessions behind every change.",
    metaTitle: "Mobile App Analytics with Session Replay | Rejourney",
    metaDescription:
      "Lightweight mobile app analytics with replay, funnels, retention, crashes, ANRs, devices, and API context for Flutter, React Native, Expo, and iOS.",
    primaryKeyword: "mobile app analytics",
    secondaryKeywords: ["mobile analytics tools", "mobile app analytics tools", "React Native analytics", "Flutter analytics", "iOS app analytics"],
    searchIntent: "commercial",
    keywordEvidence: {
      geography: "United States",
      volume: 320,
      organicKd: 13,
      volumeSource: "Google Keyword Planner",
      kdSource: "Ahrefs",
      checkedAt: "2026-08-01",
    },
    keywords: [
      "mobile app analytics",
      "mobile analytics tools",
      "mobile app analytics tools",
      "React Native analytics",
      "Flutter analytics",
      "iOS app analytics",
    ],
    keywordSections: [
      {
        title: "Which release changed activation or retention?",
        description: "Compare mobile journeys and outcomes by app version, cohort, and device family.",
        bullets: ["Engagement and retention", "Mobile journeys", "Release and cohort analysis"],
      },
      {
        title: "Where do mobile users hesitate or drop?",
        description: "Move from the affected screen or path to the exact taps and sessions behind it.",
        bullets: ["React Native and Expo", "Flutter", "Native iOS"],
      },
      {
        title: "Which crashes are damaging real journeys?",
        description: "Prioritize crashes, ANRs, and failed requests by the users and outcomes they interrupted.",
        bullets: ["Crash and ANR context", "Device and version cohorts", "API failure evidence"],
      },
    ],
    image: "/images/engineering/product-tools-live-general.png",
    imageAlt:
      "Rejourney app analytics dashboard showing active users, sessions, retention, and degraded sessions",
    proofPoints: ["Flutter + React Native + Swift", "Pixel-perfect mobile replay", "Crashes + ANRs"],
    whyTitle: "App analytics should connect the metric to the mobile session",
    whyParagraphs: [
      "Installs and store rankings stop at the app's front door. Product teams still need to know which screens users reach, where onboarding stalls, how retention changes by release, and which crashes or slow requests interrupt a real journey.",
      "Rejourney connects engagement, retention, flows, devices, releases, crashes, ANRs, and API failures to mobile session replay. A drop in a chart becomes a session you can inspect and a problem engineering can reproduce.",
      "Use one focused workspace across React Native, Expo, Flutter, and Swift instead of separating product behavior, stability, and replay into unrelated tools.",
    ],
    chooseOtherTitle: "Choose store analytics alone if...",
    chooseOther: [
      "Your only questions are about installs, store discovery, rankings, or acquisition attribution.",
      "You do not need to understand in-app flows, drop-offs, crashes, or API failures.",
      "Your existing mobile analytics, replay, and stability tools already share context cleanly.",
    ],
    comparisonTitle: "In-app analytics should connect behavior, stability, and replay",
    comparisonIntro:
      "Useful app analytics goes beyond installs by linking engagement and retention to the exact screen, device, release, and session involved.",
    otherColumnTitle: "Store-only analytics",
    comparisonOther: "partial",
    faq: [
      {
        question: "What does app analytics track?",
        answer:
          "Rejourney tracks active users, sessions, engagement, retention, journeys, releases, devices, crashes, ANRs, errors, and API performance. Mobile session replay shows what the user experienced around those signals.",
      },
      {
        question: "Which mobile platforms does Rejourney support?",
        answer:
          "Rejourney supports React Native and Expo, Flutter apps on iOS and Android, and native iOS apps built with Swift.",
      },
      {
        question: "Can app analytics show what happened before a crash?",
        answer:
          "Yes. Rejourney connects crashes, ANRs, errors, requests, app versions, and device context to the session so engineering can see the path that led to the issue.",
      },
      {
        question: "Is Rejourney an App Store analytics tool?",
        answer:
          "Rejourney focuses on in-app behavior and stability after a user opens the product. Use store or attribution analytics alongside it when you also need rankings, campaign attribution, and install reporting.",
      },
    ],
  }),
  categoryPage({
    path: "/mobile-session-replay",
    badge: "Mobile apps",
    eyebrow: "Mobile session replay",
    title: "Mobile App Session Replay",
    subtitle:
      "Watch taps, gestures, screen changes, slow requests, crashes, and ANRs with enough metadata to reproduce what happened on the device.",
    metaTitle: "Mobile App Session Replay | Rejourney",
    metaDescription:
      "Lightweight mobile session replay for Flutter, iOS, React Native, and Expo with product analytics, journeys, ANRs, crashes, and API context.",
    primaryKeyword: "mobile session replay",
    secondaryKeywords: ["mobile app session replay", "React Native session replay", "Expo session replay", "Flutter session replay", "iOS session replay", "Android session replay"],
    searchIntent: "commercial",
    keywordEvidence: {
      geography: "United States",
      volume: null,
      organicKd: null,
      volumeSource: "Google Search Console demand",
      kdSource: "Not available",
      checkedAt: "2026-08-01",
    },
    keywords: ["mobile session replay", "mobile app session replay", "React Native session replay", "Expo session replay", "Flutter session replay", "iOS session replay", "Android session replay"],
    keywordSections: [
      {
        title: "What did the user tap before the flow broke?",
        description: "Replay the exact gestures, screen changes, and app state leading into the problem.",
        bullets: ["React Native screens", "Expo workflows", "JavaScript and native context"],
      },
      {
        title: "Was it app state, network, or stability?",
        description: "Review requests, errors, crashes, and ANRs beside the visible mobile experience.",
        bullets: ["Flutter routes", "iOS and Android builds", "Touch and error evidence"],
      },
      {
        title: "Which devices and releases share the pattern?",
        description: "Group matching sessions by device, operating system, and app version before escalating.",
        bullets: ["Native iOS support", "Android evidence through supported SDKs", "Device and release cohorts"],
      },
    ],
    image: "/images/heatmaps.png",
    imageAlt: "Rejourney heatmap workspace with replay and behavioral insights",
    proofPoints: [
      "Replay across mobile frameworks",
      "Connect replay to device and release context",
      "Investigate crashes, ANRs, and touch patterns",
    ],
    whyTitle: "Mobile replay has to understand the app behind the pixels",
    whyParagraphs: [
      "Mobile bugs often hide in app-specific context: screen transitions, gestures, OS versions, foreground and background changes, flaky networks, slow frames, crashes, and ANRs. A recording without those details is hard to act on.",
      "Rejourney connects replay with touch heatmaps, journeys, crash reports, ANR signals, device metadata, and API performance so teams can see the session and the conditions around it.",
      "That makes the replay useful before anyone asks the user to reproduce the problem. Product can see the hesitation, support can verify the path, and engineering can start with a screen, release, device, and likely cause.",
    ],
    chooseOtherTitle: "Choose a web-first tool if...",
    chooseOther: [
      "Your product is browser-only and every important flow happens on the web.",
      "You do not need Flutter, React Native, Expo, or native iOS replay.",
      "You already capture mobile crashes, API failures, and user paths in another workflow.",
    ],
    comparisonTitle: "Mobile replay requires mobile context",
    comparisonIntro:
      "Mobile replay should treat taps, gestures, screens, app versions, devices, ANRs, crashes, and network timing as part of the recording.",
    otherColumnTitle: "Web-first replay tools",
    comparisonOther: "partial",
    faq: [
      {
        question: "Does Rejourney work with React Native?",
        answer:
          "Yes. Rejourney supports React Native and Expo, Flutter on iOS and Android, and native iOS apps.",
      },
      {
        question: "Does Rejourney work with Flutter?",
        answer:
          "Yes. The Rejourney Flutter SDK records sessions on iOS and Android with route tracking, privacy masking, errors, network timing, and custom events.",
      },
      {
        question: "Can mobile replay help with crashes?",
        answer:
          "Yes. The replay before a crash or ANR can show the active screen, last gesture, loading state, network behavior, and path that made the stack trace easier to understand.",
      },
      {
        question: "Does Rejourney include heatmaps for mobile screens?",
        answer:
          "Yes. Rejourney includes touch heatmaps and journey views so teams can understand where users tap, hesitate, and drop.",
      },
    ],
  }),
  categoryPage({
    path: "/web-session-replay",
    badge: "Browser replay",
    eyebrow: "Web session replay",
    title: "Web Session Replay Software",
    subtitle:
      "See the clicks, route changes, loading states, failed requests, and UI dead ends that traffic analytics usually flatten.",
    metaTitle: "Web Session Replay Software | Rejourney",
    metaDescription:
      "Lightweight web session replay with product analytics, heatmaps, funnels, journeys, network requests, console context, and replay search.",
    primaryKeyword: "web session replay",
    secondaryKeywords: ["website session replay", "browser session replay", "web session recording", "privacy-conscious web replay"],
    searchIntent: "commercial",
    keywordEvidence: {
      geography: "United States",
      volume: null,
      organicKd: null,
      volumeSource: "Google Search Console demand",
      kdSource: "Not available",
      checkedAt: "2026-08-01",
    },
    keywords: ["web session replay", "website session replay", "browser session replay", "web session recording", "privacy-conscious web replay"],
    keywordSections: [
      {
        title: "Why did users abandon this step?",
        description: "Replay the clicks, route changes, loading states, and UI state immediately before the exit.",
        bullets: ["Single-page app routes", "Event timelines", "Searchable session evidence"],
      },
      {
        title: "Did the interface fail—or did the request fail?",
        description: "Read console output and network activity on the same timeline as the visible experience.",
        bullets: ["Network requests", "Console context", "Error-linked sessions"],
      },
      {
        title: "Can we share the session without exposing private input?",
        description: "Keep useful interaction evidence while masking sensitive fields and raw keystrokes.",
        bullets: ["Input masking", "Configurable privacy controls", "Shareable evidence without raw keystrokes"],
      },
    ],
    image: "/images/web-session-replay-workbench.png",
    imageAlt: "Rejourney web session replay theater showing browser behavior and timeline context",
    proofPoints: ["Browser SDK", "Funnels + journeys", "Network context"],
    whyTitle: "Website friction hides in state between clicks",
    whyParagraphs: [
      "A chart can tell you where people dropped. Web replay can show whether they saw a disabled button, a buried validation message, a blank state, a stalled request, or copy that sent them the wrong way.",
      "Rejourney records browser sessions and ties them to route changes, event timelines, journeys, heatmaps, console context, requests, and product analytics, so the behavior is not stranded in a separate tool.",
      "That matters most in flows that pass QA but misbehave in production: checkout, sign-up, search, dashboards, pricing pages, docs, and support-heavy account screens.",
    ],
    chooseOtherTitle: "Choose pageview analytics alone if...",
    chooseOther: [
      "Your questions stop at acquisition, attribution, and top-level conversion.",
      "You do not need to inspect individual UI states or request failures.",
      "Your existing replay, error, heatmap, and analytics tools already share context cleanly.",
    ],
    comparisonTitle: "Web replay should connect behavior to system context",
    comparisonIntro:
      "Browser replay becomes useful when it includes the events, requests, journeys, and visual friction around the recording.",
    otherColumnTitle: "Pageview analytics",
    comparisonOther: "partial",
    faq: [
      {
        question: "What is web session replay?",
        answer:
          "Web session replay records browser interactions and reconstructs the experience so teams can inspect what a visitor saw, clicked, typed, and experienced.",
      },
      {
        question: "Does Rejourney support single-page apps?",
        answer:
          "Yes. Rejourney's web SDK is designed for modern browser apps and connects replay with route changes, events, heatmaps, and network context.",
      },
      {
        question: "Can web replay help product teams?",
        answer:
          "Yes. Product teams can review onboarding, activation, checkout, search, and dashboard sessions to understand what users actually experienced.",
      },
    ],
  }),
  categoryPage({
    path: "/heatmaps",
    badge: "Behavior analytics",
    eyebrow: "Website and mobile heatmaps",
    title: "Website and Mobile Heatmap Tools",
    subtitle:
      "Use web attention maps and mobile touch maps to understand what users notice, skim, miss, and repeat.",
    metaTitle: "Website and Mobile Heatmap Tools | Rejourney",
    metaDescription:
      "Web attention and mobile touch heatmaps connected to lightweight product analytics, session replay, journeys, and behavioral context.",
    primaryKeyword: "website heatmap tools",
    secondaryKeywords: ["website heatmap analytics", "click heatmaps", "scroll heatmaps", "attention maps", "touch heatmaps", "rage click heatmaps", "mobile heatmaps"],
    searchIntent: "commercial",
    keywordEvidence: {
      geography: "United States",
      volume: 100,
      organicKd: 9,
      volumeSource: "Ahrefs lower-bound volume bucket",
      kdSource: "Ahrefs",
      checkedAt: "2026-08-01",
    },
    keywords: ["website heatmap tools", "website heatmap analytics", "click heatmaps", "scroll heatmaps", "attention maps", "touch heatmaps", "rage click heatmaps", "mobile heatmaps"],
    keywordSections: [
      {
        title: "What are users missing?",
        description: "See whether important content was viewed, skimmed, or never reached before users left.",
        bullets: ["Click density", "Rage-click clusters", "Dead-control investigation"],
      },
      {
        title: "Where are repeated clicks signaling friction?",
        description: "Separate intentional interaction from rage clicks, dead controls, and misleading interface cues.",
        bullets: ["Scroll depth", "Content exposure", "Web attention patterns"],
      },
      {
        title: "Which sessions created the pattern?",
        description: "Open matching replays to verify the cause before redesigning the page or mobile screen.",
        bullets: ["Touch density", "Mobile dead zones", "Associated session replay"],
      },
    ],
    image: "/images/engineering/heatmaps-attention-docs.png",
    imageAlt: "Rejourney heatmap workspace showing a product page with interaction density",
    proofPoints: ["Web attention maps", "Mobile touch maps", "Replay context"],
    whyTitle: "A heatmap is useful only when it tells you something surprising",
    whyParagraphs: [
      "The weak version of heatmaps is a pretty red overlay that proves people clicked buttons. Useful heatmaps answer a harder question: did users notice the copy, controls, layout, and page sections that were supposed to guide them?",
      "Mobile touch maps are still valuable for repeated taps, dead zones, thumb reach, and controls that look interactive but are not. They become noisy when every obvious button is treated as an insight.",
      "Web attention maps can go further because web pages have scroll depth, viewport exposure, reading patterns, pointer movement, and dense content. They can show a skimmed hero, an ignored docs warning, or a pricing block that absorbed attention before conversion.",
    ],
    chooseOtherTitle: "Choose touch-only heatmaps if...",
    chooseOther: [
      "You only need tap density on a mobile screen.",
      "You are not evaluating copy, scroll depth, content exposure, or web page comprehension.",
      "You do not plan to open replays from the same route or release before filing tickets.",
    ],
    comparisonTitle: "Heatmaps should separate attention from interaction",
    comparisonIntro:
      "Use heatmaps to separate actual attention from obvious interaction.",
    otherColumnTitle: "Basic touch maps",
    comparisonOther: "partial",
    officialSources: [
      { label: "Nielsen Norman Group: F-Shaped Pattern of Reading on the Web", href: "https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/" },
      { label: "Nielsen Norman Group: Original F-Pattern eyetracking research", href: "https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content-discovered/" },
      { label: "Chartbeat: User Engagement Tracking Methodology", href: "https://help.chartbeat.com/hc/en-us/articles/360045890913-User-Engagement-Tracking-Methodology" },
      { label: "Chartbeat: Using Engaged Time to understand your audience", href: "https://chartbeat.com/resources/research/using-engaged-time-to-understand-your-audience/" },
      { label: "Chen, Anderson, and Sohn: eye/mouse movement correlation", href: "https://doi.org/10.1145/634067.634234" },
      { label: "Huang, White, and Dumais: No Clicks, No Problem", href: "https://jeffhuang.com/papers/CursorBehavior_CHI11.pdf" },
      { label: "Huang, White, and Buscher: Gaze and Cursor Alignment", href: "https://www.microsoft.com/en-us/research/publication/user-see-user-point-gaze-and-cursor-alignment-in-web-search/" },
      { label: "Rayner: Eye movements in reading and information processing", href: "https://pubmed.ncbi.nlm.nih.gov/9849112/" },
    ],
    faq: [
      {
        question: "What is the difference between attention maps and touch maps?",
        answer:
          "Attention maps are web-only maps that help show what page content users noticed, skimmed, or ignored. Touch maps show where users tapped or touched, especially on mobile screens.",
      },
      {
        question: "Why are attention maps more useful for web pages?",
        answer:
          "Web pages have reading order, scroll depth, hero copy, docs sections, pricing blocks, and content exposure. Attention maps can reveal whether those areas carried the user's focus, while touch maps often turn obvious buttons red.",
      },
      {
        question: "When should I use mobile touch maps?",
        answer:
          "Use touch maps to find repeated taps, dead zones, gesture confusion, crowded controls, and mobile navigation friction. Pair them with replay before treating a hotspot as a product problem.",
      },
    ],
  }),
  categoryPage({
    path: "/replay-first-mentality",
    badge: "Product thinking",
    eyebrow: "Replay-first mentality",
    title: "Replay-First Workspace",
    subtitle:
      "Use real sessions as the first shared artifact in product decisions, support escalations, bug triage, and release reviews.",
    metaTitle: "Replay-First Product Analytics | Rejourney",
    metaDescription:
      "Learn how replay-first product analytics grounds product, support, design, and engineering decisions in real user sessions.",
    keywords: ["replay-first mentality", "replay first analytics", "session replay analytics", "user experience evidence"],
    image: "/images/hero-replay-workbench.png",
    imageAlt: "Rejourney replay workbench for replay-first product investigation",
    proofPoints: ["Evidence first", "Shared context", "Faster fixes"],
    whyTitle: "Replay gives the team a shared first object",
    whyParagraphs: [
      "Dashboards are useful, but they can turn the user into a shape on a chart. Replay-first work asks the team to watch a real experience before naming the problem.",
      "That changes the discussion. Product sees the missed expectation, support sees the path the customer took, and engineering sees the events, requests, crashes, or ANRs that shaped the session.",
      "Rejourney is built around that habit: start from the session, then branch into events, journeys, heatmaps, stability, network context, and analytics to check scope.",
    ],
    chooseOtherTitle: "Rely on charts alone if...",
    chooseOther: [
      "Your question is only about traffic volume or campaign reporting.",
      "Support and engineering never need to inspect the same user path.",
      "Your team already reviews real sessions elsewhere before prioritizing UX work.",
    ],
    comparisonTitle: "Replay-first versus dashboard-only work",
    comparisonIntro:
      "Replay-first does not replace analytics. It keeps the analytics conversation tied to observable user behavior.",
    otherColumnTitle: "Dashboard-only work",
    comparisonOther: "partial",
    faq: [
      {
        question: "What does replay-first mean?",
        answer:
          "Replay-first means starting investigations from real user sessions, then using analytics, heatmaps, journeys, errors, and network context to understand the broader pattern.",
      },
      {
        question: "Does replay-first replace analytics?",
        answer:
          "No. Replay-first makes analytics more useful by tying metrics back to observable behavior and system context.",
      },
      {
        question: "Who benefits from a replay-first workflow?",
        answer:
          "Product, support, design, and engineering all benefit because they can discuss the same session instead of debating separate screenshots, tickets, and charts.",
      },
    ],
  }),
  categoryPage({
    path: "/importance-of-open-source",
    badge: "Open source",
    eyebrow: "Importance of open source",
    title: "Open Source Foundation",
    subtitle:
      "Session replay touches product behavior, user privacy, and debugging workflows. Source visibility makes those boundaries easier to inspect.",
    metaTitle: "Open Source Product Analytics | Rejourney",
    metaDescription:
      "Why open source matters for lightweight product analytics, session replay, self-hosting, privacy, auditability, and long-term control.",
    keywords: ["importance of open source", "open source session replay", "self-hosted session replay", "open source analytics"],
    image: "/images/readme-user-journeys.png",
    imageAlt: "Rejourney open-source user journey analytics view",
    proofPoints: ["Source visibility", "Self-hosting", "Data control"],
    whyTitle: "Trust starts at the capture boundary",
    whyParagraphs: [
      "Replay tools run inside your product and observe behavior that users rarely think about explicitly. That does not make replay bad, but it does mean teams should know what is captured, masked, stored, and shared.",
      "Open source gives technical teams a way to inspect that boundary: SDK behavior, redaction rules, payload shape, deployment options, retention, and the path to self-hosting if requirements change.",
      "Rejourney pairs that source-visible base with a practical workspace for replay, journeys, heatmaps, crashes, ANRs, API context, and analytics.",
    ],
    chooseOtherTitle: "Choose closed SaaS if...",
    chooseOther: [
      "You do not need to inspect SDK behavior, masking, storage, or deployment choices.",
      "Your organization prefers a closed vendor suite with procurement and governance already solved.",
      "You are comfortable with product and pricing changes you cannot audit or fork around.",
    ],
    comparisonTitle: "Open-source replay should still feel polished",
    comparisonIntro:
      "Open-source replay still has to be usable. Control only helps if PMs, support, design, and engineering can actually work from the evidence.",
    otherColumnTitle: "Closed tools",
    comparisonOther: "partial",
    faq: [
      {
        question: "Why does open source matter for session replay?",
        answer:
          "Replay data can include sensitive product behavior. Open source gives teams more auditability, deployment flexibility, and confidence in how the observability stack works.",
      },
      {
        question: "Is Rejourney open source?",
        answer:
          "Yes. Rejourney is open source and includes self-hosting documentation for teams that want more control over their analytics and replay infrastructure.",
      },
      {
        question: "Can open source still be easy for product teams?",
        answer:
          "Yes. Rejourney is designed to keep replay, analytics, heatmaps, journeys, and stability context approachable while still giving technical teams source visibility.",
      },
    ],
  }),
  categoryPage({
    path: "/what-is-session-replay",
    badge: "Guide",
    eyebrow: "Session replay guide",
    title: "What Session Replay Shows",
    subtitle:
      "Session replay reconstructs a user experience so teams can inspect the visible path, the surrounding events, and the system signals around a confusing moment.",
    metaTitle: "What Is Session Replay? | Rejourney",
    metaDescription:
      "Learn what session replay is, how it works, and how it connects with product analytics, heatmaps, journeys, crashes, and network context.",
    primaryKeyword: "what is session replay",
    secondaryKeywords: ["how does session replay work", "session replay analytics", "session replay definition"],
    searchIntent: "informational",
    keywordEvidence: {
      geography: "United States",
      volume: 65,
      organicKd: null,
      volumeSource: "Wordtracker",
      kdSource: "Ahrefs Medium category",
      checkedAt: "2026-08-01",
    },
    keywords: ["what is session replay", "how does session replay work", "session replay analytics", "session replay definition"],
    image: "/images/landing-replay-theater.png",
    imageAlt: "Rejourney replay theater explaining session replay",
    proofPoints: ["Behavior context", "Debugging evidence", "Product insight"],
    whyTitle: "Replay turns vague reports into inspectable behavior",
    whyParagraphs: [
      "Session replay does not read minds. It reconstructs enough of the experience for a team to inspect what the user saw, clicked, tapped, waited through, retried, or abandoned.",
      "The replay is strongest when it carries context with it: product events, journeys, heatmaps, errors, device details, app or browser version, and network calls.",
      "Rejourney uses replay as the center of the workflow for web and mobile teams, so product, support, and engineering can discuss the same user experience instead of trading screenshots and guesses.",
    ],
    chooseOtherTitle: "Use aggregate analytics alone if...",
    chooseOther: [
      "You only need acquisition, attribution, or high-level traffic reporting.",
      "You do not need to inspect individual friction or production UI states.",
      "Your team never debugs UX issues, support escalations, or release regressions from real sessions.",
    ],
    comparisonTitle: "Session replay versus analytics alone",
    comparisonIntro:
      "Analytics can tell you what changed. Replay helps explain why by showing the user experience behind the metric.",
    otherColumnTitle: "Analytics alone",
    comparisonOther: "partial",
    faq: [
      {
        question: "How does session replay work?",
        answer:
          "A session replay SDK captures interaction and interface state, then reconstructs the experience in a player. Rejourney also attaches events, heatmaps, journeys, crashes, and network context.",
      },
      {
        question: "Is session replay useful for mobile apps?",
        answer:
          "Yes. Mobile replay helps teams understand taps, gestures, screen paths, crashes, ANRs, and device-specific friction.",
      },
      {
        question: "Is session replay only for developers?",
        answer:
          "No. Product, design, support, and engineering teams all use replay to understand real user behavior and make better decisions.",
      },
    ],
  }),
  categoryPage({
    path: "/how-to-see-what-your-users-do",
    badge: "Practical guide",
    eyebrow: "How to see what your users do",
    title: "See What Users Do",
    subtitle:
      "Move from vague feedback to real sessions, journey paths, heatmaps, events, crashes, and API context that point to the same moment.",
    metaTitle: "See What Users Do with Product Analytics | Rejourney",
    metaDescription:
      "See what users do in your app or website with lightweight product analytics, session replay, heatmaps, journeys, events, and crash context.",
    keywords: ["how to see what users do", "see what users do on website", "user behavior analytics", "session replay"],
    image: "/images/readme-general-demo.png",
    imageAlt: "Rejourney dashboard showing user behavior analytics and replay context",
    proofPoints: ["Watch sessions", "Map journeys", "Find friction"],
    whyTitle: "The right signal depends on the question",
    whyParagraphs: [
      "Seeing what users do starts with choosing the right observation layer. Replay shows the individual session, journeys show repeated paths, heatmaps show attention or repeated interaction, events show sequence, and errors or requests show where the system changed the experience.",
      "The mistake is opening everything at once. Start with a bounded question, such as users who reached checkout but did not pay, users who retried search, or accounts on a new release that hit a slow endpoint.",
      "Rejourney combines those layers so a team can move from 'users are dropping' to 'this route, interaction, request, and release window explain the drop.'",
    ],
    chooseOtherTitle: "Stay with indirect signals if...",
    chooseOther: [
      "You only need broad trend reporting or scheduled qualitative research.",
      "Your product does not need support, debugging, conversion, or release investigation.",
      "Your team already has a reliable way to connect sessions, journeys, errors, and analytics.",
    ],
    comparisonTitle: "Direct observation versus guessing",
    comparisonIntro:
      "The strongest behavior workflow moves between the individual session and the repeated pattern.",
    otherColumnTitle: "Indirect signals",
    comparisonOther: "partial",
    faq: [
      {
        question: "How can I see what users do in my app?",
        answer:
          "Use session replay to watch real sessions, then combine it with events, heatmaps, journeys, crashes, and network context to understand the behavior.",
      },
      {
        question: "Is this useful for websites and mobile apps?",
        answer:
          "Yes. Rejourney supports browser replay and mobile replay workflows, so teams can inspect behavior across web, Flutter, React Native, Expo, and native iOS apps.",
      },
      {
        question: "How do I avoid cherry-picking one replay?",
        answer:
          "Use replay as the starting point, then look for repeated patterns with journeys, heatmaps, events, and analytics so one session becomes evidence in context.",
      },
    ],
  }),
  categoryPage({
    path: "/be-your-users",
    badge: "Team habit",
    eyebrow: "Be your users",
    title: "True User Experience",
    subtitle:
      "Watch real sessions before shipping so roadmap debates, bug triage, and design reviews stay attached to what people actually experienced.",
    metaTitle: "User-Centered Product Analytics | Rejourney",
    metaDescription:
      "Ground product decisions in actual user behavior with session replay, journeys, friction evidence, and lightweight product analytics.",
    primaryKeyword: "watch user sessions",
    secondaryKeywords: ["be your users", "session replay for product teams", "user-centered product decisions"],
    searchIntent: "informational",
    keywords: ["watch user sessions", "be your users", "session replay for product teams", "user-centered product decisions"],
    image: "/images/user-journeys.png",
    imageAlt: "Rejourney user journeys view for understanding real product paths",
    proofPoints: ["User empathy", "Real sessions", "Shared reviews"],
    whyTitle: "Empathy works better when it has evidence",
    whyParagraphs: [
      "Teams can talk about users for hours and still miss the tiny moment where the product stops making sense. A replay makes that moment concrete: the hesitation, the missed affordance, the repeated tap, the path that was obvious only inside the building.",
      "Rejourney helps teams build the habit without turning it into theater. Pick a flow, watch real sessions, write down what happened, then use journeys and heatmaps to check whether the same friction repeats.",
      "The result is a product conversation with less mind-reading. The team can decide what to fix because it has seen the experience from the user's side and checked the pattern behind it.",
    ],
    chooseOtherTitle: "Skip session review if...",
    chooseOther: [
      "Your decisions do not depend on understanding user-facing friction.",
      "Your team already reviews real sessions before roadmap, design, and release decisions.",
      "You only need backend telemetry and never need behavioral context.",
    ],
    comparisonTitle: "Empathy should be paired with evidence",
    comparisonIntro:
      "Being your users is a product habit: observe real behavior, connect it to data, and leave with a concrete next decision.",
    otherColumnTitle: "Assumption-led work",
    comparisonOther: "partial",
    faq: [
      {
        question: "What does 'be your users' mean?",
        answer:
          "It means regularly watching and analyzing real user experiences so the team understands how the product feels outside internal assumptions.",
      },
      {
        question: "How does session replay help with user empathy?",
        answer:
          "Replay shows the exact moments where people hesitate, retry, abandon, or hit technical problems, making product friction easier to understand and prioritize.",
      },
      {
        question: "How often should teams watch sessions?",
        answer:
          "A practical habit is to review sessions during product planning, support escalations, bug triage, release retrospectives, and after major funnel changes.",
      },
    ],
  }),
  alternativePage({
    path: "/alternatives/posthog-session-replay",
    competitor: "PostHog Session Replay",
    badge: "",
    subtitle:
      "PostHog works well when you want a broad product OS. Rejourney is for teams that want replay, mobile evidence, heatmaps, journeys, and debugging context to stay close together.",
    metaTitle: "PostHog Alternative for Product Analytics | Rejourney",
    metaDescription:
      "Compare PostHog with Rejourney for lightweight product analytics, web and mobile replay, unlimited events, retention, teams, and pricing.",
    keywords: ["posthog session replay", "session replay posthog", "posthog alternatives", "posthog react native session replay"],
    image: "/images/landing-replay-theater.png",
    imageAlt: "Rejourney replay dashboard as a PostHog session replay alternative",
    proofPoints: ["Replay-first analytics", "Mobile + web", "Simple included limits"],
    whyParagraphs: [
      "PostHog Cloud is a multi-product platform: analytics, session replay, feature flags, experiments, surveys, warehouse tools, error tracking, logs, and more. That is useful if the team wants one large operating system for product work.",
      "Rejourney is intentionally narrower. It keeps replay, heatmaps, journeys, crashes, ANRs, network context, and product analytics on the same investigation path so the team can move from a symptom to the user experience behind it.",
      "The practical pricing question is quota shape. PostHog publishes usage-based quotas and rates; Rejourney keeps events, analytics retention, projects, and team members open in its own plans.",
    ],
    chooseOther: [
      "You want feature flags, experiments, and a broad all-in-one product analytics suite.",
      "Your team is already deeply built around PostHog workflows.",
      "You prefer consolidating many growth tools into one large platform.",
    ],
    comparisonRows: comparisonRows({
      revenueLeakPrediction: "no",
      frictionAlertEmails: "partial",
      replayFirst: "no",
      webSessionReplay: "yes",
      mobileSessionReplay: "yes",
      productAnalytics: "yes",
      heatmaps: "yes",
      journeyMaps: "yes",
      crashOrErrorContext: "yes",
      networkApiContext: "yes",
      nativeApiCalls: "yes",
      consoleLogs: "yes",
      privacyMasking: "yes",
    }, [
      { feature: "Native ANR replay triage", other: "no" },
      { feature: "API endpoint analytics dashboard", other: "no" },
      { feature: "API degradation email rules", other: "no" },
      { feature: "Device and app-version friction boards", other: "no" },
    ]),
    featureDifferences: [
      {
        feature: "Product center",
        rejourney: "Replay-led product analytics with heatmaps, journeys, crashes, ANRs, and network context in the same investigation path.",
        other: "PostHog publicly presents a broader product OS with analytics, replay, feature flags, experiments, surveys, data warehouse, error tracking, logs, and more.",
      },
      {
        feature: "Session workflow",
        rejourney: "Built around finding a session, seeing the exact experience, and moving from one replay to the repeated product pattern.",
        other: "Best to evaluate when you want session replay as one product inside a wider growth and product analytics suite.",
      },
      {
        feature: "Team fit",
        rejourney: "Optimized for product, support, and engineering teams that want one replay-backed evidence trail.",
        other: "A stronger fit when the team also needs PostHog's feature flags, experiments, surveys, and broader platform workflow.",
      },
    ],
    competitorFacts: [
      "PostHog's pricing page says the free cloud plan includes 1 project, 1-year data retention, unlimited team members, and monthly free quotas including 1M analytics events and 5K session replay recordings.",
      "PostHog lists usage-based pricing after the monthly free tier, with paid session replay rates after 5K recordings and a separate mobile session replay meter after 2.5K mobile recordings.",
      "PostHog says adding a credit card for usage-based pricing increases plan limits to 6 projects, 7-year data retention, and email support.",
    ],
    officialSources: [
      { label: "PostHog pricing", href: "https://posthog.com/pricing" },
      { label: "PostHog Session Replay docs", href: "https://posthog.com/docs/session-replay" },
    ],
    pricingIntro:
      "PostHog publishes transparent usage-based pricing with free monthly quotas and per-product overage rates. Rejourney is built for teams that want replay-led investigation with unlimited events, analytics history, projects, and seats included in the Rejourney model.",
    faq: [
      {
        question: "Is Rejourney a PostHog alternative?",
        answer:
          "Yes, for teams whose priority is replay-backed product analytics, mobile and web session replay, heatmaps, journeys, crashes, and simple team-wide access.",
      },
      {
        question: "Does Rejourney replace every PostHog feature?",
        answer:
          "No. PostHog includes a broader growth suite. Rejourney focuses on replay, analytics, heatmaps, journeys, and observability workflows.",
      },
      {
        question: "Why choose Rejourney over PostHog session replay?",
        answer:
          "Choose Rejourney if you want a focused replay-first workflow, mobile app context, unlimited events, unlimited analytics retention, unlimited projects, and unlimited team members.",
      },
    ],
  }),
  alternativePage({
    path: "/alternatives/sentry-session-replay",
    competitor: "Sentry Session Replay",
    badge: "",
    subtitle:
      "Sentry is built for developer diagnostics. Rejourney is for teams that need replay to explain product behavior beyond exceptions.",
    metaTitle: "Sentry Alternative with Session Replay | Rejourney",
    metaDescription:
      "Compare Sentry with Rejourney for lightweight product analytics, session replay, mobile apps, funnels, heatmaps, crashes, and API context.",
    keywords: ["sentry session replay", "sentry self hosted session replay", "session replay for sentry", "sentry alternatives"],
    image: "/images/anr-issues.png",
    imageAlt: "Rejourney crash and ANR replay context as a Sentry Session Replay alternative",
    proofPoints: ["Replay + product analytics", "Heatmaps + journeys", "Crash + API context"],
    whyParagraphs: [
      "Sentry's pricing and billing docs center on developer monitoring: errors, tracing, logs, replays, monitors, profiling, and attachments. That is the right center of gravity when engineering diagnostics are the main job.",
      "Rejourney connects replay with product analytics, heatmaps, journeys, crashes, ANRs, network context, and team collaboration. Support, product, design, and engineering can work from the same session instead of passing evidence between tools.",
      "If replay needs to explain both bugs and behavior, Rejourney keeps the investigation focused while leaving events, analytics retention, projects, and team members open.",
    ],
    chooseOther: [
      "Your main need is exception monitoring and developer error triage.",
      "Your team already standardizes on Sentry for alerting and issue workflows.",
      "You want replay primarily as an attachment to errors rather than as a product analytics workflow.",
    ],
    comparisonRows: comparisonRows({
      revenueLeakPrediction: "no",
      frictionAlertEmails: "partial",
      replayFirst: "no",
      webSessionReplay: "yes",
      mobileSessionReplay: "yes",
      productAnalytics: "no",
      heatmaps: "no",
      journeyMaps: "no",
      crashOrErrorContext: "yes",
      networkApiContext: "yes",
      nativeApiCalls: "yes",
      consoleLogs: "yes",
      privacyMasking: "yes",
    }, [
      { feature: "Product journey maps", other: "no" },
      { feature: "Heatmaps", other: "no" },
      { feature: "Product analytics workspace", other: "no" },
    ]),
    featureDifferences: [
      {
        feature: "Primary workflow",
        rejourney: "Starts from user behavior and connects replay to journeys, heatmaps, crashes, ANRs, network context, and product analytics.",
        other: "Sentry's public pricing and docs center the product around developer monitoring categories such as errors, tracing, logs, replays, monitors, profiling, and attachments.",
      },
      {
        feature: "Non-error friction",
        rejourney: "Designed to help product and support teams investigate hesitation, confusing screens, drop-off, and UX friction even when no exception fired.",
        other: "Best to evaluate when replay is mainly needed to support engineering diagnostics and issue triage.",
      },
      {
        feature: "Audience",
        rejourney: "Built for PMs, designers, support, and engineers to share the same session evidence.",
        other: "A stronger fit when the organization already standardizes on Sentry for alerting, exception tracking, and developer issue workflows.",
      },
    ],
    competitorFacts: [
      "Sentry's pricing page lists a free Developer plan for one user, Team at $26/mo, Business at $80/mo, and Enterprise as custom pricing when billed annually with default pre-paid data.",
      "Sentry's pricing docs say each paid plan includes monthly volume for 50K errors, 5GB logs, 5M spans, 50 replays, monitors, size analysis builds, and 1GB attachments.",
      "Sentry's docs list replay pricing by replay volume after the included 50 replays, with separate reserved and pay-as-you-go rates.",
    ],
    officialSources: [
      { label: "Sentry pricing", href: "https://sentry.io/pricing/" },
      { label: "Sentry pricing docs", href: "https://docs.sentry.io/pricing/" },
      { label: "Sentry Session Replay docs", href: "https://docs.sentry.io/platforms/javascript/session-replay/" },
    ],
    pricingIntro:
      "Sentry documents event-volume billing across several data categories, including replays. Rejourney is positioned for replay and analytics teams that want simple included limits across events, retention, projects, and seats.",
    faq: [
      {
        question: "How much does Sentry Session Replay cost?",
        answer:
          "Sentry's published plans include 50 replays per month, then document separate reserved and pay-as-you-go replay rates. Check the linked Sentry pricing sources for current billing details before buying.",
      },
      {
        question: "Is Rejourney a Sentry alternative?",
        answer:
          "Rejourney can replace or complement Sentry when your priority is replay-led product analytics, mobile UX investigation, heatmaps, journeys, and crash context.",
      },
      {
        question: "Does Rejourney include crash context?",
        answer:
          "Yes. Rejourney includes crash and ANR context alongside replay, device details, events, and network evidence.",
      },
      {
        question: "When should I keep Sentry?",
        answer:
          "Keep Sentry if your primary workflow is exception monitoring. Use Rejourney when you need product behavior and replay context beyond errors.",
      },
    ],
  }),
  alternativePage({
    path: "/alternatives/datadog-session-replay",
    competitor: "Datadog Session Replay",
    badge: "",
    subtitle:
      "Datadog makes sense inside a broad observability stack. Rejourney is for product teams that want session evidence without adopting the whole stack.",
    metaTitle: "Datadog Alternative for Product Analytics | Rejourney",
    metaDescription:
      "Compare Datadog with Rejourney for lightweight product analytics, session replay, mobile apps, funnels, API context, and simpler pricing.",
    keywords: ["datadog session replay", "datadog rum session replay", "datadog alternatives", "session replay tools"],
    image: "/images/geo-analytics.png",
    imageAlt: "Rejourney geo analytics and replay context as a Datadog alternative",
    proofPoints: ["Product-first UX", "Replay + API context", "Mobile + web"],
    whyParagraphs: [
      "Datadog places Session Replay inside Real User Monitoring and the wider Datadog observability catalog. That is useful when replay belongs beside logs, traces, APM, and platform monitoring.",
      "Rejourney starts from the user session, then brings in journeys, heatmaps, crashes, ANRs, API context, and product analytics. Product and engineering can use the same evidence without a large observability rollout.",
      "For teams that mainly need user-session evidence, Rejourney keeps the workflow replay-backed and keeps events, analytics retention, team members, and projects simple to plan.",
    ],
    chooseOther: [
      "You need infrastructure, logs, traces, APM, and enterprise observability in one vendor.",
      "Your SRE and platform teams already run Datadog as the central monitoring layer.",
      "You need replay mainly as one component of a full infrastructure observability stack.",
    ],
    comparisonRows: comparisonRows({
      revenueLeakPrediction: "no",
      frictionAlertEmails: "yes",
      replayFirst: "no",
      webSessionReplay: "yes",
      mobileSessionReplay: "yes",
      productAnalytics: "yes",
      heatmaps: "yes",
      journeyMaps: "yes",
      crashOrErrorContext: "yes",
      networkApiContext: "yes",
      nativeApiCalls: "yes",
      consoleLogs: "yes",
      privacyMasking: "yes",
    }, [
      { feature: "Self-hosted deployment", other: "no" },
      { feature: "Flutter, React Native, and Expo replay path", other: "partial" },
      { feature: "Native ANR replay triage", other: "partial" },
      { feature: "Focused product-team workspace", other: "no" },
    ]),
    featureDifferences: [
      {
        feature: "Platform scope",
        rejourney: "Focused on replay-backed UX investigation for product, support, and engineering teams.",
        other: "Datadog places Session Replay inside Real User Monitoring and its broader observability catalog, including infrastructure and application monitoring products.",
      },
      {
        feature: "Investigation entry point",
        rejourney: "Starts with the user's session, then brings in events, heatmaps, journeys, crashes, ANRs, and API context.",
        other: "Best to evaluate when replay should sit beside RUM, logs, traces, APM, and existing platform observability workflows.",
      },
      {
        feature: "Buyer fit",
        rejourney: "Useful when product and support need a focused workspace without adopting a large observability suite.",
        other: "A stronger fit when platform/SRE teams already use Datadog as the central monitoring layer.",
      },
    ],
    competitorFacts: [
      "Datadog lists RUM Measure starting at $0.15 per 1,000 sessions per month on full traffic when billed annually, and RUM Investigate starting at $3 per 1,000 filtered sessions per month.",
      "Datadog lists Session Replay starting at $2.50 per 1,000 sessions per month when billed annually, or $3.60 on-demand.",
      "Datadog's pricing FAQ says RUM sessions and session replays have a 30-day retention policy, while out-of-the-box metrics generated on RUM Measure sessions are retained for 15 months.",
    ],
    officialSources: [
      { label: "Datadog RUM and Session Replay pricing", href: "https://www.datadoghq.com/pricing/?product=real-user-monitoring" },
      { label: "Datadog Session Replay docs", href: "https://docs.datadoghq.com/session_replay/" },
      { label: "Datadog frustration-signal alerts", href: "https://docs.datadoghq.com/real_user_monitoring/application_monitoring/browser/frustration_signals/" },
    ],
    pricingIntro:
      "Datadog publishes RUM and Session Replay session-based pricing. Rejourney is aimed at teams that want replay and product analytics with simpler access and fewer dimensions to plan.",
    faq: [
      {
        question: "Is Rejourney a Datadog replacement?",
        answer:
          "Rejourney is not a full infrastructure observability replacement. It is a focused replay and product analytics alternative for user experience investigation.",
      },
      {
        question: "Does Rejourney include API context?",
        answer:
          "Yes. Rejourney can show API and network context beside the replay so teams can connect user friction to backend behavior.",
      },
      {
        question: "Who should choose Rejourney?",
        answer:
          "Choose Rejourney if product, support, and engineering need replay-backed user behavior insights without managing a broad observability suite.",
      },
    ],
  }),
  alternativePage({
    path: "/alternatives/amplitude-session-replay",
    competitor: "Amplitude Session Replay",
    badge: "",
    subtitle:
      "Amplitude is strong when analytics is the center. Rejourney is for teams that need the replay behind the metric.",
    metaTitle: "Amplitude Alternative with Session Replay | Rejourney",
    metaDescription:
      "Compare Amplitude with Rejourney for lightweight product analytics, web and mobile replay, journeys, heatmaps, stability, and pricing.",
    keywords: ["amplitude session replay", "amplitude session replay pricing", "amplitude alternatives", "product analytics session replay"],
    image: "/images/growth-engines.png",
    imageAlt: "Rejourney growth analytics as an Amplitude session replay alternative",
    proofPoints: ["Replay-first analytics", "Mobile UX evidence", "Crash + API context"],
    whyParagraphs: [
      "Amplitude presents a broad digital analytics platform with product analytics, session replay, heatmaps, experimentation, activation, AI feedback, and related products. That is a natural fit for mature analytics programs.",
      "Rejourney starts from the session and surrounds it with journeys, heatmaps, crashes, network context, retention signals, and product analytics. The point is to move from a chart anomaly to the moment that caused it.",
      "Unlimited events, analytics retention, projects, and team members make Rejourney easier to open across the team without turning every new event or collaborator into a planning question.",
    ],
    chooseOther: [
      "You need a mature enterprise product analytics suite with complex cohort analysis workflows.",
      "Your analytics team already has Amplitude dashboards and governance in place.",
      "Session replay is secondary to your event analytics warehouse strategy.",
    ],
    comparisonRows: comparisonRows({
      revenueLeakPrediction: "partial",
      frictionAlertEmails: "yes",
      replayFirst: "no",
      webSessionReplay: "yes",
      mobileSessionReplay: "yes",
      productAnalytics: "yes",
      heatmaps: "partial",
      journeyMaps: "yes",
      crashOrErrorContext: "partial",
      networkApiContext: "yes",
      nativeApiCalls: "partial",
      consoleLogs: "yes",
      privacyMasking: "yes",
    }, [
      { feature: "Native ANR replay triage", other: "no" },
      { feature: "Crash replay context", other: "no" },
      { feature: "API endpoint analytics dashboard", other: "no" },
      { feature: "API degradation email rules", other: "no" },
      { feature: "Self-hosted deployment", other: "no" },
    ]),
    featureDifferences: [
      {
        feature: "Analytics style",
        rejourney: "Starts from the session and keeps replay beside journeys, heatmaps, stability context, network context, and product analytics.",
        other: "Amplitude publicly presents a broad digital analytics platform with product analytics, session replay, heatmaps, experimentation, activation, AI feedback, and related products.",
      },
      {
        feature: "Question answered",
        rejourney: "Built to move from a chart anomaly or support issue to the exact user moment behind it.",
        other: "Best to evaluate when the primary workflow is mature event analytics, cohorts, governance, and experimentation.",
      },
      {
        feature: "Rollout style",
        rejourney: "Designed for product, support, and engineering to share replay evidence quickly.",
        other: "A stronger fit when a dedicated analytics team already has Amplitude dashboards, taxonomy, and governance in place.",
      },
    ],
    competitorFacts: [
      "Amplitude lists a Free plan with 2 million events per month, unlimited seats, and 10,000 monthly session replays.",
      "Amplitude lists Plus as starting at $0 with the first 2 million events per month free, while Growth and Enterprise use custom event-based pricing.",
      "Amplitude lists 20,000 monthly session replays on Growth and 50,000 on Enterprise, with custom replay volume and extended retention available to Growth and Enterprise customers.",
    ],
    officialSources: [
      { label: "Amplitude pricing", href: "https://amplitude.com/pricing" },
      { label: "Amplitude Session Replay docs", href: "https://amplitude.com/docs/session-replay/overview" },
      { label: "Amplitude Session Replay Agent", href: "https://amplitude.com/docs/amplitude-ai/session-replay-agent" },
    ],
    pricingIntro:
      "Amplitude publishes event-volume plan limits and Session Replay allowances by plan. Rejourney is evaluated as a replay-first analytics workspace with broad included limits for events, retention, projects, and seats.",
    faq: [
      {
        question: "How much does Amplitude Session Replay cost?",
        answer:
          "Amplitude currently lists 10,000 monthly session replays on Free, 20,000 on Growth, and 50,000 on Enterprise. Plus starts at $0 with event-based usage; verify the current replay allowance for your Plus configuration on Amplitude's pricing page.",
      },
      {
        question: "Is Rejourney an Amplitude alternative?",
        answer:
          "Yes, when your main goal is replay-first analytics, user journey investigation, heatmaps, mobile context, and team-wide access.",
      },
      {
        question: "Does Rejourney include product analytics?",
        answer:
          "Yes. Rejourney includes product analytics alongside session replay, heatmaps, journeys, and stability context.",
      },
      {
        question: "When is Amplitude a better fit?",
        answer:
          "Amplitude may be better when a team needs a broad enterprise analytics suite and already has mature instrumentation and analytics workflows.",
      },
    ],
  }),
  alternativePage({
    path: "/alternatives/mixpanel-session-replay",
    competitor: "Mixpanel Session Replay",
    badge: "",
    subtitle:
      "Mixpanel is built around event analytics. Rejourney is for teams that need replay, journeys, heatmaps, crashes, and API context beside the event trail.",
    metaTitle: "Mixpanel Alternative with Session Replay | Rejourney",
    metaDescription:
      "Compare Mixpanel with Rejourney for lightweight product analytics, web and mobile session replay, heatmaps, journeys, crashes, and API context.",
    keywords: ["mixpanel session replay", "mixpanel alternatives", "product analytics session replay", "session replay software"],
    image: "/images/readme-user-journeys.png",
    imageAlt: "Rejourney journey analytics as a Mixpanel session replay alternative",
    proofPoints: ["Journeys + replay", "Crash + API context", "Shared evidence"],
    whyParagraphs: [
      "Mixpanel's pricing is organized around product analytics plans, monthly event limits, saved reports, seats, session replays, governance, support, and add-ons. That works when event analytics is the core workflow.",
      "Rejourney puts replay beside events, journey maps, heatmaps, crashes, API context, and device context. PMs, designers, support, and developers can inspect the same user path.",
      "If the team wants everyone in the evidence trail, Rejourney's unlimited team members and projects make shared investigation easier.",
    ],
    chooseOther: [
      "Your core need is event analytics and cohort reporting.",
      "Your team is already standardized around Mixpanel dashboards.",
      "You do not need mobile replay, heatmaps, or crash context in the same workflow.",
    ],
    comparisonRows: comparisonRows({
      revenueLeakPrediction: "no",
      frictionAlertEmails: "partial",
      replayFirst: "no",
      webSessionReplay: "yes",
      mobileSessionReplay: "yes",
      productAnalytics: "yes",
      heatmaps: "yes",
      journeyMaps: "yes",
      crashOrErrorContext: "no",
      networkApiContext: "no",
      nativeApiCalls: "no",
      consoleLogs: "yes",
      privacyMasking: "yes",
    }, [
      { feature: "API endpoint analytics dashboard", other: "no" },
      { feature: "API degradation email rules", other: "no" },
      { feature: "Self-hosted deployment", other: "no" },
    ]),
    featureDifferences: [
      {
        feature: "Core strength",
        rejourney: "Combines replay, journeys, heatmaps, crashes, API context, device context, and product analytics around the session.",
        other: "Mixpanel publicly organizes its plans around product analytics, monthly event limits, saved reports, seats, session replays, governance, support, and add-ons.",
      },
      {
        feature: "Replay role",
        rejourney: "Replay is a first-class investigation surface for product, support, design, and engineering.",
        other: "Best to evaluate when event analytics, cohort reporting, and dashboard workflows are the main job.",
      },
      {
        feature: "Debug context",
        rejourney: "Includes crash, ANR, API, and device context beside user behavior.",
        other: "Check Mixpanel's official docs and plan table for the exact debugging and replay-context capabilities needed by your team.",
      },
    ],
    competitorFacts: [
      "Mixpanel lists a Free plan capped at 1M monthly events with up to 5 saved reports and 10K monthly session replays.",
      "Mixpanel lists Growth as starting at $0 with 1M monthly events free and $0.28 per 1K events after, volume discounts available, unlimited reports, and 20K monthly session replays free.",
      "Mixpanel's plan table lists unlimited seats across Free, Growth, and Enterprise, and Enterprise as a contact-sales plan with up to 1T monthly events and customizable session replay volumes.",
    ],
    officialSources: [
      { label: "Mixpanel pricing", href: "https://mixpanel.com/pricing/" },
      { label: "Mixpanel Session Replay", href: "https://mixpanel.com/platform/session-replay/" },
    ],
    pricingIntro:
      "Mixpanel publishes event-volume and session-replay allowances by plan. Rejourney is positioned for teams that want replay-first workflows and included limits across events, history, projects, and team access.",
    faq: [
      {
        question: "Does Mixpanel Session Replay include heatmaps?",
        answer:
          "Mixpanel's current product materials include heatmaps and session replay inside its analytics platform. Rejourney differs by keeping journeys, mobile replay, crashes, ANRs, and API context beside the behavioral evidence.",
      },
      {
        question: "Is Rejourney an open-source Mixpanel alternative?",
        answer:
          "Rejourney provides source visibility and a self-hosting path for teams that want more control, while focusing the workflow on replay-backed product and revenue-leak investigation rather than event dashboards alone.",
      },
      {
        question: "Is Rejourney a Mixpanel alternative?",
        answer:
          "Rejourney is an alternative when replay, mobile context, heatmaps, journeys, and debugging evidence are as important as event analytics.",
      },
      {
        question: "Does Rejourney include journeys?",
        answer:
          "Yes. Rejourney includes journey maps so teams can see how users move through screens and where they drop.",
      },
      {
        question: "Why pair session replay with Mixpanel-style analytics?",
        answer:
          "Events show patterns; replay explains moments. Rejourney combines both so teams can move from a metric to the user experience behind it.",
      },
    ],
  }),
  alternativePage({
    path: "/alternatives/pendo-session-replay",
    competitor: "Pendo Session Replay",
    badge: "",
    subtitle:
      "Pendo is built for product adoption and in-app guidance. Rejourney is for teams that need replay evidence before deciding what to guide, redesign, or fix.",
    metaTitle: "Pendo Alternative for Product Analytics | Rejourney",
    metaDescription:
      "Compare Pendo with Rejourney for lightweight product analytics, onboarding evidence, web and mobile replay, funnels, and technical context.",
    keywords: ["pendo session replay", "pendo alternatives", "product adoption analytics", "session replay tools"],
    image: "/images/readme-general-demo.png",
    imageAlt: "Rejourney issue detection inbox with ranked leak signals",
    proofPoints: ["Replay-led UX", "Team-wide workspace", "Crash + API context"],
    whyParagraphs: [
      "Pendo's pricing is organized around software experience management bundles, monthly active users, analytics, in-app guides, session replays, discovery, sentiment, journey orchestration, and related capabilities.",
      "Rejourney combines replay, heatmaps, journeys, product analytics, crashes, ANRs, and network context, so product and engineering can work from the same evidence.",
      "Unlimited events, analytics retention, projects, and team members help teams share replay evidence broadly without making access a budget negotiation.",
    ],
    chooseOther: [
      "You need in-app guides, surveys, and product adoption workflows more than replay investigation.",
      "Your customer success team already runs adoption programs in Pendo.",
      "You want product engagement messaging as a core platform feature.",
    ],
    comparisonRows: comparisonRows({
      revenueLeakPrediction: "partial",
      frictionAlertEmails: "partial",
      replayFirst: "no",
      webSessionReplay: "yes",
      mobileSessionReplay: "yes",
      productAnalytics: "yes",
      heatmaps: "yes",
      journeyMaps: "yes",
      crashOrErrorContext: "partial",
      networkApiContext: "partial",
      nativeApiCalls: "no",
      consoleLogs: "partial",
      privacyMasking: "yes",
    }, [
      { feature: "API endpoint analytics dashboard", other: "no" },
      { feature: "API degradation email rules", other: "no" },
      { feature: "Self-hosted deployment", other: "no" },
    ]),
    featureDifferences: [
      {
        feature: "Product motion",
        rejourney: "Replay-first UX and debugging evidence for teams investigating friction, crashes, drop-off, and support issues.",
        other: "Pendo publicly frames its packaging around software experience management, product analytics, in-app guides, session replays, discovery, sentiment, and journey orchestration.",
      },
      {
        feature: "In-app engagement",
        rejourney: "Focused on understanding what happened in a real session and connecting that behavior to technical context.",
        other: "Best to evaluate when in-app guides, surveys, product adoption, and customer-success workflows are central requirements.",
      },
      {
        feature: "Engineering context",
        rejourney: "Keeps crashes, ANRs, and network context near the replay so engineering can reproduce issues from user evidence.",
        other: "Check Pendo's official package and add-on table for the exact session replay and technical-context scope on the plan you are considering.",
      },
    ],
    competitorFacts: [
      "Pendo's current pricing page lists Base, Core, and Ultimate with custom pricing and custom monthly-active-user volume.",
      "Pendo lists Product Analytics and In-app Guides on Base; Session Replay is included on Core and Ultimate.",
      "Pendo offers a 30-day trial of the full platform, but does not publish a session-volume dollar rate for Session Replay.",
    ],
    officialSources: [
      { label: "Pendo pricing", href: "https://www.pendo.io/pricing/" },
      { label: "Pendo Session Replay", href: "https://www.pendo.io/product/session-replay/" },
    ],
    pricingIntro:
      "Pendo publishes bundle and MAU-based pricing guidance, with some capabilities included or available as add-ons by bundle. Rejourney is evaluated as a replay-first analytics and observability workspace with broad included limits.",
    faq: [
      {
        question: "How does Pendo Session Replay connect to product analytics?",
        answer:
          "Pendo connects replay to its analytics and product-adoption suite. Rejourney connects replay to journeys, heatmaps, conversion signals, crashes, ANRs, and API context so teams can investigate both behavioral and technical causes of a leak.",
      },
      {
        question: "How does Pendo Session Replay identify user friction?",
        answer:
          "Replay can expose hesitation, repeated actions, and failed paths. Rejourney adds ranked leak signals and technical context so teams can move from a friction pattern to the affected onboarding, paywall, checkout, or subscription step.",
      },
      {
        question: "What privacy controls matter for Pendo Session Replay alternatives?",
        answer:
          "Evaluate masking, capture controls, access, retention, and deployment requirements. Rejourney includes privacy masking controls and a self-hosting path for teams that need tighter ownership of replay data.",
      },
      {
        question: "Is Rejourney a Pendo alternative?",
        answer:
          "Rejourney is an alternative when the team wants replay, heatmaps, journeys, crashes, and analytics more than in-app guidance workflows.",
      },
      {
        question: "Does Rejourney help product managers?",
        answer:
          "Yes. Product managers can inspect sessions, journeys, heatmaps, retention signals, and friction patterns without needing engineering to reproduce every issue.",
      },
      {
        question: "When should I choose Pendo?",
        answer:
          "Choose Pendo if your main need is product adoption, guides, surveys, and customer success workflows.",
      },
    ],
  }),
  alternativePage({
    path: "/alternatives/smartlook",
    competitor: "Smartlook",
    badge: "",
    subtitle:
      "Smartlook is entering Cisco end-of-sale and end-of-life. Rejourney is for teams that still need replay, heatmaps, journeys, mobile evidence, and technical context in one focused workflow.",
    metaTitle: "Smartlook Alternative for Session Replay | Rejourney",
    metaDescription:
      "Compare Smartlook alternatives after Cisco end of sale, including lightweight product analytics, replay, heatmaps, mobile apps, and crash context.",
    keywords: ["smartlook alternatives", "smartlook alternative", "smartlook replacement", "smartlook end of life", "smartlook pricing", "session replay tools", "mobile session replay", "heatmap analytics"],
    image: "/images/engineering/smartlook-alternatives-replay-detail.png",
    imageAlt: "Rejourney replay workbench showing mobile session replay, API calls, timeline events, and session context",
    proofPoints: ["Cisco EOL timing", "Replay + heatmaps", "Mobile + technical context"],
    whyParagraphs: [
      "Cisco's official end-of-sale notice says Smartlook.com reaches end of sale on May 31, 2026, with the last date to renew or add to an existing subscription on August 31, 2026 and last support on August 31, 2027.",
      "Smartlook served teams that needed recordings, heatmaps, events, funnels, crash reports, and web/mobile behavior analytics. The migration question is whether teams still need that behavior-evidence layer, or whether they want Cisco's listed migration product, Splunk Observability Cloud - RUM+DXA.",
      "Rejourney is built for teams that want session replay, heatmaps, journeys, metrics, crashes, ANRs, API calls, and device context on the same investigation path after Smartlook stops being the center of the workflow.",
    ],
    chooseOther: [
      "You are already committed to Cisco or Splunk observability as the replacement path.",
      "Your organization wants an enterprise observability suite more than a replay-first product workflow.",
      "You only need to maintain existing Smartlook access through the remaining support window and are not ready to migrate.",
    ],
    comparisonRows: comparisonRows({
      revenueLeakPrediction: "no",
      frictionAlertEmails: "partial",
      replayFirst: "yes",
      webSessionReplay: "yes",
      mobileSessionReplay: "yes",
      productAnalytics: "yes",
      heatmaps: "yes",
      journeyMaps: "yes",
      crashOrErrorContext: "yes",
      networkApiContext: "yes",
      nativeApiCalls: "no",
      consoleLogs: "yes",
      privacyMasking: "yes",
    }, [
      { feature: "Active standalone buying path after May 31, 2026", other: "no" },
      { feature: "API endpoint analytics dashboard", other: "no" },
      { feature: "API degradation email rules", other: "no" },
      { feature: "Native ANR replay triage", other: "no" },
      { feature: "Self-hosted deployment", other: "no" },
    ]),
    featureDifferences: [
      {
        feature: "Product lifecycle",
        rejourney: "An active replay-first analytics product for teams moving behavior evidence into a new workflow.",
        other: "Cisco has announced Smartlook end-of-sale and end-of-life dates, with support ending on August 31, 2027.",
      },
      {
        feature: "Migration path",
        rejourney: "Keeps behavior analytics centered on sessions, heatmaps, journeys, mobile replay, crashes, ANRs, and API context.",
        other: "Cisco's EOL notice lists Splunk Observability Cloud - RUM+DXA as the migration product for affected Smartlook products.",
      },
      {
        feature: "Team workflow",
        rejourney: "Designed for product, design, support, and engineering teams to inspect the same replay-backed evidence.",
        other: "A better fit during the remaining support window if the team is staying inside existing Smartlook or Cisco account paths.",
      },
    ],
    competitorFacts: [
      "Cisco's Smartlook EOL notice says the end-of-life announcement date is March 31, 2026, the end-of-sale date is May 31, 2026, the last change or renewal date is August 31, 2026, and the last date of support is August 31, 2027.",
      "Cisco's EOL notice lists Splunk Observability Cloud - RUM+DXA as the migration product description for affected Smartlook SaaS product part numbers.",
      "Cisco's Smartlook acquisition page says Smartlook added user experience insights, analytics, troubleshooting, session recording and replay, and heatmaps to Cisco's digital experience monitoring strategy.",
      "Smartlook's own pricing page currently displays an end-of-sale notice and still presents features such as session recordings, heatmaps, events, funnels, crash reports, web analytics, and mobile app analytics.",
    ],
    officialSources: [
      { label: "Cisco Smartlook EOL notice", href: "https://www.cisco.com/c/en/us/products/collateral/software/smartlook-com-eol.html" },
      { label: "Cisco Smartlook acquisition", href: "https://www.cisco.com/site/us/en/about/corporate-development/acquisitions/smartlook/index.html" },
      { label: "Smartlook pricing", href: "https://www.smartlook.com/pricing/" },
      { label: "Smartlook project settings", href: "https://help.smartlook.com/docs/project-settings" },
      { label: "Smartlook anomaly emails", href: "https://help.smartlook.com/docs/anomalies-detection" },
    ],
    pricingIntro:
      "Smartlook's public pricing page now leads with an end-of-sale notice. Rejourney is positioned for teams that want to migrate behavior analytics into an active replay-first workflow with unlimited events, analytics retention, projects, and team access.",
    faq: [
      {
        question: "Is Smartlook ending?",
        answer:
          "Cisco has published end-of-sale and end-of-life dates for Smartlook.com. The notice lists May 31, 2026 as end of sale and August 31, 2027 as the last date of support.",
      },
      {
        question: "Is Rejourney a Smartlook alternative?",
        answer:
          "Yes. Rejourney is a Smartlook alternative for teams that want session replay, heatmaps, journeys, product analytics, mobile replay, crashes, ANRs, and API context in one workflow.",
      },
      {
        question: "When should I choose Rejourney over Smartlook?",
        answer:
          "Choose Rejourney if your team needs an active replacement before or during the Smartlook transition and wants replay-first product evidence rather than a broader Cisco or Splunk observability migration.",
      },
    ],
  }),
  alternativePage({
    path: "/alternatives/hotjar",
    competitor: "Hotjar / Contentsquare",
    badge: "",
    subtitle:
      "Hotjar's replay experience is moving into Contentsquare. Rejourney is the focused alternative for teams that want web and mobile replay tied to product and engineering evidence.",
    metaTitle: "Hotjar Alternative for Web & Mobile Replay | Rejourney",
    metaDescription:
      "Compare Hotjar with Rejourney for lightweight product analytics, web and mobile replay, heatmaps, journeys, unlimited events, and retention.",
    keywords: ["hotjar alternatives", "hotjar competitors", "alternative hotjar", "hotjar alternative", "session replay tools", "behavior analytics tools", "heatmap analytics"],
    image: "/images/engineering/churn-mobile-heatmap.png",
    imageAlt: "Rejourney heatmap workspace showing a product page with interaction density",
    proofPoints: ["Heatmaps + replay", "Journeys + analytics", "Mobile + stability context"],
    whyParagraphs: [
      "Hotjar now directs its Session Replay and pricing experience into Contentsquare, whose current plans combine replay, heatmaps, funnels, error monitoring, surveys, and broader experience analytics.",
      "Rejourney is built for product teams that need the session, heatmap, journey, metric, crash, and API context on the same investigation path.",
      "If your team is comparing Hotjar alternatives because recordings alone are not enough, Rejourney keeps replay close to product analytics, mobile context, and technical evidence.",
    ],
    chooseOther: [
      "You want Contentsquare's broader experience analytics, Voice of Customer, or enterprise digital-experience suite.",
      "Your team already uses Hotjar or Contentsquare and wants to keep its existing research workflow.",
      "You prefer a broad experience-analytics platform over a focused replay and product-debugging workspace.",
    ],
    comparisonRows: comparisonRows({
      revenueLeakPrediction: "partial",
      frictionAlertEmails: "yes",
      replayFirst: "no",
      webSessionReplay: "yes",
      mobileSessionReplay: "yes",
      productAnalytics: "yes",
      heatmaps: "yes",
      journeyMaps: "yes",
      crashOrErrorContext: "partial",
      networkApiContext: "partial",
      nativeApiCalls: "no",
      consoleLogs: "partial",
      privacyMasking: "yes",
    }, [
      { feature: "Native crash and ANR triage", other: "no" },
      { feature: "API endpoint analytics dashboard", other: "no" },
      { feature: "API degradation email rules", other: "no" },
      { feature: "Self-hosted deployment", other: "no" },
    ]),
    featureDifferences: [
      {
        feature: "Core job",
        rejourney: "Replay-first analytics for product, support, design, and engineering teams that need behavior plus technical context.",
        other: "Hotjar's current buying path leads into Contentsquare, which combines replay, heatmaps, funnels, error monitoring, surveys, and a broader experience-analytics suite.",
      },
      {
        feature: "From symptom to cause",
        rejourney: "Connects heatmaps to session replay, journeys, product analytics, crashes, ANRs, device context, and API evidence.",
        other: "Best to evaluate when the goal is a broad experience-analytics and feedback suite rather than a focused replay and engineering workflow.",
      },
      {
        feature: "Product surface",
        rejourney: "Designed for web and mobile apps where friction can come from UI, device, app version, crash, network, or backend behavior.",
        other: "Contentsquare now covers web and mobile experience analytics; verify the plan and platform scope needed for replay and technical context.",
      },
    ],
    competitorFacts: [
      "Hotjar's pricing URL now redirects to Contentsquare pricing, and Hotjar describes its Recordings product as Session Replay in Contentsquare.",
      "Contentsquare's Experience Analytics Free plan allows up to 200,000 analyzed sessions, but captures 5% for replay with a maximum of 10,000 monthly replays.",
      "Contentsquare lists Experience Analytics Growth from $49 per month when billed annually, with 15% replay capture and a 20,000-replay minimum; Pro and Enterprise pricing is handled through sales.",
    ],
    officialSources: [
      { label: "Contentsquare pricing (redirected from Hotjar)", href: "https://www.hotjar.com/pricing/" },
      { label: "Hotjar Session Replay transition", href: "https://www.hotjar.com/product/recordings/" },
      { label: "Hotjar platform compatibility", href: "https://help.hotjar.com/hc/en-us/articles/36819957176721-Platforms-and-Frameworks-Not-Compatible-with-Hotjar" },
      { label: "Contentsquare friction alerts", href: "https://support.contentsquare.com/hc/en-us/articles/37271665241617-How-to-automatically-detect-and-fix-pain-points" },
    ],
    pricingIntro:
      "Hotjar's current pricing path leads to Contentsquare plans. Rejourney is positioned for teams that want a focused replay workflow connected to product analytics, mobile evidence, crashes, API context, and broad team access.",
    faq: [
      {
        question: "Is Rejourney a Hotjar alternative?",
        answer:
          "Yes. Rejourney is a Hotjar alternative for teams that want heatmaps and session replay plus journeys, product analytics, mobile replay, crash context, and API evidence.",
      },
      {
        question: "When is Hotjar a better fit?",
        answer:
          "Hotjar or Contentsquare can be a better fit when the team wants a broader experience-analytics, feedback, and enterprise research suite.",
      },
      {
        question: "Why choose Rejourney over Hotjar?",
        answer:
          "Choose Rejourney when the team needs to connect visual behavior to replay, journeys, retention, mobile app context, errors, crashes, ANRs, and backend or API issues.",
      },
    ],
  }),
  alternativePage({
    path: "/alternatives/fullstory",
    competitor: "Fullstory",
    badge: "",
    subtitle:
      "Fullstory is a mature digital experience platform. Rejourney is the leaner replay-first alternative with mobile context, simple limits, and open-source/self-hosting paths.",
    metaTitle: "Fullstory Alternative for Lightweight Replay | Rejourney",
    metaDescription:
      "Compare Fullstory with Rejourney for lightweight product analytics, web and mobile replay, heatmaps, journeys, unlimited events, and retention.",
    keywords: ["fullstory alternatives", "fullstory alternative", "best fullstory alternatives", "fullstory competitors", "fullstory session replay", "session replay alternatives"],
    image: "/images/hero-replay-workbench.png",
    imageAlt: "Rejourney replay workbench as a Fullstory alternative",
    proofPoints: [],
    whyParagraphs: [
      "Fullstory's public plans page presents Analytics, Workforce, and Anywhere packages, with Analytics plans named Business, Advanced, and Enterprise. It also lists a free plan for individuals and small teams.",
      "Rejourney keeps replay, heatmaps, journeys, crashes, ANRs, API context, and product analytics together without requiring a complex suite rollout.",
      "For teams that want source visibility or a self-hosting path, Rejourney also offers an open-source foundation.",
    ],
    chooseOther: [
      "You need a mature enterprise digital experience platform with existing procurement support.",
      "Your organization already uses Fullstory across many web properties.",
      "You need its specific enterprise workflow integrations.",
    ],
    comparisonRows: comparisonRows({
      revenueLeakPrediction: "no",
      frictionAlertEmails: "yes",
      replayFirst: "yes",
      webSessionReplay: "yes",
      mobileSessionReplay: "yes",
      productAnalytics: "yes",
      heatmaps: "yes",
      journeyMaps: "yes",
      crashOrErrorContext: "partial",
      networkApiContext: "yes",
      nativeApiCalls: "partial",
      consoleLogs: "yes",
      privacyMasking: "yes",
    }, [
      { feature: "Self-hosted deployment", other: "no" },
      { feature: "Flutter, React Native, and Expo replay path", other: "partial" },
      { feature: "Native ANR replay triage", other: "no" },
      { feature: "API endpoint analytics dashboard", other: "no" },
      { feature: "API degradation email rules", other: "no" },
    ]),
    featureDifferences: [
      {
        feature: "Deployment posture",
        rejourney: "Offers an open-source foundation and self-hosting path for teams that want source visibility and deployment control.",
        other: "Fullstory publicly presents Analytics, Workforce, and Anywhere packages with paid plan details handled through pricing/demo requests.",
      },
      {
        feature: "Workflow shape",
        rejourney: "Lean replay-first workflow with heatmaps, journeys, crashes, ANRs, API context, and product analytics together.",
        other: "Best to evaluate when the organization wants a mature enterprise digital experience analytics platform and its specific enterprise workflows.",
      },
      {
        feature: "Mobile and add-ons",
        rejourney: "Mobile investigation is part of the core Rejourney positioning across Flutter, React Native, Expo, and iOS paths.",
        other: "Fullstory lists Mobile among its add-ons, so teams should verify paid-plan and add-on packaging directly with Fullstory.",
      },
    ],
    competitorFacts: [
      "Fullstory's plans page says Analytics has Business, Advanced, and Enterprise plans, and directs teams to request pricing and a demo for a complete feature list by plan.",
      "Fullstory lists add-ons including Mobile, Multi-Org Management, Advantage Subscription, StoryAI, and Guides and Surveys.",
      "Fullstory says FullstoryFree includes 30,000 sessions per month, 12 months of data retention, core capabilities such as Session Replay, basic analytics, debugging tools, and up to 10 users.",
    ],
    officialSources: [
      { label: "Fullstory plans", href: "https://www.fullstory.com/plans/" },
      { label: "Fullstory retention help", href: "https://help.fullstory.com/hc/en-us/articles/4559287110039-Fullstory-Plan-Retention" },
      { label: "Fullstory Analytics", href: "https://www.fullstory.com/platform/analytics/" },
      { label: "Fullstory Dev Tools", href: "https://help.fullstory.com/hc/en-us/articles/360020828313-Guide-to-Dev-Tools" },
      { label: "Fullstory friction alert examples", href: "https://help.fullstory.com/hc/en-us/articles/16194367747735-Sample-Metric-Alerts" },
    ],
    pricingIntro:
      "Fullstory publishes plan names and free-plan limits, while paid plan pricing is handled through pricing/demo requests. Rejourney is built for teams that want replay-first analytics, broad access, and simple included limits.",
    faq: [
      {
        question: "Is Rejourney a Fullstory alternative?",
        answer:
          "Yes. Rejourney is an alternative for teams that want replay, heatmaps, journeys, mobile context, crash context, and open-source/self-hosting options.",
      },
      {
        question: "Does Rejourney support mobile apps?",
        answer:
          "Yes. Rejourney supports mobile app investigation workflows across Flutter, React Native, Expo, and native iOS paths.",
      },
      {
        question: "Why compare Rejourney with Fullstory?",
        answer:
          "Teams compare them when they want session replay and experience analytics but prefer simpler pricing, lighter rollout, and team-wide access.",
      },
    ],
  }),
];

export const SEO_PAGE_PATHS = SEO_PAGES.map((page) => page.path);

export function normalizeSeoPath(pathname: string) {
  const withoutTrailingSlash = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return withoutTrailingSlash || "/";
}

export function getSeoPageByPath(pathname: string): SeoPage | undefined {
  const normalized = normalizeSeoPath(pathname);
  return SEO_PAGES.find((page) => page.path === normalized);
}
