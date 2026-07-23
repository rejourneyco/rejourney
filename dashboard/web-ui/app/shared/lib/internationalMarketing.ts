export type MarketingLocaleCode =
  | "en"
  | "ar"
  | "es"
  | "tr"
  | "pt-br"
  | "de"
  | "fr"
  | "hi"
  | "id"
  | "ja"
  | "ko"
  | "zh-cn"
  | "it"
  | "nl"
  | "pl"
  | "pt"
  | "ru"
  | "vi";

export type MarketingFeatureCopy = {
  title: string;
  highlight: string;
  badge: string;
};

export type MarketingLocale = {
  code: MarketingLocaleCode;
  slug: string;
  path: string;
  label: string;
  nativeLabel: string;
  languageTag: string;
  ogLocale: string;
  dir: "ltr" | "rtl";
  metaTitle: string;
  metaDescription: string;
  keywords: string[];
  mainAriaLabel: string;
  hero: {
    headlinePrimary: string;
    headlineSecondary: string;
    primaryCta: string;
    secondaryCta: string;
  };
  featuresHeading: string;
  featuresEyebrow: string;
  features: MarketingFeatureCopy[];
};

export const SITE_URL = "https://rejourney.co";

const englishFeatures: MarketingFeatureCopy[] = [
  { title: "Session", highlight: "Replay", badge: "Replay" },
  { title: "Incident", highlight: "Stream", badge: "Live" },
  { title: "Crash", highlight: "Detection", badge: "ANR" },
  { title: "Journey", highlight: "Maps", badge: "Flows" },
  { title: "Click", highlight: "Heatmaps", badge: "Taps" },
  { title: "Global", highlight: "Stability", badge: "Geo" },
  { title: "Growth", highlight: "Loops", badge: "Retention" },
];

export const MARKETING_LOCALES: Record<MarketingLocaleCode, MarketingLocale> = {
  en: {
    code: "en",
    slug: "",
    path: "/",
    label: "English",
    nativeLabel: "English",
    languageTag: "en-US",
    ogLocale: "en_US",
    dir: "ltr",
    metaTitle: "Revenue Leak Prediction for Web and Mobile Apps | Rejourney",
    metaDescription:
      "Predict checkout, onboarding, and subscription revenue leaks in web and mobile apps with replay-backed analytics for churn, paywalls, and failed flows.",
    keywords: [
      "revenue leak prediction",
      "revenue leak detection",
      "AI revenue leak prediction",
      "checkout revenue leak prediction",
      "checkout funnel leak detection",
      "checkout analytics",
      "checkout drop-off analytics",
      "onboarding leak prediction",
      "onboarding analytics",
      "onboarding drop-off analytics",
      "mobile onboarding analytics",
      "subscription analytics",
      "subscription churn analytics",
      "subscription revenue analytics",
      "subscription leak prediction",
      "subscription churn prediction",
      "paywall analytics",
      "paywall conversion analytics",
      "trial conversion analytics",
      "payment failure analytics",
      "web app revenue leaks",
      "mobile app revenue leaks",
      "revenue leak analytics",
      "funnel leak prediction",
      "session replay revenue leaks",
      "web session replay",
      "mobile session replay",
      "mobile app analytics",
      "web app analytics",
      "churn risk prediction",
      "payment failure prediction",
    ],
    mainAriaLabel: "Rejourney - Revenue Leak Prediction for Web and Mobile Apps",
    hero: {
      headlinePrimary: "Lightweight Session Replay",
      headlineSecondary: "Fix revenue leaks",
      primaryCta: "Find my leaks",
      secondaryCta: "Watch live demo",
    },
    featuresHeading: "Web and mobile stack.",
    featuresEyebrow: "Eight signals",
    features: englishFeatures,
  },
  ar: {
    code: "ar",
    slug: "ar",
    path: "/ar",
    label: "Arabic",
    nativeLabel: "العربية",
    languageTag: "ar",
    ogLocale: "ar_AR",
    dir: "rtl",
    metaTitle: "Rejourney: Session Replay للويب والجوال",
    metaDescription:
      "Session replay وتحليلات مفتوحة المصدر للويب وتطبيقات iOS وAndroid وFlutter وExpo وReact Native مع إعادة تشغيل الجلسات، الأعطال، الخرائط الحرارية، ورحلات المستخدم.",
    keywords: [
      "session replay عربي",
      "session replay للويب",
      "session replay للجوال",
      "تحليلات الويب مفتوحة المصدر",
      "تحليلات تطبيقات الجوال",
      "إعادة تشغيل الجلسات",
      "مراقبة الويب والجوال",
      "خرائط حرارية للويب والجوال",
      "تقارير الأعطال",
      "تحليلات React Native",
      "تحليلات JavaScript SDK",
      "استضافة ذاتية للتحليلات",
    ],
    mainAriaLabel: "Rejourney - تحليلات الويب وتطبيقات الجوال مفتوحة المصدر",
    hero: {
      headlinePrimary: "تحليلات تبدأ بالإعادة",
      headlineSecondary: "SDK خفيف الوزن",
      primaryCta: "ابدأ مجانًا",
      secondaryCta: "استضافة ذاتية",
    },
    featuresHeading: "منصة الويب والجوال.",
    featuresEyebrow: "ثماني إشارات",
    features: [
      { title: "إعادة", highlight: "الجلسات", badge: "إعادة" },
      { title: "تدفق", highlight: "الحوادث", badge: "مباشر" },
      { title: "كشف", highlight: "الأعطال", badge: "ANR" },
      { title: "خرائط", highlight: "الرحلة", badge: "مسارات" },
      { title: "خرائط", highlight: "اللمس", badge: "نقرات" },
      { title: "استقرار", highlight: "عالمي", badge: "جغرافي" },
      { title: "حلقات", highlight: "النمو", badge: "احتفاظ" },
      { title: "تنبيهات", highlight: "الفريق", badge: "فرق" },
    ],
  },
  es: {
    code: "es",
    slug: "es",
    path: "/es",
    label: "Spanish",
    nativeLabel: "Español",
    languageTag: "es",
    ogLocale: "es_ES",
    dir: "ltr",
    metaTitle: "Rejourney: session replay web y movil",
    metaDescription:
      "Session replay y analítica open source para web, iOS, Android, Flutter, Expo y React Native con reproducción de sesiones, crashes, mapas de calor y un SDK ligero.",
    keywords: [
      "session replay español",
      "session replay web",
      "session replay móvil",
      "analítica web open source",
      "analítica móvil",
      "reproducción de sesiones web",
      "observabilidad web y móvil",
      "mapas de calor web y móvil",
      "reporte de crashes",
      "analítica React Native",
      "analítica JavaScript SDK",
      "analítica self-hosted",
    ],
    mainAriaLabel: "Rejourney - Analítica web y móvil open source",
    hero: {
      headlinePrimary: "Analítica replay-first",
      headlineSecondary: "SDK ligero",
      primaryCta: "Empieza gratis",
      secondaryCta: "Autohospedar",
    },
    featuresHeading: "Stack web y móvil.",
    featuresEyebrow: "Ocho señales",
    features: [
      { title: "Replay", highlight: "de sesión", badge: "Replay" },
      { title: "Flujo", highlight: "de incidentes", badge: "En vivo" },
      { title: "Detección", highlight: "de crashes", badge: "ANR" },
      { title: "Mapas", highlight: "de journey", badge: "Flujos" },
      { title: "Mapas", highlight: "de calor", badge: "Taps" },
      { title: "Estabilidad", highlight: "global", badge: "Geo" },
      { title: "Bucles", highlight: "de crecimiento", badge: "Retención" },
      { title: "Alertas", highlight: "de equipo", badge: "Equipos" },
    ],
  },
  tr: {
    code: "tr",
    slug: "tr",
    path: "/tr",
    label: "Turkish",
    nativeLabel: "Türkçe",
    languageTag: "tr",
    ogLocale: "tr_TR",
    dir: "ltr",
    metaTitle: "Rejourney: Web ve mobil session replay analitigi",
    metaDescription:
      "Web, iOS, Android, Flutter, Expo ve React Native uygulamaları için open source analytics, session replay, çökme izleme, ısı haritaları, kullanıcı yolculukları ve hafif SDK.",
    keywords: [
      "session replay türkçe",
      "web session replay",
      "mobil session replay",
      "açık kaynak web analitik",
      "mobil analitik",
      "oturum tekrarı",
      "web ve mobil gözlemlenebilirlik",
      "web ve mobil ısı haritaları",
      "çökme raporlama",
      "React Native analitik",
      "JavaScript SDK analitik",
      "self-hosted analitik",
    ],
    mainAriaLabel: "Rejourney - Açık kaynak web ve mobil uygulama analitiği",
    hero: {
      headlinePrimary: "Replay-oncelikli analitik",
      headlineSecondary: "Hafif SDK",
      primaryCta: "Ücretsiz başla",
      secondaryCta: "Kendin barındır",
    },
    featuresHeading: "Web ve mobil stack.",
    featuresEyebrow: "Sekiz sinyal",
    features: [
      { title: "Oturum", highlight: "Replay", badge: "Replay" },
      { title: "Olay", highlight: "Akışı", badge: "Canlı" },
      { title: "Çökme", highlight: "Algılama", badge: "ANR" },
      { title: "Yolculuk", highlight: "Haritası", badge: "Akışlar" },
      { title: "Dokunma", highlight: "Isı Haritası", badge: "Tap" },
      { title: "Küresel", highlight: "Stabilite", badge: "Geo" },
      { title: "Büyüme", highlight: "Döngüleri", badge: "Tutma" },
      { title: "Ekip", highlight: "Uyarıları", badge: "Ekipler" },
    ],
  },
  "pt-br": {
    code: "pt-br",
    slug: "pt-br",
    path: "/pt-br",
    label: "Portuguese",
    nativeLabel: "Português do Brasil",
    languageTag: "pt-BR",
    ogLocale: "pt_BR",
    dir: "ltr",
    metaTitle: "Rejourney: session replay web e mobile",
    metaDescription:
      "Analytics open source para web, iOS, Android, Flutter, Expo e React Native com replay de sessão, crashes, mapas de calor, jornadas e SDK leve.",
    keywords: [
      "analytics web open source",
      "session replay web",
      "replay de sessão mobile",
      "analytics mobile",
      "observabilidade web e mobile",
      "mapas de calor web e mobile",
      "relatório de crashes",
      "analytics React Native",
      "analytics JavaScript SDK",
      "analytics self-hosted",
    ],
    mainAriaLabel: "Rejourney - Analytics web e mobile open source",
    hero: {
      headlinePrimary: "Analytics replay-first",
      headlineSecondary: "SDK leve",
      primaryCta: "Comece grátis",
      secondaryCta: "Hospede você mesmo",
    },
    featuresHeading: "Stack web e mobile.",
    featuresEyebrow: "Oito sinais",
    features: [
      { title: "Replay", highlight: "de sessão", badge: "Replay" },
      { title: "Fluxo", highlight: "de incidentes", badge: "Ao vivo" },
      { title: "Detecção", highlight: "de crashes", badge: "ANR" },
      { title: "Mapas", highlight: "de jornada", badge: "Fluxos" },
      { title: "Mapas", highlight: "de calor", badge: "Toques" },
      { title: "Estabilidade", highlight: "global", badge: "Geo" },
      { title: "Loops", highlight: "de crescimento", badge: "Retenção" },
      { title: "Alertas", highlight: "de equipe", badge: "Times" },
    ],
  },
  de: {
    code: "de",
    slug: "de",
    path: "/de",
    label: "German",
    nativeLabel: "Deutsch",
    languageTag: "de",
    ogLocale: "de_DE",
    dir: "ltr",
    metaTitle: "Rejourney: Web- und Mobile-Session-Replay",
    metaDescription:
      "Open-Source-Analytics für Web, iOS, Android, Flutter, Expo und React Native mit Session Replay, Crash-Reporting, Heatmaps, Journeys und leichtem SDK.",
    keywords: [
      "Open Source Web Analytics",
      "Web Session Replay",
      "Mobile Session Replay",
      "Web und Mobile Observability",
      "Web und Mobile Heatmaps",
      "Crash Reporting",
      "React Native Analytics",
      "JavaScript SDK Analytics",
      "Self-Hosted Analytics",
    ],
    mainAriaLabel: "Rejourney - Open-Source-Web- und Mobile-App-Analytics",
    hero: {
      headlinePrimary: "Replay-First Analytics",
      headlineSecondary: "Leichtes SDK",
      primaryCta: "Kostenlos starten",
      secondaryCta: "Selbst hosten",
    },
    featuresHeading: "Web- und Mobile-Stack.",
    featuresEyebrow: "Acht Signale",
    features: [
      { title: "Session", highlight: "Replay", badge: "Replay" },
      { title: "Incident", highlight: "Stream", badge: "Live" },
      { title: "Crash", highlight: "Erkennung", badge: "ANR" },
      { title: "Journey", highlight: "Maps", badge: "Flows" },
      { title: "Touch", highlight: "Heatmaps", badge: "Taps" },
      { title: "Globale", highlight: "Stabilität", badge: "Geo" },
      { title: "Growth", highlight: "Loops", badge: "Retention" },
    ],
  },
  fr: {
    code: "fr",
    slug: "fr",
    path: "/fr",
    label: "French",
    nativeLabel: "Français",
    languageTag: "fr",
    ogLocale: "fr_FR",
    dir: "ltr",
    metaTitle: "Rejourney: session replay web et mobile",
    metaDescription:
      "Analytics open source pour le web, iOS, Android, Flutter, Expo et React Native avec replay de session, crashs, heatmaps, parcours utilisateur et SDK léger.",
    keywords: [
      "analytics web open source",
      "replay de session web",
      "replay de session mobile",
      "analytics mobile",
      "observabilité web et mobile",
      "heatmaps web et mobile",
      "rapport de crash",
      "analytics React Native",
      "analytics JavaScript SDK",
      "analytics self-hosted",
    ],
    mainAriaLabel: "Rejourney - Analytics web et mobile open source",
    hero: {
      headlinePrimary: "Analytics replay-first",
      headlineSecondary: "SDK léger",
      primaryCta: "Démarrer gratuitement",
      secondaryCta: "Auto-héberger",
    },
    featuresHeading: "Stack web et mobile.",
    featuresEyebrow: "Huit signaux",
    features: [
      { title: "Replay", highlight: "de session", badge: "Replay" },
      { title: "Flux", highlight: "d'incidents", badge: "Live" },
      { title: "Détection", highlight: "de crash", badge: "ANR" },
      { title: "Cartes", highlight: "de parcours", badge: "Flux" },
      { title: "Heatmaps", highlight: "tactiles", badge: "Taps" },
      { title: "Stabilité", highlight: "globale", badge: "Géo" },
      { title: "Boucles", highlight: "de croissance", badge: "Rétention" },
      { title: "Alertes", highlight: "d'équipe", badge: "Équipes" },
    ],
  },
  hi: {
    code: "hi",
    slug: "hi",
    path: "/hi",
    label: "Hindi",
    nativeLabel: "हिन्दी",
    languageTag: "hi",
    ogLocale: "hi_IN",
    dir: "ltr",
    metaTitle: "Rejourney: web और mobile session replay",
    metaDescription:
      "वेब, iOS, Android, Flutter, Expo और React Native ऐप्स के लिए ओपन-सोर्स एनालिटिक्स: सेशन रीप्ले, क्रैश, हीटमैप, यूजर जर्नी और हल्का SDK.",
    keywords: [
      "ओपन सोर्स वेब एनालिटिक्स",
      "वेब सेशन रीप्ले",
      "मोबाइल सेशन रीप्ले",
      "वेब और मोबाइल ऑब्जर्वेबिलिटी",
      "वेब और मोबाइल हीटमैप",
      "क्रैश रिपोर्टिंग",
      "React Native analytics",
      "JavaScript SDK analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - ओपन-सोर्स वेब और मोबाइल ऐप एनालिटिक्स",
    hero: {
      headlinePrimary: "रीप्ले-फर्स्ट एनालिटिक्स",
      headlineSecondary: "हल्का SDK",
      primaryCta: "मुफ्त शुरू करें",
      secondaryCta: "स्वयं होस्ट करें",
    },
    featuresHeading: "वेब और मोबाइल स्टैक.",
    featuresEyebrow: "आठ संकेत",
    features: [
      { title: "सेशन", highlight: "रीप्ले", badge: "रीप्ले" },
      { title: "इंसिडेंट", highlight: "स्ट्रीम", badge: "लाइव" },
      { title: "क्रैश", highlight: "डिटेक्शन", badge: "ANR" },
      { title: "जर्नी", highlight: "मैप्स", badge: "फ्लो" },
      { title: "टच", highlight: "हीटमैप", badge: "टैप" },
      { title: "ग्लोबल", highlight: "स्टेबिलिटी", badge: "Geo" },
      { title: "ग्रोथ", highlight: "लूप्स", badge: "रिटेंशन" },
      { title: "टीम", highlight: "अलर्ट", badge: "टीम" },
    ],
  },
  id: {
    code: "id",
    slug: "id",
    path: "/id",
    label: "Indonesian",
    nativeLabel: "Bahasa Indonesia",
    languageTag: "id",
    ogLocale: "id_ID",
    dir: "ltr",
    metaTitle: "Rejourney: session replay web dan mobile",
    metaDescription:
      "Analitik open source untuk web, iOS, Android, Flutter, Expo, dan React Native dengan session replay, crash, heatmap, journey, dan SDK ringan.",
    keywords: [
      "analitik web open source",
      "session replay web",
      "session replay mobile",
      "analitik mobile",
      "observability web dan mobile",
      "heatmap web dan mobile",
      "crash reporting",
      "analitik React Native",
      "analitik JavaScript SDK",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - Analitik aplikasi web dan mobile open source",
    hero: {
      headlinePrimary: "Analitik replay-first",
      headlineSecondary: "SDK ringan",
      primaryCta: "Mulai gratis",
      secondaryCta: "Self-host",
    },
    featuresHeading: "Stack web dan mobile.",
    featuresEyebrow: "Delapan sinyal",
    features: [
      { title: "Session", highlight: "Replay", badge: "Replay" },
      { title: "Incident", highlight: "Stream", badge: "Live" },
      { title: "Crash", highlight: "Detection", badge: "ANR" },
      { title: "Journey", highlight: "Maps", badge: "Flows" },
      { title: "Touch", highlight: "Heatmap", badge: "Tap" },
      { title: "Stabilitas", highlight: "Global", badge: "Geo" },
      { title: "Growth", highlight: "Loops", badge: "Retensi" },
    ],
  },
  ja: {
    code: "ja",
    slug: "ja",
    path: "/ja",
    label: "Japanese",
    nativeLabel: "日本語",
    languageTag: "ja",
    ogLocale: "ja_JP",
    dir: "ltr",
    metaTitle: "Rejourney: Web・モバイル session replay",
    metaDescription:
      "Web、iOS、Android、Flutter、Expo、React Native向けの軽量SDKで、セッションリプレイ、クラッシュ、ヒートマップ、ジャーニーを扱うオープンソース分析基盤。",
    keywords: [
      "オープンソース Web分析",
      "Web セッションリプレイ",
      "モバイル セッションリプレイ",
      "Webとモバイル Observability",
      "Webとモバイル ヒートマップ",
      "クラッシュレポート",
      "React Native analytics",
      "JavaScript SDK analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - オープンソースのWeb・モバイルアプリ分析",
    hero: {
      headlinePrimary: "リプレイ優先分析",
      headlineSecondary: "軽量SDK",
      primaryCta: "無料で始める",
      secondaryCta: "セルフホスト",
    },
    featuresHeading: "Web・モバイル基盤。",
    featuresEyebrow: "8つのシグナル",
    features: [
      { title: "セッション", highlight: "リプレイ", badge: "Replay" },
      { title: "インシデント", highlight: "ストリーム", badge: "Live" },
      { title: "クラッシュ", highlight: "検知", badge: "ANR" },
      { title: "ジャーニー", highlight: "マップ", badge: "Flows" },
      { title: "タッチ", highlight: "ヒートマップ", badge: "Taps" },
      { title: "グローバル", highlight: "安定性", badge: "Geo" },
      { title: "成長", highlight: "ループ", badge: "Retention" },
    ],
  },
  ko: {
    code: "ko",
    slug: "ko",
    path: "/ko",
    label: "Korean",
    nativeLabel: "한국어",
    languageTag: "ko",
    ogLocale: "ko_KR",
    dir: "ltr",
    metaTitle: "Rejourney: 웹 및 모바일 session replay",
    metaDescription:
      "웹, iOS, Android, Flutter, Expo, React Native 앱을 위한 오픈소스 분석. 세션 리플레이, 크래시, 히트맵, 사용자 여정, 가벼운 SDK를 제공합니다.",
    keywords: [
      "오픈소스 웹 분석",
      "웹 세션 리플레이",
      "모바일 세션 리플레이",
      "웹 및 모바일 옵저버빌리티",
      "웹 및 모바일 히트맵",
      "크래시 리포팅",
      "React Native analytics",
      "JavaScript SDK analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - 오픈소스 웹 및 모바일 앱 분석",
    hero: {
      headlinePrimary: "리플레이 우선 분석",
      headlineSecondary: "경량 SDK",
      primaryCta: "무료로 시작",
      secondaryCta: "셀프 호스팅",
    },
    featuresHeading: "웹 및 모바일 스택.",
    featuresEyebrow: "8가지 신호",
    features: [
      { title: "세션", highlight: "리플레이", badge: "Replay" },
      { title: "인시던트", highlight: "스트림", badge: "Live" },
      { title: "크래시", highlight: "감지", badge: "ANR" },
      { title: "여정", highlight: "맵", badge: "Flows" },
      { title: "터치", highlight: "히트맵", badge: "Taps" },
      { title: "글로벌", highlight: "안정성", badge: "Geo" },
      { title: "성장", highlight: "루프", badge: "Retention" },
    ],
  },
  "zh-cn": {
    code: "zh-cn",
    slug: "zh-cn",
    path: "/zh-cn",
    label: "Chinese",
    nativeLabel: "简体中文",
    languageTag: "zh-CN",
    ogLocale: "zh_CN",
    dir: "ltr",
    metaTitle: "Rejourney：开源 Web 与移动分析、会话回放与可观测性",
    metaDescription:
      "面向 Web、iOS、Android、Flutter、Expo 和 React Native 应用的开源分析，包含会话回放、崩溃、热力图、用户旅程和轻量 SDK。",
    keywords: [
      "开源 Web 分析",
      "Web 会话回放",
      "移动端会话回放",
      "Web 与移动应用可观测性",
      "Web 与移动热力图",
      "崩溃报告",
      "React Native analytics",
      "JavaScript SDK analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - 开源 Web 与移动应用分析",
    hero: {
      headlinePrimary: "回放优先分析",
      headlineSecondary: "轻量 SDK",
      primaryCta: "免费开始",
      secondaryCta: "自托管",
    },
    featuresHeading: "Web 与移动端技术栈。",
    featuresEyebrow: "八个信号",
    features: [
      { title: "会话", highlight: "回放", badge: "Replay" },
      { title: "事件", highlight: "流", badge: "Live" },
      { title: "崩溃", highlight: "检测", badge: "ANR" },
      { title: "旅程", highlight: "地图", badge: "Flows" },
      { title: "触控", highlight: "热力图", badge: "Taps" },
      { title: "全球", highlight: "稳定性", badge: "Geo" },
      { title: "增长", highlight: "循环", badge: "Retention" },
    ],
  },
  it: {
    code: "it",
    slug: "it",
    path: "/it",
    label: "Italian",
    nativeLabel: "Italiano",
    languageTag: "it",
    ogLocale: "it_IT",
    dir: "ltr",
    metaTitle: "Rejourney: session replay web e mobile",
    metaDescription:
      "Analytics open source per app web, iOS, Android, Flutter, Expo e React Native con replay di sessione, crash, heatmap, journey e SDK leggero.",
    keywords: [
      "analytics web open source",
      "session replay web",
      "replay sessioni mobile",
      "analytics mobile",
      "osservabilita web e mobile",
      "heatmap web e mobile",
      "crash reporting",
      "analytics React Native",
      "analytics JavaScript SDK",
      "analytics self-hosted",
    ],
    mainAriaLabel: "Rejourney - Analytics web e mobile open source",
    hero: {
      headlinePrimary: "Analytics replay-first",
      headlineSecondary: "SDK leggero",
      primaryCta: "Inizia gratis",
      secondaryCta: "Self-host",
    },
    featuresHeading: "Stack web e mobile.",
    featuresEyebrow: "Otto segnali",
    features: [
      { title: "Replay", highlight: "sessione", badge: "Replay" },
      { title: "Flusso", highlight: "incidenti", badge: "Live" },
      { title: "Rilevamento", highlight: "crash", badge: "ANR" },
      { title: "Mappe", highlight: "journey", badge: "Flow" },
      { title: "Heatmap", highlight: "touch", badge: "Tap" },
      { title: "Stabilita", highlight: "globale", badge: "Geo" },
      { title: "Loop", highlight: "crescita", badge: "Retention" },
      { title: "Alert", highlight: "team", badge: "Team" },
    ],
  },
  nl: {
    code: "nl",
    slug: "nl",
    path: "/nl",
    label: "Dutch",
    nativeLabel: "Nederlands",
    languageTag: "nl",
    ogLocale: "nl_NL",
    dir: "ltr",
    metaTitle: "Rejourney: web en mobiele sessiereplay",
    metaDescription:
      "Open-source analytics voor web, iOS, Android, Flutter, Expo en React Native met sessiereplay, crashes, heatmaps, journeys en een lichte SDK.",
    keywords: [
      "open source web analytics",
      "web sessiereplay",
      "mobiele sessiereplay",
      "web en mobiele observability",
      "web en mobiele heatmaps",
      "crashrapportage",
      "React Native analytics",
      "JavaScript SDK analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - Open-source web- en mobiele app analytics",
    hero: {
      headlinePrimary: "Replay-first analytics",
      headlineSecondary: "Lichte SDK",
      primaryCta: "Start gratis",
      secondaryCta: "Self-hosten",
    },
    featuresHeading: "Web- en mobiele stack.",
    featuresEyebrow: "Acht signalen",
    features: [
      { title: "Sessie", highlight: "Replay", badge: "Replay" },
      { title: "Incident", highlight: "Stream", badge: "Live" },
      { title: "Crash", highlight: "Detectie", badge: "ANR" },
      { title: "Journey", highlight: "Maps", badge: "Flows" },
      { title: "Touch", highlight: "Heatmaps", badge: "Taps" },
      { title: "Globale", highlight: "Stabiliteit", badge: "Geo" },
      { title: "Growth", highlight: "Loops", badge: "Retention" },
    ],
  },
  pl: {
    code: "pl",
    slug: "pl",
    path: "/pl",
    label: "Polish",
    nativeLabel: "Polski",
    languageTag: "pl",
    ogLocale: "pl_PL",
    dir: "ltr",
    metaTitle: "Rejourney: web i mobilny session replay",
    metaDescription:
      "Open-source analytics dla web, iOS, Android, Flutter, Expo i React Native z replayem sesji, crashami, heatmapami, journey i lekkim SDK.",
    keywords: [
      "open source analytics webowy",
      "replay sesji web",
      "replay sesji mobilnych",
      "analytics mobilny",
      "obserwowalnosc web i mobile",
      "heatmapy web i mobile",
      "raportowanie crashy",
      "React Native analytics",
      "JavaScript SDK analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - Open-source analytics aplikacji webowych i mobilnych",
    hero: {
      headlinePrimary: "Analityka replay-first",
      headlineSecondary: "Lekkie SDK",
      primaryCta: "Zacznij za darmo",
      secondaryCta: "Self-hosting",
    },
    featuresHeading: "Stack webowy i mobilny.",
    featuresEyebrow: "Osiem sygnalow",
    features: [
      { title: "Replay", highlight: "sesji", badge: "Replay" },
      { title: "Strumien", highlight: "incydentow", badge: "Live" },
      { title: "Wykrywanie", highlight: "crashy", badge: "ANR" },
      { title: "Mapy", highlight: "journey", badge: "Flow" },
      { title: "Heatmapy", highlight: "dotyku", badge: "Tap" },
      { title: "Globalna", highlight: "stabilnosc", badge: "Geo" },
      { title: "Petle", highlight: "wzrostu", badge: "Retention" },
      { title: "Alerty", highlight: "zespolu", badge: "Team" },
    ],
  },
  pt: {
    code: "pt",
    slug: "pt",
    path: "/pt",
    label: "Portuguese",
    nativeLabel: "Portugues",
    languageTag: "pt",
    ogLocale: "pt_PT",
    dir: "ltr",
    metaTitle: "Rejourney: session replay web e mobile",
    metaDescription:
      "Analytics open source para apps web, iOS, Android, Flutter, Expo e React Native com replay de sessao, crashes, mapas de calor, jornadas e SDK leve.",
    keywords: [
      "analytics web open source",
      "session replay web",
      "replay de sessao mobile",
      "analytics mobile",
      "observabilidade web e mobile",
      "mapas de calor web e mobile",
      "relatorio de crashes",
      "analytics React Native",
      "analytics JavaScript SDK",
      "analytics self-hosted",
    ],
    mainAriaLabel: "Rejourney - Analytics web e mobile open source",
    hero: {
      headlinePrimary: "Analytics replay-first",
      headlineSecondary: "SDK leve",
      primaryCta: "Comece gratis",
      secondaryCta: "Self-host",
    },
    featuresHeading: "Stack web e mobile.",
    featuresEyebrow: "Oito sinais",
    features: [
      { title: "Replay", highlight: "de sessao", badge: "Replay" },
      { title: "Fluxo", highlight: "de incidentes", badge: "Live" },
      { title: "Deteccao", highlight: "de crashes", badge: "ANR" },
      { title: "Mapas", highlight: "de jornada", badge: "Fluxos" },
      { title: "Mapas", highlight: "de calor", badge: "Toques" },
      { title: "Estabilidade", highlight: "global", badge: "Geo" },
      { title: "Loops", highlight: "de crescimento", badge: "Retencao" },
      { title: "Alertas", highlight: "de equipa", badge: "Equipa" },
    ],
  },
  ru: {
    code: "ru",
    slug: "ru",
    path: "/ru",
    label: "Russian",
    nativeLabel: "Русский",
    languageTag: "ru",
    ogLocale: "ru_RU",
    dir: "ltr",
    metaTitle: "Rejourney: web и mobile session replay",
    metaDescription:
      "Open-source аналитика для web, iOS, Android, Flutter, Expo и React Native: replay сессий, краши, heatmap, пользовательские пути и легкий SDK.",
    keywords: [
      "open source web аналитика",
      "web session replay",
      "replay мобильных сессий",
      "web и mobile observability",
      "web и mobile heatmap",
      "crash reporting",
      "React Native analytics",
      "JavaScript SDK analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - Open-source аналитика web и мобильных приложений",
    hero: {
      headlinePrimary: "Replay-first аналитика",
      headlineSecondary: "Легкий SDK",
      primaryCta: "Начать бесплатно",
      secondaryCta: "Self-host",
    },
    featuresHeading: "Web и мобильный стек.",
    featuresEyebrow: "Восемь сигналов",
    features: [
      { title: "Replay", highlight: "сессий", badge: "Replay" },
      { title: "Поток", highlight: "инцидентов", badge: "Live" },
      { title: "Детект", highlight: "крашей", badge: "ANR" },
      { title: "Карты", highlight: "journey", badge: "Flows" },
      { title: "Touch", highlight: "heatmap", badge: "Taps" },
      { title: "Глобальная", highlight: "стабильность", badge: "Geo" },
      { title: "Петли", highlight: "роста", badge: "Retention" },
    ],
  },
  vi: {
    code: "vi",
    slug: "vi",
    path: "/vi",
    label: "Vietnamese",
    nativeLabel: "Tiếng Việt",
    languageTag: "vi",
    ogLocale: "vi_VN",
    dir: "ltr",
    metaTitle: "Rejourney: session replay web và mobile",
    metaDescription:
      "Phân tích open source cho web, iOS, Android, Flutter, Expo và React Native với session replay, crash, heatmap, journey và SDK nhẹ.",
    keywords: [
      "phan tich web open source",
      "web session replay",
      "mobile session replay",
      "phan tich mobile",
      "web va mobile observability",
      "web va mobile heatmap",
      "crash reporting",
      "React Native analytics",
      "JavaScript SDK analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - Phan tich ung dung web va mobile open source",
    hero: {
      headlinePrimary: "Phân tích replay-first",
      headlineSecondary: "SDK nhẹ",
      primaryCta: "Bắt đầu miễn phí",
      secondaryCta: "Self-host",
    },
    featuresHeading: "Web and mobile stack.",
    featuresEyebrow: "Tám tín hiệu",
    features: [
      { title: "Session", highlight: "Replay", badge: "Replay" },
      { title: "Incident", highlight: "Stream", badge: "Live" },
      { title: "Crash", highlight: "Detection", badge: "ANR" },
      { title: "Journey", highlight: "Maps", badge: "Flows" },
      { title: "Touch", highlight: "Heatmaps", badge: "Taps" },
      { title: "Global", highlight: "Stability", badge: "Geo" },
      { title: "Growth", highlight: "Loops", badge: "Retention" },
    ],
  },
};

export const MARKETING_LOCALE_ORDER: MarketingLocaleCode[] = [
  "en",
  "ar",
  "es",
  "tr",
  "pt-br",
  "de",
  "fr",
  "hi",
  "id",
  "ja",
  "ko",
  "zh-cn",
  "it",
  "nl",
  "pl",
  "pt",
  "ru",
  "vi",
];

export const MARKETING_INDEXABLE_LOCALE_ORDER: MarketingLocaleCode[] = [
  "en",
];

export const MARKETING_HOME_LOCALE_ORDER: MarketingLocaleCode[] = ["en"];

export const MARKETING_ENGINEERING_LOCALE_ORDER: MarketingLocaleCode[] = ["en"];

export const MARKETING_LOCALE_SLUGS = MARKETING_LOCALE_ORDER
  .map((code) => MARKETING_LOCALES[code].slug)
  .filter((slug): slug is Exclude<MarketingLocale["slug"], ""> => slug.length > 0);

export const MARKETING_AVAILABLE_LANGUAGES = MARKETING_LOCALE_ORDER.map((code) => ({
  "@type": "Language",
  name: MARKETING_LOCALES[code].label,
  alternateName: MARKETING_LOCALES[code].nativeLabel,
}));

export function getMarketingLocaleFromPathname(pathname: string): MarketingLocale {
  const firstSegment = pathname.split("/").filter(Boolean)[0]?.toLowerCase();
  const locale = MARKETING_LOCALE_ORDER.find((code) => MARKETING_LOCALES[code].slug === firstSegment);
  return MARKETING_LOCALES[locale ?? "en"];
}

export function isMarketingLocaleSlug(segment: string | null | undefined): segment is MarketingLocale["slug"] {
  if (!segment) return false;
  const normalized = segment.toLowerCase();
  return MARKETING_LOCALE_ORDER.some((code) => MARKETING_LOCALES[code].slug === normalized);
}

export function stripMarketingLocaleFromPathname(pathname: string): {
  locale: MarketingLocale;
  pathname: string;
  hasLocalePrefix: boolean;
} {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const segments = normalizedPathname.split("/").filter(Boolean);
  const firstSegment = segments[0]?.toLowerCase();
  const locale = getMarketingLocaleFromPathname(normalizedPathname);

  if (!isMarketingLocaleSlug(firstSegment)) {
    return {
      locale,
      pathname: normalizedPathname,
      hasLocalePrefix: false,
    };
  }

  const stripped = `/${segments.slice(1).join("/")}`.replace(/\/$/, "");
  return {
    locale,
    pathname: stripped === "" ? "/" : stripped,
    hasLocalePrefix: true,
  };
}

export function isLocalizableMarketingPath(pathname: string): boolean {
  const { pathname: basePathname } = stripMarketingLocaleFromPathname(pathname);
  return /^\/(?:docs|engineering|pricing|roadmap)(?:\/.*)?$/.test(basePathname);
}

export function getLocalizedPublicPath(localeOrCode: MarketingLocale | MarketingLocaleCode, pathname: string): string {
  void localeOrCode;
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;

  if (normalizedPathname === "/") {
    return MARKETING_LOCALES.en.path;
  }

  return normalizedPathname;
}

export function getLocalizedPublicUrl(localeOrCode: MarketingLocale | MarketingLocaleCode, pathname: string): string {
  return `${SITE_URL}${getLocalizedPublicPath(localeOrCode, pathname)}`;
}

export function isIndexableMarketingLocaleCode(code: MarketingLocaleCode): boolean {
  return MARKETING_INDEXABLE_LOCALE_ORDER.includes(code);
}

export function isIndexableMarketingLocale(locale: MarketingLocale): boolean {
  return isIndexableMarketingLocaleCode(locale.code);
}

export function getLocalizedAlternateLinksForPath(
  pathname: string,
  localeCodes: MarketingLocaleCode[] = MARKETING_INDEXABLE_LOCALE_ORDER,
) {
  void localeCodes;
  const basePathname = stripMarketingLocaleFromPathname(pathname).pathname;

  return [
    {
      hrefLang: MARKETING_LOCALES.en.languageTag,
      href: getLocalizedPublicUrl(MARKETING_LOCALES.en, basePathname),
    },
    {
      hrefLang: "x-default",
      href: getLocalizedPublicUrl(MARKETING_LOCALES.en, basePathname),
    },
  ];
}

export function getMarketingLocaleUrl(locale: MarketingLocale): string {
  return `${SITE_URL}${locale.path}`;
}

export function getMarketingAlternateLinks(
  localeCodes: MarketingLocaleCode[] = MARKETING_INDEXABLE_LOCALE_ORDER,
) {
  void localeCodes;
  return [
    {
      hrefLang: MARKETING_LOCALES.en.languageTag,
      href: getMarketingLocaleUrl(MARKETING_LOCALES.en),
    },
    {
      hrefLang: "x-default",
      href: `${SITE_URL}/`,
    },
  ];
}

export const MARKETING_LOCALE_VARY_HEADER =
  "Accept-Language";

export function getMarketingLocaleFromCountryCode(countryCode: string | null | undefined): MarketingLocale | null {
  void countryCode;
  return null;
}

export function getMarketingLocaleFromAcceptLanguage(acceptLanguage: string | null | undefined): MarketingLocale | null {
  void acceptLanguage;
  return null;
}

export function getPreferredMarketingLocaleFromRequest(request: Request): MarketingLocale | null {
  void request;
  return null;
}

export function getMarketingLocaleRedirectPath(request: Request): string | null {
  void request;
  // The public website is English-only. Legacy locale-prefixed paths redirect at the route level.
  return null;
}

export type MarketingHomeCopy = {
  header: {
    ariaLabel: string;
    mobileAriaLabel: string;
    logoAlt: string;
    engineering: string;
    docs: string;
    roadmap: string;
    newBadge: string;
    pricing: string;
    github: string;
    selfHosted: string;
    dashboard: string;
    login: string;
  };
  footer: {
    dashboard: string;
    docs: string;
    engineering: string;
    changelog: string;
    pricing: string;
    selfHosted: string;
    login: string;
    terms: string;
    dpa: string;
    privacy: string;
    contact: string;
    copyEmailToast: string;
    xAriaLabel: string;
    linkedinAriaLabel: string;
    githubAriaLabel: string;
    copyright: string;
  };
  hero: {
    ariaLabel: string;
    description: string;
  };
  trust: {
    ariaLabel: string;
    gdpr: string;
    expo: string;
    reactNative: string;
    swift: string;
    sdkSize: string;
  };
  narrative: {
    loopEyebrow: string;
    loopHeadingLines: string[];
    loopIntro: string;
    tableStep: string;
    tableCatches: string;
    tableNext: string;
    loopStage: string;
    steps: Array<{
      label: string;
      title: string;
      signal: string;
      move: string;
    }>;
    signalsEyebrow: string;
    signalsHeading: string;
    demoCta: string;
    productStories: Array<{
      eyebrow: string;
      title: string;
      copy: string;
      bullets: string[];
      alt: string;
    }>;
    faq: {
      eyebrow: string;
      heading: string;
      items: Array<{
        q: string;
        a: string;
      }>;
    };
    trustEyebrow: string;
    trustHeading: string;
    trustCopy: string;
    trustCards: Array<{
      title: string;
      copy: string;
    }>;
    stats: {
      cheaper: string;
      cheaperCopy: string;
      freeSessions: string;
      everyMonth: string;
      allFeatures: string;
      allFeaturesCopy: string;
    };
  };
  performance: {
    headingPrimary: string;
    headingSecondary: string;
    bundleSummary: (ratio: string, packageName: string, version: string) => string;
    smallerBundle: string;
    chartTitle: string;
    gzip: string;
    minifiedMinusGzip: string;
    chartNote: string;
    minified: string;
    gzipped: string;
    bundlePhobiaVersion: (version: string) => string;
    transitiveNote: string;
    metricsTitle: string;
    metricsNotePrefix: string;
    metricsNoteApp: string;
    metricsNoteSuffix: string;
    tableMetric: string;
    tableAverage: string;
    tableMax: string;
    tableMin: string;
    tableThread: string;
    tableAvgShort: string;
    tableMaxShort: string;
    tableMinShort: string;
    metricRows: Array<{
      metric: string;
      thread: string;
    }>;
  };
  engineeringCta: {
    badges: string[];
    headingBefore: string;
    headingAccent: string;
    headingAfter: string;
    primary: string;
    secondary: string;
  };
  roadmap: {
    metaTitle: string;
    metaDescription: string;
    ogDescription: string;
    eyebrow: string;
    title: string;
    intro: string;
    signInToPost: string;
    addIdeaTitle: string;
    signInFirst: string;
    ideaPlaceholder: string;
    detailsPlaceholder: string;
    postButton: string;
    signInToAddIdea: string;
    ideaMinError: string;
    detailsMinError: string;
    unableToLoad: string;
    unableToUpdateVote: string;
    unableToAddIdea: string;
    showLess: string;
    showMore: string;
    developerComment: string;
    vote: string;
    unvote: string;
    voteSingular: string;
    votePlural: string;
    open: string;
    complete: string;
    noOpenIdeas: string;
    noOpenIdeasCopy: string;
    nothingComplete: string;
    nothingCompleteCopy: string;
    votesHeader: string;
    ideaHeader: string;
    detailsHeader: string;
    voteActionAria: string;
    loadingRoadmap: string;
  };
};

const englishHomeCopy: MarketingHomeCopy = {
  header: {
    ariaLabel: "Site navigation",
    mobileAriaLabel: "Site navigation mobile links",
    logoAlt: "Rejourney | Revenue Leak Prediction for Web and Mobile Apps",
    engineering: "Engineering",
    docs: "Docs",
    roadmap: "Roadmap",
    newBadge: "New",
    pricing: "Pricing",
    github: "GitHub",
    selfHosted: "Self-hosted",
    dashboard: "Dashboard",
    login: "Log in",
  },
  footer: {
    dashboard: "Dashboard",
    docs: "Docs",
    engineering: "Engineering",
    changelog: "Changelog",
    pricing: "Pricing",
    selfHosted: "Self Hosted",
    login: "Login",
    terms: "Terms",
    dpa: "DPA",
    privacy: "Privacy",
    contact: "Contact",
    copyEmailToast: "Email copied to clipboard!",
    xAriaLabel: "Rejourney on X",
    linkedinAriaLabel: "Rejourney on LinkedIn",
    githubAriaLabel: "Rejourney on GitHub",
    copyright: "© 2026 Rejourney. All rights reserved.",
  },
  hero: {
    ariaLabel: "Hero section",
    description:
      "Ensure landers onboard, convert, and checkout.",
  },
  trust: {
    ariaLabel: "Trust and supported platforms",
    gdpr: "GDPR",
    expo: "Expo",
    reactNative: "React Native",
    swift: "Swift",
    sdkSize: "13.2 kB",
  },
  narrative: {
    loopEyebrow: "Revenue lift loop",
    loopHeadingLines: ["Find Revenue blockers.", "See The Growth."],
    loopIntro: "Replay the drop-off, ship the fix, prove the lift.",
    tableStep: "Step",
    tableCatches: "What Rejourney catches",
    tableNext: "What the team does next",
    loopStage: "Loop stage",
    steps: [
      {
        label: "Watch",
        title: "Replay the exact user session",
        signal: "Screens, clicks, taps, swipes, navigation, crashes, and network context.",
        move: "See the exact moment a user hesitates instead of inferring it from a chart.",
      },
      {
        label: "Understand",
        title: "Find the friction pattern",
        signal: "Heatmaps, journeys, rage taps, crash reports, and ANRs.",
        move: "Turn one strange session into a repeated pattern the team can name.",
      },
      {
        label: "Act",
        title: "Ship the fix with confidence",
        signal: "Replay-backed evidence for product, engineering, support, and growth.",
        move: "Decide what to fix before the next release repeats the same failure.",
      },
    ],
    signalsEyebrow: "What you can see",
    signalsHeading: "The signals web and mobile teams need in one place.",
    demoCta: "See live demo",
    productStories: [
      {
        eyebrow: "Session recordings",
        title: "Watch real users move through your app.",
        copy: "Record user sessions across web and mobile so product managers, developers, and customer support can understand the digital experience in real time.",
        bullets: ["Pixel-perfect replay", "Click, tap, rage click, and screen changes", "Network, logs, and device context"],
        alt: "Rejourney session replay preview",
      },
      {
        eyebrow: "Heatmaps and journeys",
        title: "See what grabs attention and where people drop.",
        copy: "Turn scattered taps, swipes, scrolls, and exits into user journeys that show teams understand user behavior and improve user experience.",
        bullets: ["Tap and rage-tap clusters", "Journey maps across screens", "Drop-off points by flow"],
        alt: "Rejourney touch heatmaps preview",
      },
      {
        eyebrow: "Crashes and ANRs",
        title: "Tie broken experiences to the session that caused them.",
        copy: "Crash reporting is more useful when it sits beside replay, thread analysis, device details, and the user path.",
        bullets: ["Crash and ANR detection", "Main-thread performance clues", "Incident stream for triage"],
        alt: "Rejourney ANR and crash detection preview",
      },
      {
        eyebrow: "Industry Metrics",
        title: "Connect product quality to retention.",
        copy: "Measure whether releases are creating better sessions, calmer funnels, and more users who come back.",
        bullets: ["Retention and loyalty segments", "Release impact signals", "Funnel recovery opportunities"],
        alt: "Rejourney growth analytics preview",
      },
      {
        eyebrow: "Geographic analytics",
        title: "Sentiment by region.",
        copy: "See where positive, neutral, and frustrated sessions cluster across regions so teams can prioritize local UX issues.",
        bullets: ["Regional sentiment clusters", "Session replay context by country", "Location-level friction signals"],
        alt: "Rejourney sentiment by region map preview",
      },
    ],
    faq: {
      eyebrow: "FAQ",
      heading: "Common questions.",
      items: [
        {
          q: "We already have analytics dashboards. Why do we need session replay?",
          a: "Analytics tell you that something went wrong. A session replay tool shows you why. A funnel chart can tell you 40% of users abandon checkout, but only replay shows you that your payment form is clearing on validation error, or that a button is obscured on a specific device. Numbers surface the problem; replay surfaces the cause.",
        },
        {
          q: "How does Rejourney help us find user friction we didn't know existed?",
          a: "Most friction is invisible in metrics because users never report it. They just leave. Rejourney surfaces rage taps, dead taps, slow screens, and unusual session paths so you can see exactly where users struggle before it shows up as churn. You can also search sessions by outcome (crash, rage, drop-off) and watch the moments leading up to it.",
        },
        {
          q: "What are some cool things I can actually do with Rejourney?",
          a: "One of the most powerful features is the AI query builder. Instead of setting up complex filters, you describe what you are looking for in plain language and Rejourney finds the sessions that match. You can search for things like \"users who tapped the checkout button but never completed payment\" or \"sessions where the app froze during onboarding\" and get a list of real replays that fit that scenario. It makes it fast to investigate specific behaviors without knowing exactly which events or properties to filter on.",
        },
        {
          q: "Can this help us investigate crashes and bugs faster?",
          a: "Yes. Crash investigation is one of the highest-value use cases. When a crash is reported, Rejourney gives you the full session replay leading up to it, the network requests, the event timeline, and the device context. Instead of asking a user to reproduce the issue, you watch it happen. That often cuts debugging time from hours to minutes.",
        },
        {
          q: "Does Rejourney work for both mobile and web?",
          a: "Yes. Rejourney supports Flutter on iOS and Android, native iOS with Swift, React Native and Expo, and web apps via our JavaScript SDK. All sessions, mobile and web, feed into the same dashboard so your team has one unified view of the user experience across platforms.",
        },
        {
          q: "Is this useful for product teams, or just engineering?",
          a: "Both. Engineering teams use Rejourney to reproduce bugs and triage crashes without needing to ask users. Product teams use it to understand where onboarding breaks down, which features go unused, and what the experience actually looks like on real devices, not just in design mockups.",
        },
        {
          q: "Is user data kept private? Can I mask sensitive fields?",
          a: "Yes. By default, all text inputs are masked in recordings so sensitive data stays out of replay. You can optionally switch to \"Secure Only\" mode, which masks only password-type fields and lets plaintext inputs through. No raw keystrokes are ever captured.",
        },
        {
          q: "Can I self-host Rejourney?",
          a: "Yes. Rejourney offers a self-hosted always free Docker or K3s option for teams that need full data control. You run the backend on your own infrastructure with the same dashboard and SDKs. Contact sales for setup and licensing.",
        },
      ],
    },
    trustEyebrow: "Team workspace",
    trustHeading: "One room for all.",
    trustCopy:
      "PMs, designers, and developers work from the same replay-backed view: metrics on the left, the user session in the middle, and timeline/API evidence on the right.",
    trustCards: [
      {
        title: "Developers",
        copy: "Open console logs, DOM changes, API calls, errors, and device context beside the replay so the failure is reproducible.",
      },
      {
        title: "PMs",
        copy: "Start from retention, active users, degraded sessions, and release impact, then jump into the session that explains the metric.",
      },
      {
        title: "UX",
        copy: "Watch the taps, hesitation, screen transitions, and UI state that show where the experience stops making sense.",
      },
      {
        title: "Shared replay room",
        copy: "Everyone points to the same session UID, frame, timestamp, and event instead of trading separate screenshots.",
      },
      {
        title: "Evidence handoff",
        copy: "PMs flag the pattern, designers mark the confusing interaction, and developers pin the network request that needs work.",
      },
      {
        title: "Decision thread",
        copy: "Keep the metric, replay, owner, and next action together so a team review turns into a clear fix plan.",
      },
    ],
    stats: {
      cheaper: "17x cheaper",
      cheaperCopy: "Than some of the cheapest session replay and product analytics tools in the industry.",
      freeSessions: "Free 5k replays",
      everyMonth: "Every month",
      allFeatures: "Lightweight",
      allFeaturesCopy: "Tiny SDK & Light Dashboard.",
    },
  },
  performance: {
    headingPrimary: "Tiny Footprint.",
    headingSecondary: "Extreme Impact.",
    bundleSummary: (ratio, packageName, version) =>
      `${ratio}x smaller minified JS bundle vs ${packageName}@${version} (BundlePhobia)`,
    smallerBundle: "Smaller JS bundle",
    chartTitle: "Npm bundle size (BundlePhobia)",
    gzip: "Gzip",
    minifiedMinusGzip: "Minified - gzip",
    chartNote: "Bar height = minified size; darker segment = gzipped transfer size (same layout as BundlePhobia).",
    minified: "minified",
    gzipped: "kB gzipped",
    bundlePhobiaVersion: (version) => `BundlePhobia @${version}`,
    transitiveNote: "Includes transitive npm dependencies in BundlePhobia's model.",
    metricsTitle: "Performance Metrics",
    metricsNotePrefix: "iPhone 15 Pro; iOS 18; Expo SDK 54; React Native New Architecture. Running on",
    metricsNoteApp: "Merch App",
    metricsNoteSuffix: "Production build.",
    tableMetric: "Metric",
    tableAverage: "Average (ms)",
    tableMax: "Max (ms)",
    tableMin: "Min (ms)",
    tableThread: "Thread",
    tableAvgShort: "Avg",
    tableMaxShort: "Max",
    tableMinShort: "Min",
    metricRows: [
      { metric: "Main: UIKit + Metal Capture", thread: "Main" },
      { metric: "BG: Async Image Processing", thread: "Background" },
      { metric: "BG: Tar+Gzip Compression", thread: "Background" },
      { metric: "BG: Upload Handshake", thread: "Background" },
      { metric: "Total Main Thread Impact", thread: "Main" },
    ],
  },
  engineeringCta: {
    badges: ["Open source", "Self-hostable"],
    headingBefore: "Open, documented",
    headingAccent: "Engineering",
    headingAfter: "Decisions.",
    primary: "View Engineering Decisions",
    secondary: "Start Building",
  },
  roadmap: {
    metaTitle: "Roadmap - Rejourney",
    metaDescription: "Vote on Rejourney roadmap ideas and share what you want the team to build next.",
    ogDescription: "Vote on Rejourney roadmap ideas and share what you want next.",
    eyebrow: "New",
    title: "Roadmap",
    intro: "Vote on what should come next, or add the feature you want Rejourney to build.",
    signInToPost: "Sign in to post",
    addIdeaTitle: "Add an idea",
    signInFirst: "Sign in first, then add your idea.",
    ideaPlaceholder: "IDEA",
    detailsPlaceholder: "DETAILS",
    postButton: "Post",
    signInToAddIdea: "Sign in to add an idea",
    ideaMinError: "Idea needs at least 3 characters.",
    detailsMinError: "Details need at least 10 characters.",
    unableToLoad: "Unable to load roadmap posts.",
    unableToUpdateVote: "Unable to update your vote.",
    unableToAddIdea: "Unable to add that idea.",
    showLess: "Show less",
    showMore: "Show more",
    developerComment: "Developer comment",
    vote: "Vote",
    unvote: "Unvote",
    voteSingular: "vote",
    votePlural: "votes",
    open: "Open",
    complete: "Complete",
    noOpenIdeas: "No open ideas yet",
    noOpenIdeasCopy: "Be the first to put something on the board.",
    nothingComplete: "Nothing complete yet",
    nothingCompleteCopy: "Completed roadmap items will show up here.",
    votesHeader: "Votes",
    ideaHeader: "Idea",
    detailsHeader: "Details",
    voteActionAria: "Vote action",
    loadingRoadmap: "Loading roadmap",
  },
};

const arabicHomeCopy: MarketingHomeCopy = {
  header: {
    ariaLabel: "تنقل الموقع",
    mobileAriaLabel: "روابط تنقل الموقع للجوال",
    logoAlt: "Rejourney | إعادة تشغيل جلسات ومراقبة مفتوحة المصدر",
    engineering: "الهندسة",
    docs: "التوثيق",
    roadmap: "خارطة الطريق",
    newBadge: "جديد",
    pricing: "الأسعار",
    github: "GitHub",
    selfHosted: "استضافة ذاتية",
    dashboard: "لوحة التحكم",
    login: "تسجيل الدخول",
  },
  footer: {
    dashboard: "لوحة التحكم",
    docs: "التوثيق",
    engineering: "الهندسة",
    changelog: "سجل التغييرات",
    pricing: "الأسعار",
    selfHosted: "استضافة ذاتية",
    login: "الدخول",
    terms: "الشروط",
    dpa: "DPA",
    privacy: "الخصوصية",
    contact: "تواصل",
    copyEmailToast: "تم نسخ البريد الإلكتروني!",
    xAriaLabel: "Rejourney على X",
    linkedinAriaLabel: "Rejourney على LinkedIn",
    githubAriaLabel: "Rejourney على GitHub",
    copyright: "© 2026 Rejourney. جميع الحقوق محفوظة.",
  },
  hero: {
    ariaLabel: "القسم الرئيسي",
    description:
      "شاهد مستخدميك. عش تجربتهم.",
  },
  trust: {
    ariaLabel: "الثقة والمنصات المدعومة",
    gdpr: "GDPR",
    expo: "Expo",
    reactNative: "React Native",
    swift: "Swift",
    sdkSize: "13.2 kB",
  },
  narrative: {
    loopEyebrow: "حلقة فهم تجربة الويب والجوال",
    loopHeadingLines: ["توقف عن التخمين", "لماذا يغادر", "المستخدمون."],
    loopIntro:
      "تم تصميم Rejourney حول طريقة اتخاذ فرق المنتج للقرارات: شاهد ما حدث، افهم النمط، ثم تصرف قبل أن يكرر الإصدار التالي المشكلة نفسها.",
    tableStep: "الخطوة",
    tableCatches: "ما يلتقطه Rejourney",
    tableNext: "ما يفعله الفريق بعد ذلك",
    loopStage: "مرحلة الحلقة",
    steps: [
      {
        label: "شاهد",
        title: "أعد تشغيل جلسة المستخدم كما حدثت",
        signal: "الشاشات، النقرات، اللمسات، السحب، التنقل، الأعطال، وسياق الشبكة.",
        move: "اعرف اللحظة الدقيقة التي تردد فيها المستخدم بدلا من استنتاجها من رسم بياني.",
      },
      {
        label: "افهم",
        title: "اكتشف نمط الاحتكاك",
        signal: "الخرائط الحرارية، رحلات المستخدم، نقرات الغضب، تقارير الأعطال، وANR.",
        move: "حوّل جلسة غريبة واحدة إلى نمط متكرر يستطيع الفريق تسميته بوضوح.",
      },
      {
        label: "تصرف",
        title: "اشحن الإصلاح بثقة",
        signal: "دليل مدعوم بإعادة التشغيل لفرق المنتج والهندسة والدعم والنمو.",
        move: "قرر ما يجب إصلاحه قبل أن يعيد الإصدار التالي نفس الفشل.",
      },
    ],
    signalsEyebrow: "ما يمكنك رؤيته",
    signalsHeading: "كل الإشارات التي تحتاجها فرق الويب والجوال في مكان واحد.",
    demoCta: "شاهد العرض المباشر",
    productStories: [
      {
        eyebrow: "تسجيلات الجلسات",
        title: "شاهد المستخدمين الحقيقيين وهم يتنقلون داخل تطبيقك.",
        copy: "أعد تشغيل جلسات الويب والجوال مع سياق كاف للإجابة عن أول سؤال يسأله الجميع: ماذا حدث فعلا؟",
        bullets: ["إعادة تشغيل بدقة بكسل", "مسارات نقر ولمس وتغييرات شاشة", "سياق الشبكة والسجلات والجهاز"],
        alt: "معاينة إعادة تشغيل الجلسات في Rejourney",
      },
      {
        eyebrow: "الخرائط الحرارية والرحلات",
        title: "اعرف ما يجذب الانتباه وأين يتوقف المستخدمون.",
        copy: "حوّل اللمسات والسحب والتمرير والخروج المتناثرة إلى خريطة للشاشات التي تساعد التحويل أو تعطله.",
        bullets: ["تجمعات النقر ونقرات الغضب", "خرائط رحلة عبر الشاشات", "نقاط الانقطاع حسب المسار"],
        alt: "معاينة الخرائط الحرارية للمس في Rejourney",
      },
      {
        eyebrow: "الأعطال وANR",
        title: "اربط التجارب المعطلة بالجلسة التي سببتها.",
        copy: "تصبح تقارير الأعطال أكثر فائدة عندما تجلس بجانب إعادة التشغيل، وتحليل الخيوط، وتفاصيل الجهاز، ومسار المستخدم.",
        bullets: ["اكتشاف الأعطال وANR", "دلائل أداء الخيط الرئيسي", "تدفق حوادث للفرز السريع"],
        alt: "معاينة اكتشاف ANR والأعطال في Rejourney",
      },
      {
        eyebrow: "حلقات النمو",
        title: "اربط جودة المنتج بالاحتفاظ.",
        copy: "قِس ما إذا كانت الإصدارات تصنع جلسات أفضل، ومسارات أهدأ، ومستخدمين يعودون أكثر.",
        bullets: ["شرائح الاحتفاظ والولاء", "إشارات أثر الإصدار", "فرص استعادة مسارات التحويل"],
        alt: "معاينة تحليلات النمو في Rejourney",
      },
      {
        eyebrow: "تحليلات جغرافية",
        title: "شاهد استجابة API والمشاعر حسب المنطقة.",
        copy: "اكتشف أين تتغير مدة الاستجابة والأخطاء ومشاعر المستخدمين عبر البلدان قبل أن تتحول المشكلات الإقليمية إلى فقدان مستخدمين.",
        bullets: ["أزمنة استجابة API حسب المدينة", "إشارات المشاعر الإقليمية", "صحة الموقع الجغرافي وسياق الجلسة"],
        alt: "معاينة كرة تحليلات جغرافية في Rejourney",
      },
    ],
    faq: {
      eyebrow: "أسئلة شائعة",
      heading: "أسئلة شائعة.",
      items: [
        {
          q: "لدينا لوحات تحليلات بالفعل. لماذا نحتاج إلى إعادة تشغيل الجلسات؟",
          a: "تخبرك التحليلات أن شيئا ما تعطل. أما إعادة تشغيل الجلسة فتريك السبب. قد يخبرك مخطط التحويل أن 40٪ من المستخدمين يتركون الدفع، لكن إعادة التشغيل وحدها تكشف أن نموذج الدفع يمسح البيانات عند خطأ التحقق أو أن زرا مخفيا على جهاز معين. الأرقام تظهر المشكلة؛ وإعادة التشغيل تظهر السبب.",
        },
        {
          q: "كيف يساعدنا Rejourney في اكتشاف احتكاك لم نكن نعرف بوجوده؟",
          a: "معظم الاحتكاك لا يظهر في المقاييس لأن المستخدمين لا يبلغون عنه؛ إنهم يغادرون فقط. يكشف Rejourney نقرات الغضب والنقرات الميتة والشاشات البطيئة ومسارات الجلسات غير المعتادة حتى ترى بدقة أين يتعثر المستخدمون قبل أن يظهر ذلك كفقدان. يمكنك أيضا البحث في الجلسات حسب النتيجة، مثل crash أو rage أو drop-off، ومشاهدة اللحظات التي سبقتها.",
        },
        {
          q: "ما الأشياء المفيدة التي يمكنني فعلها فعلا باستخدام Rejourney؟",
          a: "من أقوى الميزات منشئ استعلامات AI. بدلا من إعداد فلاتر معقدة، تصف ما تبحث عنه بلغة عادية ويجد Rejourney الجلسات المطابقة. يمكنك البحث عن أشياء مثل \"المستخدمون الذين ضغطوا زر الدفع ولم يكملوا الدفع\" أو \"الجلسات التي تجمد فيها التطبيق أثناء onboarding\" والحصول على قائمة بإعادات تشغيل حقيقية تناسب هذا السيناريو.",
        },
        {
          q: "هل يساعدنا هذا في التحقيق في الأعطال والعلل بسرعة أكبر؟",
          a: "نعم. التحقيق في الأعطال من أعلى حالات الاستخدام قيمة. عند الإبلاغ عن crash، يعطيك Rejourney إعادة تشغيل الجلسة الكاملة قبل حدوثه، وطلبات الشبكة، وخط الأحداث الزمني، وسياق الجهاز. بدلا من طلب إعادة إنتاج المشكلة من المستخدم، تشاهدها وهي تحدث، وهذا غالبا يقلل وقت التصحيح من ساعات إلى دقائق.",
        },
        {
          q: "هل يعمل Rejourney مع الجوال والويب معا؟",
          a: "نعم. يدعم Rejourney تطبيقات Flutter على iOS وAndroid، وتطبيقات iOS الأصلية عبر Swift، وReact Native وExpo، وتطبيقات الويب عبر JavaScript SDK. كل الجلسات، الجوال والويب، تصل إلى لوحة واحدة حتى يحصل فريقك على رؤية موحدة لتجربة المستخدم عبر المنصات.",
        },
        {
          q: "هل هذا مفيد لفرق المنتج أم للهندسة فقط؟",
          a: "كلاهما. تستخدم فرق الهندسة Rejourney لإعادة إنتاج العلل وفرز الأعطال دون سؤال المستخدمين. وتستخدمه فرق المنتج لفهم أين يتعطل onboarding، وأي الميزات لا تُستخدم، وكيف تبدو التجربة فعلا على أجهزة حقيقية لا في نماذج التصميم فقط.",
        },
        {
          q: "هل تبقى بيانات المستخدم خاصة؟ وهل يمكنني إخفاء الحقول الحساسة؟",
          a: "نعم. بشكل افتراضي، يتم إخفاء كل حقول النص في التسجيلات. يمكنك اختيار وضع Secure Only، الذي يخفي حقول كلمات المرور فقط ويسمح بمرور حقول النص العادية. لا يتم التقاط ضغطات المفاتيح الخام أبدا.",
        },
        {
          q: "هل يمكنني استضافة Rejourney ذاتيا؟",
          a: "نعم. يوفر Rejourney خيار استضافة ذاتية مجاني دائما عبر Docker أو K3s للفرق التي تحتاج تحكما كاملا في البيانات. تشغل الخلفية على بنيتك التحتية مع نفس لوحة التحكم وSDKs. تواصل مع المبيعات للإعداد والترخيص.",
        },
      ],
    },
    trustEyebrow: "مساحة عمل الفريق",
    trustHeading: "مساحة عمل واحدة لكل غرفة المنتج.",
    trustCopy:
      "يمكن لمديري المنتج والمصممين والمطورين العمل من نفس العرض المدعوم بإعادة التشغيل: المقاييس على اليسار، جلسة المستخدم في الوسط، وأدلة الخط الزمني وAPI على اليمين.",
    trustCards: [
      {
        title: "المطورون",
        copy: "افتح سجلات الكونسول وتغييرات DOM ونداءات API والأخطاء وسياق الجهاز بجانب إعادة التشغيل حتى يصبح العطل قابلا للإعادة.",
      },
      {
        title: "مديرو المنتج",
        copy: "ابدأ من الاحتفاظ والمستخدمين النشطين والجلسات المتدهورة وأثر الإصدار، ثم انتقل إلى الجلسة التي تشرح الرقم.",
      },
      {
        title: "المصممون",
        copy: "شاهد النقرات والتردد وانتقالات الشاشات وحالة الواجهة التي تكشف أين تتوقف التجربة عن الوضوح.",
      },
      {
        title: "غرفة إعادة تشغيل مشتركة",
        copy: "يشير الجميع إلى نفس معرف الجلسة والإطار والطابع الزمني والحدث بدلا من تبادل لقطات شاشة منفصلة.",
      },
      {
        title: "تسليم الأدلة",
        copy: "يحدد مديرو المنتج النمط، ويعلم المصممون لحظة الالتباس، ويثبت المطورون طلب الشبكة الذي يحتاج إلى عمل.",
      },
      {
        title: "خيط القرار",
        copy: "احتفظ بالمقياس وإعادة التشغيل والمالك والخطوة التالية معا حتى يتحول استعراض الفريق إلى خطة إصلاح واضحة.",
      },
    ],
    stats: {
      cheaper: "أرخص 17 مرة",
      cheaperCopy: "مقارنة ببعض أرخص أدوات إعادة تشغيل الجلسات وتحليلات المنتج في السوق.",
      freeSessions: "5 آلاف جلسة مجانية",
      everyMonth: "كل شهر",
      allFeatures: "كل الميزات",
      allFeaturesCopy: "إعادة التشغيل، الخرائط الحرارية، الأعطال، الرحلات",
    },
  },
  performance: {
    headingPrimary: "أثر صغير.",
    headingSecondary: "تأثير كبير.",
    bundleSummary: (ratio, packageName, version) =>
      `حزمة JavaScript المصغرة أصغر ${ratio} مرة من ${packageName}@${version} (BundlePhobia)`,
    smallerBundle: "حزمة JS أصغر",
    chartTitle: "حجم حزمة npm (BundlePhobia)",
    gzip: "Gzip",
    minifiedMinusGzip: "المصغر - gzip",
    chartNote: "ارتفاع العمود = الحجم المصغر؛ الجزء الداكن = حجم النقل المضغوط gzip كما في BundlePhobia.",
    minified: "مصغر",
    gzipped: "kB مضغوط gzip",
    bundlePhobiaVersion: (version) => `BundlePhobia @${version}`,
    transitiveNote: "يشمل اعتماديات npm غير المباشرة في نموذج BundlePhobia.",
    metricsTitle: "مقاييس الأداء",
    metricsNotePrefix: "iPhone 15 Pro؛ iOS 18؛ Expo SDK 54؛ React Native New Architecture. يعمل على",
    metricsNoteApp: "Merch App",
    metricsNoteSuffix: "نسخة إنتاج.",
    tableMetric: "المقياس",
    tableAverage: "المتوسط (ms)",
    tableMax: "الأقصى (ms)",
    tableMin: "الأدنى (ms)",
    tableThread: "الخيط",
    tableAvgShort: "متوسط",
    tableMaxShort: "أقصى",
    tableMinShort: "أدنى",
    metricRows: [
      { metric: "الرئيسي: التقاط UIKit + Metal", thread: "الرئيسي" },
      { metric: "الخلفية: معالجة الصور غير المتزامنة", thread: "الخلفية" },
      { metric: "الخلفية: ضغط Tar+Gzip", thread: "الخلفية" },
      { metric: "الخلفية: مصافحة الرفع", thread: "الخلفية" },
      { metric: "إجمالي التأثير على الخيط الرئيسي", thread: "الرئيسي" },
    ],
  },
  engineeringCta: {
    badges: ["مفتوح المصدر", "قابل للاستضافة الذاتية"],
    headingBefore: "قرارات",
    headingAccent: "هندسية",
    headingAfter: "مفتوحة وموثقة.",
    primary: "عرض القرارات الهندسية",
    secondary: "ابدأ البناء",
  },
  roadmap: {
    metaTitle: "خارطة الطريق - Rejourney",
    metaDescription: "صوّت على أفكار خارطة طريق Rejourney وشارك ما تريد أن يبنيه الفريق لاحقا.",
    ogDescription: "صوّت على أفكار خارطة طريق Rejourney وشارك ما تريده لاحقا.",
    eyebrow: "جديد",
    title: "خارطة الطريق",
    intro: "صوّت على ما يجب أن يأتي بعد ذلك، أو أضف الميزة التي تريد من Rejourney بناءها.",
    signInToPost: "سجل الدخول للنشر",
    addIdeaTitle: "أضف فكرة",
    signInFirst: "سجل الدخول أولا، ثم أضف فكرتك.",
    ideaPlaceholder: "الفكرة",
    detailsPlaceholder: "التفاصيل",
    postButton: "نشر",
    signInToAddIdea: "سجل الدخول لإضافة فكرة",
    ideaMinError: "يجب أن تحتوي الفكرة على 3 أحرف على الأقل.",
    detailsMinError: "يجب أن تحتوي التفاصيل على 10 أحرف على الأقل.",
    unableToLoad: "تعذر تحميل منشورات خارطة الطريق.",
    unableToUpdateVote: "تعذر تحديث تصويتك.",
    unableToAddIdea: "تعذر إضافة هذه الفكرة.",
    showLess: "عرض أقل",
    showMore: "عرض المزيد",
    developerComment: "تعليق المطور",
    vote: "تصويت",
    unvote: "إلغاء التصويت",
    voteSingular: "تصويت",
    votePlural: "تصويتات",
    open: "مفتوح",
    complete: "مكتمل",
    noOpenIdeas: "لا توجد أفكار مفتوحة بعد",
    noOpenIdeasCopy: "كن أول من يضع فكرة على اللوحة.",
    nothingComplete: "لا شيء مكتمل بعد",
    nothingCompleteCopy: "ستظهر عناصر خارطة الطريق المكتملة هنا.",
    votesHeader: "الأصوات",
    ideaHeader: "الفكرة",
    detailsHeader: "التفاصيل",
    voteActionAria: "إجراء التصويت",
    loadingRoadmap: "جار تحميل خارطة الطريق",
  },
};

const spanishHomeCopy: MarketingHomeCopy = {
  ...englishHomeCopy,
  header: {
    ...englishHomeCopy.header,
    ariaLabel: "Navegacion del sitio",
    mobileAriaLabel: "Enlaces moviles de navegacion",
    logoAlt: "Rejourney | Replay de sesiones y observabilidad open source",
    engineering: "Ingenieria",
    docs: "Docs",
    roadmap: "Hoja de ruta",
    newBadge: "Nuevo",
    pricing: "Precios",
    selfHosted: "Autohospedado",
    dashboard: "Panel",
    login: "Iniciar sesion",
  },
  footer: {
    ...englishHomeCopy.footer,
    dashboard: "Panel",
    docs: "Docs",
    engineering: "Ingenieria",
    changelog: "Cambios",
    pricing: "Precios",
    selfHosted: "Autohospedado",
    login: "Iniciar sesion",
    terms: "Terminos",
    dpa: "DPA",
    privacy: "Privacidad",
    contact: "Contacto",
    copyEmailToast: "Correo copiado al portapapeles!",
    xAriaLabel: "Rejourney en X",
    linkedinAriaLabel: "Rejourney en LinkedIn",
    githubAriaLabel: "Rejourney en GitHub",
    copyright: "© 2026 Rejourney. Todos los derechos reservados.",
  },
  hero: {
    ariaLabel: "Seccion principal",
    description:
      "Ve a tus usuarios. Ponte en su lugar.",
  },
  trust: {
    ...englishHomeCopy.trust,
    ariaLabel: "Confianza y plataformas compatibles",
  },
  narrative: {
    loopEyebrow: "El ciclo de insight web y movil",
    loopHeadingLines: ["Deja de adivinar", "por que los usuarios", "se van."],
    loopIntro:
      "Rejourney esta organizado como los equipos toman decisiones de producto: mira que paso, entiende el patron y actua antes de que el siguiente lanzamiento repita el problema.",
    tableStep: "Paso",
    tableCatches: "Lo que captura Rejourney",
    tableNext: "Lo que el equipo hace despues",
    loopStage: "Etapa del ciclo",
    steps: [
      {
        label: "Mira",
        title: "Reproduce la sesion exacta del usuario",
        signal: "Pantallas, clics, toques, swipes, navegacion, bloqueos y contexto de red.",
        move: "Ve el momento exacto en que un usuario duda, en lugar de inferirlo desde una grafica.",
      },
      {
        label: "Entiende",
        title: "Encuentra el patron de friccion",
        signal: "Mapas de calor, journeys, rage taps, reportes de crash y ANR.",
        move: "Convierte una sesion rara en un patron repetido que el equipo puede nombrar.",
      },
      {
        label: "Actua",
        title: "Lanza el arreglo con confianza",
        signal: "Evidencia con replay para producto, ingenieria, soporte y crecimiento.",
        move: "Decide que arreglar antes de que la siguiente version repita el mismo fallo.",
      },
    ],
    signalsEyebrow: "Lo que puedes ver",
    signalsHeading: "Las señales que necesitan los equipos web y moviles en un solo lugar.",
    demoCta: "Ver demo en vivo",
    productStories: [
      {
        eyebrow: "Grabaciones de sesiones",
        title: "Mira a usuarios reales moverse por tu app.",
        copy: "Reproduce sesiones web y moviles con suficiente contexto para responder la primera pregunta de todos: que paso realmente?",
        bullets: ["Replay pixel-perfect", "Rastros de clic, toque y cambios de pantalla", "Contexto de red, logs y dispositivo"],
        alt: "Vista previa del replay de sesiones de Rejourney",
      },
      {
        eyebrow: "Mapas de calor y journeys",
        title: "Ve que captura la atencion y donde caen los usuarios.",
        copy: "Convierte toques, swipes, scrolls y salidas dispersas en un mapa de las pantallas que ayudan o frenan la conversion.",
        bullets: ["Clusters de taps y rage taps", "Mapas de journey entre pantallas", "Puntos de abandono por flujo"],
        alt: "Vista previa de mapas de calor tactiles de Rejourney",
      },
      {
        eyebrow: "Crashes y ANR",
        title: "Conecta experiencias rotas con la sesion que las causo.",
        copy: "El reporte de crashes es mas util cuando vive junto al replay, analisis de hilos, detalles del dispositivo y ruta del usuario.",
        bullets: ["Deteccion de crashes y ANR", "Pistas de rendimiento del hilo principal", "Flujo de incidentes para triage"],
        alt: "Vista previa de deteccion de ANR y crashes en Rejourney",
      },
      {
        eyebrow: "Bucles de crecimiento",
        title: "Conecta la calidad del producto con la retencion.",
        copy: "Mide si los lanzamientos crean mejores sesiones, funnels mas tranquilos y mas usuarios que vuelven.",
        bullets: ["Segmentos de retencion y lealtad", "Señales de impacto por release", "Oportunidades de recuperacion de funnels"],
        alt: "Vista previa de analitica de crecimiento de Rejourney",
      },
      {
        eyebrow: "Analitica geografica",
        title: "Ve respuesta de API y sentimiento por region.",
        copy: "Detecta donde cambian la latencia, los errores y el sentimiento de usuario entre paises antes de que los problemas regionales se conviertan en churn.",
        bullets: ["Tiempos de respuesta de API por ciudad", "Señales de sentimiento regional", "Salud geografica y contexto de sesion"],
        alt: "Vista previa del globo de analitica geografica de Rejourney",
      },
    ],
    faq: {
      eyebrow: "Preguntas",
      heading: "Preguntas comunes.",
      items: [
        {
          q: "Ya tenemos dashboards de analitica. ¿Por que necesitamos session replay?",
          a: "La analitica te dice que algo salio mal. Session replay te muestra por que. Un funnel puede decirte que 40% de los usuarios abandona checkout, pero solo el replay muestra que el formulario de pago se limpia con un error de validacion o que un boton queda oculto en un dispositivo concreto. Los numeros muestran el problema; el replay muestra la causa.",
        },
        {
          q: "¿Como nos ayuda Rejourney a encontrar friccion que no sabiamos que existia?",
          a: "La mayor parte de la friccion es invisible en las metricas porque los usuarios no la reportan. Simplemente se van. Rejourney muestra rage taps, dead taps, pantallas lentas y rutas de sesion inusuales para que veas exactamente donde sufren los usuarios antes de que aparezca como churn.",
        },
        {
          q: "¿Que cosas utiles puedo hacer con Rejourney?",
          a: "Una de las funciones mas potentes es el constructor de consultas con AI. En lugar de crear filtros complejos, describes lo que buscas en lenguaje natural y Rejourney encuentra las sesiones que coinciden. Puedes buscar cosas como \"usuarios que tocaron checkout pero no completaron el pago\" o \"sesiones donde la app se congelo durante onboarding\" y obtener replays reales de ese escenario.",
        },
        {
          q: "¿Esto nos ayuda a investigar crashes y bugs mas rapido?",
          a: "Si. La investigacion de crashes es uno de los usos de mayor valor. Cuando se reporta un crash, Rejourney te da el replay completo previo al problema, las solicitudes de red, la linea de eventos y el contexto del dispositivo. En lugar de pedirle al usuario que reproduzca el error, lo ves ocurrir.",
        },
        {
          q: "¿Rejourney funciona para mobile y web?",
          a: "Sí. Rejourney soporta Flutter en iOS y Android, iOS nativo con Swift, React Native y Expo, y apps web con nuestro JavaScript SDK. Todas las sesiones, mobile y web, llegan al mismo dashboard para que tu equipo tenga una vista unificada de la experiencia en todas las plataformas.",
        },
        {
          q: "¿Esto sirve para equipos de producto o solo para ingenieria?",
          a: "Para ambos. Ingenieria usa Rejourney para reproducir bugs y triar crashes sin pedir ayuda a usuarios. Producto lo usa para entender donde se rompe onboarding, que funciones no se usan y como se ve realmente la experiencia en dispositivos reales.",
        },
        {
          q: "¿Los datos de usuario se mantienen privados? ¿Puedo ocultar campos sensibles?",
          a: "Si. Por defecto, todos los inputs de texto se enmascaran en las grabaciones. Opcionalmente puedes usar el modo Secure Only, que solo oculta campos de contraseña y deja pasar inputs de texto plano. Nunca se capturan teclas sin procesar.",
        },
        {
          q: "¿Puedo self-hostear Rejourney?",
          a: "Si. Rejourney ofrece una opcion self-hosted siempre gratuita con Docker o K3s para equipos que necesitan control total de datos. Ejecutas el backend en tu propia infraestructura con el mismo dashboard y SDKs. Contacta ventas para configuracion y licencia.",
        },
      ],
    },
    trustEyebrow: "Workspace compartido",
    trustHeading: "Un workspace para toda la sala de producto.",
    trustCopy:
      "PMs, disenadores y desarrolladores trabajan desde la misma vista con replay: metricas a la izquierda, la sesion del usuario al centro y evidencia de timeline/API a la derecha.",
    trustCards: [
      {
        title: "Desarrolladores",
        copy: "Abre logs de consola, cambios DOM, llamadas API, errores y contexto del dispositivo junto al replay para reproducir la falla.",
      },
      {
        title: "PMs",
        copy: "Empieza por retencion, usuarios activos, sesiones degradadas e impacto de release, y salta a la sesion que explica la metrica.",
      },
      {
        title: "Disenadores",
        copy: "Mira taps, dudas, transiciones de pantalla y estado de UI para ver donde la experiencia deja de tener sentido.",
      },
      {
        title: "Sala de replay compartida",
        copy: "Todos senalan la misma sesion, frame, timestamp y evento en lugar de intercambiar capturas separadas.",
      },
      {
        title: "Handoff con evidencia",
        copy: "PMs marcan el patron, diseno senala la interaccion confusa y desarrollo fija la solicitud de red que necesita trabajo.",
      },
      {
        title: "Hilo de decision",
        copy: "Guarda metrica, replay, owner y siguiente accion juntos para convertir la revision del equipo en un plan claro.",
      },
    ],
    stats: {
      cheaper: "17x mas barato",
      cheaperCopy: "Que algunas de las herramientas mas baratas de session replay y analitica de producto del mercado.",
      freeSessions: "5k sesiones gratis",
      everyMonth: "Cada mes",
      allFeatures: "Todas las funciones",
      allFeaturesCopy: "Replay, heatmaps, crashes, journeys",
    },
  },
  performance: {
    headingPrimary: "Huella minima.",
    headingSecondary: "Impacto extremo.",
    bundleSummary: (ratio, packageName, version) =>
      `Bundle JS minificado ${ratio}x mas pequeno que ${packageName}@${version} (BundlePhobia)`,
    smallerBundle: "Bundle JS mas pequeno",
    chartTitle: "Tamaño del bundle npm (BundlePhobia)",
    gzip: "Gzip",
    minifiedMinusGzip: "Minificado - gzip",
    chartNote: "Altura de barra = tamaño minificado; segmento oscuro = transferencia gzip, igual que BundlePhobia.",
    minified: "minificado",
    gzipped: "kB gzip",
    bundlePhobiaVersion: (version) => `BundlePhobia @${version}`,
    transitiveNote: "Incluye dependencias transitivas npm en el modelo de BundlePhobia.",
    metricsTitle: "Metricas de rendimiento",
    metricsNotePrefix: "iPhone 15 Pro; iOS 18; Expo SDK 54; React Native New Architecture. Ejecutado en",
    metricsNoteApp: "Merch App",
    metricsNoteSuffix: "Build de produccion.",
    tableMetric: "Metrica",
    tableAverage: "Promedio (ms)",
    tableMax: "Max (ms)",
    tableMin: "Min (ms)",
    tableThread: "Hilo",
    tableAvgShort: "Prom",
    tableMaxShort: "Max",
    tableMinShort: "Min",
    metricRows: [
      { metric: "Principal: captura UIKit + Metal", thread: "Principal" },
      { metric: "BG: procesamiento asincrono de imagen", thread: "Fondo" },
      { metric: "BG: compresion Tar+Gzip", thread: "Fondo" },
      { metric: "BG: handshake de subida", thread: "Fondo" },
      { metric: "Impacto total en hilo principal", thread: "Principal" },
    ],
  },
  engineeringCta: {
    badges: ["Open source", "Autohospedable"],
    headingBefore: "Decisiones",
    headingAccent: "de ingenieria",
    headingAfter: "abiertas y documentadas.",
    primary: "Ver decisiones de ingenieria",
    secondary: "Empezar a construir",
  },
  roadmap: {
    metaTitle: "Hoja de ruta - Rejourney",
    metaDescription: "Vota por ideas de la hoja de ruta de Rejourney y comparte lo que quieres que el equipo construya despues.",
    ogDescription: "Vota por ideas de la hoja de ruta de Rejourney y comparte lo que quieres despues.",
    eyebrow: "Nuevo",
    title: "Hoja de ruta",
    intro: "Vota por lo que deberia venir despues o agrega la funcion que quieres que Rejourney construya.",
    signInToPost: "Inicia sesion para publicar",
    addIdeaTitle: "Agrega una idea",
    signInFirst: "Inicia sesion primero y luego agrega tu idea.",
    ideaPlaceholder: "IDEA",
    detailsPlaceholder: "DETALLES",
    postButton: "Publicar",
    signInToAddIdea: "Inicia sesion para agregar una idea",
    ideaMinError: "La idea necesita al menos 3 caracteres.",
    detailsMinError: "Los detalles necesitan al menos 10 caracteres.",
    unableToLoad: "No se pudieron cargar las publicaciones de la hoja de ruta.",
    unableToUpdateVote: "No se pudo actualizar tu voto.",
    unableToAddIdea: "No se pudo agregar esa idea.",
    showLess: "Mostrar menos",
    showMore: "Mostrar mas",
    developerComment: "Comentario del desarrollador",
    vote: "Votar",
    unvote: "Quitar voto",
    voteSingular: "voto",
    votePlural: "votos",
    open: "Abierto",
    complete: "Completo",
    noOpenIdeas: "Aun no hay ideas abiertas",
    noOpenIdeasCopy: "Se la primera persona en poner algo en el tablero.",
    nothingComplete: "Nada completo todavia",
    nothingCompleteCopy: "Los elementos completados de la hoja de ruta apareceran aqui.",
    votesHeader: "Votos",
    ideaHeader: "Idea",
    detailsHeader: "Detalles",
    voteActionAria: "Accion de voto",
    loadingRoadmap: "Cargando hoja de ruta",
  },
};

const turkishHomeCopy: MarketingHomeCopy = {
  ...englishHomeCopy,
  header: {
    ...englishHomeCopy.header,
    ariaLabel: "Site navigasyonu",
    mobileAriaLabel: "Mobil site navigasyonu",
    logoAlt: "Rejourney | Acik kaynak oturum replay ve gozlemlenebilirlik",
    engineering: "Muhendislik",
    docs: "Dokumanlar",
    roadmap: "Yol haritasi",
    newBadge: "Yeni",
    pricing: "Fiyatlar",
    selfHosted: "Self-host",
    dashboard: "Panel",
    login: "Giris yap",
  },
  footer: {
    ...englishHomeCopy.footer,
    dashboard: "Panel",
    docs: "Dokumanlar",
    engineering: "Muhendislik",
    changelog: "Degisiklikler",
    pricing: "Fiyatlar",
    selfHosted: "Self-host",
    login: "Giris",
    terms: "Kosullar",
    dpa: "DPA",
    privacy: "Gizlilik",
    contact: "Iletisim",
    copyEmailToast: "E-posta panoya kopyalandi!",
    xAriaLabel: "X uzerinde Rejourney",
    linkedinAriaLabel: "LinkedIn uzerinde Rejourney",
    githubAriaLabel: "GitHub uzerinde Rejourney",
    copyright: "© 2026 Rejourney. Tum haklari saklidir.",
  },
  hero: {
    ariaLabel: "Hero bolumu",
    description:
      "Kullanicilarini gor. Onlarin yerine gec.",
  },
  trust: {
    ...englishHomeCopy.trust,
    ariaLabel: "Guven ve desteklenen platformlar",
  },
  narrative: {
    loopEyebrow: "Web ve mobil insight dongusu",
    loopHeadingLines: ["Kullanicilarin", "neden ayrildigini", "tahmin etme."],
    loopIntro:
      "Rejourney, ekiplerin urun kararlarini alma sekline gore kuruldu: ne oldugunu izle, paterni anla ve sonraki surum ayni sorunu tekrar etmeden harekete gec.",
    tableStep: "Adim",
    tableCatches: "Rejourney ne yakalar",
    tableNext: "Ekip sonra ne yapar",
    loopStage: "Dongu asamasi",
    steps: [
      {
        label: "Izle",
        title: "Tam kullanici oturumunu yeniden oynat",
        signal: "Ekranlar, tiklamalar, dokunuslar, kaydirmalar, navigasyon, cokmeler ve ag baglami.",
        move: "Bir grafikten tahmin etmek yerine kullanicinin duraksadigi ani birebir gor.",
      },
      {
        label: "Anla",
        title: "Surtunme paternini bul",
        signal: "Heatmapler, yolculuklar, rage tapler, crash raporlari ve ANR.",
        move: "Tek bir garip oturumu ekibin adlandirabilecegi tekrar eden bir paterne cevir.",
      },
      {
        label: "Harekete gec",
        title: "Duzeltmeyi guvenle yayinla",
        signal: "Urun, muhendislik, destek ve buyume ekipleri icin replay destekli kanit.",
        move: "Sonraki surum ayni hatayi tekrar etmeden neyin duzeltilecegine karar ver.",
      },
    ],
    signalsEyebrow: "Neleri gorebilirsin",
    signalsHeading: "Web ve mobil ekiplerin ihtiyac duydugu sinyaller tek yerde.",
    demoCta: "Canli demoyu gor",
    productStories: [
      {
        eyebrow: "Oturum kayitlari",
        title: "Gercek kullanicilarin uygulamada nasil ilerledigini izle.",
        copy: "Herkesin ilk sordugu soruya cevap verecek baglamla web ve mobil oturumlari yeniden oynat: gercekte ne oldu?",
        bullets: ["Pixel-perfect replay", "Tiklama, dokunus ve ekran degisimleri", "Ag, log ve cihaz baglami"],
        alt: "Rejourney oturum replay onizlemesi",
      },
      {
        eyebrow: "Heatmapler ve yolculuklar",
        title: "Neyin dikkat cektigini ve kullanicilarin nerede dustugunu gor.",
        copy: "Dagitik tap, swipe, scroll ve cikislari donusume yardim eden veya zarar veren ekranlarin haritasina cevir.",
        bullets: ["Tap ve rage tap kumeleri", "Ekranlar arasi yolculuk haritalari", "Akisa gore terk noktalar"],
        alt: "Rejourney dokunus heatmap onizlemesi",
      },
      {
        eyebrow: "Crashler ve ANR",
        title: "Bozuk deneyimleri onlara neden olan oturuma bagla.",
        copy: "Crash raporlama; replay, thread analizi, cihaz detaylari ve kullanici yolu ile yan yana oldugunda cok daha kullanislidir.",
        bullets: ["Crash ve ANR tespiti", "Ana thread performans ipuclari", "Triyaj icin incident akisi"],
        alt: "Rejourney ANR ve crash tespit onizlemesi",
      },
      {
        eyebrow: "Buyume donguleri",
        title: "Urun kalitesini retention ile bagla.",
        copy: "Surumlerin daha iyi oturumlar, daha sakin funnel'lar ve geri donen daha fazla kullanici yaratip yaratmadigini olc.",
        bullets: ["Retention ve sadakat segmentleri", "Surum etkisi sinyalleri", "Funnel kurtarma firsatlari"],
        alt: "Rejourney buyume analitigi onizlemesi",
      },
      {
        eyebrow: "Cografi analitik",
        title: "API yanitini ve duyarliligi bolgeye gore gor.",
        copy: "Bolgesel sorunlar churn'e donusmeden once latency, hata ve kullanici duyarliliginin ulkeler arasinda nerede degistigini yakala.",
        bullets: ["Sehre gore API yanit sureleri", "Bolgesel duyarlilik sinyalleri", "Geo saglik ve oturum baglami"],
        alt: "Rejourney cografi analitik kure onizlemesi",
      },
    ],
    faq: {
      eyebrow: "SSS",
      heading: "Sik sorulan sorular.",
      items: [
        {
          q: "Zaten analitik dashboardlarimiz var. Neden session replay'e ihtiyacimiz var?",
          a: "Analitik sana bir seyin ters gittigini soyler. Session replay nedenini gosterir. Funnel grafigi kullanicilarin %40'inin checkout'u terk ettigini soyleyebilir, ama sadece replay odeme formunun validation hatasinda temizlendigini veya belirli bir cihazda bir butonun kapandigini gosterir. Rakamlar problemi, replay nedeni ortaya cikarir.",
        },
        {
          q: "Rejourney var oldugunu bilmedigimiz kullanici surtunmesini nasil bulur?",
          a: "Surtunmenin cogu metriklerde gorunmez cunku kullanicilar bunu raporlamaz; sadece ayrilir. Rejourney rage tapleri, dead tapleri, yavas ekranlari ve olagandisi oturum yollarini yuzeye cikarir, boylece churn'e donusmeden once kullanicilarin nerede zorlandigini gorursun.",
        },
        {
          q: "Rejourney ile gercekten hangi faydali seyleri yapabilirim?",
          a: "En guclu ozelliklerden biri AI query builder. Karmasik filtreler kurmak yerine aradigin seyi dogal dille anlatirsin, Rejourney eslesen oturumlari bulur. \"Checkout butonuna dokunup odemeyi tamamlamayan kullanicilar\" veya \"onboarding sirasinda uygulamanin dondugu oturumlar\" gibi aramalarla gercek replay listeleri alabilirsin.",
        },
        {
          q: "Crash ve bug arastirmasini daha hizli yapmamiza yardimci olur mu?",
          a: "Evet. Crash arastirmasi en yuksek degerli kullanim alanlarindan biridir. Bir crash raporlandiginda Rejourney sana oncesindeki tam session replay'i, network isteklerini, event timeline'ini ve cihaz baglamini verir. Kullanicidan sorunu tekrar uretmesini istemek yerine olay olurken izlersin.",
        },
        {
          q: "Rejourney hem mobile hem web icin calisir mi?",
          a: "Evet. Rejourney iOS ve Android'de Flutter'i, Swift ile native iOS'u, React Native ve Expo'yu ve JavaScript SDK ile web uygulamalarini destekler. Mobil ve web tum oturumlar ayni dashboard'a akar, boylece ekip platformlar arasinda birlesik bir deneyim gorunumune sahip olur.",
        },
        {
          q: "Bu urun ekipleri icin mi, yoksa sadece muhendislik icin mi?",
          a: "Ikisi icin de. Muhendislik ekipleri kullanicilara sormadan buglari yeniden uretmek ve crashleri triyaj etmek icin Rejourney kullanir. Urun ekipleri onboarding'in nerede bozuldugunu, hangi ozelliklerin kullanilmadigini ve deneyimin gercek cihazlarda nasil gorundugunu anlamak icin kullanir.",
        },
        {
          q: "Kullanici verisi gizli kalir mi? Hassas alanlari maskeleyebilir miyim?",
          a: "Evet. Varsayilan olarak kayitlarda tum metin inputlari maskelenir. Istersen Secure Only moduna gecebilirsin; bu mod sadece parola turu alanlari maskeler ve duz metin inputlarini gecirir. Ham tus vuruslari hicbir zaman yakalanmaz.",
        },
        {
          q: "Rejourney'i self-host edebilir miyim?",
          a: "Evet. Rejourney, tam veri kontrolune ihtiyac duyan ekipler icin Docker veya K3s ile her zaman ucretsiz self-hosted secenegi sunar. Backend'i kendi altyapinda ayni dashboard ve SDK'larla calistirirsin. Kurulum ve lisanslama icin sales ile iletisime gec.",
        },
      ],
    },
    trustEyebrow: "Ortak ekip workspace'i",
    trustHeading: "Tum urun odasi icin tek workspace.",
    trustCopy:
      "PM'ler, tasarimcilar ve gelistiriciler ayni replay destekli gorunumden calisir: solda metrikler, ortada kullanici oturumu, sagda timeline/API kaniti.",
    trustCards: [
      {
        title: "Gelistiriciler",
        copy: "Hatayi yeniden uretmek icin console loglari, DOM degisiklikleri, API cagrilari, hatalar ve cihaz baglamini replay'in yaninda ac.",
      },
      {
        title: "PM'ler",
        copy: "Retention, aktif kullanicilar, degrade oturumlar ve release etkisinden basla; metrigi aciklayan oturuma gec.",
      },
      {
        title: "Tasarimcilar",
        copy: "Deneyimin nerede anlamini kaybettigini gormek icin tap'leri, tereddudu, ekran gecislerini ve UI durumunu izle.",
      },
      {
        title: "Ortak replay odasi",
        copy: "Ayri ekran goruntuleri yerine herkes ayni oturum UID'sine, frame'e, timestamp'e ve event'e isaret eder.",
      },
      {
        title: "Kanitli handoff",
        copy: "PM paterni isaretler, tasarim kafa karistiran etkilesimi belirler, gelistirici calisilacak network istegini pinler.",
      },
      {
        title: "Karar thread'i",
        copy: "Metrigi, replay'i, owner'i ve sonraki aksiyonu birlikte tut; ekip incelemesi net bir fix planina donussun.",
      },
    ],
    stats: {
      cheaper: "17x daha ucuz",
      cheaperCopy: "Sektordeki en ucuz session replay ve urun analitigi araclarindan bazilarina gore.",
      freeSessions: "Ucretsiz 5k oturum",
      everyMonth: "Her ay",
      allFeatures: "Tum ozellikler",
      allFeaturesCopy: "Replay, heatmapler, crashler, yolculuklar",
    },
  },
  performance: {
    headingPrimary: "Kucuk iz.",
    headingSecondary: "Buyuk etki.",
    bundleSummary: (ratio, packageName, version) =>
      `${packageName}@${version} ile karsilastirildiginda ${ratio}x daha kucuk minified JS bundle (BundlePhobia)`,
    smallerBundle: "Daha kucuk JS bundle",
    chartTitle: "Npm bundle boyutu (BundlePhobia)",
    gzip: "Gzip",
    minifiedMinusGzip: "Minified - gzip",
    chartNote: "Bar yuksekligi = minified boyut; koyu segment = gzip transfer boyutu, BundlePhobia ile ayni.",
    minified: "minified",
    gzipped: "kB gzip",
    bundlePhobiaVersion: (version) => `BundlePhobia @${version}`,
    transitiveNote: "BundlePhobia modelindeki gecisli npm bagimliliklarini icerir.",
    metricsTitle: "Performans metrikleri",
    metricsNotePrefix: "iPhone 15 Pro; iOS 18; Expo SDK 54; React Native New Architecture. Calistigi uygulama",
    metricsNoteApp: "Merch App",
    metricsNoteSuffix: "Production build.",
    tableMetric: "Metrik",
    tableAverage: "Ortalama (ms)",
    tableMax: "Maks (ms)",
    tableMin: "Min (ms)",
    tableThread: "Thread",
    tableAvgShort: "Ort",
    tableMaxShort: "Maks",
    tableMinShort: "Min",
    metricRows: [
      { metric: "Main: UIKit + Metal Capture", thread: "Main" },
      { metric: "BG: Async Image Processing", thread: "Background" },
      { metric: "BG: Tar+Gzip Compression", thread: "Background" },
      { metric: "BG: Upload Handshake", thread: "Background" },
      { metric: "Toplam main thread etkisi", thread: "Main" },
    ],
  },
  engineeringCta: {
    badges: ["Acik kaynak", "Self-host edilebilir"],
    headingBefore: "Acik ve belgelenmis",
    headingAccent: "muhendislik",
    headingAfter: "kararlari.",
    primary: "Muhendislik kararlarini gor",
    secondary: "Gelistirmeye basla",
  },
  roadmap: {
    metaTitle: "Yol haritasi - Rejourney",
    metaDescription: "Rejourney yol haritasi fikirlerine oy ver ve ekibin sirada ne insa etmesini istedigini paylas.",
    ogDescription: "Rejourney yol haritasi fikirlerine oy ver ve sirada ne istedigini paylas.",
    eyebrow: "Yeni",
    title: "Yol haritasi",
    intro: "Sirada ne gelmeli, oy ver; ya da Rejourney'in insa etmesini istedigin ozelligi ekle.",
    signInToPost: "Paylasmak icin giris yap",
    addIdeaTitle: "Fikir ekle",
    signInFirst: "Once giris yap, sonra fikrini ekle.",
    ideaPlaceholder: "FIKIR",
    detailsPlaceholder: "DETAYLAR",
    postButton: "Paylas",
    signInToAddIdea: "Fikir eklemek icin giris yap",
    ideaMinError: "Fikir en az 3 karakter olmali.",
    detailsMinError: "Detaylar en az 10 karakter olmali.",
    unableToLoad: "Yol haritasi gonderileri yuklenemedi.",
    unableToUpdateVote: "Oyun guncellenemedi.",
    unableToAddIdea: "Bu fikir eklenemedi.",
    showLess: "Daha az goster",
    showMore: "Daha fazla goster",
    developerComment: "Gelistirici yorumu",
    vote: "Oy ver",
    unvote: "Oyu kaldir",
    voteSingular: "oy",
    votePlural: "oy",
    open: "Acik",
    complete: "Tamamlandi",
    noOpenIdeas: "Henuz acik fikir yok",
    noOpenIdeasCopy: "Panoya bir sey ekleyen ilk kisi ol.",
    nothingComplete: "Henuz tamamlanan yok",
    nothingCompleteCopy: "Tamamlanan yol haritasi maddeleri burada gorunecek.",
    votesHeader: "Oylar",
    ideaHeader: "Fikir",
    detailsHeader: "Detaylar",
    voteActionAria: "Oy islemi",
    loadingRoadmap: "Yol haritasi yukleniyor",
  },
};

export function getMarketingHomeCopy(localeOrPath: MarketingLocale | string): MarketingHomeCopy {
  const locale =
    typeof localeOrPath === "string"
      ? getMarketingLocaleFromPathname(localeOrPath)
      : localeOrPath;

  if (locale.code === "ar") return arabicHomeCopy;
  if (locale.code === "es") return spanishHomeCopy;
  if (locale.code === "tr") return turkishHomeCopy;

  return englishHomeCopy;
}
