import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Copy, Github, Minus, Plus } from 'lucide-react';
import { api, type BillingPlan } from '~/shared/api/client';
import { useToast } from '~/shared/providers/ToastContext';
import { getContentLocaleCopy } from '~/shared/lib/contentLocalization';
import { getMarketingHomeCopy, getMarketingLocaleFromPathname } from '~/shared/lib/internationalMarketing';
import { PricingThreeField } from './PricingThreeField';

type PricingPlan = BillingPlan & {
    interval?: 'month' | 'year';
};

const FALLBACK_PLANS: PricingPlan[] = [
    { name: 'free', displayName: 'Free', sessionLimit: 5000, videoRetentionTier: 1, videoRetentionDays: 7, videoRetentionLabel: '7 days', priceCents: 0, interval: 'month' },
    { name: 'starter', displayName: 'Starter', sessionLimit: 25000, videoRetentionTier: 2, videoRetentionDays: 14, videoRetentionLabel: '14 days', priceCents: 500, interval: 'month' },
    { name: 'growth', displayName: 'Growth', sessionLimit: 100000, videoRetentionTier: 3, videoRetentionDays: 30, videoRetentionLabel: '30 days', priceCents: 1500, interval: 'month' },
    { name: 'pro', displayName: 'Pro', sessionLimit: 350000, videoRetentionTier: 4, videoRetentionDays: 60, videoRetentionLabel: '60 days', priceCents: 3500, interval: 'month' },
    { name: 'scale', displayName: 'Scale', sessionLimit: 1000000, videoRetentionTier: 4, videoRetentionDays: 60, videoRetentionLabel: '60 days', priceCents: 14900, interval: 'month', smartCaptureEnabled: true },
    { name: 'enterprise', displayName: 'Enterprise', sessionLimit: 10000000, videoRetentionTier: 5, videoRetentionDays: 90, videoRetentionLabel: 'Custom', priceCents: -1, interval: 'month', isCustom: true },
];

const PLAN_ORDER = ['free', 'starter', 'growth', 'pro', 'scale', 'enterprise'];

const VOLUME_PRESETS = [
    { label: '5k', sessions: 5000 },
    { label: '25k', sessions: 25000 },
    { label: '100k', sessions: 100000 },
    { label: '350k', sessions: 350000 },
    { label: '1m', sessions: 1000000 },
];

const normalizePlanName = (plan: Pick<PricingPlan, 'name' | 'displayName'>) =>
    (plan.name || plan.displayName).toLowerCase().trim();

const sliderToSessions = (value: number) => Math.round(1000 * Math.pow(1200, value / 100));

const sessionsToSlider = (sessions: number) =>
    Math.min(100, Math.max(0, (Math.log(sessions / 1000) / Math.log(1200)) * 100));

const DEFAULT_CALCULATOR_SESSIONS = 25000;
const DEFAULT_CALCULATOR_SLIDER_VALUE = sessionsToSlider(DEFAULT_CALCULATOR_SESSIONS);
const PLANS_RAIL_EDGE_TOLERANCE = 32;

const formatInteger = (value: number, languageTag = 'en-US') => new Intl.NumberFormat(languageTag).format(value);

const formatShortInteger = (value: number) => {
    if (value >= 1000000) return `${Number((value / 1000000).toFixed(1))}m`;
    if (value >= 1000) return `${Number((value / 1000).toFixed(value >= 100000 ? 0 : 1))}k`;
    return String(value);
};

const formatPlanPrice = (priceCents: number) => {
    if (priceCents < 0) return 'Custom';
    const price = priceCents / 100;
    if (price === 0) return '$0';
    return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
};

const formatCurrency = (value: number, maximumFractionDigits = 0) =>
    new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits,
    }).format(value);

const getOrderedPlans = (availablePlans: PricingPlan[]) => {
    const source = availablePlans.length > 0 ? availablePlans : FALLBACK_PLANS;
    const selectablePlans = source.filter((plan) => !plan.isCustom || plan.name === 'enterprise');

    return PLAN_ORDER.map((planName) => {
        const matchingPlans = selectablePlans.filter((plan) => normalizePlanName(plan) === planName);
        const monthlyPlan = matchingPlans.find((plan) => !plan.interval || plan.interval === 'month');
        const fallbackPlan = FALLBACK_PLANS.find((plan) => plan.name === planName);
        return monthlyPlan ?? matchingPlans[0] ?? fallbackPlan;
    }).filter((plan): plan is PricingPlan => Boolean(plan));
};

const rejourneyPlan = (sessions: number): { price: number; plan: string; isCustom: boolean } => {
    if (sessions <= 5000) return { price: 0, plan: 'Free', isCustom: false };
    if (sessions <= 25000) return { price: 5, plan: 'Starter', isCustom: false };
    if (sessions <= 100000) return { price: 15, plan: 'Growth', isCustom: false };
    if (sessions <= 350000) return { price: 35, plan: 'Pro', isCustom: false };
    if (sessions <= 1000000) return { price: 149, plan: 'Scale', isCustom: false };
    return { price: 149, plan: 'Enterprise', isCustom: true };
};

const ROI_LIFT_PRESETS = [
    { label: '+0.10pt', value: 0.1 },
    { label: '+0.25pt', value: 0.25 },
    { label: '+0.50pt', value: 0.5 },
];

const ROI_BENCHMARK_SOURCES = [
    {
        label: 'Baymard cart abandonment research',
        href: 'https://baymard.com/lists/cart-abandonment-rate',
        stat: '70.22% average documented cart abandonment rate across 50 studies.',
    },
    {
        label: 'Littledata Shopify benchmark',
        href: 'https://www.littledata.io/ecommerce-conversion-rate',
        stat: '1.4% average Shopify conversion rate; 3.2%+ is top 20%.',
    },
    {
        label: 'RevenueCat subscription app benchmarks',
        href: 'https://www.revenuecat.com/blog/growth/subscription-app-trends-benchmarks-2026/',
        stat: 'Longer trials converted 42.5% vs 25.5% for very short trials in RevenueCat benchmark data.',
    },
];

const PlanCheck: React.FC<{ children: React.ReactNode; tone?: 'check' | 'minus' | 'warning' }> = ({ children, tone = 'check' }) => (
    <li className="flex gap-3 text-[13px] font-medium leading-6 text-slate-600">
        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${tone === 'minus' || tone === 'warning' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
            {tone === 'minus' || tone === 'warning'
                ? <Minus className="h-3 w-3 stroke-[2.5px]" aria-hidden />
                : <Check className="h-3 w-3 stroke-[2.5px]" aria-hidden />}
        </span>
        <span>{children}</span>
    </li>
);

const PlanGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="border-t border-slate-100 pt-5 first:border-t-0 first:pt-0">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
        <ul className="space-y-3">{children}</ul>
    </div>
);

const captureControlLabel = (hasHighIntentCapture: boolean) =>
    hasHighIntentCapture
        ? 'High-Intent Capture keeps revenue-critical journeys'
        : 'Standard replay sampling, masking, and length controls';

const retentionHighlightClass = (retention: string) => {
    const days = Number.parseInt(retention, 10);
    return Number.isFinite(days) && days >= 30 ? 'text-emerald-700' : 'text-amber-600';
};

const isShortRetention = (retention: string) => {
    const days = Number.parseInt(retention, 10);
    return Number.isFinite(days) && days < 30;
};

const isLowAiLeakCoverage = (planName: string) => planName === 'free' || planName === 'starter';

const RetentionEvidenceLabel: React.FC<{ retention: string }> = ({ retention }) => (
    <>
        <span className={`font-bold ${retentionHighlightClass(retention)}`}>{retention}</span>
        {' '}of checkout, onboarding, and paywall evidence
    </>
);

const fixWorkflowCoverageDetail = (planName: string) => {
    switch (planName) {
        case 'free':
            return 'for short launch cohorts and first funnel checks';
        case 'starter':
            return 'for early traffic cohorts and first fix cycles';
        case 'growth':
            return 'for campaigns, experiments, and funnel comparisons';
        case 'pro':
            return 'for high-volume checkout, subscription, and onboarding fixes';
        case 'scale':
            return 'with high-intent capture control for noisy traffic';
        default:
            return 'for conversion-critical fixes';
    }
};

const FixWorkflowCoverage: React.FC<{ planName: string; sessions: string; retention: string }> = ({
    planName,
    sessions,
    retention,
}) => {
    return (
        <>
            <span className="font-bold text-slate-900">{sessions}</span>
            {' '}journeys across{' '}
            <span className={`font-bold ${retentionHighlightClass(retention)}`}>{retention}</span>
            {' '}
            {fixWorkflowCoverageDetail(planName)}
        </>
    );
};

const aiLeakUpgradePositioning = (planName: string, sessions: string) => {
    switch (planName) {
        case 'free':
            return { lead: `${sessions} sessions`, detail: ' of AI Leak Detection coverage' };
        case 'starter':
            return { lead: '5x more AI Leak Detection coverage', detail: ' than Free' };
        case 'growth':
            return { lead: '20x more AI Leak Detection coverage', detail: ' than Free' };
        case 'pro':
            return { lead: '70x more AI Leak Detection coverage', detail: ' than Free' };
        case 'scale':
            return { lead: '200x more AI Leak Detection coverage', detail: ' than Free' };
        default:
            return { lead: `${sessions} sessions`, detail: ' of AI Leak Detection coverage' };
    }
};

const AiLeakUpgradeLabel: React.FC<{ planName: string; sessions: string }> = ({ planName, sessions }) => {
    const positioning = aiLeakUpgradePositioning(planName, sessions);
    return (
        <>
            <span className="font-bold text-slate-900">{positioning.lead}</span>
            {positioning.detail}
        </>
    );
};

const PRICING_FAQS = [
    {
        question: 'Are analytics unlimited?',
        answer: 'Yes. DAU, MAU, and analytics events are unlimited on every plan. The paid meter is captured session volume because those sessions are what let Rejourney explain revenue leaks, not just count traffic.',
    },
    {
        question: 'What happens when I use all included captured sessions?',
        answer: 'New revenue evidence stops saving until the next billing cycle or until you upgrade. Rejourney still accepts analytics events for high-level charts, but fresh AI leak packets, heatmaps, journey drill-downs, crash context, replay search, and fix evidence need captured sessions to stay useful.',
    },
    {
        question: 'How is Rejourney different from usage-based replay pricing?',
        answer: 'Many observability and product analytics tools meter several things at once: events, replays, errors, seats, sites, add-ons, retention, or separate product packages. Rejourney keeps the public plans anchored to included monthly captured sessions, with core analytics and debugging features included.',
    },
    {
        question: 'Do web and mobile replays cost different amounts?',
        answer: 'No. The listed Rejourney plans use one captured-session allowance for web and mobile. You do not need to buy a separate mobile replay add-on just to understand native app sessions.',
    },
    {
        question: 'Do I pay per seat or tracked user?',
        answer: 'No. The public plans are not priced per teammate, DAU, MAU, or tracked user. Invite product, engineering, design, support, and leadership without turning every new viewer into a billing decision.',
    },
    {
        question: 'Are crashes, ANRs, errors, heatmaps, and journeys add-ons?',
        answer: 'No. They are part of the core Rejourney workspace. The plan limit decides how many captured sessions can become revenue-leak evidence each month and how long that evidence is retained.',
    },
    {
        question: 'What counts as a captured session?',
        answer: 'A captured session is one saved user session from the web or mobile SDK. It can include replay, screens, routes, events, errors, requests, and interaction context from that user journey. Analytics events still count as analytics, not as extra replay charges.',
    },
    {
        question: 'Can high-traffic teams control what gets recorded?',
        answer: 'Yes. Every plan includes standard replay capture controls such as project-level replay toggles, replay length limits, sample rate, FPS, and masking. Scale adds Smart Capture for teams that need rule-based replay selection at higher volume.',
    },
    {
        question: 'What are the standard capture controls?',
        answer: 'Standard capture controls are the project-level settings included before Smart Capture: SDK collection on or off, session replay on or off, max mobile replay length, max web replay length, session sample rate, mobile recording FPS, text input masking, and image/video masking.',
    },
    {
        question: 'What is Smart Capture, and why is it Scale-only?',
        answer: 'Smart Capture is the high-volume capture layer for Scale teams. It is more than a complex filter: AI can turn prompts into labeled rules, saved sessions are tagged by the rule that kept them, and rules can combine strict conditions with AND clauses, alternative OR rules, per-rule capture rates, colors, and names. You can target checkout risk, churn signals, rage taps, dead taps, crashes, ANRs, JS errors, API failures, API latency, slow starts, route or screen names, custom events, metadata, UTM and referral context, platform, device, browser, country, app version, network type, session duration, screen count, new users, loyal users, bouncers, and engagement score so Scale workspaces keep only the replays they actually need.',
    },
    {
        question: 'How should I compare Rejourney with PostHog, Sentry, Hotjar, Fullstory, or LogRocket?',
        answer: 'Start with the job you need done. If the important work is finding why users drop before checkout, onboarding, purchase, or activation, compare how many captured sessions feed that workflow, whether mobile is bundled, which features are add-ons, how retention works, and whether seats or events can change the bill.',
    },
    {
        question: 'Can we self-host Rejourney instead of using cloud pricing?',
        answer: 'Yes. Rejourney can be self-hosted if your team wants to run the stack on its own infrastructure. Cloud pricing is for the managed Rejourney service, storage, retention, billing, and hosted operations.',
    },
];

export const PricingTable: React.FC = () => {
    const { showToast } = useToast();
    const location = useLocation();
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getContentLocaleCopy(locale).pricing;
    const footerCopy = getMarketingHomeCopy(location.pathname).footer;
    const [availablePlans, setAvailablePlans] = useState<PricingPlan[]>([]);
    const [sliderValue, setSliderValue] = useState(DEFAULT_CALCULATOR_SLIDER_VALUE);
    const [currentConversionRate, setCurrentConversionRate] = useState(1.4);
    const [averageConversionValue, setAverageConversionValue] = useState(75);
    const [conversionLiftPoints, setConversionLiftPoints] = useState(0.25);
    const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
    const [contactCopied, setContactCopied] = useState(false);
    const copyResetTimerRef = useRef<number | null>(null);
    const plansRailRef = useRef<HTMLDivElement | null>(null);
    const [plansRailState, setPlansRailState] = useState({ canScrollPrev: false, canScrollNext: false });

    useEffect(() => {
        let cancelled = false;

        const fetchPlans = async () => {
            const plans = await api.getAvailablePlans();
            if (!cancelled && plans.length > 0) {
                setAvailablePlans(plans);
            }
        };

        fetchPlans();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        return () => {
            if (copyResetTimerRef.current) {
                window.clearTimeout(copyResetTimerRef.current);
            }
        };
    }, []);

    const plans = useMemo(() => getOrderedPlans(availablePlans), [availablePlans]);
    const calculatorSessions = sliderToSessions(sliderValue);
    const rejourneyMonthlyPlan = rejourneyPlan(calculatorSessions);
    const sliderStyle = { '--slider-fill': `${sliderValue}%` } as CSSProperties;
    const safeConversionRate = Math.max(0, currentConversionRate);
    const safeAverageConversionValue = Math.max(0, averageConversionValue);
    const safeConversionLiftPoints = Math.max(0, conversionLiftPoints);
    const baselineConversions = calculatorSessions * (safeConversionRate / 100);
    const recoveredConversions = calculatorSessions * (safeConversionLiftPoints / 100);
    const baselineRevenue = baselineConversions * safeAverageConversionValue;
    const recoveredMonthlyRevenue = recoveredConversions * safeAverageConversionValue;
    const netMonthlyUpside = recoveredMonthlyRevenue - rejourneyMonthlyPlan.price;
    const roiPercent = rejourneyMonthlyPlan.price > 0
        ? (netMonthlyUpside / rejourneyMonthlyPlan.price) * 100
        : null;
    const breakEvenConversions = safeAverageConversionValue > 0 && rejourneyMonthlyPlan.price > 0
        ? rejourneyMonthlyPlan.price / safeAverageConversionValue
        : 0;

    const updatePlansRailState = () => {
        const rail = plansRailRef.current;
        if (!rail) return;

        const maxScrollLeft = rail.scrollWidth - rail.clientWidth;
        setPlansRailState({
            canScrollPrev: rail.scrollLeft > PLANS_RAIL_EDGE_TOLERANCE,
            canScrollNext: rail.scrollLeft < maxScrollLeft - PLANS_RAIL_EDGE_TOLERANCE,
        });
    };

    const scrollPlansRail = (direction: -1 | 1) => {
        const rail = plansRailRef.current;
        if (!rail) return;

        const firstCard = rail.querySelector('article');
        const cardWidth = firstCard instanceof HTMLElement ? firstCard.offsetWidth : rail.clientWidth * 0.8;

        rail.scrollBy({
            left: direction * (cardWidth + 20),
            behavior: 'smooth',
        });
    };

    useEffect(() => {
        const rail = plansRailRef.current;
        if (!rail) return;

        const animationFrame = window.requestAnimationFrame(updatePlansRailState);
        const handleScroll = () => updatePlansRailState();

        rail.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', handleScroll);

        return () => {
            window.cancelAnimationFrame(animationFrame);
            rail.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', handleScroll);
        };
    }, [plans.length]);

    const handleCopyEmail = async () => {
        if (copyResetTimerRef.current) {
            window.clearTimeout(copyResetTimerRef.current);
        }

        try {
            await navigator.clipboard.writeText('contact@rejourney.co');
            setContactCopied(true);
            showToast(footerCopy.copyEmailToast);
        } catch {
            setContactCopied(true);
            showToast('Email: contact@rejourney.co');
        }

        copyResetTimerRef.current = window.setTimeout(() => {
            setContactCopied(false);
        }, 1800);
    };

    return (
        <section className="relative w-full border-t border-slate-200/60 bg-[#f9f9fb] text-slate-950 overflow-hidden">
            {/* Custom 3D Metallic Ribbon & Light Ambient background */}
            <PricingThreeField seed={19} />

            <div className="relative mx-auto flex w-full max-w-[1600px] flex-col gap-12 px-5 pb-12 pt-36 sm:gap-16 sm:px-8 sm:pb-16 sm:pt-44 lg:gap-20 lg:px-10 lg:pb-20 lg:pt-48">
                <div className="relative z-10 border-b border-slate-200 pb-8 sm:pb-10">
                    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
                        <div>
                            <h1 className="break-words text-4xl font-extrabold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                                {copy.heading}
                            </h1>
                            <p className="mt-4 max-w-3xl text-base font-normal leading-7 text-slate-500 sm:text-lg">
                                {copy.intro}
                            </p>
                        </div>

                        <div className="flex justify-start lg:justify-end">
                            <div className="border border-slate-200/60 bg-white/60 backdrop-blur-xl rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 flex flex-col gap-4 w-full sm:max-w-md lg:w-72">
                                <div>
                                    <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">{copy.contactEyebrow}</p>
                                    <h2 className="mt-1.5 text-lg font-bold leading-snug text-slate-900">{copy.contactHeading}</h2>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCopyEmail}
                                    className={`flex h-11 items-center justify-center gap-2 rounded-full px-4 text-xs font-semibold shadow-sm transition-all duration-200 ${
                                        contactCopied
                                            ? 'bg-slate-700 text-white hover:bg-slate-600'
                                            : 'bg-slate-950 text-white hover:bg-slate-800'
                                    }`}
                                    aria-live="polite"
                                    style={{ WebkitTapHighlightColor: 'transparent' }}
                                >
                                    {contactCopied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                                    {contactCopied ? copy.copied : copy.contactEmail}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="relative z-10">
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:gap-8 pt-4 pb-12">
                        {plans.map((plan) => {
                            const planName = normalizePlanName(plan);
                            const description = copy.planDescriptions[planName] ?? copy.planDescriptions.fallback;
                            const isFeatured = planName === 'growth';
                            const isScale = planName === 'scale';
                            const isEnterprise = planName === 'enterprise';
                            const isFree = plan.priceCents === 0;
                            const priceSuffix = isFree || isEnterprise ? '' : plan.interval === 'year' ? ` ${copy.perYear}` : ` ${copy.perMonth}`;
                            const smartCaptureEnabled = Boolean(plan.smartCaptureEnabled || planName === 'scale' || isEnterprise);

                            const cardClassName = isFeatured
                                ? 'border-slate-300/60 ring-1 ring-slate-300/40 bg-white/80 backdrop-blur-xl shadow-[0_8px_24px_rgba(15,23,42,0.07)] hover:shadow-[0_16px_36px_rgba(15,23,42,0.09)] hover:-translate-y-1.5'
                                : 'border-slate-200/60 bg-white/70 backdrop-blur-xl shadow-[0_2px_12px_rgba(15,23,42,0.06)] hover:shadow-[0_16px_36px_rgba(15,23,42,0.09)] hover:-translate-y-1.5';

                            const buttonClassName = 'bg-slate-950 text-white hover:bg-slate-800 focus:ring-slate-950';

                            return (
                                <article
                                    key={`${plan.name}-${plan.priceCents}`}
                                    className={`relative flex min-h-[680px] flex-col overflow-hidden border rounded-2xl p-6 transition-all duration-300 sm:p-7 ${cardClassName}`}
                                >
                                    {isFeatured && <div className="absolute inset-x-0 top-0 h-1.5 bg-slate-950" aria-hidden />}

                                    <div>
                                        <div className="flex min-h-10 flex-wrap items-start justify-between gap-3">
                                            <h2 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{plan.displayName}</h2>
                                            {isFeatured && (
                                                <span className="bg-slate-100 text-slate-800 px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-full border border-slate-200/60">
                                                    {copy.popular}
                                                </span>
                                            )}
                                        </div>

                                        <p className="mt-4 min-h-[72px] text-sm font-normal leading-6 text-slate-500">{description}</p>

                                        <div className="mt-6 flex flex-wrap items-end gap-x-2 gap-y-1">
                                            <span className="text-3xl font-bold tracking-tight text-slate-950">{formatPlanPrice(plan.priceCents)}</span>
                                            {priceSuffix && <span className="pb-0.5 text-sm font-medium text-slate-450">{priceSuffix}</span>}
                                        </div>
                                    </div>

                                    <div className="mt-7 flex-1 space-y-5">
                                        <PlanGroup title="Revenue evidence">
                                            <PlanCheck>Boost Web & Mobile Conversion, Checkout, and Subscription</PlanCheck>
                                            <PlanCheck>
                                                {isEnterprise
                                                    ? 'Custom session replays/month'
                                                    : `${formatInteger(plan.sessionLimit, locale.languageTag)} session replays/month included`}
                                            </PlanCheck>
                                            <PlanCheck tone={isEnterprise ? 'check' : (isShortRetention(plan.videoRetentionLabel) ? 'warning' : 'check')}>
                                                {isEnterprise
                                                    ? 'Custom conversion evidence history'
                                                    : <RetentionEvidenceLabel retention={plan.videoRetentionLabel} />}
                                            </PlanCheck>
                                            <PlanCheck tone={smartCaptureEnabled ? 'check' : 'minus'}>
                                                {isEnterprise
                                                    ? 'Smart Capture custom rules included'
                                                    : captureControlLabel(smartCaptureEnabled)}
                                            </PlanCheck>
                                        </PlanGroup>

                                        <PlanGroup title="Revenue analytics">
                                            <PlanCheck>Unlimited events, DAU, and MAU</PlanCheck>
                                            <PlanCheck>Funnels, cohorts, revenue, and retention trends</PlanCheck>
                                            <PlanCheck>Checkout, onboarding, signup, and subscription drill-downs</PlanCheck>
                                        </PlanGroup>

                                        <PlanGroup title="Fix workflow">
                                            <PlanCheck tone={isEnterprise ? 'check' : (isLowAiLeakCoverage(planName) ? 'warning' : 'check')}>
                                                <span className="inline-flex flex-wrap items-center gap-2">
                                                    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 border border-slate-200/60 px-2.5 py-0.5 text-[11px] font-bold text-slate-700 shadow-sm">
                                                        + AI Leak Detection
                                                    </span>
                                                    <span>
                                                        {isEnterprise
                                                            ? 'Custom volume conversion journeys'
                                                            : <AiLeakUpgradeLabel planName={planName} sessions={formatInteger(plan.sessionLimit, locale.languageTag)} />}
                                                    </span>
                                                </span>
                                            </PlanCheck>
                                            <PlanCheck tone={isEnterprise ? 'check' : (isShortRetention(plan.videoRetentionLabel) ? 'warning' : 'check')}>
                                                {isEnterprise ? (
                                                    <span>Custom volume of conversion-critical fixes</span>
                                                ) : (
                                                    <FixWorkflowCoverage
                                                        planName={planName}
                                                        sessions={formatInteger(plan.sessionLimit, locale.languageTag)}
                                                        retention={plan.videoRetentionLabel}
                                                    />
                                                )}
                                            </PlanCheck>
                                            <PlanCheck tone={isLowAiLeakCoverage(planName) ? 'warning' : 'check'}>
                                                {isLowAiLeakCoverage(planName) ? 'Limited ' : ''}AI Query Builder searches users, events, errors, devices, and metadata in that window
                                            </PlanCheck>
                                            <PlanCheck>Crash, API, ANR, Device, Geo fixes</PlanCheck>
                                        </PlanGroup>
                                    </div>

                                    <div className="mt-8 pt-2">
                                        {isEnterprise ? (
                                            <button
                                                type="button"
                                                onClick={handleCopyEmail}
                                                className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 shadow-sm ${buttonClassName}`}
                                                style={{ WebkitTapHighlightColor: 'transparent' }}
                                            >
                                                {contactCopied ? copy.copied : 'Contact Sales'}
                                                <ArrowRight className="h-4 w-4" aria-hidden />
                                            </button>
                                        ) : (
                                            <Link
                                                to="/login"
                                                className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 shadow-sm ${buttonClassName}`}
                                                style={{ WebkitTapHighlightColor: 'transparent' }}
                                            >
                                                {isFree ? copy.startFree : copy.getStarted}
                                                <ArrowRight className="h-4 w-4" aria-hidden />
                                            </Link>
                                        )}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </div>

                <div className="relative z-10 border-t border-slate-200 pt-12 sm:pt-16 lg:pt-20">
                    <div className="mb-8 border border-slate-200 bg-white/60 backdrop-blur-md px-6 py-5 text-left shadow-sm">
                        <span className="block text-xl font-bold tracking-tight text-slate-950">{copy.comparisonTitle}</span>
                        <span className="mt-1.5 block text-sm font-medium leading-normal text-slate-500">{copy.comparisonSubtitle}</span>
                    </div>

                    <div className="grid gap-8 border border-slate-200 bg-white/60 backdrop-blur-md p-6 shadow-sm lg:grid-cols-[0.95fr_1.2fr]">
                        <div className="space-y-6">
                            <div>
                                <div className="mb-3 flex items-end justify-between gap-4">
                                    <span className="text-xs font-bold uppercase tracking-wider text-slate-400">{copy.sessionsPerMonthLabel}</span>
                                    <span className="text-2xl font-bold text-slate-950">{formatInteger(calculatorSessions, locale.languageTag)}</span>
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    step="any"
                                    value={sliderValue}
                                    onChange={(event) => setSliderValue(Number(event.target.value))}
                                    className="pricing-range-slider"
                                    style={sliderStyle}
                                    aria-label={copy.monthlySessionsAriaLabel}
                                />
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {VOLUME_PRESETS.map((preset) => {
                                        const active = Math.abs(calculatorSessions - preset.sessions) / preset.sessions < 0.08;
                                        return (
                                            <button
                                                key={preset.label}
                                                type="button"
                                                onClick={() => setSliderValue(sessionsToSlider(preset.sessions))}
                                                className={`h-9 rounded-md border px-3 text-sm font-semibold transition shadow-sm ${
                                                    active
                                                        ? 'border-slate-950 bg-slate-950 text-white'
                                                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-950'
                                                }`}
                                                style={{ WebkitTapHighlightColor: 'transparent' }}
                                            >
                                                {preset.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-3">
                                <label className="block">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current conversion</span>
                                    <div className="mt-2 flex h-11 items-center border border-slate-200 bg-white px-3 shadow-sm">
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            step={0.1}
                                            value={currentConversionRate}
                                            onChange={(event) => setCurrentConversionRate(Number(event.target.value))}
                                            className="w-full bg-transparent text-sm font-bold text-slate-950 outline-none"
                                        />
                                        <span className="text-xs font-bold text-slate-400">%</span>
                                    </div>
                                </label>
                                <label className="block">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Value per conversion</span>
                                    <div className="mt-2 flex h-11 items-center border border-slate-200 bg-white px-3 shadow-sm">
                                        <span className="text-xs font-bold text-slate-400">$</span>
                                        <input
                                            type="number"
                                            min={0}
                                            step={1}
                                            value={averageConversionValue}
                                            onChange={(event) => setAverageConversionValue(Number(event.target.value))}
                                            className="w-full bg-transparent pl-1 text-sm font-bold text-slate-950 outline-none"
                                        />
                                    </div>
                                </label>
                                <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Lift from fixes</span>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                        {ROI_LIFT_PRESETS.map((preset) => (
                                            <button
                                                key={preset.label}
                                                type="button"
                                                onClick={() => setConversionLiftPoints(preset.value)}
                                                className={`h-11 flex-1 border px-2 text-xs font-bold transition shadow-sm ${
                                                    conversionLiftPoints === preset.value
                                                        ? 'border-slate-950 bg-slate-950 text-white'
                                                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-950'
                                                }`}
                                                style={{ WebkitTapHighlightColor: 'transparent' }}
                                            >
                                                {preset.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            <p className="text-xs font-medium leading-5 text-slate-500">
                                Model: monthly journeys x conversion-rate lift x value per conversion. Use order value for stores, first-month value for subscriptions, or blended revenue per activated user for onboarding.
                            </p>
                        </div>

                        <div className="space-y-5">
                            <div className="grid overflow-hidden border border-slate-200 rounded-xl bg-white/75 backdrop-blur-md shadow-sm sm:grid-cols-3">
                                <div className="border-b border-slate-100 bg-white/60 p-5 sm:border-b-0 sm:border-r sm:border-slate-100 sm:p-6">
                                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Recovered/month</p>
                                    <p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">{formatCurrency(recoveredMonthlyRevenue)}</p>
                                    <p className="mt-2 text-xs font-normal text-slate-500">{formatInteger(recoveredConversions, locale.languageTag)} extra conversions modeled</p>
                                </div>
                                <div className="border-b border-slate-100 p-5 sm:border-b-0 sm:border-r sm:border-slate-100 sm:p-6">
                                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Rejourney plan</p>
                                    <p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">{formatCurrency(rejourneyMonthlyPlan.price)}</p>
                                    <p className="mt-2 text-xs font-normal text-slate-500">{copy.rejourneyPlanLabel(rejourneyMonthlyPlan.plan, rejourneyMonthlyPlan.isCustom)}</p>
                                </div>
                                <div className="p-5 sm:p-6">
                                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Estimated ROI</p>
                                    <p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">
                                        {roiPercent === null ? 'Free' : `${Math.round(roiPercent).toLocaleString()}%`}
                                    </p>
                                    <p className="mt-2 text-xs font-normal text-slate-500">
                                        {roiPercent === null
                                            ? 'No paid plan cost at this volume'
                                            : `${formatCurrency(netMonthlyUpside)} net after plan cost`}
                                    </p>
                                </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-3">
                                <div className="border border-slate-200 bg-white/70 p-4 shadow-sm">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Baseline revenue</p>
                                    <p className="mt-2 text-lg font-extrabold text-slate-950">{formatCurrency(baselineRevenue)}</p>
                                </div>
                                <div className="border border-slate-200 bg-white/70 p-4 shadow-sm">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Break even</p>
                                    <p className="mt-2 text-lg font-extrabold text-slate-950">{breakEvenConversions <= 0 ? '0' : breakEvenConversions.toFixed(1)}</p>
                                    <p className="mt-1 text-xs font-medium text-slate-500">extra conversions/month</p>
                                </div>
                                <div className="border border-slate-200 bg-white/70 p-4 shadow-sm">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Annualized upside</p>
                                    <p className="mt-2 text-lg font-extrabold text-slate-950">{formatCurrency(Math.max(0, netMonthlyUpside) * 12)}</p>
                                </div>
                            </div>

                            <div className="border border-slate-200 bg-slate-50/70 p-4">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Research benchmarks used</p>
                                <div className="mt-3 grid gap-3">
                                    {ROI_BENCHMARK_SOURCES.map((source) => (
                                        <a
                                            key={source.href}
                                            href={source.href}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="group text-sm font-medium leading-5 text-slate-600 hover:text-slate-950"
                                        >
                                            <span className="font-bold text-slate-900 group-hover:text-slate-950">{source.label}:</span>{' '}
                                            {source.stat}
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="relative z-10 -mx-5 overflow-hidden border-y border-slate-200 bg-slate-50/70 backdrop-blur-sm px-5 py-12 sm:-mx-8 sm:px-8 sm:py-16 lg:-mx-10 lg:px-10 lg:py-20">
                    <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(#0f172a_1px,transparent_1px)] [background-size:16px_16px]" aria-hidden />

                    <div className="relative grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
                        <div className="max-w-2xl">
                            <p className="mb-4 inline-flex rounded-full bg-slate-100 text-slate-700 px-3 py-1 text-[11px] font-bold uppercase tracking-wider border border-slate-200/60">FAQ</p>
                            <h2 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                Everything included, clarified.
                            </h2>
                            <p className="mt-5 text-base font-normal leading-relaxed text-slate-500">
                                Replays are planned by volume. Analytics stays open, and Scale adds Smart Capture for teams that need precise replay selection.
                            </p>
                        </div>

                        <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-2xl overflow-hidden bg-white/80 backdrop-blur-md shadow-sm">
                            {PRICING_FAQS.map((faq, index) => (
                                <div key={faq.question}>
                                    <button
                                        type="button"
                                        onClick={() => setOpenFaqIndex(openFaqIndex === index ? null : index)}
                                        className="flex w-full select-none items-center justify-between gap-6 px-5 py-5 text-left transition-colors hover:bg-slate-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:px-6"
                                        style={{ WebkitTapHighlightColor: 'transparent' }}
                                        aria-expanded={openFaqIndex === index}
                                    >
                                        <span className="text-base font-semibold leading-snug text-slate-900">
                                            {faq.question}
                                        </span>
                                        <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 p-1 text-slate-500 hover:text-slate-900 transition-colors">
                                            {openFaqIndex === index
                                                ? <Minus className="h-3.5 w-3.5 stroke-[2px]" aria-hidden />
                                                : <Plus className="h-3.5 w-3.5 stroke-[2px]" aria-hidden />
                                            }
                                        </span>
                                    </button>

                                    {openFaqIndex === index && (
                                        <div className="border-t border-slate-100 bg-slate-50/30 px-5 py-5 sm:px-6">
                                            <p className="max-w-3xl text-sm font-normal leading-relaxed text-slate-600">{faq.answer}</p>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>


                <div className="border-t border-slate-200 pt-12 sm:pt-16 lg:pt-20">
                    <div className="max-w-4xl border border-slate-200 bg-white/60 backdrop-blur-md rounded-2xl p-6 sm:p-8 shadow-sm hover:shadow-md transition-all duration-300">
                        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">{copy.selfHostedEyebrow}</p>
                        <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{copy.selfHostedHeading}</h2>
                        <p className="mt-4 text-[15px] font-normal leading-7 text-slate-500">
                            {copy.selfHostedCopy}
                        </p>
                        <a
                            href="https://github.com/rejourneyco/rejourney"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-6 inline-flex h-11 items-center justify-center gap-2 border border-slate-300/60 bg-white/60 backdrop-blur-md px-5 text-sm font-semibold text-slate-700 rounded-full shadow-sm transition-all hover:bg-white/80 hover:border-slate-400 hover:text-slate-900"
                        >
                            <Github className="h-4 w-4" aria-hidden />
                            {copy.viewSource}
                        </a>
                    </div>
                </div>
            </div>
        </section>
    );
};
