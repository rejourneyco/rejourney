import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router';
import {
    ArrowRight,
    Check,
    Copy,
    Play,
    Video,
    ShieldAlert,
    Globe,
    Flame,
    Database,
    CreditCard,
    Sparkles,
    RefreshCw,
    TrendingUp,
    X,
    ChevronLeft,
    Smartphone,
    ShoppingBag,
} from 'lucide-react';
import { getMarketingHomeCopy } from '~/shared/lib/internationalMarketing';
import { LandingThreeField } from './LandingThreeField';
import {
    MarkAngular,
    MarkGatsby,
    MarkHydrogen,
    MarkNextJs,
    MarkReactNative,
    MarkRemix,
    MarkShopify,
    MarkSvelte,
    MarkSwift,
    MarkVue,
} from './PlatformMarks';
import { FaqSection } from './FaqSection';
import { CodeBlock } from '~/shared/ui/core/CodeBlock';

const LOGIN_PATH = '/login';
const LANDING_IMAGE_VERSION = '20260619';
const landingImage = (path: string) => `${path}?v=${LANDING_IMAGE_VERSION}`;

const SESSION_REPLAY_IMAGE = landingImage('/images/landing-replay-workbench.png');
const STABILITY_IMAGE = landingImage('/images/anr-issues.png');
const GEO_IMAGE = landingImage('/images/geo-analytics.png');
const HEATMAPS_IMAGE = landingImage('/images/engineering/heatmaps-attention-docs.png');
const API_INSIGHTS_IMAGE = landingImage('/images/engineering/api-error-rate-spike.png');
const MOUNTAIN_CARD_IMAGE = landingImage('/images/mountain_app_card.jpg');
const BEACH_CARD_IMAGE = landingImage('/images/beach_app_card.jpg');

const supportedPlatforms = [
    { label: 'Shopify', icon: MarkShopify, color: '#95bf47' },
    { label: 'Hydrogen', icon: MarkHydrogen, color: '#00a878' },
    { label: 'Gatsby', icon: MarkGatsby, color: '#663399' },
    { label: 'React Native / Expo', icon: MarkReactNative, color: '#2563eb' },
    { label: 'Swift', icon: MarkSwift, color: '#f97316' },
    { label: 'Next.js / React', icon: MarkNextJs, color: '#0f172a' },
    { label: 'Vue / Nuxt', icon: MarkVue, color: '#42b883' },
    { label: 'Angular', icon: MarkAngular, color: '#dd0031' },
    { label: 'SvelteKit', icon: MarkSvelte, color: '#ff3e00' },
    { label: 'Remix', icon: MarkRemix, color: '#0f172a' },
];

const sdkPlatforms = [
    {
        id: 'shopify',
        title: 'Shopify',
        icon: MarkShopify,
        brandColor: '#95bf47',
        terminalCommands: ['npm install @rejourneyco/browser'],
        subtitle: 'Bundle into theme asset',
        fileName: 'src/rejourney-shopify.ts',
        code: `import { Rejourney } from '@rejourneyco/browser';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();`
    },
    {
        id: 'reactnative',
        title: 'React Native / Expo',
        icon: MarkReactNative,
        brandColor: '#06b6d4', // cyan-500
        terminalCommands: ['npm install @rejourneyco/react-native'],
        subtitle: 'Official 3-line setup',
        fileName: 'App.tsx',
        code: `import { Rejourney } from '@rejourneyco/react-native';
Rejourney.init('pk_live_your_public_key');
Rejourney.start();`
    },
    {
        id: 'nextjs',
        title: 'Next.js / React',
        icon: MarkNextJs,
        brandColor: '#0f172a', // slate-900
        terminalCommands: ['npm install @rejourneyco/browser'],
        subtitle: '@rejourneyco/browser/next',
        fileName: 'app/layout.tsx',
        code: `import { RejourneyNext } from '@rejourneyco/browser/next';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <RejourneyNext publicKey="pk_live_your_public_key" />
        {children}
      </body>
    </html>
  );
}`
    },
    {
        id: 'swift',
        title: 'Swift / iOS',
        icon: MarkSwift,
        brandColor: '#f97316', // orange-500
        terminalCommands: ['https://github.com/rejourneyco/rejourney'],
        subtitle: 'SPM Dependency',
        fileName: 'MyApp.swift',
        code: `import SwiftUI
import Rejourney

@main
struct MyApp: App {

    @MainActor
    init() {
        Rejourney.configure(publicKey: "rj_your_public_key")
        Task { await Rejourney.start() }
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}`
    },
    {
        id: 'vue',
        title: 'Vue / Nuxt',
        icon: MarkVue,
        brandColor: '#10b981', // emerald-500
        terminalCommands: ['npm install @rejourneyco/browser'],
        subtitle: '@rejourneyco/browser/nuxt',
        fileName: 'plugins/rejourney.client.ts',
        code: `import { defineRejourneyNuxtPlugin } from '@rejourneyco/browser/nuxt';

export default defineRejourneyNuxtPlugin({
  publicKey: 'pk_live_your_public_key',
});`
    }
];

const SpinningGlobe: React.FC = () => {
    const [time, setTime] = useState(0);

    useEffect(() => {
        let frame: number;
        const tick = () => {
            setTime(t => t + 0.004); // Speed of rotation
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, []);

    // 10 Nodes spread evenly across latitudes and longitudes
    const nodes = [
        { id: 1,  lat:  0.52, lonOffset: -1.74, val: "+$196" }, // North America NW
        { id: 2,  lat:  0.38, lonOffset: -0.90, val: "+$84"  }, // North America NE
        { id: 3,  lat:  0.78, lonOffset:  0.17, val: "+$79"  }, // Western Europe
        { id: 4,  lat:  0.60, lonOffset:  0.62, val: "+$132" }, // Central Europe
        { id: 5,  lat: -0.26, lonOffset: -1.05, val: "+$249" }, // South America
        { id: 6,  lat:  0.20, lonOffset: -0.35, val: "+$67"  }, // West Africa
        { id: 7,  lat:  0.35, lonOffset:  1.74, val: "+$49"  }, // South-East Asia
        { id: 8,  lat:  0.55, lonOffset:  2.10, val: "+$188" }, // East Asia / Japan
        { id: 9,  lat: -0.44, lonOffset:  2.35, val: "+$120" }, // Australia
        { id: 10, lat:  0.12, lonOffset:  1.20, val: "+$93"  }, // India / S. Asia
    ];

    // Longitude lines rotate!
    // 6 rotating longitudes, spaced by pi/3 (60 degrees)
    const longitudes = [0, Math.PI/3, 2*Math.PI/3, Math.PI, 4*Math.PI/3, 5*Math.PI/3];

    return (
        <div className="relative h-64 w-64 sm:h-80 sm:w-80 rounded-full border border-slate-200/60 bg-white flex items-center justify-center shadow-[0_15px_45px_rgba(15,23,42,0.06)] overflow-hidden">
            {/* Globe grid lines SVG */}
            <svg className="absolute inset-0 h-full w-full text-slate-200" viewBox="0 0 200 200" fill="none">
                {/* Outer rings */}
                <circle cx="100" cy="100" r="99" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" className="opacity-30" />
                <circle cx="100" cy="100" r="90" stroke="currentColor" strokeWidth="1.5" />
                
                {/* Fixed Latitudes */}
                <path d="M 10,100 A 90 25 0 0 0 190 100" stroke="currentColor" strokeWidth="1" />
                <path d="M 10,100 A 90 25 0 0 1 190 100" stroke="currentColor" strokeWidth="1" />
                <path d="M 22,60 A 78 18 0 0 0 178 60" stroke="currentColor" strokeWidth="0.75" />
                <path d="M 22,140 A 78 18 0 0 1 178 140" stroke="currentColor" strokeWidth="0.75" />
                
                {/* Rotating Longitudes */}
                {longitudes.map((baseLon, idx) => {
                    const lon = baseLon + time;
                    const sinLon = Math.sin(lon);
                    const rx = Math.abs(sinLon * 90);
                    const isBehind = Math.cos(lon) < 0;
                    return (
                        <path
                            key={idx}
                            d={`M 100,10 A ${rx.toFixed(2)} 90 0 0 ${sinLon > 0 ? 1 : 0} 100 190`}
                            stroke="currentColor"
                            strokeWidth={isBehind ? "0.5" : "0.85"}
                            className={isBehind ? "opacity-20" : "opacity-60"}
                        />
                    );
                })}

                {/* Fixed Center Axis line */}
                <line x1="100" y1="10" x2="100" y2="190" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
                <line x1="10" y1="100" x2="190" y2="100" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
            </svg>

            {/* Rotating Nodes */}
            {nodes.map((node) => {
                const lon = node.lonOffset + time;
                const cosLat = Math.cos(node.lat);
                const sinLat = Math.sin(node.lat);
                
                // 3D coordinates (rotation around Y axis)
                const x = cosLat * Math.sin(lon);
                const y = sinLat;
                const z = cosLat * Math.cos(lon); // z >= 0 means front side, z < 0 means back side

                // If deep on the backside, hide it.
                if (z < -0.2) return null;
                
                const opacity = z < 0 ? (z + 0.2) / 0.2 : 1; // smooth fade at edge

                // Convert to percentage coordinates inside the 200x200 SVG (cx=50, cy=50, radius=45)
                const leftPercent = 50 + x * 45;
                const topPercent = 50 - y * 45;

                return (
                    <div 
                        key={node.id}
                        className="absolute flex items-center z-10 pointer-events-none transition-opacity duration-100"
                        style={{
                            left: `${leftPercent.toFixed(2)}%`,
                            top: `${topPercent.toFixed(2)}%`,
                            transform: "translate(-7px, -7px)", // center the dot
                            opacity: opacity.toFixed(2)
                        }}
                    >
                        <span className="relative flex h-3.5 w-3.5 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-450 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border border-white shadow-sm"></span>
                        </span>
                        <div className="ml-1.5 bg-white border border-slate-100 rounded-full px-2 py-0.5 shadow-md flex items-center gap-0.5">
                            <span className="text-[9.5px] font-extrabold text-emerald-600">{node.val}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

export const AiLeakHomepage: React.FC = () => {
    const location = useLocation();
    const homeCopy = getMarketingHomeCopy(location.pathname);

    // Bottom CTA Playground state
    const [activeSdkPlatform, setActiveSdkPlatform] = useState<'shopify' | 'nextjs' | 'reactnative' | 'swift' | 'vue'>('shopify');
    const [copied, setCopied] = useState(false);

    // Interactive Showcase Tabs state
    const [activeFeatureTab, setActiveFeatureTab] = useState<'replay' | 'heatmaps' | 'api' | 'stability' | 'geo'>('replay');

    const [chartInView, setChartInView] = useState(false);
    const chartRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    setChartInView(true);
                    observer.unobserve(entry.target);
                }
            },
            { threshold: 0.15 }
        );

        if (chartRef.current) {
            observer.observe(chartRef.current);
        }

        return () => {
            observer.disconnect();
        };
    }, []);

    const writeToClipboard = async (text: string) => {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            await writeToClipboard(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error('Failed to copy SDK setup code:', error);
        }
    };

    const activeSdk = sdkPlatforms.find(p => p.id === activeSdkPlatform) || sdkPlatforms[0];
    const activeSdkLanguage = activeSdk.id === 'swift' ? 'swift' : 'typescript';
    const activeSdkSetup = `${activeSdk.terminalCommands.join('\n')}\n\n${activeSdk.code}`;

    return (
        <div className="landing-home relative isolate w-full overflow-x-hidden bg-[#f8fbff] text-slate-900">

            <div className="relative z-10">
                {/* Hero Section */}
                <section className="landing-hero-section relative z-20 overflow-hidden px-5 pb-28 pt-36 text-center sm:px-8 sm:pb-40 sm:pt-44 lg:px-10 lg:pb-44 lg:pt-48">
                    <LandingThreeField variant="landing-hero" seed={11} />

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-36 bg-gradient-to-t from-white/75 via-white/35 to-transparent" aria-hidden="true" />

                    <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center">
                        <h1 className="landing-hero-title mx-auto max-w-6xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-700 bg-clip-text font-display text-[1.68rem] font-extrabold leading-[1.04] tracking-normal text-transparent drop-shadow-[0_18px_44px_rgba(37,99,235,0.08)] min-[360px]:text-[1.95rem] min-[430px]:text-[2.2rem] sm:text-[3.05rem] md:text-[3.65rem] lg:text-[4.45rem] xl:text-[5.35rem]">
                            Boost Subscription and Checkout Revenue.
                        </h1>
                        <p className="landing-hero-subtitle mx-auto mt-8 max-w-3xl text-balance text-lg font-medium leading-relaxed text-slate-600 sm:text-xl md:text-2xl">
                            {homeCopy.hero.description}
                        </p>
                        {/* Action buttons matching style */}
                        <div className="landing-hero-actions mt-9 flex w-full max-w-[20.5rem] flex-col items-center justify-center gap-3 sm:mt-11 sm:w-auto sm:max-w-none sm:flex-row">
                            <Link
                                to={LOGIN_PATH}
                                className="group inline-flex min-h-[52px] w-full min-w-[190px] items-center justify-center gap-2 rounded-full border border-slate-950 bg-slate-950 px-7 text-[0.95rem] font-bold text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)] ring-1 ring-slate-950/10 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-800 hover:bg-slate-800 hover:shadow-[0_20px_44px_rgba(15,23,42,0.24)] active:translate-y-0 sm:min-h-[58px] sm:w-auto sm:px-8 sm:text-base"
                            >
                                <span>Get Started $0</span>
                                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                            </Link>
                            <Link
                                to="/how-it-works"
                                className="inline-flex min-h-[52px] w-full min-w-[190px] items-center justify-center rounded-full border border-slate-300/70 bg-white/50 px-7 text-[0.95rem] font-bold text-slate-700 shadow-sm shadow-slate-200/40 ring-1 ring-slate-400/10 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white/75 hover:shadow-md active:translate-y-0 sm:min-h-[58px] sm:w-auto sm:px-8 sm:text-base"
                            >
                                How It Works
                            </Link>
                        </div>
                        <div className="landing-platforms mx-auto mt-14 flex w-full max-w-6xl flex-col items-center justify-center gap-4 border-t border-slate-200/70 pt-8">
                            <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.18em] text-slate-400">
                                Supported platforms
                            </p>
                            <div className="flex w-full max-w-5xl flex-col items-center gap-3">
                                {[supportedPlatforms.slice(0, 6), supportedPlatforms.slice(6)].map((row, rowIndex) => (
                                    <div
                                        key={rowIndex}
                                        className={`flex w-full flex-wrap items-center justify-center gap-3 ${
                                            rowIndex === 0 ? 'max-w-6xl' : 'max-w-4xl'
                                        }`}
                                    >
                                        {row.map((platform) => {
                                            const Icon = platform.icon;
                                            return (
                                                <div
                                                    key={platform.label}
                                                    className="inline-flex min-h-10 min-w-[9.5rem] items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/70 px-4 text-sm font-extrabold text-slate-600 shadow-sm shadow-slate-200/60 ring-1 ring-white/60 backdrop-blur-sm"
                                                >
                                                    <Icon className="h-4 w-4 shrink-0" style={{ color: platform.color }} />
                                                    <span className="whitespace-nowrap">{platform.label}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>
                        </div>
                </div>
            </section>

            <div className="landing-after-hero relative z-10 overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#eff6ff_26%,#f0fdf4_52%,#fffbeb_78%,#f8fafc_100%)]">
                <LandingThreeField variant="landing-sparse" seed={307} className="landing-after-hero-field" />
                <div className="pointer-events-none absolute inset-0 z-[0] bg-[radial-gradient(circle_at_15%_9%,rgba(37,99,235,0.035),transparent_31%),radial-gradient(circle_at_86%_22%,rgba(14,165,233,0.026),transparent_34%),radial-gradient(circle_at_18%_52%,rgba(245,158,11,0.032),transparent_34%),radial-gradient(circle_at_82%_78%,rgba(16,185,129,0.036),transparent_34%)]" aria-hidden="true" />
                <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(180deg,rgba(255,255,255,0.35)_0%,rgba(255,255,255,0.12)_28%,rgba(255,255,255,0.08)_56%,rgba(255,255,255,0.25)_100%)]" aria-hidden="true" />
                <div className="pointer-events-none absolute inset-x-0 top-[33rem] z-[1] h-px bg-gradient-to-r from-transparent via-sky-200/45 to-transparent" aria-hidden="true" />

            {/* Detailed product value sections for founders & revenue recovery */}
            <section className="landing-section relative z-10 overflow-hidden bg-transparent px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
                <div className="mx-auto max-w-7xl space-y-32">
                    
                    {/* Section 1: Checkout Form Leak Simulation */}
                    <div className="grid gap-12 lg:grid-cols-[0.42fr_0.58fr] lg:items-center">
                        <div className="space-y-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Revenue Leak Tracking</p>
                            <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                See the Exact Barriers Costing Revenue.
                            </h3>
                        </div>
                        <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50/50 p-6 shadow-2xl shadow-slate-200/50 flex items-center justify-center">
                            <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white shadow-xl font-sans relative">
                                {/* Mock Browser Bar */}
                                <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 flex items-center gap-2 rounded-t-2xl relative">
                                    <div className="flex gap-1.5 absolute left-4">
                                        <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
                                        <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                                        <div className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                                    </div>
                                    <div className="bg-slate-100 border border-slate-200/60 rounded-md px-2.5 py-0.5 flex items-center justify-center gap-1.5 mx-auto max-w-[130px]">
                                        <ShoppingBag className="h-2.5 w-2.5 text-slate-500" />
                                        <span className="text-[9px] font-bold text-slate-600 tracking-wide">Cart</span>
                                    </div>
                                </div>
                                
                                {/* Checkout Form Content */}
                                <div className="p-6 space-y-4 relative rounded-b-2xl bg-white">
                                    
                                    {/* Order summary */}
                                    <div className="flex gap-3 items-center bg-slate-50 p-3 rounded-xl border border-slate-100 text-left">
                                        {/* Product Image */}
                                        <div className="h-10 w-10 rounded-lg overflow-hidden border border-slate-200 bg-white shrink-0 relative cursor-pointer group">
                                            <img 
                                                src={MOUNTAIN_CARD_IMAGE} 
                                                alt="Rainier Climber Pass" 
                                                className="w-full h-full object-cover transition-transform group-hover:scale-105"
                                            />
                                            {/* Concentric click indicator on the image itself */}
                                            <div className="absolute inset-0 bg-red-500/10 pointer-events-none animate-pulse" />
                                        </div>
                                        
                                        {/* Product Details */}
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[10px] font-extrabold text-slate-800 truncate">Rainier Climber Pass</div>
                                            <div className="text-[8.5px] text-slate-400">Qty: 1 • Premium Access</div>
                                        </div>
                                        
                                        {/* Price */}
                                        <div className="text-right">
                                            <span className="text-xs font-black text-slate-900">$196.00</span>
                                        </div>
                                    </div>
                                    
                                    {/* Input fields */}
                                    <div className="space-y-3">
                                        <div>
                                            <div className="h-3 w-16 bg-slate-100 rounded mb-1.5" />
                                            <div className="h-10 w-full border border-slate-200 rounded-lg bg-slate-50/50 px-3 flex items-center">
                                                <div className="h-3 w-32 bg-slate-200/60 rounded" />
                                            </div>
                                        </div>
                                        <div>
                                            <div className="h-3 w-20 bg-slate-100 rounded mb-1.5" />
                                            <div className="h-10 w-full border border-slate-200 rounded-lg bg-slate-50/50 px-3 flex items-center justify-between">
                                                <div className="h-3 w-40 bg-slate-200/60 rounded" />
                                                <div className="h-4 w-6 bg-slate-200 rounded" />
                                            </div>
                                        </div>
                                    </div>
                                    
                                    {/* Stuck Pay Button */}
                                    <button 
                                        type="button" 
                                        className="w-full h-11 bg-slate-950 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2 cursor-not-allowed opacity-80"
                                    >
                                        <span>Confirming Payment...</span>
                                    </button>

                                    {/* Floating Checkout Leak Warning overlay */}
                                    <div className="absolute right-[-24px] top-[42%] w-72 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-100 shadow-[0_20px_40px_rgba(15,23,42,0.15)] p-4 space-y-3.5 z-10 transition-transform duration-300 hover:scale-[1.02]">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <div className="relative flex h-2 w-2">
                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                                                </div>
                                                <span className="text-[9px] font-bold uppercase tracking-wider text-amber-600">
                                                    UX Friction
                                                </span>
                                            </div>
                                            <span className="text-[10px] font-mono text-slate-400 font-bold">#9201</span>
                                        </div>
                                        
                                        <div className="space-y-1">
                                            <h4 className="text-xs font-bold text-slate-900">Dead Click on Product Image</h4>
                                            <p className="text-[10px] text-slate-500 leading-normal">
                                                42% of users click the main photo expecting to add it to checkout, but the image is non-interactive.
                                            </p>
                                        </div>
                                        
                                        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                                            <div>
                                                <div className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Opportunity Value</div>
                                                <div className="text-xs font-extrabold text-emerald-600 mt-0.5">+$3,136 today</div>
                                            </div>
                                            <Link 
                                                to="/demo/general"
                                                className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] px-3 py-1.5 rounded-full shadow-sm shadow-blue-200 transition"
                                            >
                                                <Play className="h-2 w-2 fill-current" />
                                                <span>Open Demo</span>
                                            </Link>
                                        </div>
                                    </div>
                                    
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: ROAS & Conversion Lift */}
                    <div className="grid gap-12 lg:grid-cols-[0.58fr_0.42fr] lg:items-center">
                        <div ref={chartRef} className="rounded-[1.75rem] border border-slate-200/80 bg-white p-6 shadow-2xl shadow-slate-200/50 lg:order-first">
                            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
                                <div>
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Campaign Performance</div>
                                    <div className="text-lg font-extrabold text-slate-900 mt-1">Return on Ad Spend (ROAS)</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-600">
                                        +466% Lift
                                    </div>
                                </div>
                            </div>
                            
                            {/* Premium Daily Timeline Graph Mockup */}
                            <div className="relative h-52 w-full mt-4">
                                {/* Y-Axis Labels */}
                                <div className="absolute left-2.5 inset-y-0 flex flex-col justify-between text-[8px] font-bold text-slate-350 pointer-events-none pb-6">
                                    <span>2.0x</span>
                                    <span>1.5x</span>
                                    <span>1.0x</span>
                                    <span>0.5x</span>
                                    <span>0.0x</span>
                                </div>

                                {/* Horizontal Grid lines */}
                                <div className="absolute inset-x-10 top-0 h-px bg-slate-100/70" />
                                <div className="absolute inset-x-10 top-[25%] h-px bg-slate-150/40" />
                                <div className="absolute inset-x-10 top-[50%] h-px bg-slate-150/40" />
                                <div className="absolute inset-x-10 top-[75%] h-px bg-slate-150/40" />
                                <div className="absolute inset-x-10 bottom-6 h-px bg-slate-200" />

                                {/* Vertical Grid Lines */}
                                <div className="absolute left-[12.5%] top-0 bottom-6 w-px bg-slate-100/30" />
                                <div className="absolute left-[25.0%] top-0 bottom-6 w-px bg-slate-100/30" />
                                <div className="absolute left-[37.5%] top-0 bottom-6 w-px bg-slate-100/30" />
                                <div className="absolute left-[50.0%] top-0 bottom-6 w-px bg-blue-100/40" />
                                <div className="absolute left-[62.5%] top-0 bottom-6 w-px bg-slate-100/30" />
                                <div className="absolute left-[75.0%] top-0 bottom-6 w-px bg-slate-100/30" />
                                <div className="absolute left-[87.5%] top-0 bottom-6 w-px bg-slate-100/30" />

                                {/* Rejourney Intervention Live Line & Tag */}
                                <div className="absolute left-[50.0%] top-0 bottom-6 w-px border-l border-dashed border-blue-400/60 z-10 pointer-events-none" />
                                <div className="absolute left-[50.0%] top-2 -translate-x-1/2 bg-blue-600 text-white text-[7px] font-extrabold uppercase px-1.5 py-0.5 rounded shadow-sm z-20 flex items-center gap-1 whitespace-nowrap select-none">
                                    <Sparkles className="h-2 w-2" />
                                    <span>Rejourney Active</span>
                                </div>

                                {/* SVG Curve */}
                                <svg className="absolute inset-x-0 top-0 bottom-6 h-[calc(100%-24px)] w-full" viewBox="0 0 400 180" preserveAspectRatio="none">
                                    <defs>
                                        <linearGradient id="chartGradient" x1="0" y1="1" x2="0" y2="0">
                                            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.01" />
                                            <stop offset="40%" stopColor="#3b82f6" stopOpacity="0.08" />
                                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.22" />
                                        </linearGradient>
                                        <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                                            <stop offset="0%" stopColor="#ef4444" />
                                            <stop offset="45%" stopColor="#3b82f6" />
                                            <stop offset="100%" stopColor="#10b981" />
                                        </linearGradient>
                                        {/* Dynamic Clip Path representing left-to-right draw animation */}
                                        <clipPath id="chartClip">
                                            <rect 
                                                x="0" 
                                                y="0" 
                                                width={chartInView ? "400" : "0"} 
                                                height="180" 
                                                className="transition-all duration-[1200ms] ease-out"
                                            />
                                        </clipPath>
                                    </defs>
                                    
                                    {/* Baseline Curve (Without Rejourney - dashed, flat gray line at y=145) */}
                                    <path 
                                        d="M 50,150 C 100,145 200,148 350,144" 
                                        fill="none" 
                                        stroke="#cbd5e1" 
                                        strokeWidth="2.5" 
                                        strokeDasharray="4 4" 
                                        clipPath="url(#chartClip)"
                                    />

                                    {/* Filled area for Active curve */}
                                    <path 
                                        d="M 50,150 C 75,150 75,148 100,148 C 125,148 125,142 150,142 C 175,142 185,115 200,110 C 220,103 235,80 250,75 C 265,70 285,52 300,48 C 315,44 335,35 350,35 L 350,180 L 50,180 Z" 
                                        fill="url(#chartGradient)"
                                        clipPath="url(#chartClip)"
                                    />
                                    
                                    {/* Glowing blur path line */}
                                    <path 
                                        d="M 50,150 C 75,150 75,148 100,148 C 125,148 125,142 150,142 C 175,142 185,115 200,110 C 220,103 235,80 250,75 C 265,70 285,52 300,48 C 315,44 335,35 350,35" 
                                        fill="none" 
                                        stroke="url(#lineGradient)" 
                                        strokeWidth="6"
                                        opacity="0.15"
                                        strokeLinecap="round"
                                        clipPath="url(#chartClip)"
                                    />

                                    {/* Active Curve Line path */}
                                    <path 
                                        d="M 50,150 C 75,150 75,148 100,148 C 125,148 125,142 150,142 C 175,142 185,115 200,110 C 220,103 235,80 250,75 C 265,70 285,52 300,48 C 315,44 335,35 350,35" 
                                        fill="none" 
                                        stroke="url(#lineGradient)" 
                                        strokeWidth="3.5" 
                                        strokeLinecap="round"
                                        clipPath="url(#chartClip)"
                                    />
                                </svg>
                                
                                {/* Start Point Dot & Tooltip (0.3 ROAS) */}
                                <div className="absolute left-[12.5%] top-[83.3%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20">
                                    {/* Tooltip */}
                                    <div className="absolute bottom-5 flex flex-col items-center">
                                        <div className="bg-white border border-slate-200/80 shadow-[0_4px_12px_rgba(239,68,68,0.08)] px-2 py-0.5 rounded-md text-[9px] font-extrabold text-red-500 whitespace-nowrap">
                                            0.3 ROAS
                                        </div>
                                        <div className="w-1.5 h-1.5 bg-white border-r border-b border-slate-200/80 transform rotate-45 -mt-[4px]" />
                                    </div>
                                    {/* Dot */}
                                    <div className="relative flex items-center justify-center">
                                        <div className="absolute h-4.5 w-4.5 rounded-full bg-red-500/20 animate-pulse" />
                                        <div className="h-2 w-2 rounded-full border border-white bg-red-500 shadow-sm relative z-10" />
                                    </div>
                                </div>

                                {/* End Point Dot & Tooltip (1.7 ROAS) */}
                                <div 
                                    className={`absolute left-[87.5%] top-[19.4%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-20 transition-all duration-500 delay-1000 ease-out ${
                                        chartInView ? "opacity-100 scale-100" : "opacity-0 scale-50"
                                    }`}
                                >
                                    {/* Tooltip */}
                                    <div className="absolute bottom-5 flex flex-col items-center">
                                        <div className="bg-emerald-500 shadow-[0_4px_12px_rgba(16,185,129,0.2)] px-2 py-0.5 rounded-md text-[9px] font-black text-white whitespace-nowrap">
                                            1.7 ROAS
                                        </div>
                                        <div className="w-1.5 h-1.5 bg-emerald-500 transform rotate-45 -mt-[4px]" />
                                    </div>
                                    {/* Dot */}
                                    <div className="relative flex items-center justify-center">
                                        <div className="absolute h-5 w-5 rounded-full bg-emerald-500/35 animate-ping" />
                                        <div className="h-2.5 w-2.5 rounded-full border border-white bg-emerald-500 shadow-sm relative z-10" />
                                    </div>
                                </div>

                                {/* X-Axis Labels */}
                                <div className="absolute inset-x-0 bottom-0 h-4 text-[8px] font-bold text-slate-400 pointer-events-none">
                                    <span className="absolute left-[12.5%] -translate-x-1/2">Mon</span>
                                    <span className="absolute left-[25.0%] -translate-x-1/2">Tue</span>
                                    <span className="absolute left-[37.5%] -translate-x-1/2">Wed</span>
                                    <span className="absolute left-[50.0%] -translate-x-1/2 text-blue-600 bg-blue-50/80 px-1.5 py-0.5 rounded font-extrabold border border-blue-100/50">Thu</span>
                                    <span className="absolute left-[62.5%] -translate-x-1/2">Fri</span>
                                    <span className="absolute left-[75.0%] -translate-x-1/2">Sat</span>
                                    <span className="absolute left-[87.5%] -translate-x-1/2">Sun</span>
                                </div>
                            </div>
                            
                            {/* Annotations */}
                            <div className="mt-6 grid grid-cols-2 gap-4 text-center border-t border-slate-100 pt-4">
                                <div>
                                    <div className="text-[10px] text-slate-400 font-bold uppercase">Before Rejourney</div>
                                    <div className="text-xs font-semibold text-slate-500 mt-1">Friction &amp; checkout leaks</div>
                                </div>
                                <div className="border-l border-slate-100">
                                    <div className="text-[10px] text-slate-400 font-bold uppercase">After Rejourney</div>
                                    <div className="text-xs font-semibold text-slate-700 mt-1">Healed funnels &amp; recovered spend</div>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">ROAS &amp; Conversion Lift</p>
                            <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                Improve ROAS &amp; Conversions from Ad Traffic.
                            </h3>
                        </div>
                    </div>

                    {/* Section 3: Passive Subscription Churn Recovery */}
                    <div className="grid gap-12 lg:grid-cols-[0.42fr_0.58fr] lg:items-center">
                        <div className="space-y-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Subscription Churn Recovery</p>
                            <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                Prevent Friction Churn and Ensure Renewals.
                            </h3>
                        </div>
                        <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50/50 p-6 shadow-2xl shadow-slate-200/50 flex items-center justify-center relative overflow-visible">
                            {/* Outer layout container to hold phone and floating card */}
                            <div className="relative flex items-center justify-center w-full max-w-sm h-[480px]">
                                
                                {/* Phone Mockup */}
                                <div className="w-[260px] h-[450px] bg-slate-900 border-[6px] border-slate-950 rounded-[2.5rem] p-2 shadow-2xl relative overflow-hidden flex flex-col z-10">
                                    {/* Notch / Dynamic Island */}
                                    <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-16 h-3.5 bg-slate-950 rounded-full z-30 flex items-center justify-center">
                                        <div className="h-1 w-1 bg-slate-800 rounded-full ml-auto mr-2" />
                                    </div>
                                    
                                    {/* Inner Phone Screen Content */}
                                    <div className="bg-slate-50 rounded-[2rem] h-full w-full relative overflow-hidden flex flex-col border border-slate-950/20 select-none">
                                        {/* App Header Status Bar */}
                                        <div className="flex justify-between items-center px-5 pt-2 pb-1 text-[8px] font-bold text-slate-400 relative z-20">
                                            <span className="w-10 text-left">9:41</span>
                                            {/* Center spacer so the notch doesn't clash with content */}
                                            <div className="w-16 h-3.5" />
                                            <div className="w-10 flex justify-end items-center gap-1">
                                                <div className="h-2 w-3 border border-slate-300 rounded-[2px]" />
                                                <div className="h-1.5 w-2 bg-slate-400 rounded-[2px]" />
                                            </div>
                                        </div>
                                        
                                        {/* App Navigation Header */}
                                        <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 bg-white">
                                            <ChevronLeft className="h-4 w-4 text-slate-650 cursor-pointer" />
                                            <span className="text-[10px] font-extrabold text-slate-800 tracking-wide">Peak Discoverer</span>
                                            <div className="h-5 w-5 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[8px] font-bold text-slate-500">
                                                JD
                                            </div>
                                        </div>
                                        
                                        {/* Beach Image and App Details Card */}
                                        <div className="flex-1 p-3 overflow-y-auto space-y-3 bg-slate-50/50">
                                            {/* Beach Image */}
                                            <div className="w-full h-32 rounded-xl overflow-hidden shadow-inner relative border border-slate-200/50">
                                                <img 
                                                    src={BEACH_CARD_IMAGE} 
                                                    alt="Beach scenery" 
                                                    className="w-full h-full object-cover"
                                                />
                                            </div>
                                            
                                            {/* App Text Content */}
                                            <div className="space-y-1 text-left">
                                                <h4 className="text-[11px] font-extrabold text-slate-800">Maui Shore Explorer</h4>
                                                <p className="text-[8.5px] text-slate-500 leading-normal">
                                                    Unlock premium tide tracking, surf alerts, local hidden beaches, and offline snorkeling guidebooks.
                                                </p>
                                            </div>
                                            
                                            {/* Premium Pricing Tier Box */}
                                            <div className="border border-blue-150 bg-blue-50/40 p-2 rounded-xl flex items-center justify-between">
                                                <div className="text-left">
                                                    <div className="text-[8px] font-bold text-blue-600 uppercase">RECOMMENDED</div>
                                                    <div className="text-[10px] font-extrabold text-slate-800">Pro Explorer</div>
                                                </div>
                                                <span className="text-xs font-black text-slate-900">$9.99/mo</span>
                                            </div>

                                            {/* Action Upgrade Button with Rage Clicks */}
                                            <div className="relative pt-2">
                                                <button 
                                                    type="button"
                                                    className="w-full h-9 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[10px] flex items-center justify-center shadow-sm select-none cursor-pointer"
                                                >
                                                    Upgrade Subscription
                                                </button>

                                                {/* Concentric Rage Click Ripples (Concentric circles radiating outwards) */}
                                                <div className="absolute left-[70%] top-[65%] pointer-events-none z-20">
                                                    {/* Pulse circles */}
                                                    <div className="absolute -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full border border-red-500 bg-red-500/20 animate-ping" />
                                                    <div className="absolute -translate-x-1/2 -translate-y-1/2 h-12 w-12 rounded-full border border-red-400 bg-red-400/10 animate-ping [animation-delay:0.3s]" />
                                                    <div className="absolute -translate-x-1/2 -translate-y-1/2 h-16 w-16 rounded-full border border-red-300 bg-red-300/5 animate-ping [animation-delay:0.6s]" />
                                                    
                                                    {/* Clicking cursor graphic */}
                                                    <div className="absolute left-1 top-1 flex flex-col items-center">
                                                        <svg className="h-5 w-5 text-red-700 filter drop-shadow-[0_2px_4px_rgba(239,68,68,0.4)]" viewBox="0 0 24 24" fill="currentColor">
                                                            <path d="M4 3l16 12-7 1.5 6 6-3 1.5-6-6-6 1.5z" />
                                                        </svg>
                                                        
                                                        {/* Floating Rage Click Badge */}
                                                        <span className="mt-1 text-[7px] font-extrabold uppercase tracking-wide bg-red-650 text-white px-1.5 py-0.5 rounded shadow-sm border border-red-500 whitespace-nowrap animate-bounce">
                                                            Rage Click x8
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                {/* Rejourney Floating Alert Intervention Card (Overlapping phone right side) */}
                                <div className="absolute right-[-28px] bottom-[16%] w-60 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200 shadow-[0_20px_40px_rgba(15,23,42,0.18)] p-4 space-y-3 z-20 text-left transition hover:scale-[1.02]">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            <div className="relative flex h-2 w-2">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                                            </div>
                                            <span className="text-[9px] font-bold uppercase tracking-wider text-red-700">
                                                Friction Alert
                                            </span>
                                        </div>
                                        <span className="text-[9px] font-mono text-slate-400 font-bold">#RC-8042</span>
                                    </div>
                                    
                                    <div className="space-y-1">
                                        <h4 className="text-[11px] font-extrabold text-slate-900">Upgrade Button Unresponsive</h4>
                                        <p className="text-[9px] text-slate-500 leading-normal">
                                            8 quick clicks detected. Payment gateway failed to respond to the purchase call in under 12 seconds.
                                        </p>
                                    </div>
                                    
                                    <div className="flex items-center justify-between border-t border-slate-100 pt-3">
                                        <div>
                                            <div className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">Estimated Leak</div>
                                            <div className="text-[11px] font-extrabold text-emerald-600 mt-0.5">+$1,440 LTV</div>
                                        </div>
                                        <Link 
                                            to="/demo/general"
                                            className="inline-flex items-center gap-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[9px] px-2.5 py-1.5 rounded-full shadow-sm shadow-blue-200 transition"
                                        >
                                            <Play className="h-1.5 w-1.5 fill-current" />
                                            <span>Open Demo</span>
                                        </Link>
                                    </div>
                                </div>
                                
                            </div>
                        </div>
                    </div>

                    {/* Section 4: Revenue Lift Verification (Release Markers) */}
                    <div className="grid gap-12 lg:grid-cols-[0.58fr_0.42fr] lg:items-center">
                        <div className="rounded-[1.75rem] border border-slate-200 bg-slate-50/50 p-6 shadow-2xl shadow-slate-200/50 flex items-center justify-center lg:order-first w-full relative overflow-visible">
                            <SpinningGlobe />
                        </div>
                        <div className="space-y-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Conversion Recovery</p>
                            <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                Watch the Subscription Climb in Real Time.
                            </h3>
                        </div>
                    </div>

                </div>
            </section>

            {/* Interactive Features tab section */}
            <section className="landing-section relative z-10 overflow-hidden bg-transparent px-5 py-20 sm:px-8 sm:py-24 lg:px-10 border-t border-slate-200/50">
                <div className="mx-auto max-w-7xl">
                    <div className="grid gap-12 lg:grid-cols-[0.45fr_0.55fr] lg:items-center">
                        
                        {/* Left Column: Headline and Tabs */}
                        <div className="space-y-8">
                            <div className="space-y-4">
                                <h2 className="font-display text-4xl font-extrabold leading-tight tracking-tight text-slate-950">
                                    Full Toolbox For Teams
                                </h2>

                            </div>
                            
                            {/* Vertical Tabs stack */}
                            <div className="flex flex-col gap-3">
                                {[
                                    {
                                        id: 'replay',
                                        title: 'User Recording',
                                        description: 'Watch the exact user struggle, rage clicks, and console exceptions leading up to the abandoned checkout or payment gateway timeout.',
                                        href: '/web-session-replay',
                                        icon: Video,
                                        image: SESSION_REPLAY_IMAGE,
                                        imageAlt: 'User recording workbench'
                                    },
                                    {
                                        id: 'heatmaps',
                                        title: 'Heatmaps',
                                        description: 'Visualize click hotspots, scroll depths, and touch attention zones to see which links are clicked and which are ignored.',
                                        href: '/heatmaps',
                                        icon: Flame,
                                        image: HEATMAPS_IMAGE,
                                        imageAlt: 'Click and scroll heatmaps'
                                    },
                                    {
                                        id: 'api',
                                        title: 'API Endpoint Insights',
                                        description: 'Track endpoint volume, latency, failure codes, and performance degradation while keeping the affected user session evidence close.',
                                        href: '/api-endpoint-insights',
                                        icon: Database,
                                        image: API_INSIGHTS_IMAGE,
                                        imageAlt: 'API endpoint insights view'
                                    },
                                    {
                                        id: 'stability',
                                        title: 'Stability Monitoring',
                                        description: 'Connect checkout API crashes, ANRs, network errors, and database bottlenecks directly to the user sessions they impacted.',
                                        href: '/stability-monitoring',
                                        icon: ShieldAlert,
                                        image: STABILITY_IMAGE,
                                        imageAlt: 'Stability monitoring interface'
                                    },
                                    {
                                        id: 'geo',
                                        title: 'Geographic Intelligence',
                                        description: 'Visualize conversion rates, checkout speed, and regional payment gateway failures on a real-time world map.',
                                        href: '/geographic-analytics',
                                        icon: Globe,
                                        image: GEO_IMAGE,
                                        imageAlt: 'Geographic recovery map'
                                    }
                                ].map((tab) => {
                                    const isActive = activeFeatureTab === tab.id;
                                    const Icon = tab.icon;
                                    
                                    return (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveFeatureTab(tab.id as 'replay' | 'heatmaps' | 'api' | 'stability' | 'geo')}
                                            className={`w-full flex flex-col items-start gap-2.5 rounded-2xl p-5 text-left transition-all duration-300 border ${
                                                isActive
                                                    ? 'bg-white border-slate-200/80 shadow-lg shadow-slate-100/40 text-slate-950'
                                                    : 'bg-transparent border-transparent text-slate-650 hover:text-slate-950 hover:bg-white/30'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`h-8 w-8 rounded-lg flex items-center justify-center border shrink-0 transition-colors ${
                                                    isActive ? 'bg-blue-50 border-blue-100 text-blue-600' : 'bg-slate-50 border-slate-100 text-slate-500'
                                                }`}>
                                                    <Icon className="h-4 w-4" />
                                                </div>
                                                <span className="font-bold text-base">{tab.title}</span>
                                            </div>
                                            
                                            {isActive && (
                                                <div className="pl-11 pr-2 space-y-3">
                                                    <p className="text-sm font-medium leading-relaxed text-slate-600">
                                                        {tab.description}
                                                    </p>
                                                    <Link
                                                        to={tab.href}
                                                        className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 transition"
                                                    >
                                                        <span>Learn more</span>
                                                        <ArrowRight className="h-3 w-3" />
                                                    </Link>
                                                </div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        
                        {/* Right Column: Active Image Display */}
                        <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2.5 shadow-2xl shadow-slate-200/70">
                            {[
                                { id: 'replay', image: SESSION_REPLAY_IMAGE, alt: 'User recording workbench' },
                                { id: 'heatmaps', image: HEATMAPS_IMAGE, alt: 'Heatmaps attention mapping' },
                                { id: 'api', image: API_INSIGHTS_IMAGE, alt: 'API endpoint insights' },
                                { id: 'stability', image: STABILITY_IMAGE, alt: 'Stability monitoring' },
                                { id: 'geo', image: GEO_IMAGE, alt: 'Geographic recovery map' }
                            ].map((item) => {
                                const isActive = activeFeatureTab === item.id;
                                if (!isActive) return null;
                                return (
                                    <img
                                        key={item.id}
                                        src={item.image}
                                        alt={item.alt}
                                        className="w-full rounded-[1.35rem] object-cover"
                                    />
                                );
                            })}
                        </div>
                        
                    </div>
                </div>
            </section>

            {/* Bottom Call-To-Action (CTA) */}
                <section className="landing-section landing-sdk-section relative z-10 overflow-hidden bg-transparent px-5 py-24 sm:px-8 sm:py-28 lg:px-10">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-200/20 to-transparent" aria-hidden="true" />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(245,158,11,0.015),transparent_31%),radial-gradient(circle_at_82%_20%,rgba(37,99,235,0.015),transparent_33%),radial-gradient(circle_at_50%_88%,rgba(16,185,129,0.015),transparent_35%)]" aria-hidden="true" />
                <div className="relative z-10 mx-auto max-w-6xl">
                    {/* Header */}
                    <div className="mx-auto max-w-3xl text-center mb-16">
                        <h2 className="font-display text-4xl font-extrabold leading-tight tracking-tight bg-gradient-to-br from-slate-950 via-blue-900 to-emerald-700 bg-clip-text text-transparent sm:text-5xl">
                            Easy Installation. Fast Revenue Boost.
                        </h2>
                        <p className="mt-4 text-base font-medium leading-relaxed text-slate-500 sm:text-lg">
                            Integrate our lightweight SDK to automatically record user drop-offs and compile exact, high-fidelity context packets.
                        </p>
                    </div>

                    {/* Interactive Playground Grid */}
                    <div className="landing-sdk-playground grid items-center gap-8 rounded-3xl border border-slate-200/80 bg-white/45 p-6 shadow-xl ring-1 ring-slate-100/5 backdrop-blur-md sm:p-8 lg:grid-cols-[1fr_2fr]">
                        
                        {/* Left Column: Platform selectors */}
                        <div className="flex flex-col gap-3 justify-center">
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 px-2">Select Platform</h3>
                            {sdkPlatforms.map((platform) => {
                                const isActive = activeSdkPlatform === platform.id;
                                const Icon = platform.icon;
                                
                                return (
                                    <button
                                        key={platform.id}
                                        onClick={() => {
                                            setActiveSdkPlatform(platform.id as 'shopify' | 'nextjs' | 'reactnative' | 'swift' | 'vue');
                                            setCopied(false);
                                        }}
                                        className={`w-full flex items-center gap-4 rounded-xl p-4 text-left border transition-all duration-300 ${
                                            isActive
                                                ? 'bg-white border-blue-200 shadow-md shadow-blue-100/30 scale-[1.01] text-blue-700'
                                                : 'bg-transparent border-transparent text-slate-500 hover:text-slate-950 hover:bg-white/35 hover:border-slate-200/50'
                                        }`}
                                    >
                                        <div 
                                            className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 border transition-all duration-300 ${
                                                isActive ? 'bg-slate-50/50 border-slate-200' : 'bg-slate-50 border-slate-200/60 opacity-60'
                                            }`}
                                            style={{ color: platform.brandColor }}
                                        >
                                            <Icon className="h-4 w-4" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-bold leading-none">{platform.title}</h4>
                                            <p className="text-xs text-slate-400 mt-1.5 font-mono">
                                                {platform.subtitle}
                                            </p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Right Column: Code block */}
                        <div className="landing-sdk-code-panel group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl transition-all duration-300 hover:shadow-blue-500/10">
                            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/50 px-4 py-3">
                                <div className="flex min-w-0 items-center gap-3">
                                    <div className="flex shrink-0 gap-2">
                                        <div className="h-3 w-3 rounded-full border border-white/10 bg-slate-700" />
                                        <div className="h-3 w-3 rounded-full border border-white/10 bg-slate-700" />
                                        <div className="h-3 w-3 rounded-full border border-white/10 bg-slate-700" />
                                    </div>
                                    <span className="min-w-0 truncate font-mono text-xs font-medium text-slate-400">
                                        {activeSdk.fileName}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    aria-label="Copy SDK setup code"
                                    title="Copy SDK setup code"
                                    onClick={() => void copyToClipboard(activeSdkSetup)}
                                    className={`flex shrink-0 items-center gap-1.5 rounded-md border border-slate-500 bg-slate-800 px-3 py-1.5 font-sans text-xs font-semibold text-white shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-700 ${
                                        copied ? '!border-emerald-500/50 !bg-emerald-500/10 !text-emerald-400 hover:!bg-emerald-500/20' : ''
                                    }`}
                                >
                                    {copied ? (
                                        <>
                                            <Check size={14} />
                                            <span>Copied</span>
                                        </>
                                    ) : (
                                        <>
                                            <Copy size={14} />
                                            <span>Copy</span>
                                        </>
                                    )}
                                </button>
                            </div>
                            <div className="border-b border-slate-800 bg-slate-950/80">
                                <div className="flex items-center justify-between border-b border-white/10 px-5 py-2">
                                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                        Terminal
                                    </span>

                                </div>
                                <div className="space-y-1.5 px-5 py-3 font-mono text-sm font-semibold">
                                    {activeSdk.terminalCommands.map((command) => (
                                        <div key={command} className="flex min-w-0 gap-2">
                                            <span className="shrink-0 select-none text-emerald-300">$</span>
                                            <span className="break-all text-slate-100">{command}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="overflow-x-auto p-5 text-sm font-mono leading-relaxed">
                                <div className="min-w-fit">
                                    <CodeBlock code={activeSdk.code} language={activeSdkLanguage} />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Action Buttons below playground */}
                    <div className="mt-12 flex flex-col items-center justify-center gap-4 sm:flex-row">
                        <Link
                            to={LOGIN_PATH}
                            className="group inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full border border-slate-950 bg-slate-950 px-8 text-base font-bold text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)] ring-1 ring-slate-950/10 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-800 hover:bg-slate-800 hover:shadow-[0_20px_44px_rgba(15,23,42,0.24)] active:translate-y-0 sm:w-auto"
                        >
                            Get Started
                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                        <Link
                            to="/how-it-works"
                            className="group inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full border border-slate-300/70 bg-white/50 px-8 text-base font-bold text-slate-700 shadow-sm shadow-slate-200/40 ring-1 ring-slate-400/10 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white/75 hover:shadow-md active:translate-y-0 sm:w-auto"
                        >
                            How it Works
                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                    </div>
                </div>
                </section>

                {/* FAQ Section */}
                <FaqSection />
            </div>
            </div>
        </div>
    );
};
