import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowRight, Check, Copy, Github, Minus, Plus } from 'lucide-react';
import { api, type BillingPlan } from '~/shared/api/client';
import { useToast } from '~/shared/providers/ToastContext';
import { getContentLocaleCopy } from '~/shared/lib/contentLocalization';
import { getMarketingHomeCopy, getMarketingLocaleFromPathname } from '~/shared/lib/internationalMarketing';

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

const PLAN_STEPS = [
    { name: 'free', label: '5k', sessions: 5000 },
    { name: 'starter', label: '25k', sessions: 25000 },
    { name: 'growth', label: '100k', sessions: 100000 },
    { name: 'pro', label: '350k', sessions: 350000 },
    { name: 'scale', label: '1m', sessions: 1000000 },
    { name: 'enterprise', label: '1m+', sessions: 10000000 },
];

const PLAN_DESCRIPTIONS: Record<string, string> = {
    free: 'For validating your funnel before traffic ramps.',
    starter: 'For finding the first leaks in real traffic.',
    growth: 'For ranking conversion leaks as traffic scales.',
    pro: 'Deep insights for high-volume product and checkout flows.',
    scale: 'High-scale funnels that need high-intent capture control.',
    enterprise: 'Custom captured-session volume & dedicated hardware.',
};

const normalizePlanName = (plan: Pick<PricingPlan, 'name' | 'displayName'>) =>
    (plan.name || plan.displayName).toLowerCase().trim();

const formatInteger = (value: number, languageTag = 'en-US') => new Intl.NumberFormat(languageTag).format(value);

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
    if (sessions <= 25000) return { price: 500, plan: 'Starter', isCustom: false };
    if (sessions <= 100000) return { price: 1500, plan: 'Growth', isCustom: false };
    if (sessions <= 350000) return { price: 3500, plan: 'Pro', isCustom: false };
    if (sessions <= 1000000) return { price: 14900, plan: 'Scale', isCustom: false };
    return { price: 14900, plan: 'Enterprise', isCustom: true };
};

const getRevenueLeakPredictionText = (planName: string, sessionLimit: number) => {
    switch (planName) {
        case 'free':
            return <span><strong>5,000 sessions</strong> of Revenue Leak Prediction</span>;
        case 'starter':
            return <span><strong>5x more</strong> Revenue Leak Prediction than Free</span>;
        case 'growth':
            return <span><strong>20x more</strong> Revenue Leak Prediction than Free</span>;
        case 'pro':
            return <span><strong>70x more</strong> Revenue Leak Prediction than Free</span>;
        case 'scale':
            return <span><strong>200x more</strong> Revenue Leak Prediction than Free</span>;
        case 'enterprise':
            return <span><strong>Custom</strong> Revenue Leak Prediction coverage</span>;
        default:
            return <span>Revenue Leak Prediction included</span>;
    }
};

const PlanCheck: React.FC<{ children: React.ReactNode; active?: boolean }> = ({ children, active = true }) => (
    <li className="flex gap-3 text-sm leading-6 text-slate-700 font-medium">
        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
            {active ? <Check className="h-3 w-3 stroke-[2.5px]" aria-hidden /> : <Minus className="h-3.5 w-3.5 stroke-[2px]" aria-hidden />}
        </span>
        <span className={active ? 'text-slate-800' : 'text-slate-400 font-normal'}>{children}</span>
    </li>
);

export const PricingTable: React.FC = () => {
    const { showToast } = useToast();
    const location = useLocation();
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getContentLocaleCopy(locale).pricing;
    const footerCopy = getMarketingHomeCopy(location.pathname).footer;

    const [availablePlans, setAvailablePlans] = useState<PricingPlan[]>([]);
    const [volumeIndex, setVolumeIndex] = useState(2); // Default to Growth - 100k sessions
    const [trafficCalculator, setTrafficCalculator] = useState(25000); // 25k sessions
    const [aovCalculator, setAovCalculator] = useState(75); // $75 average conversion/order value
    const [openIndex, setOpenIndex] = useState<number | null>(null);
    const [contactCopied, setContactCopied] = useState(false);
    const copyResetTimerRef = useRef<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        let idleHandle: number | null = null;
        let fallbackTimeout: ReturnType<typeof setTimeout> | null = null;

        const fetchPlans = async () => {
            const plans = await api.getAvailablePlans();
            if (!cancelled && plans.length > 0) {
                setAvailablePlans(plans);
            }
        };

        if ('requestIdleCallback' in window) {
            idleHandle = window.requestIdleCallback(fetchPlans, { timeout: 2500 });
        } else {
            fallbackTimeout = globalThis.setTimeout(fetchPlans, 1200);
        }

        return () => {
            cancelled = true;
            if (idleHandle !== null) window.cancelIdleCallback(idleHandle);
            if (fallbackTimeout !== null) globalThis.clearTimeout(fallbackTimeout);
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

    const getPlanByStepName = (name: string) => {
        return plans.find(p => normalizePlanName(p) === name) ?? FALLBACK_PLANS.find(p => p.name === name) ?? FALLBACK_PLANS[0];
    };

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

    // Calculator values
    const calculatorSessions = trafficCalculator;
    const rejourneyMonthlyPlan = rejourneyPlan(calculatorSessions);
    const recoveredRevenue = calculatorSessions * 0.0025 * aovCalculator;
    const netMonthlyUpside = recoveredRevenue - (rejourneyMonthlyPlan.price / 100);
    const roiPercent = rejourneyMonthlyPlan.price > 0
        ? (netMonthlyUpside / (rejourneyMonthlyPlan.price / 100)) * 100
        : 0;

    // Resolve index for middle card
    const activeStep = PLAN_STEPS[volumeIndex];
    const activeCenterIndex = volumeIndex === 0 ? 1 : volumeIndex === 5 ? 4 : volumeIndex;

    const faqs = [
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
            question: 'What is Smart Capture, and why is it Scale/Enterprise only?',
            answer: 'Smart Capture is our advanced collection engine. Instead of recording everything, you define rules (like only capturing checkout flows with errors, slow API calls, or specific onboarding paths) using simple AI prompts. This lets you optimize your captured session budget at high scale.',
        },
        {
            question: 'Can we self-host Rejourney instead of using cloud pricing?',
            answer: 'Yes. Rejourney can be self-hosted if your team wants to run the stack on its own infrastructure. Cloud pricing is for the managed Rejourney service, storage, retention, billing, and hosted operations.',
        },
    ];

    const renderCard = (cardType: 0 | 1 | 2, plan: PricingPlan) => {
        const planName = normalizePlanName(plan);
        const description = PLAN_DESCRIPTIONS[planName] ?? PLAN_DESCRIPTIONS.fallback;
        
        const isFree = plan.priceCents === 0;
        const isEnterprise = plan.name === 'enterprise';

        const isHighlighted = (cardType === 0 && volumeIndex === 0) ||
                              (cardType === 1 && volumeIndex >= 1 && volumeIndex <= 4) ||
                              (cardType === 2 && volumeIndex === 5);

        const badgeText = cardType === 0 ? 'Getting Started' : cardType === 1 ? 'Best Value' : 'Contact Us';
        
        const containerClasses = isHighlighted
            ? 'relative flex flex-col justify-between p-8 rounded-2xl border-2 border-slate-950 bg-white shadow-[8px_8px_0_#0f172a] -translate-y-1 transition-all duration-300'
            : 'relative flex flex-col justify-between p-8 rounded-2xl border border-slate-200 bg-white/80 shadow-sm hover:border-slate-350 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300';

        const buttonClasses = isHighlighted
            ? 'inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-950 bg-[#86efac] px-4 text-sm font-extrabold uppercase text-black shadow-[2px_2px_0_#0f172a] transition-all duration-150 hover:-translate-y-0.5 hover:bg-[#6ee7a0] active:translate-y-0 active:shadow-none'
            : 'inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-250 bg-white px-4 text-sm font-extrabold uppercase text-slate-800 transition-all duration-150 hover:border-slate-350 hover:bg-slate-50';

        // Custom features listing
        type CardFeature = {
            key: string;
            content: React.ReactNode;
            active: boolean;
        };

        let cardFeatures: CardFeature[] = [];

        if (cardType === 0) {
            cardFeatures = [
                { key: 'sessions', content: <span><strong>{formatInteger(plan.sessionLimit)}</strong> session replays / mo</span>, active: true },
                { key: 'retention', content: <span><strong>7 days</strong> evidence retention</span>, active: true },
                { key: 'ai', content: getRevenueLeakPredictionText('free', plan.sessionLimit), active: true },
                { key: 'events', content: <span>Unlimited events, DAU, and MAU</span>, active: true },
                { key: 'funnels', content: <span>Standard funnel and cohort trends</span>, active: true },
                { key: 'controls', content: <span>Standard session recording controls</span>, active: true },
                { key: 'smart', content: <span>Smart Capture customizable rules</span>, active: false },
                { key: 'sla', content: <span>Priority support & Dedicated hardware</span>, active: false },
            ];
        } else if (cardType === 1) {
            cardFeatures = [
                { key: 'sessions', content: <span><strong>{formatInteger(plan.sessionLimit)}</strong> session replays / mo</span>, active: true },
                { key: 'retention', content: <span><strong>{plan.videoRetentionLabel}</strong> evidence retention</span>, active: true },
                { key: 'ai', content: getRevenueLeakPredictionText(plan.name, plan.sessionLimit), active: true },
                { key: 'events', content: <span>Unlimited events, DAU, and MAU</span>, active: true },
                { key: 'funnels', content: <span>Checkout, onboarding, & paywall drill-downs</span>, active: true },
                { key: 'diagnostics', content: <span>Crash, API, and ANR diagnostic tools</span>, active: true },
                { key: 'smart', content: <span>Smart Capture customizable rules</span>, active: Boolean(plan.smartCaptureEnabled || plan.name === 'scale') },
                { key: 'sla', content: <span>Priority support & Dedicated hardware</span>, active: false },
            ];
        } else {
            cardFeatures = [
                { key: 'sessions', content: <span><strong>Custom volume</strong> of monthly sessions</span>, active: true },
                { key: 'retention', content: <span><strong>Custom</strong> evidence retention history</span>, active: true },
                { key: 'ai', content: getRevenueLeakPredictionText('enterprise', plan.sessionLimit), active: true },
                { key: 'events', content: <span>Unlimited events, DAU, and MAU</span>, active: true },
                { key: 'funnels', content: <span>Full suite of custom funnels & analytics</span>, active: true },
                { key: 'hardware', content: <span>Dedicated hardware & custom storage bucket</span>, active: true },
                { key: 'support', content: <span>Dedicated support team & custom SLA</span>, active: true },
            ];
        }

        return (
            <article key={cardType} className={containerClasses}>
                {isHighlighted && (
                    <span className="absolute -top-3 left-6 inline-flex items-center rounded-full bg-emerald-100 border border-emerald-500 text-emerald-800 px-3 py-0.5 text-xs font-bold uppercase tracking-wider">
                        {badgeText}
                    </span>
                )}
                
                <div>
                    <h2 className="text-2xl font-black uppercase tracking-tight text-slate-900">{isFree ? 'Free' : isEnterprise ? 'Enterprise' : plan.displayName}</h2>
                    <p className="mt-3 text-sm font-semibold text-slate-500 leading-relaxed min-h-[48px]">{description}</p>
                    
                    <div className="mt-6 flex items-end gap-x-2">
                        <span className="text-4xl font-black tracking-tight text-slate-900">
                            {isEnterprise ? 'Custom' : formatPlanPrice(plan.priceCents)}
                        </span>
                        {!isFree && !isEnterprise && (
                            <span className="pb-1 text-sm font-bold text-slate-400">/ month</span>
                        )}
                    </div>

                    <ul className="mt-8 space-y-4">
                        {cardFeatures.map((feat) => (
                            <PlanCheck key={feat.key} active={feat.active}>
                                {feat.content}
                            </PlanCheck>
                        ))}
                    </ul>
                </div>

                <div className="mt-8 pt-2">
                    {isEnterprise ? (
                        <button
                            type="button"
                            onClick={handleCopyEmail}
                            className={buttonClasses}
                        >
                            {contactCopied ? copy.copied : 'Contact Sales'}
                            <ArrowRight className="h-4 w-4" aria-hidden />
                        </button>
                    ) : (
                        <Link
                            to="/login"
                            className={buttonClasses}
                        >
                            {isFree ? copy.startFree : copy.getStarted}
                            <ArrowRight className="h-4 w-4" aria-hidden />
                        </Link>
                    )}
                </div>
            </article>
        );
    };

    return (
        <section className="relative w-full bg-[#fdfbf7] text-slate-900 overflow-hidden min-h-screen">
            <div className="relative z-10 mx-auto flex w-full max-w-[1200px] flex-col items-center px-6 pt-32 pb-8 sm:px-8 lg:px-10">
                <div className="text-center max-w-3xl">
                    <h1 className="text-4xl font-black uppercase tracking-tight text-slate-900 sm:text-5xl lg:text-6xl leading-[1.05]">
                        {copy.heading}
                    </h1>
                    <p className="mt-6 text-lg font-semibold leading-relaxed text-slate-600">
                        {copy.intro}
                    </p>
                </div>
            </div>

            {/* Slider Container */}
            <div className="w-full max-w-2xl mx-auto px-6 mb-16 relative z-20">
                <div className="relative border border-slate-200 bg-white/95 rounded-2xl p-6 shadow-sm">
                    <div className="flex justify-between items-end mb-4">
                        <div>
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Captured Session Volume</span>
                            <div className="mt-1 text-3xl font-black text-slate-900">
                                {volumeIndex === 5 ? 'Custom' : `${formatInteger(PLAN_STEPS[volumeIndex].sessions)} / mo`}
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Current Step</span>
                            <div className="mt-1 text-lg font-extrabold text-indigo-600 uppercase">
                                {PLAN_STEPS[volumeIndex].name}
                            </div>
                        </div>
                    </div>

                    <input
                        type="range"
                        min={0}
                        max={PLAN_STEPS.length - 1}
                        step={1}
                        value={volumeIndex}
                        onChange={(e) => setVolumeIndex(Number(e.target.value))}
                        className="pricing-range-slider mt-2"
                        style={{ '--slider-fill': `${(volumeIndex / (PLAN_STEPS.length - 1)) * 100}%` } as CSSProperties}
                        aria-label="Monthly session limit slider"
                    />

                    <div className="flex justify-between mt-3 px-1 text-[11px] font-black uppercase text-slate-400">
                        {PLAN_STEPS.map((step, idx) => (
                            <button
                                key={step.name}
                                type="button"
                                onClick={() => setVolumeIndex(idx)}
                                className={`transition-colors duration-150 ${volumeIndex === idx ? 'text-indigo-600 font-black' : 'hover:text-slate-600'}`}
                            >
                                {step.label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* 3-Card Layout */}
            <div className="grid gap-8 lg:grid-cols-3 max-w-[1200px] mx-auto px-6 mb-24 items-stretch relative z-20">
                {renderCard(0, getPlanByStepName('free'))}
                {renderCard(1, getPlanByStepName(PLAN_STEPS[activeCenterIndex].name))}
                {renderCard(2, getPlanByStepName('enterprise'))}
            </div>

            {/* Simplified ROI Calculator */}
            <div className="relative border border-slate-200 bg-white/95 rounded-2xl p-8 shadow-sm max-w-[1200px] mx-4 md:mx-auto mb-24 z-20">
                <div className="grid gap-8 lg:grid-cols-2 items-center">
                    <div>
                        <h2 className="text-2xl font-black uppercase text-slate-900">Calculate Your Potential ROI</h2>
                        <p className="mt-3 text-sm font-semibold text-slate-500 leading-relaxed">
                            See what recovering just a tiny fraction of your dropped-off checkout, onboarding, or subscription conversions would return.
                        </p>

                        <div className="mt-8 space-y-6">
                            <div>
                                <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                                    <span>Monthly Traffic (Sessions)</span>
                                    <span className="text-slate-700 font-extrabold">{formatInteger(trafficCalculator)}</span>
                                </div>
                                <input
                                    type="range"
                                    min={10000}
                                    max={1000000}
                                    step={10000}
                                    value={trafficCalculator}
                                    onChange={(e) => setTrafficCalculator(Number(e.target.value))}
                                    className="pricing-range-slider"
                                    style={{ '--slider-fill': `${((trafficCalculator - 10000) / 990000) * 100}%` } as CSSProperties}
                                    aria-label="Monthly traffic slider"
                                />
                            </div>

                            <div>
                                <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                                    <span>Average Order/Conversion Value</span>
                                    <span className="text-slate-700 font-extrabold">${aovCalculator}</span>
                                </div>
                                <input
                                    type="range"
                                    min={10}
                                    max={500}
                                    step={5}
                                    value={aovCalculator}
                                    onChange={(e) => setAovCalculator(Number(e.target.value))}
                                    className="pricing-range-slider"
                                    style={{ '--slider-fill': `${((aovCalculator - 10) / 490) * 100}%` } as CSSProperties}
                                    aria-label="Average order value slider"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col items-center justify-center bg-indigo-50/40 border border-indigo-100/80 rounded-xl p-8 text-center">
                        <span className="text-xs font-black uppercase tracking-widest text-indigo-500">Estimated Monthly Value</span>
                        <span className="mt-4 text-5xl font-black text-slate-900 tracking-tight">
                            {formatCurrency(recoveredRevenue)}
                        </span>
                        <p className="mt-3 max-w-sm text-sm font-bold leading-relaxed text-slate-650">
                            Recovered revenue per month, assuming a very conservative <strong className="text-indigo-600">0.25% checkout lift</strong>.
                        </p>
                        <div className="mt-6 border-t border-indigo-100/70 pt-4 w-full text-xs font-black text-indigo-700 uppercase tracking-wider">
                            {netMonthlyUpside > 0 ? `${Math.round(roiPercent).toLocaleString()}% ROI on the Pro plan` : '100% Free at this volume'}
                        </div>
                    </div>
                </div>
            </div>

            {/* Accordion FAQ Section */}
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.4fr] lg:items-start max-w-[1200px] mx-4 md:mx-auto mb-24 relative z-20">
                <div className="space-y-4">
                    <h2 className="text-3xl font-black uppercase text-slate-900">Frequently Asked Questions</h2>
                    <p className="text-sm font-semibold text-slate-500 leading-relaxed">
                        Everything you need to know about Rejourney pricing, billing, and features.
                    </p>
                </div>

                <div className="flex flex-col gap-3">
                    {faqs.map((faq, index) => {
                        const isOpen = openIndex === index;
                        return (
                            <div 
                                key={index}
                                className={`rounded-xl border p-4 transition-colors duration-200 sm:p-5 ${
                                    isOpen
                                        ? 'border-indigo-200 bg-indigo-50/35 shadow-sm'
                                        : 'border-slate-200 bg-white shadow-sm hover:border-slate-350'
                                }`}
                            >
                                <button
                                    onClick={() => setOpenIndex(isOpen ? null : index)}
                                    className="flex w-full items-start justify-between gap-6 text-left"
                                    aria-expanded={isOpen}
                                >
                                    <span className="text-base font-extrabold text-slate-900">
                                        {faq.question}
                                    </span>
                                    <Plus className={`mt-0.5 h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200 ${isOpen ? 'rotate-45 text-indigo-600' : ''}`} />
                                </button>
                                
                                <div 
                                    className={`grid transition-all duration-350 ease-in-out ${
                                        isOpen ? 'grid-rows-[1fr] opacity-100 mt-4' : 'grid-rows-[0fr] opacity-0'
                                    }`}
                                >
                                    <div className="overflow-hidden border-t border-slate-100 pt-4">
                                        <p className="text-sm font-semibold leading-relaxed text-slate-650">
                                            {faq.answer}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Self-hosted Section */}
            <div className="max-w-[1200px] mx-4 md:mx-auto mb-24 relative z-20">
                <div className="relative overflow-hidden border border-slate-200 bg-white/95 rounded-2xl p-8 shadow-sm text-slate-900">
                    <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:radial-gradient(#000_1px,transparent_1px)] [background-size:16px_16px]" aria-hidden />
                    <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                        <div className="max-w-2xl">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{copy.selfHostedEyebrow}</span>
                            <h2 className="mt-2 text-2xl font-black uppercase text-slate-950">{copy.selfHostedHeading}</h2>
                            <p className="mt-3 text-sm font-semibold text-slate-500 leading-relaxed">
                                {copy.selfHostedCopy}
                            </p>
                        </div>
                        <a
                            href="https://github.com/rejourneyco/rejourney"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-12 shrink-0 items-center justify-center gap-2 border border-slate-950 bg-[#fff19c] px-6 text-sm font-extrabold uppercase text-black rounded-xl shadow-[2px_2px_0_#0f172a] hover:bg-[#ffe366] hover:-translate-y-0.5 active:translate-y-0 active:shadow-none transition-all duration-150"
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
