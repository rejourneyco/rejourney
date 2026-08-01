import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { MarketingHomeCopy } from '~/shared/lib/internationalMarketing';

const BUNDLEPHOBIA_REJOURNEY = 'https://bundlephobia.com/package/@rejourneyco/react-native@1.0.17';
const BUNDLEPHOBIA_SENTRY = 'https://bundlephobia.com/package/@sentry/react-native@8.7.0';
const BUNDLEPHOBIA_WEB_REJOURNEY = 'https://bundlephobia.com/package/@rejourneyco/browser@0.1.0';
const BUNDLEPHOBIA_POSTHOG = 'https://bundlephobia.com/package/posthog-js@1.374.2';
const GITHUB_REPO_URL = 'https://github.com/rejourneyco/rejourney';
const WEB_BENCHMARK_RESULT_PATH = 'benchmarks/web-analytics/results/2026-05-19T03-47-21-774Z/benchmark-report.md';
const WEB_BENCHMARK_REPORT_URL = `${GITHUB_REPO_URL}/blob/main/${WEB_BENCHMARK_RESULT_PATH}`;

const performanceMetricRows = [
    {
        metric: 'Frame Rate Impact (fps drop)',
        average: '0.2',
        max: '1.1',
        min: '0.0',
        thread: 'Main Thread',
        threadClassName: 'text-blue-600 bg-blue-50 border-blue-100',
    },
    {
        metric: 'SDK Heap Allocations',
        average: '0.8 MB',
        max: '2.4 MB',
        min: '0.4 MB',
        thread: 'Background Task',
        threadClassName: 'text-slate-600 bg-slate-50 border-slate-200/60',
    },
    {
        metric: 'Total Main Thread Impact',
        average: '12.4 ms',
        max: '28.2 ms',
        min: '8.1 ms',
        thread: 'Main Thread',
        threadClassName: 'text-blue-600 bg-blue-50 border-blue-100',
    },
];

type PerformanceLocale = 'en' | 'ar' | 'es' | 'fr' | 'de';

const performanceLabels: Record<PerformanceLocale, {
    heading: string;
    webComparison: string;
    mobileComparison: string;
    packageSize: string;
    webSmaller: string;
    mobileSmaller: string;
    minifiedPayload: string;
    nativePackageSize: string;
    bundleMetric: string;
    verifyMetrics: string;
    uploadVolume: string;
    lessData: string;
    uploadPayload: string;
    mainThread: string;
    evidenceReport: string;
    performanceImpact: string;
    ultraLightweight: string;
    threadMetrics: string;
    average: string;
    maximum: string;
    minimum: string;
    internalBenchmarks: string;
    metrics: string[];
    threads: [string, string];
}> = {
    en: {
        heading: 'Unmatched Speed & Footprint', webComparison: 'Web SDK vs PostHog', mobileComparison: 'Mobile SDK vs Sentry', packageSize: 'SDK PACKAGE SIZE', webSmaller: '3.9X Smaller', mobileSmaller: '10.1X Smaller', minifiedPayload: 'Minified Package Payload', nativePackageSize: 'React Native Package Size', bundleMetric: 'BundlePhobia Metric', verifyMetrics: 'Verify metrics', uploadVolume: 'DATA UPLOAD VOLUME', lessData: '3.0X Less Data', uploadPayload: 'Session Upload Payload (KiB/min)', mainThread: 'Main Thread', evidenceReport: 'Evidence report', performanceImpact: 'PERFORMANCE IMPACT', ultraLightweight: 'Ultra-lightweight', threadMetrics: 'SDK Thread Metrics', average: 'Avg', maximum: 'Max', minimum: 'Min', internalBenchmarks: 'Based on our internal benchmarks', metrics: performanceMetricRows.map((row) => row.metric), threads: ['Main Thread', 'Background Task'],
    },
    ar: {
        heading: 'سرعة وحجم لا مثيل لهما', webComparison: 'حزمة الويب مقابل PostHog', mobileComparison: 'حزمة الجوال مقابل Sentry', packageSize: 'حجم حزمة SDK', webSmaller: 'أصغر ٣٫٩ مرة', mobileSmaller: 'أصغر ١٠٫١ مرة', minifiedPayload: 'حجم الحزمة المصغرة', nativePackageSize: 'حجم حزمة React Native', bundleMetric: 'مقياس BundlePhobia', verifyMetrics: 'تحقق من المقاييس', uploadVolume: 'حجم البيانات المرفوعة', lessData: 'بيانات أقل ٣ مرات', uploadPayload: 'حجم رفع الجلسة (KiB/دقيقة)', mainThread: 'الخيط الرئيسي', evidenceReport: 'تقرير الأدلة', performanceImpact: 'تأثير الأداء', ultraLightweight: 'خفيف للغاية', threadMetrics: 'مقاييس خيوط SDK', average: 'متوسط', maximum: 'أقصى', minimum: 'أدنى', internalBenchmarks: 'استنادًا إلى اختباراتنا الداخلية', metrics: ['تأثير معدل الإطارات', 'تخصيصات ذاكرة SDK', 'إجمالي تأثير الخيط الرئيسي'], threads: ['الخيط الرئيسي', 'مهمة خلفية'],
    },
    es: {
        heading: 'Velocidad y tamaño incomparables', webComparison: 'SDK web vs PostHog', mobileComparison: 'SDK móvil vs Sentry', packageSize: 'TAMAÑO DEL SDK', webSmaller: '3,9 veces menor', mobileSmaller: '10,1 veces menor', minifiedPayload: 'Paquete minificado', nativePackageSize: 'Tamaño del paquete React Native', bundleMetric: 'Métrica de BundlePhobia', verifyMetrics: 'Verificar métricas', uploadVolume: 'VOLUMEN DE DATOS SUBIDOS', lessData: '3 veces menos datos', uploadPayload: 'Carga de sesión (KiB/min)', mainThread: 'Hilo principal', evidenceReport: 'Informe de evidencia', performanceImpact: 'IMPACTO EN EL RENDIMIENTO', ultraLightweight: 'Ultraligero', threadMetrics: 'Métricas de hilos del SDK', average: 'Prom.', maximum: 'Máx.', minimum: 'Mín.', internalBenchmarks: 'Basado en nuestras pruebas internas', metrics: ['Impacto en la tasa de fotogramas', 'Asignaciones de memoria del SDK', 'Impacto total en el hilo principal'], threads: ['Hilo principal', 'Tarea en segundo plano'],
    },
    fr: {
        heading: 'Vitesse et empreinte inégalées', webComparison: 'SDK web vs PostHog', mobileComparison: 'SDK mobile vs Sentry', packageSize: 'TAILLE DU SDK', webSmaller: '3,9 fois plus petit', mobileSmaller: '10,1 fois plus petit', minifiedPayload: 'Charge utile minifiée', nativePackageSize: 'Taille du paquet React Native', bundleMetric: 'Mesure BundlePhobia', verifyMetrics: 'Vérifier les mesures', uploadVolume: 'VOLUME DE DONNÉES ENVOYÉ', lessData: '3 fois moins de données', uploadPayload: 'Charge de session (KiB/min)', mainThread: 'Thread principal', evidenceReport: 'Rapport de preuve', performanceImpact: 'IMPACT SUR LES PERFORMANCES', ultraLightweight: 'Ultra-léger', threadMetrics: 'Mesures des threads du SDK', average: 'Moy.', maximum: 'Max.', minimum: 'Min.', internalBenchmarks: 'Selon nos tests internes', metrics: ['Impact sur la fréquence d’images', 'Allocations mémoire du SDK', 'Impact total sur le thread principal'], threads: ['Thread principal', 'Tâche en arrière-plan'],
    },
    de: {
        heading: 'Unerreichte Geschwindigkeit und Größe', webComparison: 'Web-SDK vs. PostHog', mobileComparison: 'Mobile-SDK vs. Sentry', packageSize: 'SDK-PAKETGRÖSSE', webSmaller: '3,9-mal kleiner', mobileSmaller: '10,1-mal kleiner', minifiedPayload: 'Minifizierte Paketgröße', nativePackageSize: 'React-Native-Paketgröße', bundleMetric: 'BundlePhobia-Messwert', verifyMetrics: 'Messwerte prüfen', uploadVolume: 'DATEN-UPLOADVOLUMEN', lessData: '3-mal weniger Daten', uploadPayload: 'Sitzungs-Upload (KiB/Min.)', mainThread: 'Hauptthread', evidenceReport: 'Nachweisbericht', performanceImpact: 'PERFORMANCE-AUSWIRKUNG', ultraLightweight: 'Extrem leichtgewichtig', threadMetrics: 'SDK-Thread-Messwerte', average: 'Ø', maximum: 'Max.', minimum: 'Min.', internalBenchmarks: 'Basierend auf unseren internen Benchmarks', metrics: ['Auswirkung auf die Bildrate', 'SDK-Heap-Zuweisungen', 'Gesamtauswirkung auf den Hauptthread'], threads: ['Hauptthread', 'Hintergrundaufgabe'],
    },
};

export const PerformanceMetrics: React.FC<{
    copy?: MarketingHomeCopy['performance'];
    dir?: 'ltr' | 'rtl';
    initialPlatform?: 'web' | 'mobile';
    locale?: PerformanceLocale;
}> = ({ dir = 'ltr', initialPlatform = 'web', locale = 'en' }) => {
    const [platform, setPlatform] = useState<'web' | 'mobile'>(initialPlatform);
    const labels = performanceLabels[locale];

    return (
        <section dir={dir} className="relative z-10 w-full overflow-hidden bg-[#fdfbf7] px-5 py-20 text-slate-950 sm:px-8 sm:py-24 lg:px-10 border-t border-slate-200/70">
            <div className="mx-auto max-w-5xl">

                {/* Header */}
                <div className="mx-auto max-w-2xl text-center mb-12">
                    <h2 className="font-display text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl lg:text-5xl">
                        {labels.heading}
                    </h2>

                    {/* Platform Selector Buttons (Sharp, Clean, Lightweight) */}
                    <div className="mt-8 inline-flex border border-slate-200 bg-white p-1">
                        <button
                            type="button"
                            onClick={() => setPlatform('web')}
                            className={`px-5 py-2 text-xs font-bold uppercase transition-all ${
                                platform === 'web'
                                    ? 'bg-slate-950 text-white'
                                    : 'text-slate-600 hover:text-slate-950'
                            }`}
                        >
                            {labels.webComparison}
                        </button>
                        <button
                            type="button"
                            onClick={() => setPlatform('mobile')}
                            className={`px-5 py-2 text-xs font-bold uppercase transition-all ${
                                platform === 'mobile'
                                    ? 'bg-slate-950 text-white'
                                    : 'text-slate-600 hover:text-slate-950'
                            }`}
                        >
                            {labels.mobileComparison}
                        </button>
                    </div>
                </div>

                {/* 2-Column Comparison Cards (Sharp Edges, Subtle Thin Borders) */}
                <div className="grid gap-6 md:grid-cols-2">

                    {/* Card 1: Package Size */}
                    <div className="border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xs flex flex-col justify-between">
                        <div>
                            <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                                <span>{labels.packageSize}</span>
                                <span className="text-emerald-600 font-bold">
                                    {platform === 'web' ? labels.webSmaller : labels.mobileSmaller}
                                </span>
                            </div>
                            <h3 className="mt-1 text-lg font-bold text-slate-950">
                                {platform === 'web' ? labels.minifiedPayload : labels.nativePackageSize}
                            </h3>
                        </div>

                        {/* Handcrafted Lightweight Vertical Bar Chart */}
                        <div className="my-8 flex items-end justify-center gap-12 h-52 pt-6 pb-2 border-b border-slate-100">
                            {/* Rejourney Bar */}
                            <div className="flex flex-col items-center gap-2 h-full justify-end w-24">
                                <span className="font-mono text-xs font-bold text-blue-600">
                                    {platform === 'web' ? '61.2 kB' : '39.7 kB'}
                                </span>
                                <div
                                    className="w-full bg-blue-600 transition-all duration-500"
                                    style={{ height: platform === 'web' ? '25.6%' : '9.8%' }}
                                />
                                <span className="text-xs font-bold text-slate-900 mt-1">Rejourney</span>
                            </div>

                            {/* Competitor Bar */}
                            <div className="flex flex-col items-center gap-2 h-full justify-end w-24">
                                <span className="font-mono text-xs font-medium text-slate-500">
                                    {platform === 'web' ? '238.6 kB' : '403.0 kB'}
                                </span>
                                <div
                                    className={`w-full transition-all duration-500 ${platform === 'web' ? 'bg-orange-500' : 'bg-purple-600'}`}
                                    style={{ height: '100%' }}
                                />
                                <span className="text-xs font-medium text-slate-500 mt-1">
                                    {platform === 'web' ? 'PostHog' : 'Sentry'}
                                </span>
                            </div>
                        </div>

                        {/* Footer Subtext */}
                        <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                            <span>{labels.bundleMetric}</span>
                            <a
                                href={platform === 'web' ? BUNDLEPHOBIA_WEB_REJOURNEY : BUNDLEPHOBIA_REJOURNEY}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-slate-700 hover:text-blue-600 font-semibold transition"
                            >
                                <span>{labels.verifyMetrics}</span>
                                <ExternalLink className="h-3 w-3" />
                            </a>
                        </div>
                    </div>

                    {/* Card 2: Upload Volume / Thread Performance */}
                    {platform === 'web' ? (
                        <div className="border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xs flex flex-col justify-between">
                            <div>
                                <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                                    <span>{labels.uploadVolume}</span>
                                    <span className="text-emerald-600 font-bold">{labels.lessData}</span>
                                </div>
                                <h3 className="mt-1 text-lg font-bold text-slate-950">
                                    {labels.uploadPayload}
                                </h3>
                            </div>

                            {/* Handcrafted Lightweight Vertical Bar Chart */}
                            <div className="my-8 flex items-end justify-center gap-12 h-52 pt-6 pb-2 border-b border-slate-100">
                                {/* Rejourney Bar */}
                                <div className="flex flex-col items-center gap-2 h-full justify-end w-24">
                                    <span className="font-mono text-xs font-bold text-blue-600">12.4 KiB</span>
                                    <div
                                        className="w-full bg-blue-600 transition-all duration-500"
                                        style={{ height: '32.8%' }}
                                    />
                                    <span className="text-xs font-bold text-slate-900 mt-1">Rejourney</span>
                                </div>

                                {/* PostHog Bar */}
                                <div className="flex flex-col items-center gap-2 h-full justify-end w-24">
                                    <span className="font-mono text-xs font-medium text-slate-500">37.8 KiB</span>
                                    <div
                                        className="w-full bg-orange-500 transition-all duration-500"
                                        style={{ height: '100%' }}
                                    />
                                    <span className="text-xs font-medium text-slate-500 mt-1">PostHog</span>
                                </div>
                            </div>

                            {/* Footer Subtext */}
                            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                                <span>{labels.mainThread}: <strong className="text-slate-800">12.4 ms</strong></span>
                                <a
                                    href={WEB_BENCHMARK_REPORT_URL}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-slate-700 hover:text-blue-600 font-semibold transition"
                                >
                                    <span>{labels.evidenceReport}</span>
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            </div>
                        </div>
                    ) : (
                        <div className="border border-slate-200/80 bg-white p-6 sm:p-8 shadow-xs flex flex-col justify-between">
                            <div>
                                <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                                    <span>{labels.performanceImpact}</span>
                                    <span className="text-emerald-600 font-bold">{labels.ultraLightweight}</span>
                                </div>
                                <h3 className="mt-1 text-lg font-bold text-slate-950">
                                    {labels.threadMetrics}
                                </h3>
                            </div>

                            <div className="my-8 flex flex-col justify-center gap-3 h-52">
                                {performanceMetricRows.map((row, index) => (
                                    <div key={row.metric} className={`flex flex-col gap-1.5 pb-3 ${index !== performanceMetricRows.length - 1 ? 'border-b border-slate-100' : ''}`}>
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm font-bold text-slate-900">{labels.metrics[index]}</span>
                                            <span className={`px-2 py-0.5 text-[9px] font-bold uppercase border ${row.threadClassName}`}>
                                                {row.thread === 'Main Thread' ? labels.threads[0] : labels.threads[1]}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between font-mono text-[10px] font-semibold text-slate-500">
                                            <div className="flex flex-col items-start w-1/3">
                                                <span className="uppercase text-[9px] text-slate-400">{labels.average}</span>
                                                <span className="text-slate-900">{row.average}</span>
                                            </div>
                                            <div className="flex flex-col items-center w-1/3">
                                                <span className="uppercase text-[9px] text-slate-400">{labels.maximum}</span>
                                                <span className="text-slate-900">{row.max}</span>
                                            </div>
                                            <div className="flex flex-col items-end w-1/3">
                                                <span className="uppercase text-[9px] text-slate-400">{labels.minimum}</span>
                                                <span className="text-slate-900">{row.min}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Footer Subtext */}
                            <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                                <span>{labels.internalBenchmarks}</span>
                            </div>
                        </div>
                    )}

                </div>

            </div>
        </section>
    );
};
