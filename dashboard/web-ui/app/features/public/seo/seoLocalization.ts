import {
  MARKETING_LOCALES,
  SITE_URL,
  type MarketingLocale,
} from "../../../shared/lib/internationalMarketing";

export const SEO_LOCALIZED_LOCALE_CODES = ["ar", "es", "fr", "de"] as const;
export type SeoLocalizedLocaleCode = (typeof SEO_LOCALIZED_LOCALE_CODES)[number];

export const SEO_LOCALIZED_PAGE_PATHS = [
  "/record-user-sessions",
  "/web-session-replay",
  "/mobile-session-replay",
  "/what-is-session-replay",
  "/app-analytics",
  "/website-analytics",
  "/funnel-replay-evidence",
  "/heatmaps",
  "/stability-monitoring",
] as const;
export type SeoLocalizedPagePath = (typeof SEO_LOCALIZED_PAGE_PATHS)[number];

type LocalizedBenefit = {
  title: string;
  description: string;
};

export type LocalizedSeoContent = {
  metaTitle: string;
  metaDescription: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  h1: string;
  intro: string;
  benefits: [LocalizedBenefit, LocalizedBenefit, LocalizedBenefit];
  evidence: string;
  platforms: string;
};

type LocalizedSeoUi = {
  languageLabel: string;
  eyebrow: string;
  primaryKeywordLabel: string;
  startFree: string;
  liveDemo: string;
  benefitsHeading: string;
  evidenceHeading: string;
  platformHeading: string;
  faqHeading: string;
  relatedHeading: string;
  finalHeading: string;
  finalCopy: string;
  reassurance: string;
  freeSessions: string;
  noCreditCard: string;
  gdprCompliant: string;
  trustAriaLabel: string;
  lightweightSdks: string;
  privacyMasking: string;
  hostedInGermany: string;
  supports: string;
  verifiedResult: string;
  onboardingMetric: string;
  onboardingProof: string;
  salesMetric: string;
  salesProof: string;
  investigationEyebrow: string;
  shortAnswer: string;
  outcomesEyebrow: string;
  keepExploring: string;
  continueHeading: string;
  readNext: string;
  faqEyebrow: string;
  questionsAnswered: string;
  startProduct: string;
  faqWhat: (keyword: string) => string;
  faqWhy: string;
  faqPlatforms: string;
};

const localizedSeoUi: Record<SeoLocalizedLocaleCode, LocalizedSeoUi> = {
  ar: {
    languageLabel: "اللغة",
    eyebrow: "تحليلات المنتج وإعادة الجلسات",
    primaryKeywordLabel: "الكلمة المفتاحية الأساسية",
    startFree: "ابدأ مجانًا",
    liveDemo: "شاهد العرض المباشر",
    benefitsHeading: "حوّل سلوك المستخدم إلى دليل قابل للتنفيذ",
    evidenceHeading: "من الإشارة إلى الجلسة التي تفسرها",
    platformHeading: "المنصات والسياق المدعومان",
    faqHeading: "أسئلة شائعة",
    relatedHeading: "استكشف إمكانات مرتبطة",
    finalHeading: "افهم ما حدث ولماذا حدث",
    finalCopy: "ابدأ باستخدام Rejourney لربط المقاييس والرحلات والأعطال بإعادة تشغيل الجلسة الفعلية.",
    reassurance: "ثبّت Rejourney بجانب أدوات التحليل الحالية وقيّمه باستخدام جلسات حقيقية قبل الالتزام.",
    freeSessions: "٥٬٠٠٠ جلسة مجانًا",
    noCreditCard: "لا حاجة إلى بطاقة ائتمان",
    gdprCompliant: "متوافق مع GDPR",
    trustAriaLabel: "إشارات الثقة بالمنتج",
    lightweightSdks: "حزم SDK خفيفة",
    privacyMasking: "إخفاء البيانات الحساسة",
    hostedInGermany: "استضافة في ألمانيا",
    supports: "يدعم",
    verifiedResult: "نتيجة موثقة لأحد العملاء",
    onboardingMetric: "إكمال التهيئة بنسبة ٩٣٪",
    onboardingProof: "ساعدت أدلة الجلسات الفريق على اكتشاف خلل في تخطيط Safari وإصلاح مسار تهيئة أساسي.",
    salesMetric: "زيادة المبيعات بنسبة ١٠٣٪",
    salesProof: "كشفت أدلة الجلسات احتكاكًا في مسار مهم للإيرادات، فتمكن الفريق من إصلاح العطل المثبت أولًا.",
    investigationEyebrow: "مصمم للتحقيق الكامل",
    shortAnswer: "الإجابة المختصرة",
    outcomesEyebrow: "من الإشارة إلى الإجابة",
    keepExploring: "تابع الاستكشاف",
    continueHeading: "انتقل إلى الخطوة التالية الأكثر صلة.",
    readNext: "اقرأ التالي",
    faqEyebrow: "الأسئلة الشائعة",
    questionsAnswered: "إجابات عن أسئلتك.",
    startProduct: "ابدأ بمنتج حقيقي",
    faqWhat: (keyword) => `ما المقصود بـ ${keyword}؟`,
    faqWhy: "لماذا نربط التحليلات بإعادة تشغيل الجلسات؟",
    faqPlatforms: "ما المنصات التي يدعمها Rejourney؟",
  },
  es: {
    languageLabel: "Idioma",
    eyebrow: "Analítica de producto y replay de sesiones",
    primaryKeywordLabel: "Palabra clave principal",
    startFree: "Empieza gratis",
    liveDemo: "Ver demo en vivo",
    benefitsHeading: "Convierte el comportamiento en evidencia accionable",
    evidenceHeading: "De la señal a la sesión que la explica",
    platformHeading: "Plataformas y contexto compatibles",
    faqHeading: "Preguntas frecuentes",
    relatedHeading: "Explora capacidades relacionadas",
    finalHeading: "Entiende qué ocurrió y por qué",
    finalCopy: "Empieza con Rejourney para conectar métricas, recorridos y fallos con la sesión real del usuario.",
    reassurance: "Instala Rejourney junto a tu analítica actual y evalúalo con sesiones reales antes de comprometerte.",
    freeSessions: "5.000 sesiones gratis",
    noCreditCard: "Sin tarjeta de crédito",
    gdprCompliant: "Conforme con el RGPD",
    trustAriaLabel: "Señales de confianza del producto",
    lightweightSdks: "SDK ligeros",
    privacyMasking: "Enmascaramiento de privacidad",
    hostedInGermany: "Alojado en Alemania",
    supports: "Compatible con",
    verifiedResult: "Resultado verificado de un cliente",
    onboardingMetric: "93 % de onboarding completado",
    onboardingProof: "La evidencia de sesiones ayudó a aislar un fallo de diseño en Safari y recuperar un recorrido crítico de onboarding.",
    salesMetric: "103 % de aumento en ventas",
    salesProof: "La evidencia de replay mostró fricción en un recorrido crítico para los ingresos y permitió corregir primero el fallo demostrado.",
    investigationEyebrow: "Creado para una investigación completa",
    shortAnswer: "La respuesta breve",
    outcomesEyebrow: "De la señal a la respuesta",
    keepExploring: "Sigue explorando",
    continueHeading: "Continúa con el siguiente paso más relevante.",
    readNext: "Leer siguiente",
    faqEyebrow: "Preguntas frecuentes",
    questionsAnswered: "Preguntas resueltas.",
    startProduct: "Empieza con un producto real",
    faqWhat: (keyword) => `¿Qué es ${keyword}?`,
    faqWhy: "¿Por qué conectar la analítica con el replay de sesiones?",
    faqPlatforms: "¿Qué plataformas admite Rejourney?",
  },
  fr: {
    languageLabel: "Langue",
    eyebrow: "Product analytics et replay de sessions",
    primaryKeywordLabel: "Mot-clé principal",
    startFree: "Commencer gratuitement",
    liveDemo: "Voir la démo",
    benefitsHeading: "Transformez le comportement en preuves exploitables",
    evidenceHeading: "Du signal à la session qui l’explique",
    platformHeading: "Plateformes et contexte pris en charge",
    faqHeading: "Questions fréquentes",
    relatedHeading: "Découvrir les fonctionnalités associées",
    finalHeading: "Comprenez ce qui s’est passé et pourquoi",
    finalCopy: "Utilisez Rejourney pour relier les métriques, les parcours et les erreurs aux sessions réelles.",
    reassurance: "Installez Rejourney à côté de votre solution analytics et évaluez-le sur de vraies sessions avant de vous engager.",
    freeSessions: "5 000 sessions gratuites",
    noCreditCard: "Sans carte bancaire",
    gdprCompliant: "Conforme au RGPD",
    trustAriaLabel: "Signaux de confiance du produit",
    lightweightSdks: "SDK légers",
    privacyMasking: "Masquage des données privées",
    hostedInGermany: "Hébergé en Allemagne",
    supports: "Prend en charge",
    verifiedResult: "Résultat client vérifié",
    onboardingMetric: "93 % d’onboarding terminé",
    onboardingProof: "Les preuves de session ont permis d’isoler un défaut de mise en page dans Safari et de rétablir un parcours d’onboarding critique.",
    salesMetric: "103 % d’augmentation des ventes",
    salesProof: "Les preuves de replay ont révélé une friction dans un parcours critique pour le chiffre d’affaires afin de corriger d’abord le défaut démontré.",
    investigationEyebrow: "Conçu pour une investigation complète",
    shortAnswer: "La réponse courte",
    outcomesEyebrow: "Du signal à la réponse",
    keepExploring: "Continuer à explorer",
    continueHeading: "Passez à l’étape suivante la plus pertinente.",
    readNext: "Lire la suite",
    faqEyebrow: "Questions fréquentes",
    questionsAnswered: "Vos questions, nos réponses.",
    startProduct: "Commencez avec un vrai produit",
    faqWhat: (keyword) => `Qu’est-ce que ${keyword} ?`,
    faqWhy: "Pourquoi relier l’analytics au replay de sessions ?",
    faqPlatforms: "Quelles plateformes Rejourney prend-il en charge ?",
  },
  de: {
    languageLabel: "Sprache",
    eyebrow: "Produktanalyse und Session Replay",
    primaryKeywordLabel: "Primäres Keyword",
    startFree: "Kostenlos starten",
    liveDemo: "Live-Demo ansehen",
    benefitsHeading: "Nutzerverhalten in umsetzbare Belege verwandeln",
    evidenceHeading: "Vom Signal zur erklärenden Sitzung",
    platformHeading: "Unterstützte Plattformen und Kontexte",
    faqHeading: "Häufige Fragen",
    relatedHeading: "Verwandte Funktionen entdecken",
    finalHeading: "Verstehen, was passiert ist und warum",
    finalCopy: "Nutzen Sie Rejourney, um Kennzahlen, Journeys und Fehler mit realen Nutzersitzungen zu verbinden.",
    reassurance: "Installieren Sie Rejourney neben Ihrer bestehenden Analytics-Lösung und testen Sie es mit realen Sitzungen, bevor Sie sich festlegen.",
    freeSessions: "5.000 Sitzungen kostenlos",
    noCreditCard: "Keine Kreditkarte",
    gdprCompliant: "DSGVO-konform",
    trustAriaLabel: "Vertrauenssignale zum Produkt",
    lightweightSdks: "Leichtgewichtige SDKs",
    privacyMasking: "Datenschutz-Maskierung",
    hostedInGermany: "In Deutschland gehostet",
    supports: "Unterstützt",
    verifiedResult: "Verifiziertes Kundenergebnis",
    onboardingMetric: "93 % Onboarding-Abschluss",
    onboardingProof: "Sitzungsbelege halfen dem Team, einen Safari-Layoutfehler zu isolieren und einen kritischen Onboarding-Pfad wiederherzustellen.",
    salesMetric: "103 % mehr Umsatz",
    salesProof: "Replay-Belege deckten Reibung in einer umsatzkritischen Journey auf, sodass das Team zuerst den belegten Fehler beheben konnte.",
    investigationEyebrow: "Für die vollständige Untersuchung gebaut",
    shortAnswer: "Die kurze Antwort",
    outcomesEyebrow: "Vom Signal zur Antwort",
    keepExploring: "Weiter entdecken",
    continueHeading: "Mit dem relevantesten nächsten Schritt fortfahren.",
    readNext: "Weiterlesen",
    faqEyebrow: "Häufige Fragen",
    questionsAnswered: "Fragen, beantwortet.",
    startProduct: "Mit einem echten Produkt starten",
    faqWhat: (keyword) => `Was ist ${keyword}?`,
    faqWhy: "Warum sollte Analytics mit Session Replay verbunden werden?",
    faqPlatforms: "Welche Plattformen unterstützt Rejourney?",
  },
};

const localizedSeoContent: Record<SeoLocalizedLocaleCode, Record<SeoLocalizedPagePath, LocalizedSeoContent>> = {
  ar: {
    "/record-user-sessions": {
      metaTitle: "أدوات إعادة تشغيل الجلسات | Rejourney",
      metaDescription: "أدوات لإعادة تشغيل جلسات المستخدم وتسجيلها على الويب والجوال مع إخفاء البيانات وربط الأحداث والأخطاء والطلبات بكل جلسة.",
      primaryKeyword: "أدوات إعادة تشغيل الجلسات",
      secondaryKeywords: ["برنامج إعادة تشغيل الجلسات", "تسجيل جلسات المستخدم", "تسجيل جلسات الموقع"],
      h1: "أدوات إعادة تشغيل الجلسات لتسجيل تجربة المستخدم",
      intro: "سجّل جلسات الويب والجوال وافتحها من المسار أو الحدث أو الخطأ الذي يحتاج فريقك إلى فهمه، مع ضوابط خصوصية مدمجة.",
      benefits: [
        { title: "سجّل السياق الكامل", description: "احتفظ بالشاشات والنقرات والتنقل والأحداث والطلبات في خط زمني واحد بدل مشاهدة فيديو بلا سياق." },
        { title: "ابحث عن الجلسات المهمة", description: "صفِّ الجلسات حسب المسار أو الجهاز أو الإصدار أو النتيجة للوصول إلى الدليل المناسب بسرعة." },
        { title: "احمِ البيانات الحساسة", description: "استخدم إخفاء الحقول وضوابط الالتقاط حتى تظل إعادة التشغيل مفيدة وتحترم خصوصية المستخدم." },
      ],
      evidence: "تجمع Rejourney بين التسجيل والتحليلات، لذلك يستطيع الفريق الانتقال من انخفاض في التحويل أو خطأ متكرر إلى الجلسات التي تثبت ما واجهه المستخدم.",
      platforms: "يدعم Rejourney الويب وReact Native وExpo وFlutter وiOS، مع سياق للأحداث والطلبات والأجهزة والإصدارات.",
    },
    "/web-session-replay": {
      metaTitle: "إعادة تشغيل جلسات الويب | Rejourney",
      metaDescription: "برنامج لإعادة تشغيل جلسات الويب يربط سلوك المتصفح بالمسارات والأحداث وطلبات الشبكة وأخطاء وحدة التحكم مع حماية الخصوصية.",
      primaryKeyword: "إعادة تشغيل جلسات الويب",
      secondaryKeywords: ["إعادة تشغيل جلسات الموقع", "تسجيل جلسات المتصفح", "تسجيل جلسات الويب"],
      h1: "برنامج إعادة تشغيل جلسات الويب",
      intro: "شاهد كيف يتنقل المستخدم داخل موقعك واربط كل تفاعل بالمسار والأحداث وطلبات الشبكة وأخطاء المتصفح.",
      benefits: [
        { title: "أعد بناء تجربة المتصفح", description: "راجع تغيّرات الصفحة والنقرات والتمرير والتنقل بترتيبها الحقيقي داخل الجلسة." },
        { title: "اربط الواجهة بالشبكة", description: "افتح الطلبات الفاشلة ورسائل وحدة التحكم بجانب اللحظة التي ظهرت فيها المشكلة للمستخدم." },
        { title: "راقب المسارات والتحويل", description: "انتقل من خطوة متعثرة في المسار إلى تسجيلات المستخدمين الذين غادروا أو كرروا المحاولة." },
      ],
      evidence: "بدل التخمين من مخطط واحد، تعرض إعادة تشغيل الويب السلوك المرئي والسياق التقني في المكان نفسه حتى يصبح سبب التعثر قابلًا للتحقق.",
      platforms: "يعمل مع تطبيقات JavaScript وReact وNext.js وVue وSvelte وغيرها من أطر الويب الحديثة.",
    },
    "/mobile-session-replay": {
      metaTitle: "إعادة تشغيل جلسات تطبيقات الجوال | Rejourney",
      metaDescription: "إعادة تشغيل جلسات تطبيقات الجوال لـReact Native وExpo وFlutter وiOS وAndroid مع الأعطال وANR والطلبات وسياق الجهاز.",
      primaryKeyword: "إعادة تشغيل جلسات تطبيقات الجوال",
      secondaryKeywords: ["إعادة جلسات React Native", "إعادة جلسات Flutter", "تسجيل جلسات iOS وAndroid"],
      h1: "إعادة تشغيل جلسات تطبيقات الجوال",
      intro: "شاهد اللمسات والتنقل وحالة الشاشة التي سبقت التعثر أو العطل، مع سياق الجهاز والإصدار والشبكة.",
      benefits: [
        { title: "React Native وExpo", description: "راجع الجلسات الأصلية والهجينة مع الأحداث والطلبات وسياق الإصدار في مساحة عمل واحدة." },
        { title: "Flutter وiOS وAndroid", description: "افهم اللمسات وتغيّر الشاشات وسلوك التطبيق على الأجهزة وأنظمة التشغيل المختلفة." },
        { title: "الأعطال وANR", description: "افتح الجلسة التي سبقت العطل أو تجمد الواجهة بدل الاكتفاء بتتبع المكدس." },
      ],
      evidence: "تربط Rejourney سلوك التطبيق بالإشارات التقنية، ما يساعد المنتج والهندسة على رؤية التجربة نفسها بدل تبادل تقارير منفصلة.",
      platforms: "مسارات إعداد مخصصة لـReact Native وExpo وFlutter وSwift على iOS، مع تغطية تطبيقات Android عبر الأطر المدعومة.",
    },
    "/what-is-session-replay": {
      metaTitle: "ما هي إعادة تشغيل الجلسات؟ | Rejourney",
      metaDescription: "تعرف على إعادة تشغيل الجلسات وكيف تسجل تفاعل المستخدم بأمان وتربط السلوك بالتحليلات والأخطاء لتحسين تجربة الويب والجوال.",
      primaryKeyword: "ما هي إعادة تشغيل الجلسات",
      secondaryKeywords: ["تعريف إعادة تشغيل الجلسات", "كيف تعمل إعادة الجلسات", "تحليلات إعادة الجلسات"],
      h1: "ما هي إعادة تشغيل الجلسات؟",
      intro: "إعادة تشغيل الجلسات هي إعادة بناء مرئية لتفاعل المستخدم مع موقع أو تطبيق، وتصبح أكثر فائدة عندما ترتبط بالأحداث والمسارات والأخطاء.",
      benefits: [
        { title: "تسجيل التفاعل", description: "تلتقط الأداة الشاشات والنقرات واللمسات والتنقل ثم تعيد بناء التجربة بترتيبها الزمني." },
        { title: "إضافة سياق تحليلي", description: "توضح المقاييس أي الجلسات تستحق المشاهدة، بينما تفسر الإعادة ما حدث داخلها." },
        { title: "الخصوصية أولًا", description: "يتطلب التنفيذ الجيد إخفاء الحقول الحساسة والتحكم في الالتقاط والاحتفاظ والوصول." },
      ],
      evidence: "لا تحل إعادة التشغيل محل التحليلات؛ بل تمنح الفريق دليلًا نوعيًا يفسر الانخفاضات والأنماط التي تكشفها البيانات الكمية.",
      platforms: "يمكن تطبيقها على مواقع الويب وتطبيقات الجوال، مع اختلاف طريقة الالتقاط وإعادة البناء حسب المنصة.",
    },
    "/app-analytics": {
      metaTitle: "تحليلات تطبيقات الجوال وإعادة الجلسات | Rejourney",
      metaDescription: "تحليلات تطبيقات الجوال لقياس الاستخدام والاحتفاظ والمسارات والأعطال وربط كل إشارة بإعادة تشغيل جلسة على React Native وFlutter وiOS.",
      primaryKeyword: "تحليلات تطبيقات الجوال",
      secondaryKeywords: ["أدوات تحليلات الجوال", "تحليلات React Native", "تحليلات Flutter وiOS"],
      h1: "تحليلات تطبيقات الجوال مع إعادة تشغيل الجلسات",
      intro: "قِس الاستخدام والاحتفاظ والمسارات والأعطال، ثم افتح جلسات المستخدمين التي تفسر تغيّر كل مقياس.",
      benefits: [
        { title: "السلوك والاحتفاظ", description: "تابع المستخدمين النشطين والعودة والميزات المستخدمة دون فصل الأرقام عن التجربة الفعلية." },
        { title: "المسارات والتحويل", description: "حدد أين يتوقف المستخدم في التسجيل أو التهيئة أو الدفع وافتح الجلسات وراء الانخفاض." },
        { title: "الجودة والاستقرار", description: "اربط الأعطال وANR والطلبات البطيئة بالجهاز والإصدار والمسار الذي تأثر." },
      ],
      evidence: "تعطي التحليلات الكمية حجم المشكلة، وتوضح إعادة الجلسة كيف شعر بها المستخدم وما الذي يجب أن يتغير في المنتج.",
      platforms: "يدعم Rejourney تحليلات React Native وExpo وFlutter وiOS، مع مساحة عمل مشتركة لفرق المنتج والهندسة والدعم.",
    },
    "/website-analytics": {
      metaTitle: "تحليلات تجربة المستخدم للمواقع | Rejourney",
      metaDescription: "تحليلات تجربة المستخدم للمواقع تجمع السلوك والمسارات والخرائط الحرارية وإعادة الجلسات لفهم ما يساعد الزائر أو يمنعه من التحويل.",
      primaryKeyword: "تحليلات تجربة المستخدم للمواقع",
      secondaryKeywords: ["تحليلات UX", "تحليل سلوك زوار الموقع", "تحليلات تجربة الموقع"],
      h1: "تحليلات تجربة المستخدم للمواقع",
      intro: "افهم سلوك الزوار داخل الموقع من خلال المسارات والخرائط الحرارية وإعادة الجلسات بدل الاكتفاء بعدد الزيارات.",
      benefits: [
        { title: "قِس تجربة الموقع", description: "تابع التفاعل والمسارات والنتائج التي توضح ما إذا كان الزائر يجد ما يحتاج إليه." },
        { title: "اكتشف الاحتكاك", description: "استخدم النقرات الغاضبة والتمرير والأخطاء للكشف عن الواجهات المربكة أو المعطلة." },
        { title: "شاهد الدليل", description: "افتح جلسات حقيقية من كل نمط حتى يتحول التحليل إلى قرار تصميم أو تطوير واضح." },
      ],
      evidence: "تركز تحليلات تجربة المستخدم على جودة الرحلة داخل الموقع، لا على مصادر الزيارات فقط، وتربط النتائج بسلوك يمكن للفريق مراجعته.",
      platforms: "مناسب للمواقع التسويقية وتطبيقات الويب والمنتجات المبنية بـReact وNext.js وVue وغيرها.",
    },
    "/funnel-replay-evidence": {
      metaTitle: "تحليل مسار التحويل وإعادة الجلسات | Rejourney",
      metaDescription: "تحليل مسار التحويل مع إعادة تشغيل جلسات المستخدمين الذين أكملوا أو غادروا، وربط الانخفاض بالأخطاء والطلبات وسلوك الواجهة.",
      primaryKeyword: "تحليل مسار التحويل",
      secondaryKeywords: ["تحليل قمع التحويل", "تحليل انخفاض المسار", "إعادة جلسات المسار"],
      h1: "تحليل مسار التحويل مع دليل من الجلسات",
      intro: "قِس الانتقال بين الخطوات ثم شاهد جلسات المستخدمين الذين غادروا أو عادوا أو سلكوا مسارًا مختلفًا.",
      benefits: [
        { title: "حدد الانخفاض الحقيقي", description: "قارن عدد الداخلين والمكملين في كل خطوة حسب المنصة أو الإصدار أو الشريحة." },
        { title: "افتح الجلسات وراء الرقم", description: "شاهد ما فعله المستخدم قبل المغادرة بدل افتراض السبب من نسبة التحويل وحدها." },
        { title: "اربط السبب التقني", description: "راجع الأخطاء والطلبات البطيئة والأعطال التي تتكرر في الخطوة المتعثرة." },
      ],
      evidence: "يجمع Rejourney بين القياس الكمي والدليل المرئي حتى يعرف الفريق هل المشكلة في الرسالة أو الواجهة أو الأداء أو الخدمة الخلفية.",
      platforms: "حلل مسارات التسجيل والتهيئة والدفع والاشتراك على الويب وتطبيقات الجوال.",
    },
    "/heatmaps": {
      metaTitle: "أدوات الخرائط الحرارية للمواقع والجوال | Rejourney",
      metaDescription: "خرائط حرارية للنقر والتمرير والانتباه واللمس والنقرات الغاضبة، مع فتح جلسات المستخدم المرتبطة بكل نمط على الويب والجوال.",
      primaryKeyword: "أدوات الخرائط الحرارية للمواقع",
      secondaryKeywords: ["خرائط حرارة النقر", "خرائط التمرير والانتباه", "خرائط لمس الجوال"],
      h1: "أدوات الخرائط الحرارية للمواقع وتطبيقات الجوال",
      intro: "اجمع النقرات والتمرير واللمسات في خريطة واضحة، ثم افتح الجلسات التي صنعت كل نمط لفهم النية والسياق.",
      benefits: [
        { title: "خرائط النقر", description: "اعرف العناصر التي تجذب التفاعل واكتشف النقر على أجزاء غير تفاعلية أو مربكة." },
        { title: "التمرير والانتباه", description: "شاهد أين يتوقف الزائر عن التمرير وأي أجزاء الصفحة تحصل على الاهتمام الفعلي." },
        { title: "اللمس والنقرات الغاضبة", description: "اكتشف تجمعات اللمس والمحاولات المتكررة على شاشات الجوال وافتح الجلسات المرتبطة." },
      ],
      evidence: "تعرض الخريطة الحرارية النمط المجمع، بينما تكشف إعادة الجلسة هدف المستخدم والواجهة والحالة التقنية التي أنتجت هذا النمط.",
      platforms: "خرائط نقر وتمرير للويب وخرائط لمس للجوال عبر أطر Rejourney المدعومة.",
    },
    "/stability-monitoring": {
      metaTitle: "تقارير أعطال الجوال وإعادة الجلسات | Rejourney",
      metaDescription: "تقارير أعطال تطبيقات الجوال ومراقبة ANR والأخطاء مع إعادة تشغيل الجلسة والجهاز والإصدار والطلبات المتأثرة، لا تتبع المكدس فقط.",
      primaryKeyword: "تقارير أعطال تطبيقات الجوال",
      secondaryKeywords: ["مراقبة استقرار التطبيق", "مراقبة ANR", "تتبع أخطاء JavaScript"],
      h1: "تقارير أعطال تطبيقات الجوال مع إعادة تشغيل الجلسة",
      intro: "اجمع الأعطال وANR والأخطاء حسب الإصدار والجهاز، ثم شاهد الجلسة التي سبقت المشكلة لفهم تأثيرها على المستخدم.",
      benefits: [
        { title: "تقارير الأعطال", description: "رتب الأعطال المتكررة حسب عدد الجلسات والأجهزة والإصدارات المتأثرة." },
        { title: "مراقبة ANR", description: "راجع تجمد الواجهة وإشارات الخيط الرئيسي بجانب الخطوات التي كان المستخدم يحاول تنفيذها." },
        { title: "تتبع الأخطاء", description: "اربط أخطاء JavaScript والطلبات الفاشلة بإعادة الجلسة بدل الاعتماد على رسالة الخطأ وحدها." },
      ],
      evidence: "تختلف Rejourney عن أدوات تتبع المكدس فقط لأنها تحتفظ بتجربة المستخدم والمسار والجهاز والشبكة بجانب الإشارة التقنية.",
      platforms: "سياق استقرار لتطبيقات React Native وExpo وFlutter وiOS، إضافة إلى أخطاء تطبيقات الويب وJavaScript.",
    },
  },
  es: {
    "/record-user-sessions": {
      metaTitle: "Herramientas de replay de sesiones | Rejourney",
      metaDescription: "Herramientas para grabar y reproducir sesiones web y móvil con privacidad, eventos, errores y solicitudes conectados a cada experiencia.",
      primaryKeyword: "herramientas de replay de sesiones",
      secondaryKeywords: ["software de replay de sesiones", "grabar sesiones de usuarios", "grabación de sesiones web"],
      h1: "Herramientas de replay para grabar sesiones de usuarios",
      intro: "Graba sesiones web y móvil y ábrelas desde el recorrido, evento o error que tu equipo necesita investigar, con controles de privacidad integrados.",
      benefits: [
        { title: "Captura el contexto completo", description: "Conserva pantallas, clics, navegación, eventos y solicitudes en una sola línea temporal." },
        { title: "Encuentra las sesiones útiles", description: "Filtra por ruta, dispositivo, versión o resultado para llegar rápidamente a la evidencia correcta." },
        { title: "Protege los datos sensibles", description: "Usa enmascaramiento y controles de captura para obtener replay útil sin exponer información privada." },
      ],
      evidence: "Rejourney une grabación y analítica para pasar de una caída de conversión o un error repetido a las sesiones que muestran lo ocurrido.",
      platforms: "Compatible con web, React Native, Expo, Flutter e iOS, incluyendo eventos, red, dispositivo y versión.",
    },
    "/web-session-replay": {
      metaTitle: "Software de replay de sesiones web | Rejourney",
      metaDescription: "Replay de sesiones web que conecta el comportamiento del navegador con rutas, eventos, solicitudes de red y errores de consola respetando la privacidad.",
      primaryKeyword: "replay de sesiones web",
      secondaryKeywords: ["replay de sesiones del sitio web", "grabación de sesiones del navegador", "grabación de sesiones web"],
      h1: "Software de replay de sesiones web",
      intro: "Observa cómo navegan los usuarios por tu sitio y conecta cada interacción con rutas, eventos, solicitudes de red y errores del navegador.",
      benefits: [
        { title: "Reconstruye la experiencia", description: "Revisa cambios de página, clics, scroll y navegación en el orden real de la sesión." },
        { title: "Conecta interfaz y red", description: "Abre solicitudes fallidas y mensajes de consola junto al momento en que afectaron al usuario." },
        { title: "Investiga recorridos", description: "Pasa de un paso con abandono a las grabaciones de quienes salieron o repitieron la acción." },
      ],
      evidence: "El replay web reúne comportamiento visible y contexto técnico para verificar la causa de la fricción sin depender de suposiciones.",
      platforms: "Funciona con JavaScript, React, Next.js, Vue, Svelte y otros frameworks web modernos.",
    },
    "/mobile-session-replay": {
      metaTitle: "Replay de sesiones de aplicaciones móviles | Rejourney",
      metaDescription: "Replay móvil para React Native, Expo, Flutter, iOS y Android con crashes, ANR, solicitudes y contexto del dispositivo.",
      primaryKeyword: "replay de sesiones móviles",
      secondaryKeywords: ["replay de apps móviles", "replay de React Native", "replay de Flutter, iOS y Android"],
      h1: "Replay de sesiones de aplicaciones móviles",
      intro: "Observa toques, navegación y estados de pantalla antes de una fricción o un crash, con contexto de dispositivo, versión y red.",
      benefits: [
        { title: "React Native y Expo", description: "Revisa sesiones híbridas con eventos, solicitudes y versión de la aplicación en un mismo espacio." },
        { title: "Flutter, iOS y Android", description: "Entiende los toques y cambios de pantalla en distintos dispositivos y sistemas operativos." },
        { title: "Crashes y ANR", description: "Abre la sesión previa a un crash o bloqueo de interfaz, no solamente su stack trace." },
      ],
      evidence: "Rejourney conecta el comportamiento móvil con señales técnicas para que producto e ingeniería trabajen sobre la misma experiencia.",
      platforms: "Implementación para React Native, Expo, Flutter y Swift en iOS, con cobertura Android mediante los frameworks compatibles.",
    },
    "/what-is-session-replay": {
      metaTitle: "¿Qué es el replay de sesiones? | Rejourney",
      metaDescription: "Descubre qué es el replay de sesiones, cómo reconstruye interacciones con privacidad y cómo conecta comportamiento, analítica y errores.",
      primaryKeyword: "qué es el replay de sesiones",
      secondaryKeywords: ["definición de replay de sesiones", "cómo funciona el replay", "analítica de sesiones"],
      h1: "¿Qué es el replay de sesiones?",
      intro: "El replay de sesiones reconstruye visualmente la interacción de una persona con un sitio o aplicación y la conecta con eventos, recorridos y errores.",
      benefits: [
        { title: "Registra la interacción", description: "Captura pantallas, clics, toques y navegación para reconstruir la experiencia en orden temporal." },
        { title: "Añade contexto analítico", description: "Las métricas señalan qué sesiones revisar y el replay explica lo que ocurrió dentro de ellas." },
        { title: "Privacidad por diseño", description: "Una implementación responsable enmascara campos sensibles y controla captura, retención y acceso." },
      ],
      evidence: "El replay no sustituye a la analítica: aporta la evidencia cualitativa que explica los patrones observados en los datos.",
      platforms: "Puede utilizarse en sitios web y aplicaciones móviles, adaptando la captura y reconstrucción a cada plataforma.",
    },
    "/app-analytics": {
      metaTitle: "Analítica de apps móviles con replay | Rejourney",
      metaDescription: "Analítica de aplicaciones móviles para medir uso, retención, recorridos y crashes, conectando cada señal con sesiones de React Native, Flutter e iOS.",
      primaryKeyword: "analítica de aplicaciones móviles",
      secondaryKeywords: ["herramientas de analítica móvil", "analítica de React Native", "analítica de Flutter e iOS"],
      h1: "Analítica de aplicaciones móviles con replay de sesiones",
      intro: "Mide uso, retención, recorridos y estabilidad y abre las sesiones que explican el cambio detrás de cada métrica.",
      benefits: [
        { title: "Comportamiento y retención", description: "Mide usuarios activos, retorno y adopción sin separar los números de la experiencia real." },
        { title: "Recorridos y conversión", description: "Localiza abandonos en registro, onboarding o pago y abre las sesiones relacionadas." },
        { title: "Calidad y estabilidad", description: "Conecta crashes, ANR y red lenta con dispositivos, versiones y recorridos afectados." },
      ],
      evidence: "La analítica cuantifica el problema y el replay muestra cómo lo vivió el usuario y qué parte del producto debe cambiar.",
      platforms: "Analítica para React Native, Expo, Flutter e iOS en un espacio compartido por producto, ingeniería y soporte.",
    },
    "/website-analytics": {
      metaTitle: "Analítica de experiencia de usuario web | Rejourney",
      metaDescription: "Analítica UX para sitios web con comportamiento, recorridos, mapas de calor y replay para entender qué ayuda o impide convertir a los visitantes.",
      primaryKeyword: "analítica de experiencia de usuario web",
      secondaryKeywords: ["analítica UX", "analítica de comportamiento web", "experiencia de usuario del sitio"],
      h1: "Analítica de experiencia de usuario para sitios web",
      intro: "Entiende el comportamiento dentro del sitio mediante recorridos, mapas de calor y replay, más allá del volumen de tráfico.",
      benefits: [
        { title: "Mide la experiencia", description: "Sigue interacciones, recorridos y resultados que indican si una persona encuentra lo que necesita." },
        { title: "Detecta fricción", description: "Usa clics de frustración, scroll y errores para descubrir interfaces confusas o rotas." },
        { title: "Observa la evidencia", description: "Abre sesiones reales de cada patrón para convertir el análisis en una decisión clara." },
      ],
      evidence: "La analítica UX evalúa la calidad del recorrido, no solo la adquisición, y vincula los resultados con comportamiento revisable.",
      platforms: "Adecuado para sitios de marketing y aplicaciones web creadas con React, Next.js, Vue y otros frameworks.",
    },
    "/funnel-replay-evidence": {
      metaTitle: "Análisis de embudos con replay | Rejourney",
      metaDescription: "Analiza embudos de conversión y abre las sesiones de quienes avanzaron o abandonaron, con errores, red y comportamiento de interfaz.",
      primaryKeyword: "análisis de embudos",
      secondaryKeywords: ["análisis de embudos de conversión", "análisis de abandono", "replay de embudos"],
      h1: "Análisis de embudos con evidencia de replay",
      intro: "Mide el avance entre pasos y observa las sesiones de quienes abandonan, regresan o toman una ruta diferente.",
      benefits: [
        { title: "Mide el abandono real", description: "Compara entradas y finalizaciones por paso, plataforma, versión o segmento." },
        { title: "Abre las sesiones", description: "Observa qué ocurrió antes del abandono en lugar de deducir la causa solo del porcentaje." },
        { title: "Conecta la causa técnica", description: "Revisa errores, solicitudes lentas y crashes repetidos en el paso afectado." },
      ],
      evidence: "Rejourney combina medición y evidencia visual para distinguir problemas de mensaje, interfaz, rendimiento o backend.",
      platforms: "Analiza registro, onboarding, checkout y suscripción en web y aplicaciones móviles.",
    },
    "/heatmaps": {
      metaTitle: "Mapas de calor para web y móvil | Rejourney",
      metaDescription: "Mapas de clics, scroll, atención, toques y clics de frustración con acceso a las sesiones relacionadas en web y móvil.",
      primaryKeyword: "herramientas de mapas de calor web",
      secondaryKeywords: ["mapas de clics", "mapas de scroll y atención", "mapas de toques móviles"],
      h1: "Herramientas de mapas de calor para web y móvil",
      intro: "Agrupa clics, scroll y toques en un mapa claro y abre las sesiones que formaron cada patrón para entender su intención.",
      benefits: [
        { title: "Mapas de clics", description: "Descubre qué elementos atraen interacción y dónde se pulsa sobre contenido no interactivo." },
        { title: "Scroll y atención", description: "Comprueba dónde dejan de desplazarse los visitantes y qué contenido recibe atención real." },
        { title: "Toques y frustración", description: "Detecta agrupaciones de toques y acciones repetidas en móvil y abre sus sesiones." },
      ],
      evidence: "El mapa muestra el patrón agregado; el replay revela la intención, el estado de la interfaz y el contexto técnico que lo produjo.",
      platforms: "Mapas de clics y scroll para web y mapas de toques para aplicaciones móviles compatibles.",
    },
    "/stability-monitoring": {
      metaTitle: "Reporte de crashes móviles con replay | Rejourney",
      metaDescription: "Reporte de crashes, ANR y errores móviles con replay, dispositivo, versión y solicitudes afectadas, más allá del stack trace.",
      primaryKeyword: "reporte de crashes de aplicaciones móviles",
      secondaryKeywords: ["monitorización de estabilidad", "monitorización de ANR", "seguimiento de errores JavaScript"],
      h1: "Reporte de crashes de aplicaciones móviles con replay",
      intro: "Agrupa crashes, ANR y errores por versión y dispositivo y observa la sesión anterior al fallo para entender su impacto.",
      benefits: [
        { title: "Reporte de crashes", description: "Prioriza fallos repetidos por número de sesiones, dispositivos y versiones afectadas." },
        { title: "Monitorización de ANR", description: "Revisa bloqueos de interfaz y señales del hilo principal junto a la acción del usuario." },
        { title: "Seguimiento de errores", description: "Conecta errores JavaScript y solicitudes fallidas con replay, no solo con un mensaje." },
      ],
      evidence: "Rejourney se diferencia de las herramientas centradas en stack traces al conservar experiencia, recorrido, dispositivo y red junto al fallo.",
      platforms: "Contexto de estabilidad para React Native, Expo, Flutter e iOS, además de errores web y JavaScript.",
    },
  },
  fr: {
    "/record-user-sessions": {
      metaTitle: "Outils de replay de sessions | Rejourney",
      metaDescription: "Enregistrez et rejouez les sessions web et mobile avec masquage, événements, erreurs et requêtes reliés à chaque expérience utilisateur.",
      primaryKeyword: "outils de replay de sessions",
      secondaryKeywords: ["logiciel de replay de sessions", "enregistrer les sessions utilisateur", "enregistrement de sessions web"],
      h1: "Outils de replay pour enregistrer les sessions utilisateur",
      intro: "Enregistrez les sessions web et mobile, puis ouvrez-les depuis le parcours, l’événement ou l’erreur que votre équipe doit comprendre.",
      benefits: [
        { title: "Capturer tout le contexte", description: "Conservez écrans, clics, navigation, événements et requêtes dans une même chronologie." },
        { title: "Trouver les bonnes sessions", description: "Filtrez par route, appareil, version ou résultat pour atteindre rapidement les preuves utiles." },
        { title: "Protéger les données", description: "Masquez les champs sensibles et contrôlez la capture pour respecter la vie privée." },
      ],
      evidence: "Rejourney unit enregistrement et analytics afin de passer d’une baisse de conversion ou d’une erreur répétée aux sessions qui l’expliquent.",
      platforms: "Compatible avec le web, React Native, Expo, Flutter et iOS, avec événements, réseau, appareil et version.",
    },
    "/web-session-replay": {
      metaTitle: "Logiciel de replay de sessions web | Rejourney",
      metaDescription: "Replay de sessions web reliant le comportement du navigateur aux routes, événements, requêtes réseau et erreurs console avec protection des données.",
      primaryKeyword: "replay de sessions web",
      secondaryKeywords: ["replay de sessions du site", "enregistrement de sessions navigateur", "enregistrement de sessions web"],
      h1: "Logiciel de replay de sessions web",
      intro: "Observez la navigation sur votre site et reliez chaque interaction aux routes, événements, requêtes réseau et erreurs du navigateur.",
      benefits: [
        { title: "Reconstruire l’expérience", description: "Revoyez les changements de page, clics, défilements et navigations dans leur ordre réel." },
        { title: "Relier interface et réseau", description: "Ouvrez les requêtes échouées et messages console au moment où l’utilisateur les subit." },
        { title: "Analyser les parcours", description: "Passez d’une étape en difficulté aux enregistrements des visiteurs qui abandonnent." },
      ],
      evidence: "Le replay web rassemble comportement visible et contexte technique pour vérifier la cause d’une friction sans la deviner.",
      platforms: "Fonctionne avec JavaScript, React, Next.js, Vue, Svelte et d’autres frameworks web modernes.",
    },
    "/mobile-session-replay": {
      metaTitle: "Replay de sessions d’applications mobiles | Rejourney",
      metaDescription: "Replay mobile pour React Native, Expo, Flutter, iOS et Android avec crashs, ANR, requêtes et contexte de l’appareil.",
      primaryKeyword: "replay de sessions mobiles",
      secondaryKeywords: ["replay d’application mobile", "replay React Native", "replay Flutter, iOS et Android"],
      h1: "Replay de sessions d’applications mobiles",
      intro: "Observez les gestes, la navigation et l’état de l’écran avant une friction ou un crash, avec le contexte appareil, version et réseau.",
      benefits: [
        { title: "React Native et Expo", description: "Analysez les sessions hybrides avec événements, requêtes et version dans un même espace." },
        { title: "Flutter, iOS et Android", description: "Comprenez les gestes et changements d’écran selon l’appareil et le système." },
        { title: "Crashs et ANR", description: "Ouvrez la session précédant un crash ou un blocage au lieu de vous limiter à la stack trace." },
      ],
      evidence: "Rejourney relie le comportement mobile aux signaux techniques afin que produit et ingénierie examinent la même expérience.",
      platforms: "Parcours d’intégration pour React Native, Expo, Flutter et Swift sur iOS, avec Android via les frameworks compatibles.",
    },
    "/what-is-session-replay": {
      metaTitle: "Qu’est-ce que le replay de sessions ? | Rejourney",
      metaDescription: "Comprenez le replay de sessions, la reconstruction respectueuse de la vie privée et le lien entre comportement, analytics et erreurs.",
      primaryKeyword: "qu’est-ce que le replay de sessions",
      secondaryKeywords: ["définition du replay de sessions", "fonctionnement du replay", "analytics de sessions"],
      h1: "Qu’est-ce que le replay de sessions ?",
      intro: "Le replay de sessions reconstruit visuellement l’interaction avec un site ou une application et la relie aux événements, parcours et erreurs.",
      benefits: [
        { title: "Enregistrer l’interaction", description: "Capturez écrans, clics, gestes et navigation pour reconstruire l’expérience chronologiquement." },
        { title: "Ajouter le contexte analytics", description: "Les métriques indiquent les sessions à regarder et le replay explique leur déroulement." },
        { title: "Respecter la vie privée", description: "Une bonne mise en œuvre masque les champs sensibles et contrôle capture, rétention et accès." },
      ],
      evidence: "Le replay ne remplace pas l’analytics : il apporte les preuves qualitatives qui expliquent les tendances quantitatives.",
      platforms: "Il s’applique aux sites web et applications mobiles avec une méthode de capture adaptée à chaque plateforme.",
    },
    "/app-analytics": {
      metaTitle: "Analytics d’applications mobiles avec replay | Rejourney",
      metaDescription: "Mesurez usage, rétention, parcours et crashs mobiles, puis reliez chaque signal aux sessions React Native, Flutter et iOS.",
      primaryKeyword: "analytics d’applications mobiles",
      secondaryKeywords: ["outils d’analytics mobile", "analytics React Native", "analytics Flutter et iOS"],
      h1: "Analytics d’applications mobiles avec replay de sessions",
      intro: "Mesurez l’usage, la rétention, les parcours et la stabilité, puis ouvrez les sessions qui expliquent chaque variation.",
      benefits: [
        { title: "Comportement et rétention", description: "Suivez utilisateurs actifs, retour et adoption sans séparer les chiffres de l’expérience réelle." },
        { title: "Parcours et conversion", description: "Repérez les abandons pendant l’inscription, l’onboarding ou le paiement et ouvrez les sessions." },
        { title: "Qualité et stabilité", description: "Reliez crashs, ANR et lenteurs réseau aux appareils, versions et parcours touchés." },
      ],
      evidence: "L’analytics quantifie le problème ; le replay montre comment l’utilisateur le vit et ce qui doit changer dans le produit.",
      platforms: "Analytics pour React Native, Expo, Flutter et iOS dans un espace partagé entre produit, ingénierie et support.",
    },
    "/website-analytics": {
      metaTitle: "Analytics de l’expérience utilisateur web | Rejourney",
      metaDescription: "Analytics UX pour sites web avec comportement, parcours, heatmaps et replay afin de comprendre ce qui favorise ou bloque la conversion.",
      primaryKeyword: "analytics de l’expérience utilisateur web",
      secondaryKeywords: ["analytics UX", "analyse du comportement web", "expérience utilisateur du site"],
      h1: "Analytics de l’expérience utilisateur pour les sites web",
      intro: "Comprenez le comportement sur votre site grâce aux parcours, heatmaps et replays, au-delà des simples chiffres de trafic.",
      benefits: [
        { title: "Mesurer l’expérience", description: "Suivez interactions, parcours et résultats pour savoir si les visiteurs trouvent ce qu’ils cherchent." },
        { title: "Détecter les frictions", description: "Utilisez clics de rage, défilement et erreurs pour identifier les interfaces confuses ou cassées." },
        { title: "Voir les preuves", description: "Ouvrez les sessions réelles de chaque tendance pour prendre une décision claire." },
      ],
      evidence: "L’analytics UX mesure la qualité du parcours, pas seulement l’acquisition, et rattache les résultats à des comportements observables.",
      platforms: "Adapté aux sites marketing et applications web développées avec React, Next.js, Vue et d’autres frameworks.",
    },
    "/funnel-replay-evidence": {
      metaTitle: "Analyse de funnel avec replay de sessions | Rejourney",
      metaDescription: "Analysez les funnels de conversion et ouvrez les sessions des utilisateurs qui progressent ou abandonnent avec erreurs et contexte réseau.",
      primaryKeyword: "analyse de funnel",
      secondaryKeywords: ["analyse de funnel de conversion", "analyse des abandons", "replay de funnel"],
      h1: "Analyse de funnel avec preuves de replay",
      intro: "Mesurez le passage entre les étapes et observez les sessions des utilisateurs qui abandonnent, reviennent ou changent de chemin.",
      benefits: [
        { title: "Mesurer les abandons", description: "Comparez entrées et réussites à chaque étape selon plateforme, version ou segment." },
        { title: "Ouvrir les sessions", description: "Voyez ce qui précède l’abandon au lieu d’en déduire la cause depuis un pourcentage." },
        { title: "Relier la cause technique", description: "Examinez erreurs, requêtes lentes et crashs répétés sur l’étape affectée." },
      ],
      evidence: "Rejourney combine mesure quantitative et preuve visuelle pour distinguer message, interface, performance et backend.",
      platforms: "Analysez inscription, onboarding, paiement et abonnement sur le web et les applications mobiles.",
    },
    "/heatmaps": {
      metaTitle: "Outils de heatmap pour web et mobile | Rejourney",
      metaDescription: "Heatmaps de clic, défilement, attention, gestes et rage clicks avec accès aux sessions associées sur web et mobile.",
      primaryKeyword: "outils de heatmap pour site web",
      secondaryKeywords: ["heatmaps de clic", "heatmaps de défilement", "heatmaps tactiles mobiles"],
      h1: "Outils de heatmap pour sites web et applications mobiles",
      intro: "Regroupez clics, défilements et gestes dans une carte claire, puis ouvrez les sessions à l’origine de chaque tendance.",
      benefits: [
        { title: "Heatmaps de clic", description: "Identifiez les éléments qui attirent l’interaction et les clics sur du contenu non interactif." },
        { title: "Défilement et attention", description: "Voyez où les visiteurs cessent de défiler et quelles zones reçoivent vraiment leur attention." },
        { title: "Gestes et rage clicks", description: "Détectez les gestes regroupés et actions répétées sur mobile, puis ouvrez leurs sessions." },
      ],
      evidence: "La heatmap montre la tendance agrégée ; le replay révèle l’intention, l’état de l’interface et le contexte technique.",
      platforms: "Heatmaps de clic et de défilement pour le web, et cartes tactiles pour les applications mobiles compatibles.",
    },
    "/stability-monitoring": {
      metaTitle: "Rapports de crash mobile avec replay | Rejourney",
      metaDescription: "Rapports de crashs, ANR et erreurs mobiles avec replay, appareil, version et requêtes touchées, au-delà de la stack trace.",
      primaryKeyword: "rapports de crash d’applications mobiles",
      secondaryKeywords: ["surveillance de stabilité mobile", "surveillance ANR", "suivi des erreurs JavaScript"],
      h1: "Rapports de crash d’applications mobiles avec replay",
      intro: "Regroupez crashs, ANR et erreurs par version et appareil, puis regardez la session précédant le problème.",
      benefits: [
        { title: "Rapports de crash", description: "Priorisez les crashs répétés selon les sessions, appareils et versions touchés." },
        { title: "Surveillance ANR", description: "Examinez blocages d’interface et signaux du thread principal avec l’action de l’utilisateur." },
        { title: "Suivi des erreurs", description: "Reliez erreurs JavaScript et requêtes échouées au replay, pas seulement à un message." },
      ],
      evidence: "Rejourney va au-delà des stack traces en conservant expérience, parcours, appareil et réseau avec le signal technique.",
      platforms: "Contexte de stabilité pour React Native, Expo, Flutter et iOS, plus les erreurs web et JavaScript.",
    },
  },
  de: {
    "/record-user-sessions": {
      metaTitle: "Session-Replay-Tools | Rejourney",
      metaDescription: "Nutzersitzungen im Web und auf Mobilgeräten aufzeichnen und wiedergeben – mit Maskierung, Events, Fehlern und Requests im selben Kontext.",
      primaryKeyword: "Session-Replay-Tools",
      secondaryKeywords: ["Session-Replay-Software", "Nutzersitzungen aufzeichnen", "Website-Sitzungsaufzeichnung"],
      h1: "Session-Replay-Tools zum Aufzeichnen von Nutzersitzungen",
      intro: "Zeichnen Sie Web- und Mobile-Sitzungen auf und öffnen Sie sie direkt aus der Journey, dem Event oder dem Fehler, den Ihr Team untersucht.",
      benefits: [
        { title: "Vollständigen Kontext erfassen", description: "Bildschirme, Klicks, Navigation, Events und Requests bleiben in einer gemeinsamen Zeitleiste." },
        { title: "Relevante Sitzungen finden", description: "Filtern Sie nach Route, Gerät, Version oder Ergebnis, um schnell zu den richtigen Belegen zu gelangen." },
        { title: "Sensible Daten schützen", description: "Maskierung und Aufnahmeregeln sorgen für nützliche Replays mit Datenschutz." },
      ],
      evidence: "Rejourney verbindet Aufzeichnung und Analyse, damit aus einem Conversion-Rückgang oder Fehler direkt überprüfbare Sitzungen werden.",
      platforms: "Unterstützt Web, React Native, Expo, Flutter und iOS mit Event-, Netzwerk-, Geräte- und Versionskontext.",
    },
    "/web-session-replay": {
      metaTitle: "Web-Session-Replay-Software | Rejourney",
      metaDescription: "Web Session Replay verbindet Browserverhalten mit Routen, Events, Netzwerk-Requests und Konsolenfehlern und schützt sensible Daten.",
      primaryKeyword: "Web Session Replay",
      secondaryKeywords: ["Website Session Replay", "Browser-Sitzungsaufzeichnung", "Web-Sitzungsaufzeichnung"],
      h1: "Web-Session-Replay-Software",
      intro: "Sehen Sie, wie Menschen Ihre Website nutzen, und verbinden Sie jede Interaktion mit Routen, Events, Netzwerk-Requests und Browserfehlern.",
      benefits: [
        { title: "Browsererlebnis rekonstruieren", description: "Prüfen Sie Seitenänderungen, Klicks, Scrollen und Navigation in der tatsächlichen Reihenfolge." },
        { title: "Oberfläche und Netzwerk verbinden", description: "Öffnen Sie fehlgeschlagene Requests und Konsolenmeldungen genau am betroffenen Moment." },
        { title: "Journeys untersuchen", description: "Wechseln Sie von einem Abbruchschritt zu den Aufzeichnungen der betroffenen Besucher." },
      ],
      evidence: "Web Session Replay vereint sichtbares Verhalten und technischen Kontext, damit Reibung überprüft statt erraten wird.",
      platforms: "Funktioniert mit JavaScript, React, Next.js, Vue, Svelte und weiteren modernen Web-Frameworks.",
    },
    "/mobile-session-replay": {
      metaTitle: "Mobile-App-Session-Replay | Rejourney",
      metaDescription: "Mobile Session Replay für React Native, Expo, Flutter, iOS und Android mit Abstürzen, ANRs, Requests und Gerätekontext.",
      primaryKeyword: "Mobile Session Replay",
      secondaryKeywords: ["Mobile-App-Session-Replay", "React-Native-Session-Replay", "Flutter-, iOS- und Android-Replay"],
      h1: "Session Replay für mobile Apps",
      intro: "Sehen Sie Taps, Navigation und Bildschirmzustände vor Reibung oder Absturz – zusammen mit Geräte-, Versions- und Netzwerkkontext.",
      benefits: [
        { title: "React Native und Expo", description: "Prüfen Sie hybride Sitzungen mit Events, Requests und App-Version in einem Arbeitsbereich." },
        { title: "Flutter, iOS und Android", description: "Verstehen Sie Taps und Bildschirmwechsel auf unterschiedlichen Geräten und Betriebssystemen." },
        { title: "Abstürze und ANRs", description: "Öffnen Sie die Sitzung vor einem Absturz oder UI-Freeze statt nur den Stacktrace." },
      ],
      evidence: "Rejourney verbindet mobiles Verhalten mit technischen Signalen, damit Produkt und Entwicklung dieselbe Erfahrung untersuchen.",
      platforms: "Integrationspfade für React Native, Expo, Flutter und Swift auf iOS sowie Android über unterstützte Frameworks.",
    },
    "/what-is-session-replay": {
      metaTitle: "Was ist Session Replay? | Rejourney",
      metaDescription: "Erfahren Sie, wie Session Replay Interaktionen datenschutzbewusst rekonstruiert und Verhalten mit Analytics, Journeys und Fehlern verbindet.",
      primaryKeyword: "Was ist Session Replay",
      secondaryKeywords: ["Session-Replay-Definition", "wie funktioniert Session Replay", "Session-Replay-Analytics"],
      h1: "Was ist Session Replay?",
      intro: "Session Replay rekonstruiert visuell die Interaktion mit einer Website oder App und verbindet sie mit Events, Journeys und Fehlern.",
      benefits: [
        { title: "Interaktionen erfassen", description: "Bildschirme, Klicks, Taps und Navigation werden chronologisch zu einer Erfahrung zusammengesetzt." },
        { title: "Analytics-Kontext ergänzen", description: "Kennzahlen zeigen, welche Sitzungen wichtig sind; Replay erklärt, was darin geschah." },
        { title: "Datenschutz einplanen", description: "Eine verantwortungsvolle Umsetzung maskiert sensible Felder und steuert Aufnahme, Zugriff und Aufbewahrung." },
      ],
      evidence: "Session Replay ersetzt Analytics nicht, sondern liefert qualitative Belege für die Muster in quantitativen Daten.",
      platforms: "Die Methode eignet sich für Websites und mobile Apps, wobei Erfassung und Rekonstruktion an die Plattform angepasst werden.",
    },
    "/app-analytics": {
      metaTitle: "Mobile-App-Analytics mit Session Replay | Rejourney",
      metaDescription: "Mobile-App-Analytics für Nutzung, Retention, Journeys und Abstürze mit direktem Zugriff auf React-Native-, Flutter- und iOS-Sitzungen.",
      primaryKeyword: "Mobile-App-Analytics",
      secondaryKeywords: ["Mobile-Analytics-Tools", "React-Native-Analytics", "Flutter- und iOS-Analytics"],
      h1: "Mobile-App-Analytics mit Session Replay",
      intro: "Messen Sie Nutzung, Retention, Journeys und Stabilität und öffnen Sie die Sitzungen, die jede Veränderung erklären.",
      benefits: [
        { title: "Verhalten und Retention", description: "Verfolgen Sie aktive Nutzer, Wiederkehr und Adoption, ohne Zahlen von der realen Erfahrung zu trennen." },
        { title: "Journeys und Conversion", description: "Finden Sie Abbrüche in Registrierung, Onboarding oder Zahlung und öffnen Sie die Sitzungen dahinter." },
        { title: "Qualität und Stabilität", description: "Verbinden Sie Abstürze, ANRs und langsame Requests mit Geräten, Versionen und Journeys." },
      ],
      evidence: "Analytics quantifiziert das Problem; Session Replay zeigt, wie Nutzer es erleben und was sich im Produkt ändern muss.",
      platforms: "Analytics für React Native, Expo, Flutter und iOS in einem gemeinsamen Arbeitsbereich für Produkt, Entwicklung und Support.",
    },
    "/website-analytics": {
      metaTitle: "User-Experience-Analytics für Websites | Rejourney",
      metaDescription: "UX Analytics für Websites verbindet Verhalten, Journeys, Heatmaps und Session Replay, um Conversion-Hürden und hilfreiche Inhalte zu verstehen.",
      primaryKeyword: "User-Experience-Analytics für Websites",
      secondaryKeywords: ["UX Analytics", "Website-Verhaltensanalyse", "Website-User-Experience-Analytics"],
      h1: "User-Experience-Analytics für Websites",
      intro: "Verstehen Sie Website-Verhalten mit Journeys, Heatmaps und Session Replay – nicht nur mit Traffic-Zahlen.",
      benefits: [
        { title: "Erlebnis messen", description: "Verfolgen Sie Interaktionen, Journeys und Ergebnisse, die zeigen, ob Besucher ihr Ziel erreichen." },
        { title: "Reibung erkennen", description: "Nutzen Sie Rage Clicks, Scrolltiefe und Fehler, um verwirrende oder defekte Oberflächen zu finden." },
        { title: "Belege ansehen", description: "Öffnen Sie reale Sitzungen hinter jedem Muster und treffen Sie klare Design- oder Entwicklungsentscheidungen." },
      ],
      evidence: "UX Analytics bewertet die Qualität der Website-Journey und verbindet Ergebnisse mit beobachtbarem Nutzerverhalten.",
      platforms: "Geeignet für Marketing-Websites und Web-Apps mit React, Next.js, Vue und anderen Frameworks.",
    },
    "/funnel-replay-evidence": {
      metaTitle: "Funnel-Analyse mit Session Replay | Rejourney",
      metaDescription: "Conversion-Funnels analysieren und Sitzungen von Nutzern öffnen, die fortfahren oder abbrechen – mit Fehler-, Netzwerk- und UI-Kontext.",
      primaryKeyword: "Funnel-Analyse",
      secondaryKeywords: ["Conversion-Funnel-Analyse", "Funnel-Abbruchanalyse", "Funnel Session Replay"],
      h1: "Funnel-Analyse mit Replay-Belegen",
      intro: "Messen Sie Übergänge zwischen Schritten und sehen Sie Sitzungen von Nutzern, die abbrechen, zurückkehren oder anders navigieren.",
      benefits: [
        { title: "Abbrüche messen", description: "Vergleichen Sie Einstiege und Abschlüsse je Schritt, Plattform, Version oder Segment." },
        { title: "Sitzungen öffnen", description: "Sehen Sie, was vor dem Abbruch geschieht, statt die Ursache aus einer Quote abzuleiten." },
        { title: "Technische Ursache verbinden", description: "Prüfen Sie Fehler, langsame Requests und Abstürze am betroffenen Schritt." },
      ],
      evidence: "Rejourney verbindet Messung und visuelle Belege, um Probleme in Botschaft, Oberfläche, Performance oder Backend zu unterscheiden.",
      platforms: "Analysieren Sie Registrierung, Onboarding, Checkout und Abonnements im Web und in mobilen Apps.",
    },
    "/heatmaps": {
      metaTitle: "Website- und Mobile-Heatmap-Tools | Rejourney",
      metaDescription: "Klick-, Scroll-, Attention-, Touch- und Rage-Click-Heatmaps mit direktem Zugriff auf die zugehörigen Web- und Mobile-Sitzungen.",
      primaryKeyword: "Website-Heatmap-Tools",
      secondaryKeywords: ["Klick-Heatmaps", "Scroll- und Attention-Maps", "Mobile-Touch-Heatmaps"],
      h1: "Heatmap-Tools für Websites und mobile Apps",
      intro: "Fassen Sie Klicks, Scrollen und Taps in klaren Karten zusammen und öffnen Sie die Sitzungen hinter jedem Muster.",
      benefits: [
        { title: "Klick-Heatmaps", description: "Erkennen Sie, welche Elemente Interaktion anziehen und wo nicht interaktive Inhalte angeklickt werden." },
        { title: "Scrollen und Aufmerksamkeit", description: "Sehen Sie, wo Besucher nicht weiterlesen und welche Bereiche echte Aufmerksamkeit erhalten." },
        { title: "Taps und Rage Clicks", description: "Finden Sie Tap-Cluster und wiederholte Aktionen auf Mobilgeräten und öffnen Sie ihre Sitzungen." },
      ],
      evidence: "Die Heatmap zeigt das aggregierte Muster; Replay erklärt Absicht, UI-Zustand und technischen Kontext dahinter.",
      platforms: "Klick- und Scroll-Heatmaps für das Web sowie Touch-Heatmaps für unterstützte mobile Apps.",
    },
    "/stability-monitoring": {
      metaTitle: "Mobile-App-Absturzberichte mit Replay | Rejourney",
      metaDescription: "Mobile Crash Reports, ANR-Monitoring und Fehlertracking mit Session Replay, Gerät, Version und betroffenen Requests statt nur Stacktraces.",
      primaryKeyword: "Mobile-App-Absturzberichte",
      secondaryKeywords: ["App-Stabilitätsmonitoring", "ANR-Monitoring", "JavaScript-Fehlertracking"],
      h1: "Mobile-App-Absturzberichte mit Session Replay",
      intro: "Gruppieren Sie Abstürze, ANRs und Fehler nach Version und Gerät und sehen Sie die Sitzung vor dem Problem.",
      benefits: [
        { title: "Absturzberichte", description: "Priorisieren Sie wiederkehrende Abstürze nach betroffenen Sitzungen, Geräten und Versionen." },
        { title: "ANR-Monitoring", description: "Prüfen Sie UI-Freezes und Main-Thread-Signale zusammen mit der Nutzeraktion." },
        { title: "Fehlertracking", description: "Verbinden Sie JavaScript-Fehler und fehlgeschlagene Requests mit Replay statt nur einer Fehlermeldung." },
      ],
      evidence: "Rejourney geht über Stacktrace-Tools hinaus, weil Nutzererlebnis, Journey, Gerät und Netzwerk beim technischen Signal bleiben.",
      platforms: "Stabilitätskontext für React Native, Expo, Flutter und iOS sowie Web- und JavaScript-Fehler.",
    },
  },
};

export type LocalizedSeoPage = LocalizedSeoContent & {
  locale: MarketingLocale;
  localeCode: SeoLocalizedLocaleCode;
  basePath: SeoLocalizedPagePath;
  localizedPath: string;
  ui: LocalizedSeoUi;
};

function normalizePath(pathname: string): string {
  const withLeadingSlash = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, "") : withLeadingSlash;
}

export function isSeoLocalizedLocaleCode(value: string): value is SeoLocalizedLocaleCode {
  return SEO_LOCALIZED_LOCALE_CODES.includes(value as SeoLocalizedLocaleCode);
}

export type SeoPreferredLocaleCode = "en" | SeoLocalizedLocaleCode;

/**
 * Selects among the languages these SEO pages support using the browser's
 * ordered Accept-Language preferences. Geography is deliberately not used.
 */
export function getPreferredSeoLocaleCode(
  acceptLanguage: string | null | undefined,
): SeoPreferredLocaleCode {
  if (!acceptLanguage) return "en";

  const supportedLocaleCodes = new Set<SeoPreferredLocaleCode>([
    "en",
    ...SEO_LOCALIZED_LOCALE_CODES,
  ]);
  const preferences = acceptLanguage
    .split(",")
    .map((entry, index) => {
      const [languageRange = "", ...parameters] = entry.trim().split(";");
      const localeCode = languageRange.toLowerCase().split("-")[0];
      if (!supportedLocaleCodes.has(localeCode as SeoPreferredLocaleCode)) return null;

      const qualityParameter = parameters.find((parameter) => parameter.trim().toLowerCase().startsWith("q="));
      const quality = qualityParameter
        ? Number.parseFloat(qualityParameter.trim().slice(2))
        : 1;
      if (!Number.isFinite(quality) || quality <= 0) return null;

      return {
        localeCode: localeCode as SeoPreferredLocaleCode,
        quality: Math.min(quality, 1),
        index,
      };
    })
    .filter((preference): preference is NonNullable<typeof preference> => preference !== null)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  return preferences[0]?.localeCode ?? "en";
}

export function isSeoLocalizedPagePath(value: string): value is SeoLocalizedPagePath {
  return SEO_LOCALIZED_PAGE_PATHS.includes(value as SeoLocalizedPagePath);
}

export function getLocalizedSeoPath(localeCode: "en" | SeoLocalizedLocaleCode, basePath: SeoLocalizedPagePath): string {
  return localeCode === "en" ? basePath : `/${localeCode}${basePath}`;
}

export function getLocalizedSeoPageByPath(pathname: string): LocalizedSeoPage | null {
  const normalized = normalizePath(pathname);
  const segments = normalized.split("/").filter(Boolean);
  const localeCode = segments[0]?.toLowerCase();
  if (!localeCode || !isSeoLocalizedLocaleCode(localeCode)) return null;

  const basePath = `/${segments.slice(1).join("/")}`;
  if (!isSeoLocalizedPagePath(basePath)) return null;

  return {
    ...localizedSeoContent[localeCode][basePath],
    locale: MARKETING_LOCALES[localeCode],
    localeCode,
    basePath,
    localizedPath: getLocalizedSeoPath(localeCode, basePath),
    ui: localizedSeoUi[localeCode],
  };
}

export function getLocalizedSeoPage(localeCode: SeoLocalizedLocaleCode, basePath: SeoLocalizedPagePath): LocalizedSeoPage {
  return getLocalizedSeoPageByPath(getLocalizedSeoPath(localeCode, basePath)) as LocalizedSeoPage;
}

export function getLocalizedSeoAlternateLinks(basePath: SeoLocalizedPagePath) {
  return [
    {
      hrefLang: MARKETING_LOCALES.en.languageTag,
      href: `${SITE_URL}${getLocalizedSeoPath("en", basePath)}`,
    },
    ...SEO_LOCALIZED_LOCALE_CODES.map((localeCode) => ({
      hrefLang: MARKETING_LOCALES[localeCode].languageTag,
      href: `${SITE_URL}${getLocalizedSeoPath(localeCode, basePath)}`,
    })),
    {
      hrefLang: "x-default",
      href: `${SITE_URL}${getLocalizedSeoPath("en", basePath)}`,
    },
  ];
}

export function getLocalizedSeoFaq(page: LocalizedSeoPage) {
  return [
    {
      question: page.ui.faqWhat(page.primaryKeyword),
      answer: page.intro,
    },
    {
      question: page.ui.faqWhy,
      answer: page.evidence,
    },
    {
      question: page.ui.faqPlatforms,
      answer: page.platforms,
    },
  ];
}
