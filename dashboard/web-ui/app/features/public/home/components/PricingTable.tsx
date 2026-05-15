import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowRight, Check, ChevronDown, Copy, Github } from 'lucide-react';
import { api, type BillingPlan } from '~/shared/api/client';
import { useToast } from '~/shared/providers/ToastContext';
import { getContentLocaleCopy } from '~/shared/lib/contentLocalization';
import { getMarketingLocaleFromPathname } from '~/shared/lib/internationalMarketing';

type PricingPlan = BillingPlan & {
    interval?: 'month' | 'year';
};

const FALLBACK_PLANS: PricingPlan[] = [
    { name: 'free', displayName: 'Free', sessionLimit: 5000, videoRetentionTier: 1, videoRetentionDays: 7, videoRetentionLabel: '7 days', priceCents: 0, interval: 'month' },
    { name: 'starter', displayName: 'Starter', sessionLimit: 25000, videoRetentionTier: 2, videoRetentionDays: 14, videoRetentionLabel: '14 days', priceCents: 500, interval: 'month' },
    { name: 'growth', displayName: 'Growth', sessionLimit: 100000, videoRetentionTier: 3, videoRetentionDays: 30, videoRetentionLabel: '30 days', priceCents: 1500, interval: 'month' },
    { name: 'pro', displayName: 'Pro', sessionLimit: 350000, videoRetentionTier: 4, videoRetentionDays: 60, videoRetentionLabel: '60 days', priceCents: 3500, interval: 'month' },
];

const PLAN_ORDER = ['free', 'starter', 'growth', 'pro'];

const VOLUME_PRESETS = [
    { label: '5k', sessions: 5000 },
    { label: '25k', sessions: 25000 },
    { label: '100k', sessions: 100000 },
    { label: '350k', sessions: 350000 },
];

const normalizePlanName = (plan: Pick<PricingPlan, 'name' | 'displayName'>) =>
    (plan.name || plan.displayName).toLowerCase().trim();

const sliderToSessions = (value: number) => Math.round(1000 * Math.pow(400, value / 100));

const sessionsToSlider = (sessions: number) =>
    Math.min(100, Math.max(0, (Math.log(sessions / 1000) / Math.log(400)) * 100));

const DEFAULT_CALCULATOR_SESSIONS = 25000;
const DEFAULT_CALCULATOR_SLIDER_VALUE = sessionsToSlider(DEFAULT_CALCULATOR_SESSIONS);

const formatInteger = (value: number, languageTag = 'en-US') => new Intl.NumberFormat(languageTag).format(value);

const formatShortInteger = (value: number) => {
    if (value >= 1000000) return `${Number((value / 1000000).toFixed(1))}m`;
    if (value >= 1000) return `${Number((value / 1000).toFixed(value >= 100000 ? 0 : 1))}k`;
    return String(value);
};

const formatPlanPrice = (priceCents: number) => {
    const price = priceCents / 100;
    if (price === 0) return '$0';
    return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
};

const formatApproxCurrency = (value: number) => `~$${value.toFixed(2)}`;

const getOrderedPlans = (availablePlans: PricingPlan[]) => {
    const source = availablePlans.length > 0 ? availablePlans : FALLBACK_PLANS;
    const selectablePlans = source.filter((plan) => !plan.isCustom);

    return PLAN_ORDER.map((planName) => {
        const matchingPlans = selectablePlans.filter((plan) => normalizePlanName(plan) === planName);
        const monthlyPlan = matchingPlans.find((plan) => !plan.interval || plan.interval === 'month');
        const fallbackPlan = FALLBACK_PLANS.find((plan) => plan.name === planName);
        return monthlyPlan ?? matchingPlans[0] ?? fallbackPlan;
    }).filter((plan): plan is PricingPlan => Boolean(plan));
};

const posthogCost = (sessions: number): number => {
    if (sessions <= 5000) return 0;
    const remaining = sessions - 5000;
    return (
        Math.min(remaining, 20000) * 0.00425 +
        Math.max(0, Math.min(remaining - 20000, 75000)) * 0.0025 +
        Math.max(0, Math.min(remaining - 95000, 250000)) * 0.00176 +
        Math.max(0, remaining - 345000) * 0.00176
    );
};

const sentryReplayCost = (sessions: number): number => sessions * 0.006;

const rejourneyPlan = (sessions: number): { price: number; plan: string; isCustom: boolean } => {
    if (sessions <= 5000) return { price: 0, plan: 'Free', isCustom: false };
    if (sessions <= 25000) return { price: 5, plan: 'Starter', isCustom: false };
    if (sessions <= 100000) return { price: 15, plan: 'Growth', isCustom: false };
    if (sessions <= 350000) return { price: 35, plan: 'Pro', isCustom: false };
    return { price: 35, plan: 'Custom', isCustom: true };
};

const PlanCheck: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <li className="flex gap-3 text-[15px] leading-6 text-slate-700">
        <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white">
            <Check className="h-3.5 w-3.5 stroke-[3px]" aria-hidden />
        </span>
        <span>{children}</span>
    </li>
);

export const PricingTable: React.FC = () => {
    const { showToast } = useToast();
    const location = useLocation();
    const locale = getMarketingLocaleFromPathname(location.pathname);
    const copy = getContentLocaleCopy(locale).pricing;
    const [availablePlans, setAvailablePlans] = useState<PricingPlan[]>([]);
    const [sliderValue, setSliderValue] = useState(DEFAULT_CALCULATOR_SLIDER_VALUE);
    const [calculatorOpen, setCalculatorOpen] = useState(true);
    const [contactCopied, setContactCopied] = useState(false);
    const copyResetTimerRef = useRef<number | null>(null);

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
    const posthogMonthlyCost = posthogCost(calculatorSessions);
    const sentryMonthlyCost = sentryReplayCost(calculatorSessions);
    const rejourneyMonthlyPlan = rejourneyPlan(calculatorSessions);
    const sliderStyle = { '--slider-fill': `${sliderValue}%` } as CSSProperties;

    const handleCopyEmail = async () => {
        if (copyResetTimerRef.current) {
            window.clearTimeout(copyResetTimerRef.current);
        }

        try {
            await navigator.clipboard.writeText('contact@rejourney.co');
            setContactCopied(true);
            showToast(copy.emailCopiedToast);
        } catch {
            setContactCopied(true);
            showToast('Email: contact@rejourney.co');
        }

        copyResetTimerRef.current = window.setTimeout(() => {
            setContactCopied(false);
        }, 1800);
    };

    return (
        <section className="w-full border-t-2 border-black bg-white text-slate-950">
            <div className="relative mx-auto w-full max-w-[1600px] px-5 py-12 sm:px-8 sm:py-16 lg:px-10 lg:py-20">
                <div className="relative z-10 border-b-2 border-black pb-10 sm:pb-12">
                    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-end">
                        <div>

                            <h1 className="break-words text-5xl font-black uppercase leading-none tracking-normal text-slate-950 min-[380px]:text-6xl sm:text-7xl lg:text-8xl">
                                {copy.heading}
                            </h1>
                            <p className="mt-5 max-w-3xl text-base font-semibold leading-7 text-slate-600 sm:text-lg">
                                {copy.intro}
                            </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:relative lg:block lg:min-h-[220px]">
                            <div className="border-2 border-black bg-[#fef08a] p-4 text-black shadow-neo-sm lg:absolute lg:right-0 lg:top-0 lg:w-72 lg:rotate-[3deg]">
                                <p className="font-mono text-[10px] font-black uppercase">{copy.contactEyebrow}</p>
                                <h2 className="mt-3 text-xl font-black uppercase leading-tight min-[380px]:text-2xl">{copy.contactHeading}</h2>
                            </div>
                            <button
                                type="button"
                                onClick={handleCopyEmail}
                                className={`flex min-h-16 items-center justify-center gap-2 border-2 border-black p-4 text-sm font-black uppercase text-black transition-all sm:min-h-20 lg:absolute lg:bottom-1 lg:left-0 lg:w-64 lg:rotate-[-4deg] ${
                                    contactCopied
                                        ? 'bg-[#86efac] shadow-none'
                                        : 'bg-[#86efac] shadow-neo-sm hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#fef08a] hover:shadow-neo active:translate-x-0 active:translate-y-0 active:shadow-none'
                                }`}
                                aria-live="polite"
                            >
                                {contactCopied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                                {contactCopied ? copy.copied : copy.contactEmail}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="relative z-10 grid border-2 border-t-0 border-black bg-white shadow-neo-sm lg:grid-cols-4 lg:divide-x-2 lg:divide-black">
                    {plans.map((plan) => {
                        const planName = normalizePlanName(plan);
                        const description = copy.planDescriptions[planName] ?? copy.planDescriptions.fallback;
                        const isFeatured = planName === 'growth';
                        const isFree = plan.priceCents === 0;
                        const priceSuffix = isFree ? '' : plan.interval === 'year' ? ` ${copy.perYear}` : ` ${copy.perMonth}`;

                        return (
                            <article
                                key={`${plan.name}-${plan.priceCents}`}
                                className="flex flex-col border-t-2 border-black px-5 py-8 first:border-t-0 lg:min-h-[760px] lg:border-t-0 lg:px-8 lg:py-10 xl:px-10"
                            >
                                <div className="lg:min-h-[240px]">
                                    <div className="flex min-h-9 items-start justify-between gap-4">
                                        <h2 className="text-3xl font-black uppercase leading-tight text-slate-950 sm:text-4xl">{plan.displayName}</h2>
                                        {isFeatured && (
                                            <span className="border-2 border-black bg-[#5dadec] px-3 py-1 font-mono text-[10px] font-black uppercase text-black shadow-neo-sm">
                                                {copy.popular}
                                            </span>
                                        )}
                                    </div>

                                    <p className="mt-5 text-[15px] font-semibold leading-6 text-slate-500 lg:min-h-14">{description}</p>

                                    <div className="mt-8 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                                        <span className="text-4xl font-black text-slate-950 sm:text-5xl">{formatPlanPrice(plan.priceCents)}</span>
                                        {priceSuffix && <span className="text-lg font-semibold text-slate-500">{priceSuffix}</span>}
                                    </div>
                                </div>

                                <ul className="space-y-5 border-t-2 border-black pt-8">
                                    <PlanCheck>{copy.sessionsPerMonth(formatInteger(plan.sessionLimit, locale.languageTag))}</PlanCheck>
                                    <PlanCheck>{copy.replayRetention(plan.videoRetentionLabel)}</PlanCheck>
                                    {copy.sharedFeatures.map((feature) => (
                                        <PlanCheck key={feature}>{feature}</PlanCheck>
                                    ))}
                                </ul>

                                <div className="mt-auto pt-9">
                                    <Link
                                        to="/login"
                                        className={`inline-flex h-11 w-full items-center justify-center gap-2 border-2 border-black px-4 text-sm font-black uppercase transition-all active:translate-x-0 active:translate-y-0 active:shadow-none ${
                                            isFeatured
                                                ? 'bg-slate-950 text-white shadow-[4px_4px_0px_0px_rgba(93,173,236,1)] hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#5dadec] hover:text-slate-950 hover:shadow-neo'
                                                : 'bg-white text-slate-950 shadow-neo-sm hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo'
                                        }`}
                                    >
                                        {isFree ? copy.startFree : copy.getStarted}
                                        <ArrowRight className="h-4 w-4" aria-hidden />
                                    </Link>
                                </div>
                            </article>
                        );
                    })}
                </div>

                <div className="relative z-10 overflow-hidden border-x-2 border-b-2 border-black bg-[#f8fafc] px-5 py-10 shadow-neo-sm sm:px-8 md:flex md:items-center md:justify-between md:gap-8">
                    <div className="absolute -right-8 -top-8 h-20 w-32 rotate-[6deg] border-2 border-black bg-[#86efac] shadow-neo-sm" aria-hidden />
                    <div className="relative max-w-2xl">
                        <p className="font-mono text-[10px] font-black uppercase text-slate-500">{copy.enterpriseEyebrow}</p>
                        <h2 className="mt-3 text-2xl font-black uppercase leading-tight text-slate-950 sm:text-3xl">{copy.enterpriseHeading(formatShortInteger(350000))}</h2>
                        <p className="mt-4 text-[15px] font-semibold leading-7 text-slate-600">
                            {copy.enterpriseCopy}
                        </p>
                    </div>
                    <div className="relative mt-7 shrink-0 md:mt-0">
                        <button
                            type="button"
                            onClick={handleCopyEmail}
                            className={`inline-flex h-14 w-full items-center justify-center gap-2 border-2 border-black px-6 text-sm font-black uppercase text-slate-950 transition-all md:w-64 ${
                                contactCopied
                                    ? 'bg-[#86efac] shadow-none'
                                    : 'bg-[#c4b5fd] shadow-neo-sm hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#ddd6fe] hover:shadow-neo active:translate-x-0 active:translate-y-0 active:shadow-none'
                            }`}
                            aria-live="polite"
                        >
                            {contactCopied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                            {contactCopied ? copy.copied : copy.contact}
                        </button>
                    </div>
                </div>

                <div className="border-b-2 border-black py-8">
                    <button
                        type="button"
                        onClick={() => setCalculatorOpen((open) => !open)}
                        className="flex w-full items-center justify-between gap-5 border-2 border-black bg-white px-5 py-4 text-left shadow-neo-sm transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo"
                    >
                        <span>
                            <span className="block text-base font-black uppercase text-slate-950">{copy.comparisonTitle}</span>
                            <span className="mt-1 block text-sm font-semibold text-slate-500">{copy.comparisonSubtitle}</span>
                        </span>
                        <ChevronDown className={`h-5 w-5 shrink-0 text-slate-500 transition ${calculatorOpen ? 'rotate-180' : ''}`} aria-hidden />
                    </button>

                    {calculatorOpen && (
                        <div className="grid gap-8 border-x-2 border-b-2 border-black bg-white px-5 py-6 lg:grid-cols-[0.85fr_1.35fr]">
                            <div>
                                <div className="mb-3 flex items-end justify-between gap-4">
                                    <span className="font-mono text-[10px] font-black uppercase text-slate-500">{copy.sessionsPerMonthLabel}</span>
                                    <span className="text-3xl font-black text-slate-950">{formatInteger(calculatorSessions, locale.languageTag)}</span>
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
                                                className={`h-9 rounded-md border px-3 text-sm font-semibold transition ${
                                                    active
                                                        ? 'border-slate-950 bg-slate-950 text-white'
                                                        : 'border-slate-300 bg-white text-slate-700 hover:border-slate-950'
                                                }`}
                                            >
                                                {preset.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="grid overflow-hidden border-2 border-black sm:grid-cols-3">
                                <div className="border-b-2 border-black bg-[#f8fafc] p-5 sm:border-b-0 sm:border-r-2">
                                    <p className="font-mono text-[10px] font-black uppercase text-slate-500">Rejourney</p>
                                    <p className="mt-3 text-3xl font-black text-slate-950">${rejourneyMonthlyPlan.price}</p>
                                    <p className="mt-2 text-sm font-semibold text-slate-500">{copy.rejourneyPlanLabel(rejourneyMonthlyPlan.plan, rejourneyMonthlyPlan.isCustom)}</p>
                                </div>
                                <div className="border-b-2 border-black p-5 sm:border-b-0 sm:border-r-2">
                                    <p className="font-mono text-[10px] font-black uppercase text-slate-500">PostHog</p>
                                    <p className="mt-3 text-3xl font-black text-slate-950">{formatApproxCurrency(posthogMonthlyCost)}</p>
                                    <p className="mt-2 text-sm font-semibold text-slate-500">{copy.posthogEstimate}</p>
                                </div>
                                <div className="bg-[#ecfeff] p-5">
                                    <p className="font-mono text-[10px] font-black uppercase text-slate-500">Sentry</p>
                                    <p className="mt-3 text-3xl font-black text-slate-950">{formatApproxCurrency(sentryMonthlyCost)}</p>
                                    <p className="mt-2 text-sm font-semibold text-slate-500">{copy.sentryEstimate}</p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="border-b-2 border-black py-9">
                    <div className="max-w-3xl">
                        <p className="font-mono text-[10px] font-black uppercase text-slate-500">{copy.selfHostedEyebrow}</p>
                        <h2 className="mt-3 text-2xl font-black uppercase leading-tight text-slate-950">{copy.selfHostedHeading}</h2>
                        <p className="mt-4 text-[15px] font-semibold leading-7 text-slate-600">
                            {copy.selfHostedCopy}
                        </p>
                        <a
                            href="https://github.com/rejourneyco/rejourney"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-6 inline-flex h-11 items-center justify-center gap-2 border-2 border-black bg-white px-4 text-sm font-black uppercase text-slate-950 shadow-neo-sm transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo"
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
