import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'react-router';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Copy, Github, Minus, Plus } from 'lucide-react';
import { api, type BillingPlan } from '~/shared/api/client';
import { useToast } from '~/shared/providers/ToastContext';
import { getContentLocaleCopy } from '~/shared/lib/contentLocalization';
import { getMarketingLocaleFromPathname } from '~/shared/lib/internationalMarketing';
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
];

const PLAN_ORDER = ['free', 'starter', 'growth', 'pro', 'scale'];

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
    if (sessions <= 1000000) return { price: 149, plan: 'Scale', isCustom: false };
    return { price: 149, plan: 'Custom', isCustom: true };
};

const PlanCheck: React.FC<{ children: React.ReactNode; tone?: 'check' | 'minus' }> = ({ children, tone = 'check' }) => (
    <li className="flex gap-3 text-[13px] font-medium leading-6 text-slate-600">
        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${tone === 'minus' ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
            {tone === 'minus'
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

const PRICING_FAQS = [
    {
        question: 'Are analytics unlimited?',
        answer: 'Yes. DAU, MAU, and analytics events are unlimited on every plan. Rejourney pricing is planned around saved session replay volume, not around every event your app sends.',
    },
    {
        question: 'What happens when I use all included session replays?',
        answer: 'Replay recording pauses until the next billing cycle or until you upgrade. Rejourney still accepts analytics events, so funnels, cohorts, journeys, heatmaps, crashes, ANRs, errors, and geo analytics keep updating while replay capture waits for more allowance.',
    },
    {
        question: 'How is Rejourney different from usage-based replay pricing?',
        answer: 'Many observability and product analytics tools meter several things at once: events, replays, errors, seats, sites, add-ons, retention, or separate product packages. Rejourney keeps the public plans anchored to included monthly session replays, with core analytics and debugging features included.',
    },
    {
        question: 'Do web and mobile replays cost different amounts?',
        answer: 'No. The listed Rejourney plans use one session replay allowance for web and mobile. You do not need to buy a separate mobile replay add-on just to understand native app sessions.',
    },
    {
        question: 'Do I pay per seat or tracked user?',
        answer: 'No. The public plans are not priced per teammate, DAU, MAU, or tracked user. Invite product, engineering, design, support, and leadership without turning every new viewer into a billing decision.',
    },
    {
        question: 'Are crashes, ANRs, errors, heatmaps, and journeys add-ons?',
        answer: 'No. They are part of the core Rejourney workspace. The plan limit decides how many session replays you can save each month and how long those replays are retained.',
    },
    {
        question: 'What counts as a session replay?',
        answer: 'A session replay is one saved user session from the web or mobile SDK. It can include the screens, routes, events, errors, and interaction context from that user journey. Analytics events still count as analytics, not as extra replay charges.',
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
        answer: 'Start with the billing unit and the workflow you need. If the important work is reviewing user sessions, journeys, heatmaps, crashes, and product analytics together, compare how many replays are included, whether mobile is bundled, which features are add-ons, how retention works, and whether seats or events can change the bill.',
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
    const [availablePlans, setAvailablePlans] = useState<PricingPlan[]>([]);
    const [sliderValue, setSliderValue] = useState(DEFAULT_CALCULATOR_SLIDER_VALUE);
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
    const posthogMonthlyCost = posthogCost(calculatorSessions);
    const sentryMonthlyCost = sentryReplayCost(calculatorSessions);
    const rejourneyMonthlyPlan = rejourneyPlan(calculatorSessions);
    const sliderStyle = { '--slider-fill': `${sliderValue}%` } as CSSProperties;

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
        <section className="relative w-full border-t border-slate-200 bg-white text-slate-950 overflow-hidden">
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
                            <div className="border border-slate-200 bg-white/60 backdrop-blur-md rounded-2xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 flex flex-col gap-4 w-full sm:max-w-md lg:w-72">
                                <div>
                                    <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">{copy.contactEyebrow}</p>
                                    <h2 className="mt-1.5 text-lg font-bold leading-snug text-slate-900">{copy.contactHeading}</h2>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCopyEmail}
                                    className={`flex h-11 items-center justify-center gap-2 rounded-full px-4 text-xs font-semibold shadow-sm transition-all duration-200 ${
                                        contactCopied
                                            ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                                            : 'bg-indigo-600 text-white hover:bg-indigo-700'
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
                    <div className="mb-5 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={() => scrollPlansRail(-1)}
                            disabled={!plansRailState.canScrollPrev}
                            className="flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-slate-650 rounded-full shadow-sm hover:border-slate-350 hover:bg-slate-50 transition disabled:opacity-35"
                            aria-label="Show previous pricing plans"
                            title="Previous plans"
                        >
                            <ChevronLeft className="h-4 w-4" aria-hidden />
                        </button>
                        <button
                            type="button"
                            onClick={() => scrollPlansRail(1)}
                            disabled={!plansRailState.canScrollNext}
                            className="flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-slate-650 rounded-full shadow-sm hover:border-slate-350 hover:bg-slate-50 transition disabled:opacity-35"
                            aria-label="Show more pricing plans"
                            title="More plans"
                        >
                            <ChevronRight className="h-4 w-4" aria-hidden />
                        </button>
                    </div>

                    <div
                        ref={plansRailRef}
                        className="pricing-plan-rail -mx-5 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-6 pt-4 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10"
                    >
                        {plans.map((plan) => {
                            const planName = normalizePlanName(plan);
                            const description = copy.planDescriptions[planName] ?? copy.planDescriptions.fallback;
                            const isFeatured = planName === 'growth';
                            const isScale = planName === 'scale';
                            const isFree = plan.priceCents === 0;
                            const priceSuffix = isFree ? '' : plan.interval === 'year' ? ` ${copy.perYear}` : ` ${copy.perMonth}`;
                            const smartCaptureEnabled = Boolean(plan.smartCaptureEnabled || planName === 'scale');

                            const cardClassName = isScale
                                ? 'border-blue-500/40 bg-gradient-to-b from-blue-50/50 via-indigo-50/50 to-white/70 shadow-md hover:shadow-lg hover:-translate-y-1.5'
                                : isFeatured
                                    ? 'border-indigo-500 ring-1 ring-indigo-500/50 bg-indigo-50/20 backdrop-blur-md shadow-md shadow-indigo-100/10 hover:shadow-lg hover:-translate-y-1.5'
                                    : 'border-slate-200/80 bg-white/70 backdrop-blur-md shadow-sm hover:shadow-lg hover:-translate-y-1.5';

                            const buttonClassName = isScale
                                ? 'bg-blue-650 text-white hover:bg-blue-700 focus:ring-blue-600'
                                : isFeatured
                                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 focus:ring-indigo-600'
                                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:text-slate-900 focus:ring-indigo-600';

                            return (
                                <article
                                    key={`${plan.name}-${plan.priceCents}`}
                                    className={`relative flex min-h-[660px] w-[82vw] max-w-[390px] shrink-0 snap-start flex-col overflow-hidden border rounded-2xl p-6 transition-all duration-300 sm:w-[360px] sm:p-7 lg:w-[340px] xl:w-[360px] ${cardClassName}`}
                                >
                                    {isFeatured && <div className="absolute inset-x-0 top-0 h-1.5 bg-indigo-650" aria-hidden />}

                                    <div>
                                        <div className="flex min-h-10 flex-wrap items-start justify-between gap-3">
                                            <h2 className="text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{plan.displayName}</h2>
                                            {isFeatured && (
                                                <span className="bg-indigo-100 text-indigo-800 px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-full border border-indigo-200/50">
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
                                        <PlanGroup title="Replays">
                                            <PlanCheck>{copy.sessionsPerMonth(formatInteger(plan.sessionLimit, locale.languageTag))}</PlanCheck>
                                            <PlanCheck>{copy.replayRetention(plan.videoRetentionLabel)}</PlanCheck>
                                            <PlanCheck tone={smartCaptureEnabled ? 'check' : 'minus'}>
                                                {smartCaptureEnabled ? 'Smart Capture included' : 'Standard replay capture controls'}
                                            </PlanCheck>
                                        </PlanGroup>

                                        <PlanGroup title="Analytics">
                                            <PlanCheck>Unlimited DAU and MAU</PlanCheck>
                                            <PlanCheck>Unlimited events</PlanCheck>
                                            <PlanCheck>Funnels, cohorts, and analytics retention</PlanCheck>
                                        </PlanGroup>

                                        <PlanGroup title="Features">
                                            <PlanCheck>
                                                <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-100 to-purple-100 border border-indigo-200 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700 shadow-sm">
                                                    + AI Leak Detection
                                                </span>
                                            </PlanCheck>
                                            <PlanCheck>Query builder</PlanCheck>
                                            <PlanCheck>Crashes, ANRs, errors, and stability tools</PlanCheck>
                                            <PlanCheck>Heatmaps, journeys, and geo analytics</PlanCheck>
                                        </PlanGroup>
                                    </div>

                                    <div className="mt-8 pt-2">
                                        <Link
                                            to="/login"
                                            className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 shadow-sm ${buttonClassName}`}
                                            style={{ WebkitTapHighlightColor: 'transparent' }}
                                        >
                                            {isFree ? copy.startFree : copy.getStarted}
                                            <ArrowRight className="h-4 w-4" aria-hidden />
                                        </Link>
                                    </div>
                                </article>
                            );
                        })}
                    </div>

                    <div className="relative z-10 mt-8 overflow-hidden border border-slate-200 bg-white/65 backdrop-blur-md p-6 rounded-2xl shadow-sm sm:p-8 md:flex md:items-center md:justify-between md:gap-8 hover:border-indigo-200 transition-all duration-300">
                        <div className="relative max-w-2xl">
                            <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">{copy.enterpriseEyebrow}</p>
                            <h2 className="mt-2.5 text-xl font-bold tracking-tight text-slate-950 sm:text-2xl">{copy.enterpriseHeading(formatShortInteger(1000000))}</h2>
                            <p className="mt-2 text-sm font-normal text-slate-500 leading-relaxed">
                                {copy.enterpriseCopy}
                            </p>
                        </div>
                        <div className="relative mt-5 shrink-0 md:mt-0">
                            <button
                                type="button"
                                onClick={handleCopyEmail}
                                className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-all md:w-44 shadow-sm ${
                                    contactCopied
                                        ? 'bg-emerald-500 text-white'
                                        : 'bg-indigo-650 text-white hover:bg-indigo-700'
                                }`}
                                aria-live="polite"
                                style={{ WebkitTapHighlightColor: 'transparent' }}
                            >
                                {contactCopied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
                                {contactCopied ? copy.copied : copy.contact}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="border-t border-slate-200 pt-12 sm:pt-16 lg:pt-20">
                    <div className="mb-8 border border-slate-200 bg-white/60 backdrop-blur-md px-6 py-5 text-left shadow-sm">
                        <span className="block text-xl font-bold tracking-tight text-slate-950">{copy.comparisonTitle}</span>
                        <span className="mt-1.5 block text-sm font-medium leading-normal text-slate-500">{copy.comparisonSubtitle}</span>
                    </div>

                    <div className="grid gap-8 border border-slate-200 bg-white/60 backdrop-blur-md p-6 shadow-sm lg:grid-cols-[0.85fr_1.35fr]">
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
                                                    ? 'border-indigo-650 bg-indigo-650 text-white'
                                                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-350 hover:text-slate-950'
                                            }`}
                                            style={{ WebkitTapHighlightColor: 'transparent' }}
                                        >
                                            {preset.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="grid overflow-hidden border border-slate-200 rounded-xl bg-white/70 backdrop-blur-md shadow-sm sm:grid-cols-3">
                            <div className="border-b border-slate-100 bg-indigo-50/30 p-5 sm:border-b-0 sm:border-r sm:border-slate-100 sm:p-6">
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Rejourney</p>
                                <p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">${rejourneyMonthlyPlan.price}</p>
                                <p className="mt-2 text-xs font-normal text-slate-500">{copy.rejourneyPlanLabel(rejourneyMonthlyPlan.plan, rejourneyMonthlyPlan.isCustom)}</p>
                            </div>
                            <div className="border-b border-slate-100 p-5 sm:border-b-0 sm:border-r sm:border-slate-100 sm:p-6">
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">PostHog</p>
                                <p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">{formatApproxCurrency(posthogMonthlyCost)}</p>
                                <p className="mt-2 text-xs font-normal text-slate-500">{copy.posthogEstimate}</p>
                            </div>
                            <div className="p-5 sm:p-6">
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Sentry</p>
                                <p className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950">{formatApproxCurrency(sentryMonthlyCost)}</p>
                                <p className="mt-2 text-xs font-normal text-slate-500">{copy.sentryEstimate}</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="relative z-10 -mx-5 overflow-hidden border-y border-slate-200 bg-slate-50/70 backdrop-blur-sm px-5 py-12 sm:-mx-8 sm:px-8 sm:py-16 lg:-mx-10 lg:px-10 lg:py-20">
                    <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background-image:radial-gradient(#0f172a_1px,transparent_1px)] [background-size:16px_16px]" aria-hidden />

                    <div className="relative grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
                        <div className="max-w-2xl">
                            <p className="mb-4 inline-flex rounded-full bg-indigo-50 text-indigo-700 px-3 py-1 text-[11px] font-bold uppercase tracking-wider">FAQ</p>
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
                                        className="flex w-full select-none items-center justify-between gap-6 px-5 py-5 text-left transition-colors hover:bg-slate-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:px-6"
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
                            className="mt-6 inline-flex h-11 items-center justify-center gap-2 border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-755 rounded-full shadow-sm transition-all hover:bg-slate-50 hover:text-slate-900 hover:border-slate-350"
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
