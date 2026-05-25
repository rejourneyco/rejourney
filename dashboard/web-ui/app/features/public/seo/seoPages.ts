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
    href: "/demo/general",
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
  comparisonTitle: `Why teams compare Rejourney with ${config.competitor}`,
  comparisonIntro:'',
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
    path: "/record-user-sessions",
    badge: "Strategy guide",
    eyebrow: "Record user sessions",
    title: "Record user sessions without losing the story",
    subtitle:
      "Capture real user sessions, replay the moment, understand the pattern behind it, and give product, support, and engineering the same evidence.",
    metaTitle: "Record User Sessions | Rejourney",
    metaDescription:
      "Record user sessions on web and mobile with replay, heatmaps, journeys, privacy controls, product analytics, crash context, and lightweight SDKs.",
    keywords: ["record user sessions", "web session replay", "session replay software", "session replay tools", "website session recording", "real user sessions", "user session replay software"],
    image: "/images/session-replay-preview.png",
    imageAlt: "Rejourney user session replay preview with event context",
    proofPoints: ["Replay search", "Heatmaps + journeys", "Crash context"],
    whyTitle: "Recorded sessions should make the user action obvious",
    whyParagraphs: [
      "Teams record user sessions when something important happened but the chart cannot explain it: a funnel dropped, a customer got stuck, a rage click appeared, or support needs proof of what the user saw.",
      "The strongest session replay software makes that investigation fast. Search by behavior, jump into the real user session, inspect the event timeline, and move from one strange moment to the repeated friction points that deserve attention.",
      "Rejourney keeps replay close to heatmaps, user journeys, crashes, ANRs, privacy masking, and network context so a session does not become another isolated clip in a separate dashboard.",
    ],
    chooseOtherTitle: "Choose a heavier suite if...",
    chooseOther: [
      "You need a broad enterprise data warehouse workflow more than replay investigation.",
      "Your team already has mature analytics engineering around another platform.",
      "You do not need native mobile or app stability context.",
    ],
    comparisonTitle: "Record user sessions checklist",
    comparisonIntro:
      "Use this checklist when comparing a session replay tool. The right choice should help product managers, customer support, and engineering work from the same evidence.",
    otherColumnTitle: "Typical replay tool",
    comparisonOther: "partial",
    faq: [
      {
        question: "How do I record user sessions without guessing?",
        answer:
          "Use a session replay SDK that captures the visual session, meaningful user action, event context, privacy controls, and performance impact. Rejourney adds heatmaps, journeys, crash context, and pricing that does not punish useful instrumentation.",
      },
      {
        question: "Can recorded sessions improve user experience?",
        answer:
          "Yes. Product teams use Rejourney to see where onboarding, checkout, search, or activation breaks, then pair those sessions with journeys and heatmaps to improve user experience.",
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
    title: "Mobile session replay for real app behavior",
    subtitle:
      "Watch taps, swipes, screen changes, crashes, ANRs, and slow moments from the user's actual mobile session.",
    metaTitle: "Mobile Session Replay | Rejourney",
    metaDescription:
      "Mobile session replay for iOS, React Native, and Expo with heatmaps, journeys, ANR detection, crash context, and lightweight SDKs.",
    keywords: ["mobile session replay", "mobile app session replay", "React Native session replay", "iOS session replay"],
    image: "/images/heatmaps.png",
    imageAlt: "Rejourney mobile heatmaps and replay analytics dashboard",
    proofPoints: ["React Native + Expo", "Native iOS", "Heatmaps + ANRs"],
    whyTitle: "Mobile behavior needs mobile context",
    whyParagraphs: [
      "Mobile teams debug gestures, screen transitions, device conditions, slow frames, crashes, ANRs, and API calls. A web-only recorder cannot explain those app-specific moments well.",
      "Rejourney brings replay, touch heatmaps, journey maps, crash reporting, ANR signals, and regional API performance into one dashboard so the app experience is visible as it happened.",
      "That makes mobile replay useful beyond bug reports. Product can see hesitation, support can confirm the path, and engineering can inspect the context before asking a user to reproduce anything.",
    ],
    chooseOtherTitle: "Choose a web-first tool if...",
    chooseOther: [
      "Your product is only a website and does not need mobile app context.",
      "You do not need native iOS, Expo, or React Native support.",
      "You are only investigating desktop browser conversion flows.",
    ],
    comparisonTitle: "Mobile replay requires mobile context",
    comparisonIntro:
      "The best mobile replay tool should treat taps, swipes, screens, ANRs, crashes, devices, and network timing as first-class signals.",
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
          "Yes. Seeing the replay before a crash or ANR can reveal the screen, gesture, network state, and user path that led to the issue.",
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
    title: "Web session replay for every strange click",
    subtitle:
      "See how people move through your website, checkout, onboarding, docs, and account flows without reducing the story to pageviews.",
    metaTitle: "Web Session Replay | Rejourney",
    metaDescription:
      "Web session replay for browser apps with product analytics, heatmaps, journeys, network context, console context, and replay search.",
    keywords: ["web session replay", "website session replay", "browser session replay", "web session recording"],
    image: "/images/landing-replay-theater.png",
    imageAlt: "Rejourney web session replay theater showing browser behavior and timeline context",
    proofPoints: ["Browser SDK", "Funnels + journeys", "Network context"],
    whyTitle: "Website friction hides in the moments between clicks",
    whyParagraphs: [
      "A web analytics chart can tell you where people dropped. Web session replay shows the hesitation, repeated clicks, broken UI state, confusing copy, failed request, or dead end that made the drop happen.",
      "Rejourney records browser sessions and connects them to event timelines, journeys, heatmaps, network context, and product analytics so teams can inspect behavior without stitching together separate tools.",
      "That is especially useful for flows that look fine in QA but fail in production: checkout, sign-up, search, dashboards, pricing pages, and support-heavy account screens.",
    ],
    chooseOtherTitle: "Choose pageview analytics alone if...",
    chooseOther: [
      "You only need traffic acquisition and top-level conversion reporting.",
      "You never need to inspect individual user paths or UI states.",
      "You already have a separate workflow for replay, errors, heatmaps, and product analytics.",
    ],
    comparisonTitle: "Web replay should connect behavior to system context",
    comparisonIntro:
      "Browser replay becomes more useful when it includes the surrounding events, requests, journeys, and visual friction that explain the recording.",
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
    path: "/replay-first-mentality",
    badge: "Product thinking",
    eyebrow: "Replay-first mentality",
    title: "Replay-first mentality starts with what the user saw",
    subtitle:
      "A replay-first team uses real sessions as the starting point for product decisions, support escalations, bug triage, and release reviews.",
    metaTitle: "Replay-First Mentality | Rejourney",
    metaDescription:
      "Learn the replay-first mentality for product, support, and engineering teams that want decisions grounded in real user sessions.",
    keywords: ["replay-first mentality", "replay first analytics", "session replay analytics", "user experience evidence"],
    image: "/images/hero-replay-workbench.png",
    imageAlt: "Rejourney replay workbench for replay-first product investigation",
    proofPoints: ["Evidence first", "Shared context", "Faster fixes"],
    whyTitle: "Replay keeps teams honest about the lived experience",
    whyParagraphs: [
      "Dashboards are useful, but they can make the user feel abstract. A replay-first mentality asks the team to watch the experience before deciding what the metric means.",
      "That changes the conversation. Product sees the missed expectation, support sees the exact path, and engineering sees the surrounding signals that made the session fail.",
      "Rejourney is built around that habit: start from a real session, then branch into events, journeys, heatmaps, crashes, ANRs, network context, and analytics.",
    ],
    chooseOtherTitle: "Rely on charts alone if...",
    chooseOther: [
      "Your questions are only about traffic volume and high-level reporting.",
      "Your team never needs to understand individual friction or support context.",
      "You are comfortable making roadmap decisions without watching real sessions.",
    ],
    comparisonTitle: "Replay-first versus dashboard-only work",
    comparisonIntro:
      "Replay-first does not replace analytics. It anchors analytics in observable user behavior so the team knows what the numbers actually mean.",
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
    title: "The importance of open source for session replay data",
    subtitle:
      "Replay data sits close to your product, users, and debugging workflow. Open source gives teams more visibility into the tools that handle it.",
    metaTitle: "Importance of Open Source | Rejourney",
    metaDescription:
      "Why open source matters for session replay, product analytics, self-hosting, privacy, auditability, and long-term observability control.",
    keywords: ["importance of open source", "open source session replay", "self-hosted session replay", "open source analytics"],
    image: "/images/readme-user-journeys.png",
    imageAlt: "Rejourney open-source user journey analytics view",
    proofPoints: ["Source visibility", "Self-hosting", "Data control"],
    whyTitle: "Open source matters when the data is this close to users",
    whyParagraphs: [
      "Session replay and analytics can become part of the nervous system of a product team. They collect behavioral context, debugging signals, and operational evidence that teams rely on every week.",
      "Open source gives technical teams more visibility into how that system works: what the SDK captures, how data moves, what can be self-hosted, and how the platform can evolve if requirements change.",
      "Rejourney pairs that source-visible foundation with a product surface for everyday work: replay, journeys, heatmaps, crashes, ANRs, API context, and analytics in one place.",
    ],
    chooseOtherTitle: "Choose closed SaaS if...",
    chooseOther: [
      "You do not need source visibility, self-hosting, or deployment flexibility.",
      "You prefer buying into a large closed vendor ecosystem.",
      "You are comfortable with opaque product and pricing changes.",
    ],
    comparisonTitle: "Open-source replay should still feel polished",
    comparisonIntro:
      "The best open-source tools combine operational control with a product experience that PMs, support, design, and engineering can use every day.",
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
    title: "What is session replay?",
    subtitle:
      "Session replay lets teams watch how real users experience an app or website, then inspect the events, errors, and journeys around that moment.",
    metaTitle: "What Is Session Replay? | Rejourney",
    metaDescription:
      "Learn what session replay is, how it works, and how Rejourney uses replay with analytics, heatmaps, journeys, crashes, and network context.",
    keywords: ["what is session replay", "how does session replay work", "session replay analytics", "what are session replay tools"],
    image: "/images/landing-replay-theater.png",
    imageAlt: "Rejourney replay theater explaining session replay",
    proofPoints: ["Behavior context", "Debugging evidence", "Product insight"],
    whyTitle: "Session replay turns vague user feedback into evidence",
    whyParagraphs: [
      "Session replay captures the meaningful parts of a user's experience so a team can reconstruct what happened. Instead of asking a user to describe a bug, the team can watch the confusing step, failed tap, slow screen, or broken checkout path.",
      "The best replay tools do more than playback. They pair the session with product events, journeys, heatmaps, errors, device context, and network calls so teams understand both the user behavior and the system context.",
      "Rejourney uses session replay as the center of the workflow for web and mobile teams. It is built for product, support, and engineering teams that want one shared view of the user experience.",
    ],
    chooseOtherTitle: "Use aggregate analytics alone if...",
    chooseOther: [
      "You only need high-level traffic or acquisition reporting.",
      "You do not need to see individual user friction.",
      "You never debug bugs, UX issues, or support escalations from real sessions.",
    ],
    comparisonTitle: "Session replay versus analytics alone",
    comparisonIntro:
      "Analytics answers what changed. Replay helps explain why it changed by showing the lived user experience.",
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
      "Move from vague feedback and aggregate charts to actual sessions, journeys, heatmaps, events, crashes, and API context.",
    metaTitle: "How to See What Your Users Do | Rejourney",
    metaDescription:
      "Learn how to see what users do in your app or website with session replay, heatmaps, journeys, events, crash context, and product analytics.",
    keywords: ["how to see what users do", "see what users do on website", "user behavior analytics", "session replay"],
    image: "/images/readme-general-demo.png",
    imageAlt: "Rejourney dashboard showing user behavior analytics and replay context",
    proofPoints: ["Watch sessions", "Map journeys", "Find friction"],
    whyTitle: "Seeing user behavior starts with the actual session",
    whyParagraphs: [
      "Surveys, tickets, and dashboards all help, but they can leave teams guessing about the moment that caused confusion. Session replay gives you the user's real path through the product.",
      "From there, the surrounding context matters. Heatmaps show where attention clusters, journeys show the paths people take, events show the sequence, and crashes or failed requests explain when the system shaped the experience.",
      "Rejourney combines those layers so teams can move from 'users are dropping' to 'this is the screen, interaction, and technical context that caused the drop.'",
    ],
    chooseOtherTitle: "Stay with indirect signals if...",
    chooseOther: [
      "You only need periodic qualitative research and broad trend reporting.",
      "Your product does not need support, debugging, or conversion investigation.",
      "You are comfortable making UX decisions without watching real behavior.",
    ],
    comparisonTitle: "Direct observation versus guessing",
    comparisonIntro:
      "The best behavior workflow combines direct session evidence with aggregate analytics so teams can see both the individual moment and the repeated pattern.",
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
    title: "Be your users for five minutes before you ship",
    subtitle:
      "Watch the product from the user's side so roadmap debates, bug triage, and design decisions stay grounded in lived experience.",
    metaTitle: "Be Your Users | Rejourney",
    metaDescription:
      "Be your users by watching real sessions, reviewing journeys, inspecting friction, and grounding product decisions in actual user behavior.",
    keywords: ["be your users", "watch user sessions", "user experience analytics", "session replay product teams"],
    image: "/images/user-journeys.png",
    imageAlt: "Rejourney user journeys view for understanding real product paths",
    proofPoints: ["User empathy", "Real sessions", "Shared reviews"],
    whyTitle: "User empathy gets sharper when the team watches real sessions",
    whyParagraphs: [
      "It is easy to talk about users as segments, cohorts, or tickets. Watching a real session makes the product feel concrete again: the hesitation, the missed affordance, the repeated tap, the path that seemed obvious only to the team.",
      "Rejourney helps teams build that habit without turning it into theater. Pick a session, watch the path, inspect the events, then use journeys and heatmaps to see whether the same friction repeats.",
      "The result is a product conversation with better evidence and less guessing. Teams can decide what to fix because they have seen the experience from the user's side.",
    ],
    chooseOtherTitle: "Skip session review if...",
    chooseOther: [
      "Your product decisions do not depend on understanding user friction.",
      "Your team already observes real sessions through another workflow.",
      "You only need backend telemetry and do not need behavioral context.",
    ],
    comparisonTitle: "Empathy should be paired with evidence",
    comparisonIntro:
      "Being your users is not a slogan. It is a product habit: observe real behavior, connect it to data, and make the next decision with clearer context.",
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
      "PostHog is a broad product analytics suite. Rejourney is the replay-first alternative for teams that want web and mobile session evidence, simple limits, and faster investigation workflows.",
    metaTitle: "Rejourney vs PostHog Session Replay",
    metaDescription:
      "Compare Rejourney with PostHog session replay for web and mobile replay, unlimited events, retention, projects, team members, and pricing.",
    keywords: ["posthog session replay", "session replay posthog", "posthog alternatives", "posthog react native session replay"],
    image: "/images/landing-replay-theater.png",
    imageAlt: "Rejourney replay dashboard as a PostHog session replay alternative",
    proofPoints: ["Replay-first analytics", "Mobile + web", "Simple included limits"],
    whyParagraphs: [
      "PostHog publicly positions PostHog Cloud as a multi-product platform with product analytics, web analytics, session replay, feature flags, experiments, surveys, data warehouse, error tracking, logs, and more. That can be a good fit if you want a broad product OS.",
      "Rejourney is narrower by design. It centers the workflow on replay, heatmaps, journeys, crashes, ANRs, network context, and product analytics so teams can move from a symptom to the exact user experience faster.",
      "For teams comparing PostHog session replay costs and limits, the practical difference to evaluate is quota shape: PostHog publishes usage-based quotas and rates, while Rejourney emphasizes unlimited events, analytics retention, projects, and team members in its own plans.",
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
      "Sentry is excellent for error monitoring. Rejourney is the session replay alternative when product behavior, journeys, heatmaps, and team-wide analytics matter as much as exceptions.",
    metaTitle: "Rejourney vs Sentry Session Replay",
    metaDescription:
      "Compare Rejourney and Sentry Session Replay for replay, product analytics, heatmaps, journeys, unlimited events, and mobile debugging.",
    keywords: ["sentry session replay", "sentry self hosted session replay", "session replay for sentry", "sentry alternatives"],
    image: "/images/anr-issues.png",
    imageAlt: "Rejourney crash and ANR replay context as a Sentry Session Replay alternative",
    proofPoints: ["Replay + product analytics", "Heatmaps + journeys", "Crash + API context"],
    whyParagraphs: [
      "Sentry's public pricing and billing docs center the product around developer monitoring categories such as errors, tracing, logs, replays, monitors, profiling, and attachments. That is a strong fit when your main workflow is engineering diagnostics.",
      "Rejourney connects replay with product analytics, heatmaps, journeys, crashes, ANRs, network context, and team collaboration. That makes it useful for support, product, design, and engineering in the same workspace.",
      "If your team wants replay to explain both bugs and behavior, Rejourney gives you a focused path with unlimited events, analytics retention, projects, and team members.",
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
      "Datadog is a broad observability platform. Rejourney is the focused alternative for product teams that need replay, heatmaps, journeys, and app behavior without enterprise-suite complexity.",
    metaTitle: "Rejourney vs Datadog Session Replay",
    metaDescription:
      "Compare Rejourney and Datadog Session Replay for product analytics, mobile replay, unlimited events, retention, projects, and teams.",
    keywords: ["datadog session replay", "datadog rum session replay", "datadog alternatives", "session replay tools"],
    image: "/images/geo-analytics.png",
    imageAlt: "Rejourney geo analytics and replay context as a Datadog alternative",
    proofPoints: ["Product-first UX", "Replay + API context", "Mobile + web"],
    whyParagraphs: [
      "Datadog's public pricing page places Session Replay inside Real User Monitoring and Session Replay, alongside the broader Datadog observability catalog. That is useful when replay should sit inside an existing observability stack.",
      "Rejourney centers the experience on session replay, journeys, heatmaps, crashes, ANRs, API context, and product analytics. It gives product and engineering the same evidence without starting from a large observability suite.",
      "For teams that mainly want user-session evidence, Rejourney emphasizes replay-backed product workflows with unlimited events, analytics retention, team members, and projects.",
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
      "Amplitude is a mature product analytics platform. Rejourney is the replay-first alternative when the team needs session evidence, mobile context, and simple included limits.",
    metaTitle: "Rejourney vs Amplitude Session Replay",
    metaDescription:
      "Compare Rejourney and Amplitude Session Replay for replay-first analytics, mobile context, unlimited events, retention, projects, and seats.",
    keywords: ["amplitude session replay", "amplitude session replay pricing", "amplitude alternatives", "product analytics session replay"],
    image: "/images/growth-engines.png",
    imageAlt: "Rejourney growth analytics as an Amplitude session replay alternative",
    proofPoints: ["Replay-first analytics", "Mobile UX evidence", "Crash + API context"],
    whyParagraphs: [
      "Amplitude's public pricing page presents a broad digital analytics platform with product analytics, session replay, heatmaps, experimentation, activation, AI feedback, and related products. That can be a strong fit for mature analytics programs.",
      "Rejourney starts from the session and surrounds it with journeys, heatmaps, crashes, network context, retention signals, and product analytics. That helps teams move from a chart anomaly to the moment that caused it.",
      "Unlimited events, analytics retention, projects, and team members make Rejourney easier to open up across the team without turning every new event or collaborator into a planning question.",
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
      "Mixpanel is known for event analytics. Rejourney is the alternative for teams that want replay, journeys, heatmaps, crashes, and unlimited team access together.",
    metaTitle: "Rejourney vs Mixpanel Session Replay",
    metaDescription:
      "Compare Rejourney and Mixpanel Session Replay for replay-first product analytics, mobile replay, unlimited events, retention, projects, and teams.",
    keywords: ["mixpanel session replay", "mixpanel alternatives", "product analytics session replay", "session replay software"],
    image: "/images/readme-user-journeys.png",
    imageAlt: "Rejourney journey analytics as a Mixpanel session replay alternative",
    proofPoints: ["Journeys + replay", "Crash + API context", "Shared evidence"],
    whyParagraphs: [
      "Mixpanel's public pricing page is organized around product analytics plans, monthly event limits, saved reports, seats, session replays, governance, support, and add-ons. That is a strong fit when event analytics is the core workflow.",
      "Rejourney puts replay beside events, journey maps, heatmaps, crashes, API context, and device context. That makes the workflow practical for PMs, designers, support, and developers.",
      "If the team wants to invite everyone into the evidence, Rejourney's unlimited team members and projects make shared investigation easier.",
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
      "Pendo is built for product adoption and in-app guidance. Rejourney is the replay-first alternative for teams that want user evidence, mobile context, and observability in one place.",
    metaTitle: "Rejourney vs Pendo Session Replay",
    metaDescription:
      "Compare Rejourney and Pendo Session Replay for replay-first analytics, mobile UX, unlimited team members, projects, events, and retention.",
    keywords: ["pendo session replay", "pendo alternatives", "product adoption analytics", "session replay tools"],
    image: "/images/team-alerts.png",
    imageAlt: "Rejourney team alerts and shared replay workspace as a Pendo alternative",
    proofPoints: ["Replay-led UX", "Team-wide workspace", "Crash + API context"],
    whyParagraphs: [
      "Pendo's public pricing page is organized around software experience management bundles, monthly active users, analytics, in-app guides, session replays, discovery, sentiment, journey orchestration, and related capabilities.",
      "Rejourney combines replay, heatmaps, journeys, product analytics, crashes, ANRs, and network context, so the product team and engineering team can work from the same evidence.",
      "Unlimited events, analytics retention, projects, and team members help teams roll replay evidence out broadly without making access a budget negotiation.",
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
      "Smartlook is entering Cisco end-of-sale and end-of-life. Rejourney is the Smartlook alternative for teams that still need replay, heatmaps, journeys, mobile evidence, and technical context in one focused workflow.",
    metaTitle: "Smartlook Alternatives: Rejourney vs Smartlook",
    metaDescription:
      "Compare Rejourney and Smartlook alternatives before Cisco ends Smartlook. Review session replay, heatmaps, funnels, mobile replay, crash context, pricing, and migration risk.",
    keywords: ["smartlook alternatives", "smartlook alternative", "smartlook replacement", "smartlook end of life", "smartlook pricing", "session replay tools", "mobile session replay", "heatmap analytics"],
    image: "/images/engineering/smartlook-alternatives-replay-detail.png",
    imageAlt: "Rejourney replay workbench showing mobile session replay, API calls, timeline events, and session context",
    proofPoints: ["Cisco EOL timing", "Replay + heatmaps", "Mobile + technical context"],
    whyParagraphs: [
      "Cisco's official end-of-sale notice says Smartlook.com reaches end of sale on May 31, 2026, with the last date to renew or add to an existing subscription on August 31, 2026 and last support on August 31, 2027.",
      "Smartlook historically served teams that needed recordings, heatmaps, events, funnels, crash reports, and web/mobile behavior analytics. The migration question is whether teams still need that product and UX evidence layer, or whether they want to move into Cisco's listed migration product, Splunk Observability Cloud - RUM+DXA.",
      "Rejourney is built for teams that want the session, heatmap, journey, metric, crash, ANR, API call, and device context in the same investigation path after Smartlook stops being the center of the workflow.",
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
      "Hotjar is known for heatmaps, recordings, surveys, and feedback. Rejourney is the Hotjar alternative for teams that want replay, heatmaps, journeys, mobile evidence, product analytics, and technical context together.",
    metaTitle: "Hotjar Alternatives: Rejourney vs Hotjar",
    metaDescription:
      "Compare Rejourney and Hotjar alternatives for heatmaps, session replay, user journeys, mobile analytics, unlimited events, retention, projects, and teams.",
    keywords: ["hotjar alternatives", "hotjar competitors", "alternative hotjar", "hotjar alternative", "session replay tools", "behavior analytics tools", "heatmap analytics"],
    image: "/images/engineering/churn-mobile-heatmap.png",
    imageAlt: "Mobile app heatmap showing concentrated taps and attention across a coffee app screen",
    proofPoints: ["Heatmaps + replay", "Journeys + analytics", "Mobile + stability context"],
    whyParagraphs: [
      "Hotjar's official pricing page frames Observe around heatmaps and recordings, with additional Ask and Engage products for surveys, feedback, user interviews, and user tests. That is useful when a website team wants classic qualitative UX research tools.",
      "Rejourney is built for product teams that need the session, the heatmap, the journey, the metric, the crash, and the API context in the same investigation path.",
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
      "Fullstory is a mature digital experience platform. Rejourney is the leaner replay-first alternative with simple limits, mobile context, and open-source/self-hosting paths.",
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
      "For teams that want source visibility or self-hosting paths, Rejourney also offers an open-source foundation.",
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
