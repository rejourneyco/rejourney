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
  | "zh-cn";

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

const SITE_URL = "https://rejourney.co";

const englishFeatures: MarketingFeatureCopy[] = [
  { title: "Session", highlight: "Replay", badge: "Replay" },
  { title: "Incident", highlight: "Stream", badge: "Live" },
  { title: "Crash", highlight: "Detection", badge: "ANR" },
  { title: "Journey", highlight: "Maps", badge: "Flows" },
  { title: "Touch", highlight: "Heatmaps", badge: "Taps" },
  { title: "Global", highlight: "Stability", badge: "Geo" },
  { title: "Growth", highlight: "Loops", badge: "Retention" },
  { title: "Team", highlight: "Alerts", badge: "Teams" },
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
    metaTitle: "Rejourney: Open Source Mobile Analytics, Session Replay & Observability",
    metaDescription:
      "Open-source mobile analytics for iOS, Android, Expo, and React Native apps with replay, crashes, heatmaps, journeys, and a light SDK.",
    keywords: [
      "open source mobile analytics",
      "mobile session replay",
      "mobile observability",
      "mobile heatmaps",
      "crash reporting",
      "Expo analytics",
      "Swift iOS analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - Open Source Mobile App Analytics",
    hero: {
      headlinePrimary: "Creative analytics.",
      headlineSecondary: "Light SDK.",
      primaryCta: "Get started free",
      secondaryCta: "Self-host instead",
    },
    featuresHeading: "Mobile stack.",
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
    metaTitle: "Rejourney: تحليلات جوال مفتوحة المصدر وإعادة تشغيل الجلسات",
    metaDescription:
      "تحليلات ومراقبة مفتوحة المصدر لتطبيقات iOS وAndroid وExpo وReact Native مع إعادة تشغيل الجلسات، الأعطال، الخرائط الحرارية، ورحلات المستخدم.",
    keywords: [
      "تحليلات تطبيقات الجوال مفتوحة المصدر",
      "إعادة تشغيل جلسات الجوال",
      "مراقبة تطبيقات الجوال",
      "خرائط حرارية للجوال",
      "تقارير الأعطال",
      "تحليلات React Native",
      "تحليلات Expo",
      "استضافة ذاتية للتحليلات",
    ],
    mainAriaLabel: "Rejourney - تحليلات تطبيقات الجوال مفتوحة المصدر",
    hero: {
      headlinePrimary: "تحليلات إبداعية.",
      headlineSecondary: "SDK خفيف.",
      primaryCta: "ابدأ مجانًا",
      secondaryCta: "استضافة ذاتية",
    },
    featuresHeading: "منصة الجوال.",
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
    metaTitle: "Rejourney: Analítica móvil open source, replay de sesiones y observabilidad",
    metaDescription:
      "Analítica móvil open source para iOS, Android, Expo y React Native con replay de sesiones, crashes, mapas de calor, journeys y un SDK ligero.",
    keywords: [
      "analítica móvil open source",
      "replay de sesiones móviles",
      "observabilidad móvil",
      "mapas de calor móviles",
      "reporte de crashes",
      "analítica React Native",
      "analítica Expo",
      "analítica self-hosted",
    ],
    mainAriaLabel: "Rejourney - Analítica móvil open source",
    hero: {
      headlinePrimary: "Analítica creativa.",
      headlineSecondary: "SDK ligero.",
      primaryCta: "Empieza gratis",
      secondaryCta: "Autohospedar",
    },
    featuresHeading: "Stack móvil.",
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
    metaTitle: "Rejourney: Açık kaynak mobil analitik, oturum kaydı ve gözlemlenebilirlik",
    metaDescription:
      "iOS, Android, Expo ve React Native uygulamaları için oturum yeniden oynatma, çökme izleme, ısı haritaları, kullanıcı yolculukları ve hafif SDK.",
    keywords: [
      "açık kaynak mobil analitik",
      "mobil oturum yeniden oynatma",
      "mobil gözlemlenebilirlik",
      "mobil ısı haritaları",
      "çökme raporlama",
      "React Native analitik",
      "Expo analitik",
      "self-hosted analitik",
    ],
    mainAriaLabel: "Rejourney - Açık kaynak mobil uygulama analitiği",
    hero: {
      headlinePrimary: "Yaratıcı analitik.",
      headlineSecondary: "Hafif SDK.",
      primaryCta: "Ücretsiz başla",
      secondaryCta: "Kendin barındır",
    },
    featuresHeading: "Mobil stack.",
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
    metaTitle: "Rejourney: Analytics mobile open source, replay de sessão e observabilidade",
    metaDescription:
      "Analytics mobile open source para iOS, Android, Expo e React Native com replay de sessão, crashes, mapas de calor, jornadas e SDK leve.",
    keywords: [
      "analytics mobile open source",
      "replay de sessão mobile",
      "observabilidade mobile",
      "mapas de calor mobile",
      "relatório de crashes",
      "analytics React Native",
      "analytics Expo",
      "analytics self-hosted",
    ],
    mainAriaLabel: "Rejourney - Analytics mobile open source",
    hero: {
      headlinePrimary: "Analytics criativo.",
      headlineSecondary: "SDK leve.",
      primaryCta: "Comece grátis",
      secondaryCta: "Hospede você mesmo",
    },
    featuresHeading: "Stack mobile.",
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
    metaTitle: "Rejourney: Open-Source-Mobile-Analytics, Session Replay und Observability",
    metaDescription:
      "Open-Source-Mobile-Analytics für iOS, Android, Expo und React Native mit Session Replay, Crash-Reporting, Heatmaps, Journeys und leichtem SDK.",
    keywords: [
      "Open Source Mobile Analytics",
      "Mobile Session Replay",
      "Mobile Observability",
      "Mobile Heatmaps",
      "Crash Reporting",
      "React Native Analytics",
      "Expo Analytics",
      "Self-Hosted Analytics",
    ],
    mainAriaLabel: "Rejourney - Open-Source-Mobile-App-Analytics",
    hero: {
      headlinePrimary: "Kreative Analytics.",
      headlineSecondary: "Leichtes SDK.",
      primaryCta: "Kostenlos starten",
      secondaryCta: "Selbst hosten",
    },
    featuresHeading: "Mobile Stack.",
    featuresEyebrow: "Acht Signale",
    features: [
      { title: "Session", highlight: "Replay", badge: "Replay" },
      { title: "Incident", highlight: "Stream", badge: "Live" },
      { title: "Crash", highlight: "Erkennung", badge: "ANR" },
      { title: "Journey", highlight: "Maps", badge: "Flows" },
      { title: "Touch", highlight: "Heatmaps", badge: "Taps" },
      { title: "Globale", highlight: "Stabilität", badge: "Geo" },
      { title: "Growth", highlight: "Loops", badge: "Retention" },
      { title: "Team", highlight: "Alerts", badge: "Teams" },
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
    metaTitle: "Rejourney: Analytics mobile open source, replay de session et observabilité",
    metaDescription:
      "Analytics mobile open source pour iOS, Android, Expo et React Native avec replay de session, crashs, heatmaps, parcours utilisateur et SDK léger.",
    keywords: [
      "analytics mobile open source",
      "replay de session mobile",
      "observabilité mobile",
      "heatmaps mobile",
      "rapport de crash",
      "analytics React Native",
      "analytics Expo",
      "analytics self-hosted",
    ],
    mainAriaLabel: "Rejourney - Analytics mobile open source",
    hero: {
      headlinePrimary: "Analytics créative.",
      headlineSecondary: "SDK léger.",
      primaryCta: "Démarrer gratuitement",
      secondaryCta: "Auto-héberger",
    },
    featuresHeading: "Stack mobile.",
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
    metaTitle: "Rejourney: ओपन-सोर्स मोबाइल एनालिटिक्स, सेशन रीप्ले और ऑब्जर्वेबिलिटी",
    metaDescription:
      "iOS, Android, Expo और React Native ऐप्स के लिए ओपन-सोर्स मोबाइल एनालिटिक्स: सेशन रीप्ले, क्रैश, हीटमैप, यूजर जर्नी और हल्का SDK.",
    keywords: [
      "ओपन सोर्स मोबाइल एनालिटिक्स",
      "मोबाइल सेशन रीप्ले",
      "मोबाइल ऑब्जर्वेबिलिटी",
      "मोबाइल हीटमैप",
      "क्रैश रिपोर्टिंग",
      "React Native analytics",
      "Expo analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - ओपन-सोर्स मोबाइल ऐप एनालिटिक्स",
    hero: {
      headlinePrimary: "क्रिएटिव एनालिटिक्स.",
      headlineSecondary: "हल्का SDK.",
      primaryCta: "मुफ्त शुरू करें",
      secondaryCta: "स्वयं होस्ट करें",
    },
    featuresHeading: "मोबाइल स्टैक.",
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
    metaTitle: "Rejourney: Analitik mobile open source, session replay, dan observability",
    metaDescription:
      "Analitik mobile open source untuk iOS, Android, Expo, dan React Native dengan session replay, crash, heatmap, journey, dan SDK ringan.",
    keywords: [
      "analitik mobile open source",
      "session replay mobile",
      "observability mobile",
      "heatmap mobile",
      "crash reporting",
      "analitik React Native",
      "analitik Expo",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - Analitik aplikasi mobile open source",
    hero: {
      headlinePrimary: "Analitik kreatif.",
      headlineSecondary: "SDK ringan.",
      primaryCta: "Mulai gratis",
      secondaryCta: "Self-host",
    },
    featuresHeading: "Stack mobile.",
    featuresEyebrow: "Delapan sinyal",
    features: [
      { title: "Session", highlight: "Replay", badge: "Replay" },
      { title: "Incident", highlight: "Stream", badge: "Live" },
      { title: "Crash", highlight: "Detection", badge: "ANR" },
      { title: "Journey", highlight: "Maps", badge: "Flows" },
      { title: "Touch", highlight: "Heatmap", badge: "Tap" },
      { title: "Stabilitas", highlight: "Global", badge: "Geo" },
      { title: "Growth", highlight: "Loops", badge: "Retensi" },
      { title: "Team", highlight: "Alerts", badge: "Tim" },
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
    metaTitle: "Rejourney: オープンソースのモバイル分析、セッションリプレイ、Observability",
    metaDescription:
      "iOS、Android、Expo、React Native向けの軽量SDKで、セッションリプレイ、クラッシュ、ヒートマップ、ジャーニーを扱うオープンソースのモバイル分析基盤。",
    keywords: [
      "オープンソース モバイル分析",
      "モバイル セッションリプレイ",
      "モバイル Observability",
      "モバイル ヒートマップ",
      "クラッシュレポート",
      "React Native analytics",
      "Expo analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - オープンソースのモバイルアプリ分析",
    hero: {
      headlinePrimary: "創造的な分析。",
      headlineSecondary: "軽量SDK。",
      primaryCta: "無料で始める",
      secondaryCta: "セルフホスト",
    },
    featuresHeading: "モバイル基盤。",
    featuresEyebrow: "8つのシグナル",
    features: [
      { title: "セッション", highlight: "リプレイ", badge: "Replay" },
      { title: "インシデント", highlight: "ストリーム", badge: "Live" },
      { title: "クラッシュ", highlight: "検知", badge: "ANR" },
      { title: "ジャーニー", highlight: "マップ", badge: "Flows" },
      { title: "タッチ", highlight: "ヒートマップ", badge: "Taps" },
      { title: "グローバル", highlight: "安定性", badge: "Geo" },
      { title: "成長", highlight: "ループ", badge: "Retention" },
      { title: "チーム", highlight: "アラート", badge: "Teams" },
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
    metaTitle: "Rejourney: 오픈소스 모바일 분석, 세션 리플레이, 옵저버빌리티",
    metaDescription:
      "iOS, Android, Expo, React Native 앱을 위한 오픈소스 모바일 분석. 세션 리플레이, 크래시, 히트맵, 사용자 여정, 가벼운 SDK를 제공합니다.",
    keywords: [
      "오픈소스 모바일 분석",
      "모바일 세션 리플레이",
      "모바일 옵저버빌리티",
      "모바일 히트맵",
      "크래시 리포팅",
      "React Native analytics",
      "Expo analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - 오픈소스 모바일 앱 분석",
    hero: {
      headlinePrimary: "창의적인 분석.",
      headlineSecondary: "가벼운 SDK.",
      primaryCta: "무료로 시작",
      secondaryCta: "셀프 호스팅",
    },
    featuresHeading: "모바일 스택.",
    featuresEyebrow: "8가지 신호",
    features: [
      { title: "세션", highlight: "리플레이", badge: "Replay" },
      { title: "인시던트", highlight: "스트림", badge: "Live" },
      { title: "크래시", highlight: "감지", badge: "ANR" },
      { title: "여정", highlight: "맵", badge: "Flows" },
      { title: "터치", highlight: "히트맵", badge: "Taps" },
      { title: "글로벌", highlight: "안정성", badge: "Geo" },
      { title: "성장", highlight: "루프", badge: "Retention" },
      { title: "팀", highlight: "알림", badge: "Teams" },
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
    metaTitle: "Rejourney：开源移动分析、会话回放与可观测性",
    metaDescription:
      "面向 iOS、Android、Expo 和 React Native 应用的开源移动分析，包含会话回放、崩溃、热力图、用户旅程和轻量 SDK。",
    keywords: [
      "开源移动分析",
      "移动端会话回放",
      "移动应用可观测性",
      "移动热力图",
      "崩溃报告",
      "React Native analytics",
      "Expo analytics",
      "self-hosted analytics",
    ],
    mainAriaLabel: "Rejourney - 开源移动应用分析",
    hero: {
      headlinePrimary: "创意分析。",
      headlineSecondary: "轻量 SDK。",
      primaryCta: "免费开始",
      secondaryCta: "自托管",
    },
    featuresHeading: "移动端技术栈。",
    featuresEyebrow: "八个信号",
    features: [
      { title: "会话", highlight: "回放", badge: "Replay" },
      { title: "事件", highlight: "流", badge: "Live" },
      { title: "崩溃", highlight: "检测", badge: "ANR" },
      { title: "旅程", highlight: "地图", badge: "Flows" },
      { title: "触控", highlight: "热力图", badge: "Taps" },
      { title: "全球", highlight: "稳定性", badge: "Geo" },
      { title: "增长", highlight: "循环", badge: "Retention" },
      { title: "团队", highlight: "告警", badge: "Teams" },
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
];

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

export function getMarketingLocaleUrl(locale: MarketingLocale): string {
  return `${SITE_URL}${locale.path}`;
}

export function getMarketingAlternateLinks() {
  return [
    ...MARKETING_LOCALE_ORDER.map((code) => {
      const locale = MARKETING_LOCALES[code];
      return {
        hrefLang: locale.languageTag,
        href: getMarketingLocaleUrl(locale),
      };
    }),
    {
      hrefLang: "x-default",
      href: `${SITE_URL}/`,
    },
  ];
}

export const MARKETING_LOCALE_VARY_HEADER =
  "Accept-Language, CF-IPCountry, CloudFront-Viewer-Country, X-Vercel-IP-Country, X-Country-Code";

const COUNTRY_LOCALE_MAP: Record<string, MarketingLocaleCode> = {
  AE: "ar",
  BH: "ar",
  DZ: "ar",
  DJ: "ar",
  EG: "ar",
  IQ: "ar",
  JO: "ar",
  KM: "ar",
  KW: "ar",
  LB: "ar",
  LY: "ar",
  MA: "ar",
  MR: "ar",
  OM: "ar",
  PS: "ar",
  QA: "ar",
  SA: "ar",
  SD: "ar",
  SO: "ar",
  SY: "ar",
  TN: "ar",
  YE: "ar",
  AR: "es",
  BO: "es",
  BZ: "es",
  CL: "es",
  CO: "es",
  CR: "es",
  CU: "es",
  DO: "es",
  EC: "es",
  ES: "es",
  GQ: "es",
  GT: "es",
  HN: "es",
  MX: "es",
  NI: "es",
  PA: "es",
  PE: "es",
  PR: "es",
  PY: "es",
  SV: "es",
  UY: "es",
  VE: "es",
  CY: "tr",
  TR: "tr",
  BR: "pt-br",
  PT: "pt-br",
  AO: "pt-br",
  MZ: "pt-br",
  DE: "de",
  AT: "de",
  CH: "de",
  FR: "fr",
  BE: "fr",
  SN: "fr",
  CI: "fr",
  IN: "hi",
  ID: "id",
  JP: "ja",
  KR: "ko",
  CN: "zh-cn",
  SG: "zh-cn",
};

const LANGUAGE_LOCALE_MAP: Record<string, MarketingLocaleCode> = {
  ar: "ar",
  es: "es",
  tr: "tr",
  pt: "pt-br",
  de: "de",
  fr: "fr",
  hi: "hi",
  id: "id",
  ja: "ja",
  ko: "ko",
  zh: "zh-cn",
  en: "en",
};

function normalizeCountryCode(countryCode: string | null | undefined): string | null {
  const normalized = countryCode?.trim().toUpperCase();
  return normalized && normalized !== "XX" && normalized !== "T1" ? normalized : null;
}

function getHeaderValue(headers: Headers, names: string[]): string | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value) return value;
  }
  return null;
}

export function getMarketingLocaleFromCountryCode(countryCode: string | null | undefined): MarketingLocale | null {
  const normalized = normalizeCountryCode(countryCode);
  if (!normalized) return null;
  const localeCode = COUNTRY_LOCALE_MAP[normalized];
  return localeCode ? MARKETING_LOCALES[localeCode] : null;
}

export function getMarketingLocaleFromAcceptLanguage(acceptLanguage: string | null | undefined): MarketingLocale | null {
  if (!acceptLanguage) return null;

  const requested = acceptLanguage
    .split(",")
    .map((part) => {
      const [rawTag, ...params] = part.trim().split(";");
      const qParam = params.find((param) => param.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return {
        tag: rawTag.trim().replace("_", "-").toLowerCase(),
        q: Number.isFinite(q) ? q : 1,
      };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of requested) {
    const exactLocale = MARKETING_LOCALE_ORDER.find((code) => {
      const locale = MARKETING_LOCALES[code];
      return locale.languageTag.toLowerCase() === tag || locale.slug === tag || code === tag;
    });
    if (exactLocale) return MARKETING_LOCALES[exactLocale];

    const baseLanguage = tag.split("-")[0];
    const mappedLocale = LANGUAGE_LOCALE_MAP[baseLanguage];
    if (mappedLocale) return MARKETING_LOCALES[mappedLocale];
  }

  return null;
}

export function getPreferredMarketingLocaleFromRequest(request: Request): MarketingLocale | null {
  const countryLocale = getMarketingLocaleFromCountryCode(
    getHeaderValue(request.headers, [
      "cf-ipcountry",
      "cloudfront-viewer-country",
      "x-vercel-ip-country",
      "x-country-code",
    ]),
  );

  return countryLocale ?? getMarketingLocaleFromAcceptLanguage(request.headers.get("accept-language"));
}

export function getMarketingLocaleRedirectPath(request: Request): string | null {
  const url = new URL(request.url);
  if (url.pathname !== "/") return null;

  const preferredLocale = getPreferredMarketingLocaleFromRequest(request);
  if (!preferredLocale || preferredLocale.code === "en") return null;

  return `${preferredLocale.path}${url.search}`;
}

export type MarketingHomeCopy = {
  header: {
    ariaLabel: string;
    logoAlt: string;
    engineering: string;
    docs: string;
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
    privacy: string;
    contact: string;
    copyEmailToast: string;
    xAriaLabel: string;
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
  demo: {
    ariaLabel: string;
    heading: string;
    mobileTitle: string;
    mobileCopy: string;
    openDemo: string;
    liveLabel: string;
    openInNewTabTitle: string;
    fullscreen: string;
    iframeTitle: string;
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
};

const englishHomeCopy: MarketingHomeCopy = {
  header: {
    ariaLabel: "Site navigation",
    logoAlt: "Rejourney | Open Source Session Replay & Observability",
    engineering: "Engineering",
    docs: "Docs",
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
    privacy: "Privacy",
    contact: "Contact",
    copyEmailToast: "Email copied to clipboard!",
    xAriaLabel: "Rejourney on X",
    githubAriaLabel: "Rejourney on GitHub",
    copyright: "© 2026 Rejourney. All rights reserved.",
  },
  hero: {
    ariaLabel: "Hero section",
    description:
      "See what users actually did inside your mobile app, why they got stuck, and which fixes will move retention, stability, and conversion.",
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
    loopEyebrow: "Issue to milestone journey",
    loopHeadingLines: ["Identify issues.", "Measure the milestone."],
    loopIntro:
      "Follow a problem from end user to replay evidence. Ship the fix. Then watch the result.",
    tableStep: "Step",
    tableCatches: "What Rejourney catches",
    tableNext: "What the team does next",
    loopStage: "Loop stage",
    steps: [
      {
        label: "Watch",
        title: "Replay the exact mobile session",
        signal: "Screens, taps, swipes, navigation, crashes, and network context.",
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
    signalsHeading: "The signals mobile teams need in one place.",
    demoCta: "See live demo",
    productStories: [
      {
        eyebrow: "Session recordings",
        title: "Watch real users move through your app.",
        copy: "Replay mobile sessions with enough context to answer the question everyone asks first: what actually happened?",
        bullets: ["Pixel-perfect mobile replay", "Touch trails and screen changes", "Network, logs, and device context"],
        alt: "Rejourney session replay preview",
      },
      {
        eyebrow: "Heatmaps and journeys",
        title: "See what grabs attention and where people drop.",
        copy: "Turn scattered taps, swipes, scrolls, and exits into a map of the screens that help or hurt conversion.",
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
        eyebrow: "Growth loops",
        title: "Connect product quality to retention.",
        copy: "Measure whether releases are creating better sessions, calmer funnels, and more users who come back.",
        bullets: ["Retention and loyalty segments", "Release impact signals", "Funnel recovery opportunities"],
        alt: "Rejourney growth analytics preview",
      },
    ],
    trustEyebrow: "Why teams say yes",
    trustHeading: "Evidence for every person in the room.",
    trustCopy:
      "Adoption is easier when every team gets the same replay-backed source of truth, plus clear answers for performance, privacy, deployment, and mobile stack fit.",
    trustCards: [
      {
        title: "GDPR compliance",
        copy: "EU-oriented controls for masking, redaction, data minimization, and optional geolocation collection.",
      },
      {
        title: "Open source",
        copy: "Inspect the code, verify the SDK behavior, and keep the roadmap accountable to real mobile teams.",
      },
      {
        title: "Self-hostable",
        copy: "Run Rejourney on your own infrastructure when recordings and metadata need to stay under your control.",
      },
      {
        title: "Privacy controls",
        copy: "Mask sensitive UI, redact fields, avoid unnecessary location data, and keep collection intentional.",
      },
      {
        title: "Light mobile SDK",
        copy: "A 13.2 kB gzipped React Native SDK with async capture work kept out of the user's way.",
      },
      {
        title: "Observe-only mode",
        copy: "Set observeOnly: true to disable visual session replay while still sending anonymized telemetry for errors, crashes, ANRs, network activity, and events.",
      },
    ],
    stats: {
      cheaper: "17x cheaper",
      cheaperCopy: "Than some of the cheapest session replay and product analytics tools in the industry.",
      freeSessions: "Free 5k sessions",
      everyMonth: "Every month",
      allFeatures: "All features",
      allFeaturesCopy: "Replay, heatmaps, crashes, journeys",
    },
  },
  demo: {
    ariaLabel: "Interactive Demo",
    heading: "Walk the product...",
    mobileTitle: "Full dashboard demo, best opened wide.",
    mobileCopy:
      "The live console is a dense desktop workspace, so phones get a fast overview here and a dedicated fullscreen launch.",
    openDemo: "Open demo",
    liveLabel: "Live dashboard demo",
    openInNewTabTitle: "Open in new tab",
    fullscreen: "Fullscreen",
    iframeTitle: "Rejourney Dashboard Demo",
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
};

const arabicHomeCopy: MarketingHomeCopy = {
  header: {
    ariaLabel: "تنقل الموقع",
    logoAlt: "Rejourney | إعادة تشغيل جلسات ومراقبة مفتوحة المصدر",
    engineering: "الهندسة",
    docs: "التوثيق",
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
    privacy: "الخصوصية",
    contact: "تواصل",
    copyEmailToast: "تم نسخ البريد الإلكتروني!",
    xAriaLabel: "Rejourney على X",
    githubAriaLabel: "Rejourney على GitHub",
    copyright: "© 2026 Rejourney. جميع الحقوق محفوظة.",
  },
  hero: {
    ariaLabel: "القسم الرئيسي",
    description:
      "شاهد ما فعله المستخدمون داخل تطبيقك فعليا، ولماذا تعثروا، وأي إصلاحات ستحسن الاحتفاظ والاستقرار والتحويل.",
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
    loopEyebrow: "حلقة فهم تجربة الجوال",
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
        title: "أعد تشغيل جلسة الجوال كما حدثت",
        signal: "الشاشات، اللمسات، السحب، التنقل، الأعطال، وسياق الشبكة.",
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
    signalsHeading: "كل الإشارات التي تحتاجها فرق الجوال في مكان واحد.",
    demoCta: "شاهد العرض المباشر",
    productStories: [
      {
        eyebrow: "تسجيلات الجلسات",
        title: "شاهد المستخدمين الحقيقيين وهم يتنقلون داخل تطبيقك.",
        copy: "أعد تشغيل جلسات الجوال مع سياق كاف للإجابة عن أول سؤال يسأله الجميع: ماذا حدث فعلا؟",
        bullets: ["إعادة تشغيل جوال بدقة بكسل", "مسارات لمس وتغييرات شاشة", "سياق الشبكة والسجلات والجهاز"],
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
    ],
    trustEyebrow: "لماذا توافق الفرق",
    trustHeading: "دليل لكل شخص في الغرفة.",
    trustCopy:
      "يسهل التبني عندما يحصل كل فريق على مصدر حقيقة واحد مدعوم بإعادة التشغيل، مع إجابات واضحة حول الأداء والخصوصية والنشر وملاءمة حزمة الجوال.",
    trustCards: [
      {
        title: "امتثال GDPR",
        copy: "ضوابط موجهة للاتحاد الأوروبي للإخفاء والتنقيح وتقليل البيانات وجمع الموقع اختياريا.",
      },
      {
        title: "مفتوح المصدر",
        copy: "افحص الكود، وتحقق من سلوك SDK، واجعل خارطة الطريق قابلة للمساءلة أمام فرق الجوال الحقيقية.",
      },
      {
        title: "قابل للاستضافة الذاتية",
        copy: "شغل Rejourney على بنيتك التحتية عندما يجب أن تبقى التسجيلات والبيانات الوصفية تحت سيطرتك.",
      },
      {
        title: "ضوابط الخصوصية",
        copy: "اخف واجهات حساسة، ونقح الحقول، وتجنب بيانات الموقع غير الضرورية، واجعل الجمع مقصودا.",
      },
      {
        title: "SDK جوال خفيف",
        copy: "حجم React Native SDK المضغوط 13.2 kB مع عمل التقاط غير متزامن بعيد عن طريق المستخدم.",
      },
      {
        title: "وضع المراقبة فقط",
        copy: "اضبط observeOnly: true لتعطيل إعادة التشغيل المرئي مع الاستمرار في إرسال قياسات مجهولة للأخطاء والأعطال وANR والشبكة والأحداث.",
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
  demo: {
    ariaLabel: "عرض تفاعلي",
    heading: "جرّب المنتج...",
    mobileTitle: "عرض لوحة التحكم الكامل أفضل على شاشة واسعة.",
    mobileCopy:
      "لوحة التحكم مساحة عمل مكتبية كثيفة، لذلك تعرض الهواتف نظرة سريعة هنا مع زر فتح مخصص بملء الشاشة.",
    openDemo: "افتح العرض",
    liveLabel: "عرض لوحة التحكم المباشر",
    openInNewTabTitle: "افتح في تبويب جديد",
    fullscreen: "ملء الشاشة",
    iframeTitle: "عرض لوحة تحكم Rejourney",
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
};

const spanishHomeCopy: MarketingHomeCopy = {
  ...englishHomeCopy,
  header: {
    ...englishHomeCopy.header,
    ariaLabel: "Navegacion del sitio",
    logoAlt: "Rejourney | Replay de sesiones y observabilidad open source",
    engineering: "Ingenieria",
    docs: "Docs",
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
    privacy: "Privacidad",
    contact: "Contacto",
    copyEmailToast: "Correo copiado al portapapeles!",
    xAriaLabel: "Rejourney en X",
    githubAriaLabel: "Rejourney en GitHub",
    copyright: "© 2026 Rejourney. Todos los derechos reservados.",
  },
  hero: {
    ariaLabel: "Seccion principal",
    description:
      "Ve que hicieron realmente los usuarios dentro de tu app movil, por que se quedaron atascados y que arreglos moveran retencion, estabilidad y conversion.",
  },
  trust: {
    ...englishHomeCopy.trust,
    ariaLabel: "Confianza y plataformas compatibles",
  },
  narrative: {
    loopEyebrow: "El ciclo de insight movil",
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
        title: "Reproduce la sesion movil exacta",
        signal: "Pantallas, toques, swipes, navegacion, bloqueos y contexto de red.",
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
    signalsHeading: "Las señales que necesitan los equipos moviles en un solo lugar.",
    demoCta: "Ver demo en vivo",
    productStories: [
      {
        eyebrow: "Grabaciones de sesiones",
        title: "Mira a usuarios reales moverse por tu app.",
        copy: "Reproduce sesiones moviles con suficiente contexto para responder la primera pregunta de todos: que paso realmente?",
        bullets: ["Replay movil pixel-perfect", "Rastros de toque y cambios de pantalla", "Contexto de red, logs y dispositivo"],
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
    ],
    trustEyebrow: "Por que los equipos dicen si",
    trustHeading: "Evidencia para cada persona en la sala.",
    trustCopy:
      "La adopcion es mas facil cuando todos tienen la misma fuente de verdad con replay, mas respuestas claras sobre rendimiento, privacidad, despliegue y compatibilidad movil.",
    trustCards: [
      {
        title: "Cumplimiento GDPR",
        copy: "Controles orientados a la UE para enmascarado, redaccion, minimizacion de datos y geolocalizacion opcional.",
      },
      {
        title: "Open source",
        copy: "Inspecciona el codigo, verifica el comportamiento del SDK y mantén el roadmap responsable ante equipos moviles reales.",
      },
      {
        title: "Autohospedable",
        copy: "Ejecuta Rejourney en tu propia infraestructura cuando grabaciones y metadata deben permanecer bajo tu control.",
      },
      {
        title: "Controles de privacidad",
        copy: "Enmascara UI sensible, redacta campos, evita datos de ubicacion innecesarios y mantén la recoleccion intencional.",
      },
      {
        title: "SDK movil ligero",
        copy: "Un SDK React Native de 13.2 kB comprimido con gzip, con captura asincrona fuera del camino del usuario.",
      },
      {
        title: "Modo solo observacion",
        copy: "Usa observeOnly: true para desactivar el replay visual mientras sigues enviando telemetria anonimizada de errores, crashes, ANR, red y eventos.",
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
  demo: {
    ariaLabel: "Demo interactiva",
    heading: "Recorre el producto...",
    mobileTitle: "La demo completa del panel se ve mejor en pantalla amplia.",
    mobileCopy:
      "La consola en vivo es un espacio de escritorio denso, asi que en moviles mostramos una vista rapida y un lanzamiento dedicado en pantalla completa.",
    openDemo: "Abrir demo",
    liveLabel: "Demo en vivo del panel",
    openInNewTabTitle: "Abrir en nueva pestaña",
    fullscreen: "Pantalla completa",
    iframeTitle: "Demo del panel de Rejourney",
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
};

const turkishHomeCopy: MarketingHomeCopy = {
  ...englishHomeCopy,
  header: {
    ...englishHomeCopy.header,
    ariaLabel: "Site navigasyonu",
    logoAlt: "Rejourney | Acik kaynak oturum replay ve gozlemlenebilirlik",
    engineering: "Muhendislik",
    docs: "Dokumanlar",
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
    privacy: "Gizlilik",
    contact: "Iletisim",
    copyEmailToast: "E-posta panoya kopyalandi!",
    xAriaLabel: "X uzerinde Rejourney",
    githubAriaLabel: "GitHub uzerinde Rejourney",
    copyright: "© 2026 Rejourney. Tum haklari saklidir.",
  },
  hero: {
    ariaLabel: "Hero bolumu",
    description:
      "Kullanicilarin mobil uygulamanin icinde gercekte ne yaptigini, nerede takildigini ve hangi duzeltmelerin tutma, stabilite ve donusumu artiracagini gor.",
  },
  trust: {
    ...englishHomeCopy.trust,
    ariaLabel: "Guven ve desteklenen platformlar",
  },
  narrative: {
    loopEyebrow: "Mobil insight dongusu",
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
        title: "Tam mobil oturumu yeniden oynat",
        signal: "Ekranlar, dokunuslar, kaydirmalar, navigasyon, cokmeler ve ag baglami.",
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
    signalsHeading: "Mobil ekiplerin ihtiyac duydugu sinyaller tek yerde.",
    demoCta: "Canli demoyu gor",
    productStories: [
      {
        eyebrow: "Oturum kayitlari",
        title: "Gercek kullanicilarin uygulamada nasil ilerledigini izle.",
        copy: "Herkesin ilk sordugu soruya cevap verecek baglamla mobil oturumlari yeniden oynat: gercekte ne oldu?",
        bullets: ["Pixel-perfect mobil replay", "Dokunus izleri ve ekran degisimleri", "Ag, log ve cihaz baglami"],
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
    ],
    trustEyebrow: "Ekipler neden evet der",
    trustHeading: "Odadaki herkes icin kanit.",
    trustCopy:
      "Her ekip ayni replay destekli gercek kaynagina, performans, gizlilik, kurulum ve mobil stack uyumu icin net cevaplara sahip oldugunda benimseme kolaylasir.",
    trustCards: [
      {
        title: "GDPR uyumlulugu",
        copy: "Maskeleme, redaksiyon, veri minimizasyonu ve opsiyonel konum toplama icin AB odakli kontroller.",
      },
      {
        title: "Acik kaynak",
        copy: "Kodu incele, SDK davranisini dogrula ve yol haritasini gercek mobil ekiplerine karsi hesap verebilir tut.",
      },
      {
        title: "Self-host edilebilir",
        copy: "Kayitlar ve metadata kendi kontrolunde kalmaliyken Rejourney'i kendi altyapinda calistir.",
      },
      {
        title: "Gizlilik kontrolleri",
        copy: "Hassas UI'i maskele, alanlari redakte et, gereksiz konum verisinden kacin ve veri toplamayi bilincli tut.",
      },
      {
        title: "Hafif mobil SDK",
        copy: "13.2 kB gzip React Native SDK; async yakalama isi kullanicinin yolundan uzak tutulur.",
      },
      {
        title: "Sadece gozlem modu",
        copy: "Gorsel oturum replay'ini kapatirken hata, crash, ANR, ag ve eventler icin anonim telemetri gondermeye devam etmek icin observeOnly: true kullan.",
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
  demo: {
    ariaLabel: "Etkilesimli demo",
    heading: "Urunu gez...",
    mobileTitle: "Tam panel demosu genis ekranda daha iyi.",
    mobileCopy:
      "Canli konsol yogun bir masaustu calisma alani; bu yuzden telefonda hizli ozet ve tam ekran acilis sunuyoruz.",
    openDemo: "Demoyu ac",
    liveLabel: "Canli panel demosu",
    openInNewTabTitle: "Yeni sekmede ac",
    fullscreen: "Tam ekran",
    iframeTitle: "Rejourney panel demosu",
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
