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

/**
 * Sankey-style checkout funnel — Before vs After.
 * Each panel draws a left-to-right flow: the full-height source bar (Add to Cart)
 * splits into a Checkout ribbon and a Drop-off ribbon via smooth bezier curves,
 * exactly like a real Sankey/alluvial diagram.
 */
const SankeyPanel: React.FC<{
    title: string;
    addToCart: number;
    checkout: number;
    accent: string;
    accentLight: string;
    dropColor: string;
    dropLight: string;
}> = ({ title, addToCart, checkout, accent, accentLight, dropColor, dropLight }) => {
    const dropOff = addToCart - checkout;
    const total = addToCart;

    // ── Layout constants ──────────────────────────────────────────
    // W/H are the inner chart area. We add a left pad for the source
    // label and a right pad for dest labels — kept inside viewBox so
    // nothing ever clips.
    const PAD_LEFT  = 72;   // room for "6,810 / to Cart"
    const PAD_RIGHT = 80;   // room for "4,319 / Checkout"
    const TITLE_H   = 32;   // space above chart for the panel title
    const CHART_H   = 200;
    const W = PAD_LEFT + 400 + PAD_RIGHT;   // total SVG width
    const H = TITLE_H + CHART_H + 16;       // total SVG height

    const barW   = 10;
    const sourceX = PAD_LEFT;
    const destX   = W - PAD_RIGHT - barW;
    const sourceH = CHART_H;
    const sourceTop = TITLE_H;

    // Ribbon heights
    const checkoutH = (checkout / total) * sourceH;
    const dropH     = (dropOff  / total) * sourceH;

    const gap        = 12;
    const checkoutTop = sourceTop;
    const dropTop     = checkoutTop + checkoutH + gap;

    const cx = (destX - sourceX - barW) * 0.42;

    const checkoutPath = [
        `M ${sourceX + barW} ${sourceTop}`,
        `C ${sourceX + barW + cx} ${sourceTop}, ${destX - cx} ${checkoutTop}, ${destX} ${checkoutTop}`,
        `L ${destX} ${checkoutTop + checkoutH}`,
        `C ${destX - cx} ${checkoutTop + checkoutH}, ${sourceX + barW + cx} ${sourceTop + checkoutH}, ${sourceX + barW} ${sourceTop + checkoutH}`,
        'Z',
    ].join(' ');

    const dropPath = [
        `M ${sourceX + barW} ${sourceTop + checkoutH}`,
        `C ${sourceX + barW + cx} ${sourceTop + checkoutH}, ${destX - cx} ${dropTop}, ${destX} ${dropTop}`,
        `L ${destX} ${dropTop + dropH}`,
        `C ${destX - cx} ${dropTop + dropH}, ${sourceX + barW + cx} ${sourceTop + sourceH}, ${sourceX + barW} ${sourceTop + sourceH}`,
        'Z',
    ].join(' ');

    // Vertical midpoints for labels
    const srcMid      = sourceTop + sourceH / 2;
    const checkoutMid = checkoutTop + checkoutH / 2;
    const dropMid     = dropTop + dropH / 2;

    return (
        <div className="flex-1 min-w-0">
            {/* SVG carries everything — title included — so both panels are
                always the same height and pixel-aligned. overflow visible is
                a no-op here since everything is inside the viewBox. */}
            <svg
                viewBox={`0 0 ${W} ${H}`}
                className="w-full"
                style={{ display: 'block' }}
                aria-label={title}
            >
                {/* Panel title */}
                <text
                    x={PAD_LEFT}
                    y={16}
                    textAnchor="start"
                    dominantBaseline="middle"
                    fill="#94a3b8"
                    fontSize="11"
                    fontWeight="700"
                    letterSpacing="0.1em"
                    fontFamily="system-ui, sans-serif"
                    style={{ textTransform: 'uppercase' }}
                >
                    {title}
                </text>

                {/* ── Source bar ── */}
                <rect x={sourceX} y={sourceTop} width={barW} height={sourceH} rx={5} fill="#60a5fa" />

                {/* ── Checkout ribbon + bar ── */}
                <path d={checkoutPath} fill={accentLight} />
                <rect x={destX} y={checkoutTop} width={barW} height={checkoutH} rx={5} fill={accent} />

                {/* ── Drop-off ribbon + bar ── */}
                <path d={dropPath} fill={dropLight} />
                <rect x={destX} y={dropTop} width={barW} height={dropH} rx={5} fill={dropColor} />

                {/* ── Source label (left of source bar) ── */}
                <text x={sourceX - 12} y={srcMid - 9} textAnchor="end" dominantBaseline="middle"
                    fill="#e2e8f0" fontSize="15" fontWeight="700" fontFamily="system-ui, sans-serif">
                    {addToCart.toLocaleString()}
                </text>
                <text x={sourceX - 12} y={srcMid + 9} textAnchor="end" dominantBaseline="middle"
                    fill="#64748b" fontSize="11" fontFamily="system-ui, sans-serif">
                    to Cart
                </text>

                {/* ── Checkout label (right of dest bar) ── */}
                <text x={destX + barW + 12} y={checkoutMid - 9} textAnchor="start" dominantBaseline="middle"
                    fill={accent} fontSize="17" fontWeight="700" fontFamily="system-ui, sans-serif">
                    {checkout.toLocaleString()}
                </text>
                <text x={destX + barW + 12} y={checkoutMid + 9} textAnchor="start" dominantBaseline="middle"
                    fill="#64748b" fontSize="11" fontFamily="system-ui, sans-serif">
                    Checkout
                </text>

                {/* ── Drop-off label (right of dest bar) ── */}
                <text x={destX + barW + 12} y={dropMid - 9} textAnchor="start" dominantBaseline="middle"
                    fill="#94a3b8" fontSize="15" fontWeight="600" fontFamily="system-ui, sans-serif">
                    {dropOff.toLocaleString()}
                </text>
                <text x={destX + barW + 12} y={dropMid + 9} textAnchor="start" dominantBaseline="middle"
                    fill="#475569" fontSize="11" fontFamily="system-ui, sans-serif">
                    Drop-off
                </text>
            </svg>
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
        <div className="landing-home relative isolate w-full overflow-x-hidden bg-[#f9f9fb] text-slate-900">

            <div className="relative z-10">
                {/* Hero Section */}
                <section className="landing-hero-section relative z-20 overflow-hidden px-5 pb-28 pt-36 text-center sm:px-8 sm:pb-40 sm:pt-44 lg:px-10 lg:pb-44 lg:pt-48">
                    <LandingThreeField variant="landing-hero" seed={11} />

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-36 bg-gradient-to-t from-white/75 via-white/35 to-transparent" aria-hidden="true" />

                    <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center">
                        <h1 className="landing-hero-title mx-auto max-w-6xl font-display text-[1.68rem] font-extrabold leading-[1.04] tracking-normal text-slate-950 min-[360px]:text-[1.95rem] min-[430px]:text-[2.2rem] sm:text-[3.05rem] md:text-[3.65rem] lg:text-[4.45rem] xl:text-[5.35rem]">
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
                                className="inline-flex min-h-[52px] w-full min-w-[190px] items-center justify-center rounded-full border border-slate-300/80 bg-white/60 backdrop-blur-md px-7 text-[0.95rem] font-bold text-slate-700 shadow-sm shadow-slate-200/40 ring-1 ring-slate-400/10 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white/80 hover:shadow-md active:translate-y-0 sm:min-h-[58px] sm:w-auto sm:px-8 sm:text-base"
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

            <div className="landing-after-hero relative z-10 overflow-hidden bg-[#f9f9fb]">
                <LandingThreeField variant="landing-sparse" seed={307} className="landing-after-hero-field" />
                <div className="pointer-events-none absolute inset-x-0 top-[33rem] z-[1] h-px bg-gradient-to-r from-transparent via-slate-200/60 to-transparent" aria-hidden="true" />

            {/* Detailed product value sections for founders & revenue recovery */}
            <section className="landing-section relative z-10 overflow-hidden bg-transparent px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
                <div className="mx-auto max-w-7xl space-y-32">
                    
                    {/* Section 1: Checkout Funnel Leak Detection */}
                    <div className="grid gap-12 lg:grid-cols-[0.42fr_0.58fr] lg:items-center">
                        <div className="space-y-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Revenue Leak Tracking</p>
                            <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                Fix the Exact Barriers Costing Revenue.
                            </h3>
                        </div>
                        {/* Outer card — phone left, single insight card right */}
                        <div className="rounded-[1.75rem] border border-slate-200/60 bg-[#f0f1f3] shadow-[0_20px_40px_rgba(15,23,42,0.08)] overflow-hidden flex items-start sm:items-stretch gap-0">
                            {/* Phone — flush left, no padding needed */}
                            <div className="flex-shrink-0 self-stretch flex items-end pl-5 pb-0 pt-5">
                                <div className="w-[190px] rounded-t-[2rem] bg-slate-950 p-[5px] pb-0 shadow-[0_-12px_48px_rgba(15,23,42,0.28)] ring-1 ring-white/[0.06]">
                                    <div className="rounded-t-[1.65rem] overflow-hidden bg-white">
                                        {/* Status bar */}
                                        <div className="relative flex items-center justify-between bg-white px-3 pt-2 pb-1.5">
                                            <span className="text-[8px] font-bold text-slate-800">9:41</span>
                                            <div className="absolute left-1/2 -translate-x-1/2 top-0 w-16 h-3.5 bg-slate-950 rounded-b-full" />
                                            <div className="h-1.5 w-3.5 rounded-[2px] border border-slate-400 p-px">
                                                <div className="h-full w-3/4 rounded-[1px] bg-slate-500" />
                                            </div>
                                        </div>
                                        {/* Nav bar */}
                                        <div className="flex items-center justify-between bg-white border-b border-slate-100 px-3 py-1.5">
                                            <span className="text-[8px] font-medium text-slate-500">Explore</span>
                                            <span className="text-[9px] font-extrabold text-slate-900">Marketplace</span>
                                            <div className="relative">
                                                <ShoppingBag className="h-3.5 w-3.5 text-slate-700" />
                                                <div className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-red-500 border border-white" />
                                            </div>
                                        </div>
                                        {/* Product image with dead-tap */}
                                        <div className="relative">
                                            <img
                                                src={MOUNTAIN_CARD_IMAGE}
                                                alt="Rainier Climber Pass marketplace listing"
                                                className="w-full h-[140px] object-cover"
                                            />
                                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                                                <div className="h-10 w-10 rounded-full border-2 border-white/60 bg-white/20" />
                                                <div className="absolute inset-0 h-10 w-10 rounded-full border border-white/30 scale-[1.6]" />
                                            </div>
                                        </div>
                                        {/* Product info */}
                                        <div className="px-3 py-2.5 space-y-1.5 bg-white">
                                            <div className="flex items-start justify-between gap-1">
                                                <div>
                                                    <div className="text-[9px] font-extrabold text-slate-900 leading-tight">Rainier Climber Pass</div>
                                                    <div className="text-[7px] text-slate-400 mt-0.5">Outdoor Adventures</div>
                                                </div>
                                                <div className="text-[10px] font-black text-slate-900 shrink-0">$196</div>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {[1,2,3,4,5].map(i => (
                                                    <div key={i} className="h-1.5 w-1.5 rounded-[1px] bg-amber-400" />
                                                ))}
                                                <span className="text-[7px] text-slate-400 ml-0.5">1,284</span>
                                            </div>
                                            <button type="button" className="w-full h-6 bg-slate-950 text-white rounded-lg text-[8px] font-bold cursor-not-allowed opacity-75">
                                                Add to Cart
                                            </button>
                                            <div className="pt-1 space-y-1.5">
                                                <div className="h-2 w-full rounded bg-slate-100" />
                                                <div className="h-2 w-4/5 rounded bg-slate-100" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Single insight card — fills remaining space */}
                            <div className="flex-1 min-w-0 flex items-center p-2.5 min-[390px]:p-4">
                                <div className="w-full bg-white rounded-2xl border border-slate-200 shadow-[0_8px_24px_rgba(15,23,42,0.10)] p-3 min-[390px]:p-4 space-y-2.5 min-[390px]:space-y-3">
                                    {/* Header */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                            <div className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                            <span className="text-[8px] font-semibold text-slate-500 uppercase tracking-wide">Friction detected</span>
                                        </div>
                                        <span className="text-[8px] font-mono text-slate-400">#9201</span>
                                    </div>
                                    {/* Issue */}
                                    <div>
                                        <div className="text-[11px] font-extrabold text-slate-900 leading-snug">Dead click on product image</div>
                                        <div className="mt-1 text-[9px] text-slate-500 leading-relaxed">42% of users tap the photo expecting it to open checkout. Non-interactive — they abandon.</div>
                                    </div>
                                    {/* Revenue at risk */}
                                    <div className="flex flex-col gap-0.5 rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-2 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between min-[390px]:gap-2 min-[390px]:px-3">
                                        <span className="text-[7px] font-semibold uppercase text-emerald-600/70">Revenue at risk</span>
                                        <span className="whitespace-nowrap text-[11px] font-bold text-emerald-700">$3,136 / mo</span>
                                    </div>
                                    {/* Divider + fix info */}
                                    <div className="flex items-center justify-between text-[8px] text-slate-400 border-t border-slate-100 pt-2.5">
                                        <span>Effort: <span className="text-slate-600 font-semibold">1–2 hrs</span></span>
                                        <span>Impact: <span className="text-emerald-600 font-semibold">High</span></span>
                                    </div>
                                    {/* Buttons */}
                                    <div className="space-y-1.5">
                                        <Link
                                            to="/demo/general"
                                            className="flex min-h-7 w-full items-center justify-center gap-1 rounded-xl bg-slate-950 px-1.5 text-[8px] font-bold leading-none text-white transition hover:bg-slate-800 min-[390px]:gap-1.5 min-[390px]:text-[9px]"
                                        >
                                            <Play className="h-2 w-2 fill-current" />
                                            <span className="whitespace-nowrap min-[390px]:hidden">Session Replay</span>
                                            <span className="hidden whitespace-nowrap min-[390px]:inline">Watch Session Replay</span>
                                        </Link>
                                        <button
                                            type="button"
                                            className="flex min-h-7 w-full items-center justify-center rounded-xl border border-slate-950/10 bg-white px-1.5 text-[8px] font-bold leading-none text-slate-800 shadow-sm transition hover:bg-slate-50 min-[390px]:text-[9px]"
                                        >
                                            <span className="whitespace-nowrap">Implement Fix</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Section 2: ROAS & Conversion Lift */}
                    <div className="grid gap-12 lg:grid-cols-[0.58fr_0.42fr] lg:items-center">
                        <div ref={chartRef} className="rounded-[1.75rem] border border-slate-200/60 bg-white/80 backdrop-blur-xl shadow-[0_20px_40px_rgba(15,23,42,0.08)] lg:order-first overflow-hidden">
                            {/* Stats summary bar — clean analytics tool style */}
                            <div className="grid grid-cols-3 border-b border-slate-100 divide-x divide-slate-100">
                                <div className="px-4 py-3.5">
                                    <div className="text-[9px] font-semibold text-slate-400">Before</div>
                                    <div className="text-sm font-bold text-slate-800 mt-0.5">0.3x ROAS</div>
                                </div>
                                <div className="px-4 py-3.5">
                                    <div className="text-[9px] font-semibold text-slate-400">After</div>
                                    <div className="text-sm font-bold text-slate-800 mt-0.5">1.7x ROAS</div>
                                </div>
                                <div className="px-4 py-3.5">
                                    <div className="text-[9px] font-semibold text-slate-400">Change</div>
                                    <div className="text-sm font-bold text-emerald-600 mt-0.5">+466%</div>
                                </div>
                            </div>
                            <div className="p-6">
                            <div className="flex items-center justify-between pb-4 mb-4">
                                <div>
                                    <div className="text-sm font-semibold text-slate-700">Return on Ad Spend</div>
                                    <div className="text-[10px] text-slate-400 mt-0.5">Mon — Sun · Last 7 days</div>
                                </div>
                                <div className="flex items-center gap-4 text-[10px]">
                                    <div className="flex items-center gap-1.5">
                                        <div className="h-px w-6 bg-slate-300" style={{ borderTop: '2px dashed #cbd5e1' }} />
                                        <span className="text-slate-400">Without fix</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="h-0.5 w-6 bg-emerald-500 rounded-full" />
                                        <span className="text-slate-400">With Rejourney</span>
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
                                <div className="absolute left-[50.0%] top-0 bottom-6 w-px border-l border-dashed border-slate-400/60 z-10 pointer-events-none" />
                                <div className="absolute left-[50.0%] top-2 -translate-x-1/2 bg-slate-800 text-white text-[7px] font-semibold px-1.5 py-0.5 rounded shadow-sm z-20 whitespace-nowrap select-none tracking-wide">
                                    Rejourney fix deployed
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
                                    <span className="absolute left-[50.0%] -translate-x-1/2 text-slate-900 bg-slate-100/80 px-1.5 py-0.5 rounded font-extrabold border border-slate-200/60">Thu</span>
                                    <span className="absolute left-[62.5%] -translate-x-1/2">Fri</span>
                                    <span className="absolute left-[75.0%] -translate-x-1/2">Sat</span>
                                    <span className="absolute left-[87.5%] -translate-x-1/2">Sun</span>
                                </div>
                            </div>
                            
                            {/* Annotations */}
                            <div className="mt-5 border-t border-slate-100 pt-4 flex items-center justify-between">
                                <div className="flex items-center gap-5 text-[10px] text-slate-500">
                                    <span>Before: <span className="font-semibold text-slate-700">0.3x ROAS · $48k ad spend lost</span></span>
                                    <span className="text-slate-200">|</span>
                                    <span>After: <span className="font-semibold text-emerald-600">1.7x ROAS · +$31k recovered</span></span>
                                </div>
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
                    <style dangerouslySetInnerHTML={{ __html: `
                        @keyframes fadeSlideIn {
                            from { opacity: 0; transform: translateY(6px); }
                            to   { opacity: 1; transform: translateY(0); }
                        }
                    `}} />
                    <div className="grid gap-12 lg:grid-cols-[0.42fr_0.58fr] lg:items-center">
                        <div className="space-y-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Subscription Churn Recovery</p>
                            <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                Prevent Friction Churn and Ensure Renewals.
                            </h3>
                        </div>
                        <div className="rounded-[1.75rem] border border-slate-200/60 bg-white/80 backdrop-blur-xl shadow-[0_20px_40px_rgba(15,23,42,0.08)] overflow-hidden">
                            {/* Card header */}
                            <div className="flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3.5">
                                <div className="flex items-center gap-2.5">
                                    <div className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                                    <span className="text-xs font-bold text-slate-700">Session Replay — Churn Event</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
                                    <Smartphone className="h-3 w-3" />
                                    <span>iOS · 2m 14s</span>
                                </div>
                            </div>

                            <div className="p-5 space-y-4">
                                {/* Session event timeline — rows appear sequentially */}
                                <div className="space-y-1.5">
                                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-2">Session Timeline</div>
                                    {[
                                        { time: '0:04', event: 'App opened', type: 'neutral' },
                                        { time: '0:22', event: 'Viewed Maui Shore Explorer', type: 'neutral' },
                                        { time: '0:41', event: 'Tapped "Pro Explorer" pricing', type: 'neutral' },
                                        { time: '0:55', event: 'Tapped "Upgrade Subscription"', type: 'warn' },
                                        { time: '1:07', event: 'Tapped again — no response', type: 'error' },
                                        { time: '1:12', event: 'Tapped 6 more times (8 total)', type: 'error' },
                                        { time: '1:24', event: 'User closed app', type: 'error' },
                                    ].map((ev, i) => (
                                        <div
                                            key={ev.time}
                                            className="flex items-center gap-3 opacity-0"
                                            style={{
                                                animation: `fadeSlideIn 0.3s ease-out forwards`,
                                                animationDelay: `${i * 0.18}s`,
                                            }}
                                        >
                                            <span className="w-8 shrink-0 text-[9px] font-mono text-slate-400 text-right">{ev.time}</span>
                                            <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${ev.type === 'error' ? 'bg-red-500' : ev.type === 'warn' ? 'bg-amber-400' : 'bg-slate-300'}`} />
                                            <span className={`text-[11px] font-medium ${ev.type === 'error' ? 'text-red-600 font-semibold' : ev.type === 'warn' ? 'text-amber-700' : 'text-slate-500'}`}>{ev.event}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Impact callout */}
                                <div className="flex items-start gap-3 rounded-xl border border-red-200/70 bg-red-50/60 p-3.5">
                                    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 text-[10px] font-bold">!</div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[11px] font-bold text-red-800">Payment gateway timeout — 12s avg</span>
                                            <span className="text-[10px] font-bold text-red-500">#RC-8042</span>
                                        </div>
                                        <p className="mt-0.5 text-[10px] text-red-700/80 leading-relaxed">
                                            Upgrade button unresponsive. Gateway failing silently on iOS 17.
                                        </p>
                                    </div>
                                </div>

                                {/* Bottom action row */}
                                <div className="flex items-center justify-between rounded-xl bg-emerald-50/70 border border-emerald-100/80 px-4 py-3">
                                    <div>
                                        <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-600/70">Est. LTV at risk / month</div>
                                        <div className="text-xl font-extrabold text-emerald-700 mt-0.5">$1,440</div>
                                    </div>
                                    <Link
                                        to="/demo/general"
                                        className="inline-flex items-center gap-1.5 rounded-full bg-slate-950 hover:bg-slate-800 px-3.5 py-1.5 text-[11px] font-bold text-white shadow-sm transition"
                                    >
                                        <Play className="h-2.5 w-2.5 fill-current" />
                                        <span>Watch Replay</span>
                                    </Link>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Section 4: Revenue Lift Verification (Release Markers) */}
                    <div className="grid gap-12 lg:grid-cols-[0.58fr_0.42fr] lg:items-center">
                        <div className="rounded-[1.75rem] border border-slate-200/60 bg-white/70 backdrop-blur-xl p-6 shadow-[0_20px_40px_rgba(15,23,42,0.08)] flex items-center justify-center lg:order-first w-full relative overflow-visible">
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
                        <div className="overflow-hidden rounded-[1.75rem] border border-slate-200/60 bg-white/70 backdrop-blur-xl p-2.5 shadow-[0_20px_40px_rgba(15,23,42,0.08)]">
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

            {/* ── Success Story: Burst Creatine ── */}
            <section className="landing-section relative z-10 overflow-hidden px-5 py-24 sm:px-8 sm:py-28 lg:px-10 border-t border-slate-200/50">
                <div className="mx-auto max-w-5xl">

                    {/* Case study card — dark background to visually separate from the page */}
                    <div className="overflow-hidden rounded-3xl bg-slate-950 px-8 py-14 sm:px-14 sm:py-16">

                        {/* Top: logo circle + headline */}
                        <div className="flex flex-col items-center text-center gap-5 mb-14">
                            <div className="h-16 w-16 rounded-full overflow-hidden border-2 border-white/10 shadow-lg shrink-0">
                                <img
                                    src="/images/burst-creatine-logo-red.png"
                                    alt="Burst Creatine"
                                    className="h-full w-full object-cover"
                                />
                            </div>
                            <div className="space-y-3">
                                <h2 className="font-display text-2xl font-extrabold leading-tight tracking-tight text-white sm:text-3xl">
                                    Burst Creatine 103% Increase in Sales.
                                </h2>
                                <p className="max-w-lg mx-auto text-sm font-medium leading-relaxed text-slate-400">
                                    Rejourney surfaced the exact UX friction points causing drop-off. Simple fixes, no guesswork.
                                </p>
                            </div>
                        </div>

                        {/* Sankey diagrams — sit directly on the dark card, no nested panel */}
                        <div className="grid gap-8 lg:grid-cols-2">
                            <SankeyPanel
                                title="Before Rejourney"
                                addToCart={6810}
                                checkout={2130}
                                accent="#f87171"
                                accentLight="rgba(248,113,113,0.22)"
                                dropColor="#94a3b8"
                                dropLight="rgba(148,163,184,0.14)"
                            />
                            <SankeyPanel
                                title="After Rejourney"
                                addToCart={6810}
                                checkout={4319}
                                accent="#34d399"
                                accentLight="rgba(52,211,153,0.22)"
                                dropColor="#94a3b8"
                                dropLight="rgba(148,163,184,0.12)"
                            />
                        </div>

                        {/* Result line */}
                        <p className="mt-8 text-center text-sm font-medium text-slate-400">
                        Same <span style={{ color: '#0081FB' }} className="font-semibold">Meta</span> Ads Budget. <span className="text-emerald-400 font-bold">+2,189 more checkouts</span> from fixing easy UX leaks.
                        </p>

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
                        <h2 className="font-display text-4xl font-extrabold leading-tight tracking-tight text-slate-950 sm:text-5xl">
                            Easy Installation. Fix Revenue Leaks.
                        </h2>
                        <p className="mt-4 text-base font-medium leading-relaxed text-slate-500 sm:text-lg">
                            Integrate our lightweight SDK to automatically record user drop-offs and compile exact, high-fidelity context packets.
                        </p>
                    </div>

                    {/* Interactive Playground Grid */}
                    <div className="landing-sdk-playground grid items-center gap-8 rounded-3xl border border-slate-200/60 bg-white/45 p-6 shadow-xl ring-1 ring-slate-100/5 backdrop-blur-xl sm:p-8 lg:grid-cols-[1fr_2fr]">
                        
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
                                        copied ? '!border-slate-400 !bg-slate-700 !text-white' : ''
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
                            className="group inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full border border-slate-300/80 bg-white/60 backdrop-blur-md px-8 text-base font-bold text-slate-700 shadow-sm shadow-slate-200/40 ring-1 ring-slate-400/10 transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white/80 hover:shadow-md active:translate-y-0 sm:w-auto"
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
