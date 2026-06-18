export type SeoPageKind = "category" | "alternative";

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
  path: string;
  badge: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
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
  { feature: "Replay-First", rejourney: "yes", other: other.replayFirst },
  { feature: "Web session replay", rejourney: "yes", other: other.webSessionReplay },
  { feature: "Mobile session replay", rejourney: "yes", other: other.mobileSessionReplay },
  { feature: "Product analytics", rejourney: "yes", other: other.productAnalytics },
  { feature: "Heatmaps", rejourney: "yes", other: other.heatmaps },
  { feature: "Journey maps", rejourney: "yes", other: other.journeyMaps },
  { feature: "Crash / error context", rejourney: "yes", other: other.crashOrErrorContext },
  { feature: "Network / API context", rejourney: "yes", other: other.networkApiContext },
  { feature: "Native API calls", rejourney: "yes", other: other.nativeApiCalls },
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

const commonRelated = [
  {
    label: "Pricing",
    href: "/pricing",
    description: "See Rejourney's fixed-price plans and included platform limits.",
  },
  {
    label: "Live demo",
    href: "/demo",
    description: "Open the demo dashboard and inspect the replay, heatmap, journey, and stability views.",
  },
  {
    label: "React Native SDK",
    href: "/docs/reactnative/overview",
    description: "Install mobile session replay for React Native and Expo apps.",
  },
  {
    label: "Web SDK",
    href: "/docs/web/getting-started",
    description: "Add browser session replay, analytics, and network capture to a web app.",
  },
];

const categoryPage = (config: {
  path: string;
  badge: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
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
}): SeoPage => ({
  kind: "category",
  chooseRejourney: [
    "You want replay, product analytics, heatmaps, journeys, crashes, and network context together.",
    "You need predictable pricing with unlimited events, retention, projects, and team members.",
    "You want a lightweight SDK that is easy to add to web, React Native, Expo, and iOS apps.",
    "You want a product team and engineering team to investigate the same real session.",
  ],
  pricingTitle: "Pricing built for teams that instrument deeply",
  pricingIntro:
    "Rejourney is designed so you do not have to ration events, projects, seats, or historical analytics data. Replay volume can be planned, while the broader product analytics workspace stays open to the whole team.",
  pricingBullets: commonPricingBullets,
  related: commonRelated,
  ...config,
  comparisonRows: categoryFeatureRows(config.comparisonOther),
});

const alternativePage = (config: {
  path: string;
  competitor: string;
  badge: string;
  subtitle: string;
  metaTitle: string;
  metaDescription: string;
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
}): SeoPage => ({
  kind: "alternative",
  path: config.path,
  badge: config.badge,
  eyebrow: "Alternative comparison",
  title: `Rejourney vs ${config.competitor}`,
  subtitle: config.subtitle,
  metaTitle: config.metaTitle,
  metaDescription: config.metaDescription,
  keywords: config.keywords,
  image: config.image,
  imageAlt: config.imageAlt,
  proofPoints: config.proofPoints,
  whyTitle: `Why consider Rejourney over ${config.competitor}?`,
  whyParagraphs: config.whyParagraphs,
  chooseRejourney: [
    "You want replay-first analytics for web and mobile apps in one workspace.",
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
  lastReviewed: "May 24, 2026",
  competitorFacts: config.competitorFacts,
  officialSources: config.officialSources,
  pricingTitle: "Pricing comparison",
  pricingIntro: config.pricingIntro,
  pricingBullets: commonPricingBullets,
  faq: config.faq,
  related: [
    ...commonRelated.slice(0, 2),
    {
      label: "Web session replay",
      href: "/web-session-replay",
      description: "See how Rejourney records browser behavior with product and network context.",
    },
    {
      label: "Record user sessions",
      href: "/record-user-sessions",
      description: "See how to record user sessions with replay, privacy controls, and product context.",
    },
  ],
});

export const SEO_PAGES: SeoPage[] = [
  categoryPage({
    path: "/ai-funnel-leak-detection",
    badge: "Leak detection",
    eyebrow: "AI funnel leaks",
    title: "AI funnel leak detection that starts from the leaks page",
    subtitle:
      "Use the Rejourney leaks page to rank conversion drops, rage taps, crashes, API failures, and journey loops with the replay evidence needed to fix them.",
    metaTitle: "AI Funnel Leak Detection | Rejourney",
    metaDescription:
      "AI funnel leak detection for product and engineering teams. Rank funnel leaks, inspect replay evidence, and create fix-ready context from the Rejourney leaks page.",
    keywords: ["AI funnel leak detection", "funnel leak detection", "conversion leak detection", "AI session replay", "revenue leak detection", "rage tap detection", "session replay issues"],
    image: "/images/landing-replay-theater.png",
    imageAlt: "Rejourney leaks page showing ranked issue detection and funnel leak evidence",
    proofPoints: ["Ranked leak inbox", "Replay evidence", "AI-ready fix context"],
    whyTitle: "The leaks page turns raw sessions into a ranked repair queue",
    whyParagraphs: [
      "A funnel leak is not just a chart that went down. It is the repeated moment where users lose intent: a dead checkout button, a loop between screens, a slow API call, a rage tap cluster, a crash, or a path that looks healthy until replay shows confusion.",
      "Rejourney's leaks page groups those signals into ranked issues, then keeps the replay, journey, technical context, and affected user evidence close enough for product and engineering to act together.",
      "That means teams can move from 'conversion dropped' to 'this path, this screen, this request, these sessions, this likely fix' without stitching together separate dashboards.",
    ],
    chooseOtherTitle: "Choose a generic analytics dashboard if...",
    chooseOther: [
      "Your team only needs high-level conversion rates and does not investigate the sessions behind them.",
      "You already have a reliable issue queue that links funnel drops to replay, journey, API, and crash context.",
      "Your product does not need product and engineering teams to share the same evidence when prioritizing fixes.",
    ],
    comparisonTitle: "AI funnel leak detection checklist",
    comparisonIntro:
      "A leak-detection workflow should rank the problem, explain why it matters, and preserve enough session evidence for someone to verify the fix.",
    otherColumnTitle: "Generic analytics",
    comparisonOther: "partial",
    faq: [
      {
        question: "What does the Rejourney leaks page show?",
        answer:
          "It shows ranked product and technical issues such as funnel drop-offs, rage taps, crashes, API failures, and repeated journey loops, with replay evidence and context for each item.",
      },
      {
        question: "How is AI used in funnel leak detection?",
        answer:
          "AI helps cluster repeated session signals into fixable issues and prepare context packages, but the workflow stays grounded in real replay, journey, event, crash, and request evidence.",
      },
      {
        question: "Who should use the leaks page?",
        answer:
          "Product teams use it to prioritize conversion leaks. Engineering teams use it to reproduce the cause. Growth teams use it to connect leak repair with revenue and retention movement.",
      },
    ],
  }),
  categoryPage({
    path: "/funnel-replay-evidence",
    badge: "Funnels",
    eyebrow: "Funnel replay evidence",
    title: "Funnel replay evidence for the paths where users branch, loop, or drop",
    subtitle:
      "Use journey ribbons to find the highest-volume paths, then open the replay evidence behind each branch, loop, and drop-off.",
    metaTitle: "Funnel Replay Evidence | Rejourney",
    metaDescription:
      "Use Rejourney funnel replay evidence to inspect journey ribbons, drop-offs, repeated paths, and the replay sessions behind conversion leaks.",
    keywords: ["funnel replay evidence", "user journey analytics", "journey map analytics", "funnel drop-off replay", "conversion funnel replay"],
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
    title: "Geographic analytics for regional sentiment and UX friction",
    subtitle:
      "Map positive, neutral, and frustrated sessions by region so teams can see where UX, network, language, or market-specific friction is clustering.",
    metaTitle: "Geographic Analytics | Rejourney",
    metaDescription:
      "Use Rejourney geographic analytics to map regional sentiment, friction, session replay context, and product issues by country.",
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
    title: "Revenue recovery analytics tied to sessions and releases",
    subtitle:
      "Track revenue, transactions, active users, retention, and releases beside the sessions that explain movement.",
    metaTitle: "Revenue Recovery Analytics | Rejourney",
    metaDescription:
      "Use Rejourney revenue recovery analytics to connect revenue movement, transactions, releases, retention, and session replay evidence.",
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
    title: "Standardized context for sessions, regions, events, and issues",
    subtitle:
      "Turn sessions, regional signals, events, and technical evidence into consistent context that teams can query, share, compare, and hand off.",
    metaTitle: "Standardized Context | Rejourney",
    metaDescription:
      "Use Rejourney standardized context to keep replay, journeys, regions, events, crashes, and API evidence tied to shared identifiers.",
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
    path: "/ai-agent-handoff",
    badge: "AI handoff",
    eyebrow: "AI agent handoff",
    title: "AI agent handoff from replay evidence to fix-ready context",
    subtitle:
      "Package replay, event, request, crash, and journey evidence into context developers can paste into Cursor, Claude, Codex, or an IDE workflow.",
    metaTitle: "AI Agent Handoff | Rejourney",
    metaDescription:
      "Use Rejourney AI agent handoff to convert session replay evidence into fix-ready context packets for developer and coding-agent workflows.",
    keywords: ["AI agent handoff", "session replay AI", "AI debugging context", "coding agent context", "replay to fix"],
    image: "/images/readme-general-demo.png",
    imageAlt: "Rejourney issue detection context ready for AI agent handoff",
    proofPoints: ["Replay packets", "Markdown context", "Developer workflow"],
    whyTitle: "AI agents need evidence, not a vague bug summary",
    whyParagraphs: [
      "A coding agent can only help if it receives the right facts: the path, expected behavior, observed behavior, affected release, failed request, event sequence, and replay evidence that proves the issue.",
      "Rejourney turns session evidence into structured context that a developer can review and hand to an AI workflow without rewriting the same bug report from scratch.",
      "The goal is not to replace engineering judgment. It is to remove the tedious translation between what happened in a real session and what a coding agent needs to start a fix.",
    ],
    chooseOtherTitle: "Write manual bug reports if...",
    chooseOther: [
      "Your team does not use coding agents or IDE assistant workflows.",
      "Issues are rare enough that manual reproduction notes are easy to maintain.",
      "Your bug tracker already includes replay, event, request, and release context automatically.",
    ],
    comparisonTitle: "AI handoff checklist",
    comparisonIntro:
      "A good AI handoff should preserve the exact session evidence and describe the fix boundary clearly.",
    otherColumnTitle: "Manual ticket",
    comparisonOther: "partial",
    faq: [
      {
        question: "What goes into an AI agent handoff?",
        answer:
          "The useful packet includes replay links, route or screen path, expected behavior, observed behavior, product events, release and device context, failed requests, crashes, and likely reproduction steps.",
      },
      {
        question: "Does Rejourney automatically write code?",
        answer:
          "Rejourney focuses on preparing evidence and context. Developers can then use that context with their preferred AI coding tools and review the result.",
      },
      {
        question: "Why not just paste a replay link?",
        answer:
          "A replay link is useful, but agents and developers also need structured facts: what failed, where, for whom, and which signals support the diagnosis.",
      },
    ],
  }),
  categoryPage({
    path: "/autonomous-debugging",
    badge: "Debugging",
    eyebrow: "Autonomous debugging",
    title: "Autonomous debugging starts with exact session context",
    subtitle:
      "Group repeated issue signals with replay links, stack context, events, and handoff text so engineering can reproduce and repair production bugs faster.",
    metaTitle: "Autonomous Debugging | Rejourney",
    metaDescription:
      "Use Rejourney autonomous debugging workflows to connect production bugs, replay links, crash context, API signals, and AI-ready developer handoff text.",
    keywords: ["autonomous debugging", "AI debugging", "session replay debugging", "production bug replay", "crash replay context"],
    image: "/images/anr-issues.png",
    imageAlt: "Rejourney stability issue dashboard with crash and ANR replay context",
    proofPoints: ["Repeated signals", "Replay links", "Fix-ready handoff"],
    whyTitle: "Production debugging should begin with the session that proves the bug",
    whyParagraphs: [
      "Debugging slows down when the evidence is split between a metric dashboard, a crash tool, a replay clip, a support ticket, and a chat thread. The team spends time reconstructing the story before it can fix anything.",
      "Rejourney groups repeated signals and keeps replay, crash, API, event, device, release, and journey context together so the bug has a reproducible shape.",
      "That context can then be handed to an engineer or AI coding workflow with enough detail to start testing a fix instead of asking users to reproduce the failure.",
    ],
    chooseOtherTitle: "Use a crash-only workflow if...",
    chooseOther: [
      "The stack trace alone is enough to reproduce most production issues.",
      "Your product bugs do not depend on user path, UI state, device, release, or network context.",
      "Your existing observability tool already connects crash context to replay and product behavior.",
    ],
    comparisonTitle: "Autonomous debugging checklist",
    comparisonIntro:
      "Autonomous debugging needs exact evidence, repeated signals, and a context packet that survives handoff.",
    otherColumnTitle: "Crash-only triage",
    comparisonOther: "partial",
    faq: [
      {
        question: "What makes debugging autonomous?",
        answer:
          "The workflow becomes more autonomous when issue evidence is grouped, replay links are attached, context is structured, and the next agent or engineer can start from reproducible facts.",
      },
      {
        question: "Does this replace crash reporting?",
        answer:
          "No. It complements crash reporting by adding replay, product path, events, device, release, and API context around the crash or failure.",
      },
      {
        question: "Can this help with ANRs and freezes?",
        answer:
          "Yes. ANR and freeze triage is stronger when the session shows what the user was doing before the app stopped responding.",
      },
    ],
  }),
  categoryPage({
    path: "/self-healing-software",
    badge: "Self-healing",
    eyebrow: "Self-healing software",
    title: "Self-healing software starts with real session evidence",
    subtitle:
      "Use replay, stability, API, device, journey, and leak context to turn repeated production friction into fix-ready work.",
    metaTitle: "Self-Healing Software | Rejourney",
    metaDescription:
      "Self-healing software workflows with AI debugging, session replay debugging, crashes, ANRs, API failures, device insights, and fix-ready context.",
    keywords: [
      "self healing software",
      "AI debugging",
      "session replay debugging",
      "self healing software development",
      "autonomous debugging",
      "production debugging",
      "AI session replay",
    ],
    image: "/images/engineering/product-tools-live-stability.png",
    imageAlt: "Rejourney stability dashboard for self-healing software workflows",
    proofPoints: ["Replay evidence", "Stability signals", "Fix-ready context"],
    whyTitle: "Self-healing software needs evidence before automation",
    whyParagraphs: [
      "A product cannot heal itself from a vague chart. It needs the exact user path, the failed request, the crash or ANR, the affected device, and the release context that made the issue repeat.",
      "Rejourney keeps those signals tied to real sessions so teams can identify friction, inspect the proof, and hand a bounded problem to an engineer or AI coding workflow.",
      "That makes self-healing less like magic and more like a disciplined loop: observe the user experience, group the repeated issue, package the context, fix, and verify recovery.",
    ],
    chooseOtherTitle: "Use generic monitoring if...",
    chooseOther: [
      "Your team only needs uptime or server-side metrics.",
      "Production issues are reproducible without user path, replay, device, or request context.",
      "Your existing tools already package product and engineering evidence into fix-ready workflows.",
    ],
    comparisonTitle: "Self-healing software checklist",
    comparisonIntro:
      "Self-healing workflows should connect observed user friction to the technical context needed to repair it.",
    otherColumnTitle: "Generic monitoring",
    comparisonOther: "partial",
    faq: [
      {
        question: "What does self-healing software mean for product teams?",
        answer:
          "It means repeated user-facing friction can be detected, grouped, explained, and handed off with enough context for a fix, instead of waiting for manual reports and incomplete bug tickets.",
      },
      {
        question: "How does Rejourney support self-healing workflows?",
        answer:
          "Rejourney connects session replay, journeys, stability issues, API endpoint failures, device cohorts, and AI-ready handoff context around the same real user evidence.",
      },
      {
        question: "Does Rejourney automatically deploy fixes?",
        answer:
          "No. Rejourney prepares the evidence and context developers or AI coding tools need. Teams still review, test, and ship fixes through their normal engineering process.",
      },
    ],
  }),
  categoryPage({
    path: "/stability-monitoring",
    badge: "Stability",
    eyebrow: "Stability monitoring",
    title: "Stability monitoring with replay context for crashes, errors, and ANRs",
    subtitle:
      "Group crashes, errors, ANRs, and API spikes with affected users, devices, releases, and replay evidence.",
    metaTitle: "Stability Monitoring | Rejourney",
    metaDescription:
      "Mobile app stability monitoring for crashes, errors, ANR monitoring, API spikes, replay context, affected devices, and release impact.",
    keywords: [
      "mobile app stability monitoring",
      "crash analytics",
      "ANR monitoring",
      "error monitoring",
      "mobile crash analytics",
      "session replay debugging",
      "production stability monitoring",
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
    title: "API endpoint insights tied to product sessions",
    subtitle:
      "Track endpoint volume, latency, failure codes, and risk while keeping the affected session evidence close.",
    metaTitle: "API Endpoint Insights | Rejourney",
    metaDescription:
      "API endpoint analytics and API endpoint monitoring with endpoint risk, latency, failure codes, user impact, and session replay context.",
    keywords: [
      "API endpoint analytics",
      "API endpoint monitoring",
      "API insights",
      "endpoint analytics",
      "API monitoring dashboard",
      "API error analytics",
      "session replay API errors",
    ],
    image: "/images/engineering/product-tools-live-api-endpoints.png",
    imageAlt: "Rejourney API endpoint insights dashboard with endpoint risk latency and failure codes",
    proofPoints: ["Endpoint risk", "Failure codes", "Session context"],
    whyTitle: "API failures become product problems when users feel them",
    whyParagraphs: [
      "Endpoint health is not only an infrastructure metric. A slow checkout request, failed profile load, or repeated 500 during onboarding can become product friction even when the rest of the system looks healthy.",
      "Rejourney's API endpoint insights show calls, latency, failure rates, status codes, and risk across captured sessions so product and engineering can identify which backend problems users actually experienced.",
      "That keeps API monitoring close to replay, journeys, stability, device context, and release impact instead of making teams translate raw logs into product consequences by hand.",
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
    title: "Device insights for mobile app friction, crashes, and engagement",
    subtitle:
      "Compare device models, platforms, app versions, issue rates, engagement, and session quality to find device-specific friction.",
    metaTitle: "Device Insights | Rejourney",
    metaDescription:
      "Device analytics for mobile apps with device-specific crash analytics, engagement, ANR context, error rates, app versions, and replay evidence.",
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
    badge: "Strategy guide",
    eyebrow: "Record user sessions",
    title: "Record user sessions without building a clip graveyard",
    subtitle:
      "Capture the session, the search that found it, and the signals that explain whether the behavior is a one-off or a pattern worth fixing.",
    metaTitle: "Record User Sessions | Rejourney",
    metaDescription:
      "Record user sessions on web and mobile with replay, heatmaps, journeys, privacy controls, product analytics, crash context, and lightweight SDKs.",
    keywords: ["record user sessions", "web session replay", "session replay software", "session replay tools", "website session recording", "real user sessions", "user session replay software"],
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
    path: "/mobile-session-replay",
    badge: "Mobile apps",
    eyebrow: "Mobile session replay",
    title: "Mobile session replay with the app context intact",
    subtitle:
      "Watch taps, gestures, screen changes, slow requests, crashes, and ANRs with enough metadata to reproduce what happened on the device.",
    metaTitle: "Mobile Session Replay | Rejourney",
    metaDescription:
      "Mobile session replay for iOS, React Native, and Expo with heatmaps, journeys, ANR detection, crash context, and lightweight SDKs.",
    keywords: ["mobile session replay", "mobile app session replay", "React Native session replay", "iOS session replay"],
    image: "/images/heatmaps.png",
    imageAlt: "Rejourney mobile heatmaps and replay analytics dashboard",
    proofPoints: ["React Native + Expo", "Native iOS", "Heatmaps + ANRs"],
    whyTitle: "Mobile replay has to understand the app behind the pixels",
    whyParagraphs: [
      "Mobile bugs often hide in app-specific context: screen transitions, gestures, OS versions, foreground and background changes, flaky networks, slow frames, crashes, and ANRs. A recording without those details is hard to act on.",
      "Rejourney connects replay with touch heatmaps, journeys, crash reports, ANR signals, device metadata, and API performance so teams can see the session and the conditions around it.",
      "That makes the replay useful before anyone asks the user to reproduce the problem. Product can see the hesitation, support can verify the path, and engineering can start with a screen, release, device, and likely cause.",
    ],
    chooseOtherTitle: "Choose a web-first tool if...",
    chooseOther: [
      "Your product is browser-only and every important flow happens on the web.",
      "You do not need React Native, Expo, or native iOS replay.",
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
          "Yes. Rejourney has React Native and Expo documentation, plus native iOS support for teams building mobile apps.",
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
    title: "Web session replay for the state between pageviews",
    subtitle:
      "See the clicks, route changes, loading states, failed requests, and UI dead ends that traffic analytics usually flatten.",
    metaTitle: "Web Session Replay | Rejourney",
    metaDescription:
      "Web session replay for browser apps with product analytics, heatmaps, journeys, network context, console context, and replay search.",
    keywords: ["web session replay", "website session replay", "browser session replay", "web session recording"],
    image: "/images/landing-replay-theater.png",
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
    eyebrow: "Heatmaps",
    title: "Heatmaps should explain attention, not common sense",
    subtitle:
      "Use web attention maps and mobile touch maps to understand what users notice, skim, miss, and repeat.",
    metaTitle: "Heatmaps | Rejourney",
    metaDescription:
      "Use Rejourney heatmaps to compare web attention maps and mobile touch maps with replay, journeys, and product context.",
    keywords: [
      "heatmaps",
      "heatmap analytics",
      "attention maps",
      "touch heatmaps",
      "website attention maps",
      "mobile heatmaps",
      "session replay heatmaps",
    ],
    image: "/images/engineering/heatmaps-attention-docs.png",
    imageAlt: "Rejourney web attention map over the Web SDK documentation page",
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
    title: "Replay-first mentality starts with the session, not the chart",
    subtitle:
      "Use real sessions as the first shared artifact in product decisions, support escalations, bug triage, and release reviews.",
    metaTitle: "Replay-First Mentality | Rejourney",
    metaDescription:
      "Learn the replay-first mentality for product, support, and engineering teams that want decisions grounded in real user sessions.",
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
    title: "Open source matters when replay data is this close to users",
    subtitle:
      "Session replay touches product behavior, user privacy, and debugging workflows. Source visibility makes those boundaries easier to inspect.",
    metaTitle: "Importance of Open Source | Rejourney",
    metaDescription:
      "Why open source matters for session replay, product analytics, self-hosting, privacy, auditability, and long-term observability control.",
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
    title: "What session replay actually shows",
    subtitle:
      "Session replay reconstructs a user experience so teams can inspect the visible path, the surrounding events, and the system signals around a confusing moment.",
    metaTitle: "What Is Session Replay? | Rejourney",
    metaDescription:
      "Learn what session replay is, how it works, and how Rejourney uses replay with analytics, heatmaps, journeys, crashes, and network context.",
    keywords: ["what is session replay", "how does session replay work", "session replay analytics", "what are session replay tools"],
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
    title: "How to see what your users do without guessing",
    subtitle:
      "Move from vague feedback to real sessions, journey paths, heatmaps, events, crashes, and API context that point to the same moment.",
    metaTitle: "How to See What Your Users Do | Rejourney",
    metaDescription:
      "Learn how to see what users do in your app or website with session replay, heatmaps, journeys, events, crash context, and product analytics.",
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
          "Yes. Rejourney supports browser replay and mobile replay workflows, so teams can inspect behavior across web, React Native, Expo, and native iOS apps.",
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
    title: "Be your users without pretending to be them",
    subtitle:
      "Watch real sessions before shipping so roadmap debates, bug triage, and design reviews stay attached to what people actually experienced.",
    metaTitle: "Be Your Users | Rejourney",
    metaDescription:
      "Be your users by watching real sessions, reviewing journeys, inspecting friction, and grounding product decisions in actual user behavior.",
    keywords: ["be your users", "watch user sessions", "user experience analytics", "session replay product teams"],
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
    metaTitle: "Rejourney vs PostHog Session Replay",
    metaDescription:
      "Compare Rejourney with PostHog session replay for web and mobile replay, unlimited events, retention, projects, team members, and pricing.",
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
      { feature: "Team/project alert topology", other: "no" },
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
    metaTitle: "Rejourney vs Sentry Session Replay",
    metaDescription:
      "Compare Rejourney and Sentry Session Replay for replay, product analytics, heatmaps, journeys, unlimited events, and mobile debugging.",
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
      { feature: "API endpoint analytics dashboard", other: "no" },
      { feature: "Team/project alert topology", other: "no" },
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
    ],
    pricingIntro:
      "Sentry documents event-volume billing across several data categories, including replays. Rejourney is positioned for replay and analytics teams that want simple included limits across events, retention, projects, and seats.",
    faq: [
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
    metaTitle: "Rejourney vs Datadog Session Replay",
    metaDescription:
      "Compare Rejourney and Datadog Session Replay for product analytics, mobile replay, unlimited events, retention, projects, and teams.",
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
      { feature: "Open-source or self-host path", other: "no" },
      { feature: "React Native and Expo replay path", other: "partial" },
      { feature: "Native ANR replay triage", other: "partial" },
      { feature: "Team/project alert topology", other: "no" },
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
    metaTitle: "Rejourney vs Amplitude Session Replay",
    metaDescription:
      "Compare Rejourney and Amplitude Session Replay for replay-first analytics, mobile context, unlimited events, retention, projects, and seats.",
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
      replayFirst: "no",
      webSessionReplay: "yes",
      mobileSessionReplay: "yes",
      productAnalytics: "yes",
      heatmaps: "partial",
      journeyMaps: "yes",
      crashOrErrorContext: "partial",
      networkApiContext: "partial",
      nativeApiCalls: "partial",
      consoleLogs: "yes",
      privacyMasking: "yes",
    }, [
      { feature: "Native ANR replay triage", other: "no" },
      { feature: "Crash replay context", other: "no" },
      { feature: "API endpoint analytics dashboard", other: "no" },
      { feature: "API degradation email rules", other: "no" },
      { feature: "Open-source or self-host path", other: "no" },
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
      "Amplitude lists a free Starter plan with 10K MTUs, up to 2M events, and Session Replay included.",
      "Amplitude lists Plus starting at $49/mo when paid annually, Growth and Enterprise as custom, and says Growth and Enterprise use custom MTU or event volume.",
      "Amplitude's plan table lists Session Replay monthly sessions as 10,000 on Starter and Plus, 20,000 on Growth with add-ons for more, and 50,000 on Enterprise with add-ons for more; replay retention is listed as 1 month, with add-ons for more on Growth and Enterprise.",
    ],
    officialSources: [
      { label: "Amplitude pricing", href: "https://amplitude.com/pricing" },
      { label: "Amplitude Session Replay docs", href: "https://amplitude.com/docs/session-replay/overview" },
    ],
    pricingIntro:
      "Amplitude publishes MTU/event-volume plan limits and Session Replay session allowances by plan. Rejourney is evaluated as a replay-first analytics workspace with broad included limits for events, retention, projects, and seats.",
    faq: [
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
    metaTitle: "Rejourney vs Mixpanel Session Replay",
    metaDescription:
      "Compare Rejourney and Mixpanel Session Replay for replay-first product analytics, mobile replay, unlimited events, retention, projects, and teams.",
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
      replayFirst: "no",
      webSessionReplay: "yes",
      mobileSessionReplay: "partial",
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
      { feature: "Device and app-version friction boards", other: "no" },
      { feature: "Team/project alert topology", other: "no" },
      { feature: "API degradation email rules", other: "no" },
      { feature: "Open-source or self-host path", other: "no" },
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
    ],
    pricingIntro:
      "Mixpanel publishes event-volume and session-replay allowances by plan. Rejourney is positioned for teams that want replay-first workflows and included limits across events, history, projects, and team access.",
    faq: [
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
    metaTitle: "Rejourney vs Pendo Session Replay",
    metaDescription:
      "Compare Rejourney and Pendo Session Replay for replay-first analytics, mobile UX, unlimited team members, projects, events, and retention.",
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
      replayFirst: "no",
      webSessionReplay: "partial",
      mobileSessionReplay: "partial",
      productAnalytics: "yes",
      heatmaps: "partial",
      journeyMaps: "yes",
      crashOrErrorContext: "no",
      networkApiContext: "no",
      nativeApiCalls: "no",
      consoleLogs: "partial",
      privacyMasking: "yes",
    }, [
      { feature: "API endpoint analytics dashboard", other: "no" },
      { feature: "API degradation email rules", other: "no" },
      { feature: "Open-source or self-host path", other: "no" },
      { feature: "Device and app-version friction boards", other: "no" },
      { feature: "Team/project alert topology", other: "no" },
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
      "Pendo says pricing combines the number of Monthly Active Users tracked and the functionality included in the selected plan.",
      "Pendo's pricing table lists Free, Base, Core, and Ultimate bundles; Free lists 500 monthly active users and paid tiers list custom MAU amounts.",
      "Pendo's table shows analytics and in-app guides included across bundles, while session replays are shown as available for purchase as an add-on on Base and included on Core and Ultimate.",
    ],
    officialSources: [
      { label: "Pendo pricing", href: "https://www.pendo.io/pricing/" },
    ],
    pricingIntro:
      "Pendo publishes bundle and MAU-based pricing guidance, with some capabilities included or available as add-ons by bundle. Rejourney is evaluated as a replay-first analytics and observability workspace with broad included limits.",
    faq: [
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
    metaTitle: "Smartlook Alternatives: Rejourney vs Smartlook",
    metaDescription:
      "Compare Rejourney and Smartlook alternatives before Cisco ends Smartlook. Review session replay, heatmaps, funnels, mobile replay, crash context, pricing, and migration risk.",
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
      replayFirst: "yes",
      webSessionReplay: "yes",
      mobileSessionReplay: "yes",
      productAnalytics: "yes",
      heatmaps: "yes",
      journeyMaps: "partial",
      crashOrErrorContext: "yes",
      networkApiContext: "no",
      nativeApiCalls: "no",
      consoleLogs: "partial",
      privacyMasking: "yes",
    }, [
      { feature: "Active standalone buying path after May 31, 2026", other: "no" },
      { feature: "Replacement workflow independent of Cisco/Splunk migration", other: "no" },
      { feature: "API endpoint analytics dashboard", other: "no" },
      { feature: "API degradation email rules", other: "no" },
      { feature: "Native ANR replay triage", other: "partial" },
      { feature: "Open-source or self-host path", other: "no" },
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
    competitor: "Hotjar",
    badge: "",
    subtitle:
      "Hotjar is a good fit for website heatmaps, recordings, surveys, and feedback. Rejourney is for teams that need those behavior signals tied to product and engineering evidence.",
    metaTitle: "Hotjar Alternatives: Rejourney vs Hotjar",
    metaDescription:
      "Compare Rejourney and Hotjar alternatives for heatmaps, session replay, user journeys, mobile analytics, unlimited events, retention, projects, and teams.",
    keywords: ["hotjar alternatives", "hotjar competitors", "alternative hotjar", "hotjar alternative", "session replay tools", "behavior analytics tools", "heatmap analytics"],
    image: "/images/engineering/churn-mobile-heatmap.png",
    imageAlt: "Mobile app heatmap showing concentrated taps and attention across a coffee app screen",
    proofPoints: ["Heatmaps + replay", "Journeys + analytics", "Mobile + stability context"],
    whyParagraphs: [
      "Hotjar frames Observe around heatmaps and recordings, with Ask and Engage for surveys, feedback, user interviews, and user tests. That is useful when a website team wants classic qualitative UX research tools.",
      "Rejourney is built for product teams that need the session, heatmap, journey, metric, crash, and API context on the same investigation path.",
      "If your team is comparing Hotjar alternatives because recordings alone are not enough, Rejourney keeps replay close to product analytics, mobile context, and technical evidence.",
    ],
    chooseOther: [
      "You mainly need website heatmaps, recordings, surveys, feedback widgets, and user interviews.",
      "Your team already uses Hotjar as a lightweight research layer on marketing pages.",
      "You do not need mobile app replay, crash context, ANRs, API context, or engineering evidence beside sessions.",
    ],
    comparisonRows: comparisonRows({
      replayFirst: "no",
      webSessionReplay: "yes",
      mobileSessionReplay: "no",
      productAnalytics: "partial",
      heatmaps: "yes",
      journeyMaps: "partial",
      crashOrErrorContext: "partial",
      networkApiContext: "no",
      nativeApiCalls: "no",
      consoleLogs: "partial",
      privacyMasking: "yes",
    }, [
      { feature: "Mobile app replay workflow", other: "no" },
      { feature: "Native crash and ANR triage", other: "no" },
      { feature: "API endpoint analytics dashboard", other: "no" },
      { feature: "API degradation email rules", other: "no" },
      { feature: "Open-source or self-host path", other: "no" },
      { feature: "Team/project alert topology", other: "no" },
    ]),
    featureDifferences: [
      {
        feature: "Core job",
        rejourney: "Replay-first analytics for product, support, design, and engineering teams that need behavior plus technical context.",
        other: "Hotjar is strongest as a website behavior research product with heatmaps, recordings, surveys, feedback, and user research products.",
      },
      {
        feature: "From symptom to cause",
        rejourney: "Connects heatmaps to session replay, journeys, product analytics, crashes, ANRs, device context, and API evidence.",
        other: "Best to evaluate when the main goal is website heatmaps, recordings, and feedback workflows rather than mobile and engineering triage.",
      },
      {
        feature: "Product surface",
        rejourney: "Designed for web and mobile apps where friction can come from UI, device, app version, crash, network, or backend behavior.",
        other: "A strong fit for teams that want qualitative website insight and do not need the same depth of mobile app or technical context.",
      },
    ],
    competitorFacts: [
      "Hotjar's pricing page says teams can mix and match products and always get access to the Basic plan on all products.",
      "Hotjar lists Observe as Heatmaps & Recordings, with Basic at $0 and Plus shown at $39 when billed annually at review time.",
      "Hotjar's Observe feature table lists items such as funnels, trends, JavaScript error filtering, Google Analytics filtering, Jira, Slack, Microsoft Teams, Webhooks, and Hotjar API in its plan comparison, so teams should verify which plan gates the exact workflow they need.",
    ],
    officialSources: [
      { label: "Hotjar pricing", href: "https://www.hotjar.com/pricing/" },
      { label: "Hotjar plans docs", href: "https://help.hotjar.com/hc/en-us/articles/360001389973-Hotjar-Plans" },
    ],
    pricingIntro:
      "Hotjar publishes product and plan packaging for Observe, Ask, and Engage. Rejourney is positioned for teams that want heatmaps and replay connected to product analytics, mobile evidence, crashes, API context, unlimited events, analytics retention, projects, and team access.",
    faq: [
      {
        question: "Is Rejourney a Hotjar alternative?",
        answer:
          "Yes. Rejourney is a Hotjar alternative for teams that want heatmaps and session replay plus journeys, product analytics, mobile replay, crash context, and API evidence.",
      },
      {
        question: "When is Hotjar a better fit?",
        answer:
          "Hotjar can be a better fit when the team mainly needs website heatmaps, recordings, surveys, feedback widgets, and user interviews.",
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
    metaTitle: "Fullstory Alternatives: Rejourney vs Fullstory",
    metaDescription:
      "Compare Rejourney with Fullstory alternatives for session replay, mobile analytics, heatmaps, journeys, unlimited events, retention, projects, and teams.",
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
      replayFirst: "yes",
      webSessionReplay: "yes",
      mobileSessionReplay: "partial",
      productAnalytics: "yes",
      heatmaps: "yes",
      journeyMaps: "partial",
      crashOrErrorContext: "partial",
      networkApiContext: "yes",
      nativeApiCalls: "partial",
      consoleLogs: "yes",
      privacyMasking: "yes",
    }, [
      { feature: "Open-source or self-host path", other: "no" },
      { feature: "React Native and Expo replay path", other: "partial" },
      { feature: "Native ANR replay triage", other: "no" },
      { feature: "API endpoint analytics dashboard", other: "partial" },
      { feature: "API degradation email rules", other: "no" },
      { feature: "Team/project alert topology", other: "no" },
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
        rejourney: "Mobile investigation is part of the core Rejourney positioning across React Native, Expo, and iOS paths.",
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
          "Yes. Rejourney supports mobile app investigation workflows across React Native, Expo, and native iOS paths.",
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
