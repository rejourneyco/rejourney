import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { Check, Server, Building2, ArrowRight, Loader2 } from 'lucide-react';
import { useToast } from '~/context/ToastContext';
import { api, type BillingPlan } from '~/services/api';

const SAVINGS_LABELS: Record<string, string> = {
    growth: '25% SCALE SAVINGS',
    pro: '50% SCALE SAVINGS',
};

const FEATURES = [
    { id: '01', title: "Pixel Perfect", highlight: "Session Replay", desc: "Experience true fidelity with our high-performance replay engine. Capture the true state of your application." },
    { id: '02', title: "Live", highlight: "Incident Stream", desc: "See crashes, errors, and rage taps as they happen in real-time. Don't wait for user reports." },
    { id: '03', title: "Error/ANR/Crash", highlight: "Detection", desc: "Automatic detection of ANR events with full thread dumps. Pinpoint code blocking the Main Thread." },
    { id: '04', title: "Journey", highlight: "Mapping", desc: "Visualize how users navigate your app. Identify high-friction drop-off points." },
    { id: '05', title: "Interaction", highlight: "Heat Maps", desc: "Visualize user engagement with Touch Heatmaps and Scroll Depth analysis." },
    { id: '06', title: "Global", highlight: "Stability", desc: "Monitor performance across different regions. Regional Performance Heatmaps." },
    { id: '07', title: "Growth", highlight: "Engines", desc: "Analyze release impact on retention and track user loyalty segments." },
    { id: '08', title: "Team", highlight: "Alerts", desc: "Smart email notifications for crashes, ANRs, and error spikes. Direct routing." }
];

export const PricingTable: React.FC = () => {
    const { showToast } = useToast();
    const [availablePlans, setAvailablePlans] = useState<BillingPlan[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchPlans = async () => {
            try {
                const plans = await api.getAvailablePlans();
                if (plans && plans.length > 0) {
                    setAvailablePlans(plans);
                }
            } catch (err) {
                console.error('Failed to fetch plans:', err);
            } finally {
                setIsLoading(false);
            }
        };
        fetchPlans();
    }, []);

    const handleCopyEmail = () => {
        navigator.clipboard.writeText('contact@rejourney.co');
        showToast('Email copied to clipboard!');
    };

    const formatNumber = (val: number) => {
        return new Intl.NumberFormat('en-US').format(val);
    };

    const formatCurrency = (val: number) => {
        return `$${val}`;
    };

    return (
        <section className="w-full bg-white text-black py-24 px-4 border-t-4 border-black">
            <div className="max-w-7xl mx-auto">
                {/* Header Banner */}
                <div className="mb-12 border-b-4 border-black pb-12">
                    <div className="border-4 border-black p-6 bg-black text-white flex flex-col md:flex-row items-center gap-8 w-full group hover:shadow-[12px_12px_0px_0px_rgba(0,0,0,0.2)] transition-all">
                        <div className="flex items-center gap-4">
                            <Server className="w-8 h-8 shrink-0 group-hover:rotate-12 transition-transform" />
                            <h3 className="text-3xl font-black uppercase whitespace-nowrap tracking-tighter">Self-Hosted</h3>
                        </div>

                        <div className="w-px h-12 bg-white/20 hidden md:block" />

                        <div className="flex-grow text-center md:text-left">
                            <p className="text-xs font-black uppercase tracking-widest opacity-60 mb-1">Open Source & Free Forever</p>
                            <p className="text-lg font-bold uppercase leading-tight">
                                Your data, your hardware, your rules. <span className="opacity-50 text-sm ml-2">Apache 2.0 / SSPL Licensed</span>
                            </p>
                        </div>

                        <div className="flex flex-col items-end gap-2 shrink-0">
                            <a href="https://github.com/rejourneyco/rejourney" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-3 text-sm font-black uppercase border-b-4 border-white pb-1 hover:gap-5 transition-all">
                                Docker or K3s <ArrowRight className="w-5 h-5" />
                            </a>
                        </div>
                    </div>
                </div>

                {/* Quick Stats / Info Bar */}
                <div className="flex flex-wrap gap-8 mb-8 font-black uppercase text-[10px] tracking-widest">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-black" />
                        <span>All Sessions Observed & Only Record Problems</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-black" />
                        <span>Unlimited Data Retention & 7-Day Video Retention</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-black" />
                        <span>Infinite Meta-Data & Analytics</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-black" />
                        <span>No Hidden Fees</span>
                    </div>
                </div>

                {/* Plans Grid */}
                <div className="grid lg:grid-cols-4 gap-0 border-4 border-black mb-24 overflow-hidden min-h-[400px]">
                    {isLoading ? (
                        <div className="col-span-full flex flex-col items-center justify-center py-24 bg-neutral-50 border-black">
                            <Loader2 className="w-12 h-12 text-black animate-spin mb-4" />
                            <p className="font-black uppercase tracking-widest text-sm">Loading Plans...</p>
                        </div>
                    ) : (availablePlans.length > 0 ? availablePlans : [
                        { name: 'free', displayName: 'Free', sessionLimit: 5000, priceCents: 0 },
                        { name: 'starter', displayName: 'Starter', sessionLimit: 25000, priceCents: 500 },
                        { name: 'growth', displayName: 'Growth', sessionLimit: 100000, priceCents: 1500 },
                        { name: 'pro', displayName: 'Pro', sessionLimit: 350000, priceCents: 3500 },
                    ]).map((plan) => {
                        const savings = SAVINGS_LABELS[plan.name];
                        const price = plan.priceCents / 100;

                        return (
                            <div
                                key={plan.name}
                                className="p-8 border-b-4 lg:border-b-0 lg:border-r-4 last:border-r-0 border-black transition-all bg-white text-black hover:bg-neutral-50 hover:-translate-y-1 group"
                            >
                                <div className="flex justify-between items-start mb-8">
                                    <h3 className="text-2xl font-black uppercase">{plan.displayName}</h3>
                                    {savings && (
                                        <span className="text-[10px] font-black px-2 py-1 border-2 border-black bg-black text-white group-hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,0.3)] transition-all">
                                            {savings}
                                        </span>
                                    )}
                                </div>

                                <div className="mb-8">
                                    <div className="text-5xl font-black">{formatCurrency(price)}</div>
                                </div>

                                <div className="space-y-4 mb-12">
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 border-2 border-black bg-black group-hover:rotate-45 transition-transform" />
                                        <span className="font-black uppercase text-sm">
                                            {formatNumber(plan.sessionLimit)} Sessions / month
                                        </span>
                                    </div>
                                    <p className="text-xs font-bold leading-relaxed opacity-70">
                                        Full access to all features and analytics tools.
                                    </p>
                                </div>

                                <Link
                                    to="/login"
                                    className="block w-full py-4 text-center font-black uppercase border-4 border-black bg-black text-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] hover:shadow-[10px_10px_0px_0px_rgba(0,0,0,1)] hover:-translate-x-1 hover:-translate-y-1 active:translate-x-0 active:translate-y-0 active:shadow-none transition-all"
                                >
                                    Get Started
                                </Link>
                            </div>
                        );
                    })}
                </div>

                {/* Features Section */}
                <div className="mb-24">
                    <h2 className="text-4xl font-black uppercase mb-12 flex items-center gap-4">
                        <span className="bg-black text-white px-3 py-1">All</span> Features Included In Every Plan
                    </h2>
                    <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-x-12 gap-y-16">
                        {FEATURES.map((feature) => (
                            <div key={feature.id} className="group">
                                <div className="font-mono text-xs font-black mb-4 underline">
                                    {feature.id} //
                                </div>
                                <h4 className="text-xl font-black uppercase mb-4 leading-none">
                                    {feature.title} <span className="block">{feature.highlight}</span>
                                </h4>
                                <p className="text-sm font-bold leading-relaxed mb-6">
                                    {feature.desc}
                                </p>
                                <div className="h-1 w-12 bg-black group-hover:w-full transition-all duration-300" />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Enterprise Section */}
                <div className="border-4 border-black p-12 bg-white flex flex-col md:flex-row justify-between items-start md:items-center gap-8">
                    <div>
                        <div className="flex items-center gap-4 mb-4">
                            <Building2 className="w-8 h-8" />
                            <h3 className="text-3xl font-black uppercase">Enterprise</h3>
                        </div>
                        <p className="text-lg font-bold uppercase leading-tight max-w-xl">
                            Massive scale? Custom requirements? Extended 30/60/90 Day Video Retention? We got you.
                        </p>
                    </div>
                    <div className="flex flex-col gap-6 items-start md:items-end">
                        <ul className="space-y-2">
                            {['Custom Session Limits', 'Heavy Discounts', 'Priority Support'].map((item) => (
                                <li key={item} className="flex items-center gap-3">
                                    <Check className="w-4 h-4 stroke-[3px]" />
                                    <span className="font-black uppercase text-xs">{item}</span>
                                </li>
                            ))}
                        </ul>
                        <button
                            onClick={handleCopyEmail}
                            className="inline-flex items-center gap-2 font-black uppercase border-b-4 border-black pb-1 hover:gap-4 transition-all w-fit pointer-events-auto"
                        >
                            Contact Us <ArrowRight className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
};

