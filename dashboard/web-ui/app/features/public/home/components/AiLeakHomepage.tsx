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
    ChevronRight,
    Smartphone,
    ShoppingBag,
    ExternalLink,
    Workflow,
} from 'lucide-react';
import { getMarketingHomeCopy } from '~/shared/lib/internationalMarketing';

import {
    MarkAngular,
    MarkFlutter,
    MarkGatsby,
    MarkHydrogen,
    MarkNextJs,
    MarkReactNative,
    MarkRedux,
    MarkRemix,
    MarkShopify,
    MarkSvelte,
    MarkSwift,
    MarkVue,
} from './PlatformMarks';
import { FaqSection } from './FaqSection';
import { ComplianceSection } from './ComplianceSection';
import { PerformanceMetrics } from './PerformanceMetrics';
import { CodeBlock } from '~/shared/ui/core/CodeBlock';

const LOGIN_PATH = '/login';
const LANDING_IMAGE_VERSION = '20260619';
const landingImage = (path: string) => `${path}?v=${LANDING_IMAGE_VERSION}`;

const SESSION_REPLAY_IMAGE = landingImage('/images/landing-replay-workbench.webp');
const STABILITY_IMAGE = landingImage('/images/anr-issues.webp');
const GEO_IMAGE = landingImage('/images/geo-analytics.webp');
const HEATMAPS_IMAGE = landingImage('/images/engineering/heatmaps-attention-docs.webp');
const API_INSIGHTS_IMAGE = landingImage('/images/engineering/api-error-rate-spike.webp');
const LEAK_AUTOMATIONS_IMAGE = landingImage('/images/issues-feed.webp');
const MOUNTAIN_CARD_IMAGE = landingImage('/images/mountain_app_card.webp');
const BEACH_CARD_IMAGE = landingImage('/images/beach_app_card.webp');

const supportedPlatforms = [
    { label: 'Next.js / React', icon: MarkNextJs, color: '#0f172a', href: '/docs/web/getting-started#nextjs' },
    { label: 'Redux Toolkit', icon: MarkRedux, color: '#764abc', href: '/docs/web/getting-started#redux-and-redux-toolkit' },
    { label: 'React Native / Expo', icon: MarkReactNative, color: '#2563eb', href: '/docs/reactnative/overview' },
    { label: 'Flutter', icon: MarkFlutter, color: '#54c5f8', href: '/docs/flutter/overview' },
    { label: 'Swift', icon: MarkSwift, color: '#f97316', href: '/docs/swift/overview' },
    { label: 'Vue / Nuxt', icon: MarkVue, color: '#42b883', href: '/docs/web/getting-started#vue' },
    { label: 'Angular', icon: MarkAngular, color: '#dd0031', href: '/docs/web/getting-started#angular' },
    { label: 'SvelteKit', icon: MarkSvelte, color: '#ff3e00', href: '/docs/web/getting-started#svelte-sveltekit' },
    { label: 'Remix', icon: MarkRemix, color: '#0f172a', href: '/docs/web/getting-started#remix' },
    { label: 'Gatsby', icon: MarkGatsby, color: '#663399', href: '/docs/web/getting-started' },
    { label: 'Shopify', icon: MarkShopify, color: '#95bf47', href: '/docs/shopify/getting-started' },
    { label: 'Hydrogen', icon: MarkHydrogen, color: '#00a878', href: '/docs/web/getting-started' },
];

const sdkPlatforms = [
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
        id: 'flutter',
        title: 'Flutter',
        icon: MarkFlutter,
        brandColor: '#54c5f8',
        terminalCommands: ['flutter pub add rejourney'],
        subtitle: 'Native iOS & Android replay',
        fileName: 'main.dart',
        code: `import 'package:rejourney/rejourney.dart';

await Rejourney.init('pk_live_your_public_key');
await Rejourney.start();`
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
        id: 'redux',
        title: 'Redux Toolkit',
        icon: MarkRedux,
        brandColor: '#764abc',
        terminalCommands: ['npm install @rejourneyco/browser'],
        subtitle: 'Optional action + state replay',
        fileName: 'store.ts',
        code: `import { configureStore } from '@reduxjs/toolkit';
import { createRejourneyReduxMiddleware } from '@rejourneyco/browser/redux';

export const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
      createRejourneyReduxMiddleware({
        redactKeys: ['email'],
      }),
    ),
});`
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
    },
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
 * Sankey-style conversion funnel — Before vs After.
 * Each panel draws a left-to-right flow from a source action to a completed action,
 * then splits it into a completion ribbon and a Drop-off ribbon via smooth bezier curves,
 * exactly like a real Sankey/alluvial diagram.
 */
export const SankeyPanel: React.FC<{
    title: string;
    addToCart: number;
    checkout: number;
    accent: string;
    accentLight: string;
    dropColor: string;
    dropLight: string;
    sourceLabel?: string;
    completionLabel?: string;
}> = ({
    title,
    addToCart,
    checkout,
    accent,
    accentLight,
    dropColor,
    dropLight,
    sourceLabel = 'to Cart',
    completionLabel = 'Checkout',
}) => {
    const dropOff = addToCart - checkout;
    const total = addToCart;

    // ── Layout constants ──────────────────────────────────────────
    // W/H are the inner chart area. We add a left pad for the source
    // label and a right pad for dest labels — kept inside viewBox so
    // nothing ever clips.
    const PAD_LEFT  = 90;   // room for source value and label
    const PAD_RIGHT = 110;  // room for completed value and label
    const TITLE_H   = 32;   // space above chart for the panel title
    const CHART_H   = 200;
    const W = PAD_LEFT + 400 + PAD_RIGHT;   // total SVG width
    const H = TITLE_H + CHART_H + 36;       // total SVG height

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
                always the same height and pixel-aligned. */}
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
                    fill="#374151"
                    fontSize="11"
                    fontWeight="900"
                    letterSpacing="0.1em"
                    fontFamily="system-ui, sans-serif"
                    style={{ textTransform: 'uppercase' }}
                >
                    {title}
                </text>

                {/* ── Source bar ── */}
                <rect x={sourceX} y={sourceTop} width={barW} height={sourceH} rx={0} fill="#60a5fa" stroke="black" strokeWidth="1.5" />

                {/* ── Checkout ribbon + bar ── */}
                <path d={checkoutPath} fill={accentLight} stroke="black" strokeWidth="1.5" />
                <rect x={destX} y={checkoutTop} width={barW} height={checkoutH} rx={0} fill={accent} stroke="black" strokeWidth="1.5" />

                {/* ── Drop-off ribbon + bar ── */}
                <path d={dropPath} fill={dropLight} stroke="black" strokeWidth="1.5" />
                <rect x={destX} y={dropTop} width={barW} height={dropH} rx={0} fill={dropColor} stroke="black" strokeWidth="1.5" />

                {/* ── Source label (left of source bar) ── */}
                <text x={sourceX - 12} y={srcMid - 9} textAnchor="end" dominantBaseline="middle"
                    fill="black" fontSize="15" fontWeight="900" fontFamily="system-ui, sans-serif">
                    {addToCart.toLocaleString()}
                </text>
                <text x={sourceX - 12} y={srcMid + 9} textAnchor="end" dominantBaseline="middle"
                    fill="#4b5563" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif">
                    {sourceLabel}
                </text>

                {/* ── Checkout label (right of dest bar) ── */}
                <text x={destX + barW + 12} y={checkoutMid - 9} textAnchor="start" dominantBaseline="middle"
                    fill={accent === '#34d399' || accent === '#22c55e' ? '#15803d' : '#b91c1c'} fontSize="17" fontWeight="900" fontFamily="system-ui, sans-serif">
                    {checkout.toLocaleString()}
                </text>
                <text x={destX + barW + 12} y={checkoutMid + 9} textAnchor="start" dominantBaseline="middle"
                    fill="#4b5563" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif">
                    {completionLabel}
                </text>

                {/* ── Drop-off label (right of dest bar) ── */}
                <text x={destX + barW + 12} y={dropMid - 9} textAnchor="start" dominantBaseline="middle"
                    fill="#4b5563" fontSize="15" fontWeight="900" fontFamily="system-ui, sans-serif">
                    {dropOff.toLocaleString()}
                </text>
                <text x={destX + barW + 12} y={dropMid + 9} textAnchor="start" dominantBaseline="middle"
                    fill="#6b7280" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif">
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
    const [activeSdkPlatform, setActiveSdkPlatform] = useState<'shopify' | 'nextjs' | 'reactnative' | 'flutter' | 'redux' | 'swift' | 'vue'>('nextjs');
    const [copied, setCopied] = useState(false);
    const [catHasBeenPet, setCatHasBeenPet] = useState(false);

    const [activeFeatureTab, setActiveFeatureTab] = useState<'replay' | 'heatmaps' | 'api' | 'stability' | 'geo' | 'leaks'>('replay');
    const [activeSuccessStory, setActiveSuccessStory] = useState<'burst' | 'merch'>('burst');

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
        <div className="landing-home relative isolate w-full overflow-x-hidden bg-[#fdfbf7] text-slate-900">

            <div className="relative z-10">
                {/* Hero Section */}
                <section className="landing-hero-section relative z-20 overflow-hidden bg-[#fdfbf7] px-5 pb-16 pt-12 text-center sm:px-8 sm:pb-20 sm:pt-28 lg:px-10 lg:pb-24 lg:pt-32 xl:pb-28">

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-36 bg-gradient-to-t from-white/75 via-white/35 to-transparent" aria-hidden="true" />

                    <div className="relative z-10 mx-auto flex max-w-7xl flex-col items-center">
                        <h1 className="landing-hero-title mx-auto max-w-7xl text-balance font-display text-[clamp(1.875rem,9vw,3rem)] font-black leading-[0.98] tracking-[-0.045em] text-slate-950 sm:text-[clamp(3rem,6vw,4.75rem)]">
                            <span className="block font-semibold sm:inline">Lightweight</span>{' '}
                            <span className="whitespace-nowrap font-black">Product Analytics</span>
                        </h1>
                        <p className="landing-hero-subtitle mx-auto mt-8 max-w-2xl text-balance text-base font-medium leading-relaxed text-slate-600 sm:text-lg">
                            Tiny SDK. Big Impact.
                        </p>
                        {/* Action buttons matching style */}
                        <div className="landing-hero-actions mt-12 flex w-full max-w-[20.5rem] flex-col items-center justify-center gap-3 sm:w-auto sm:max-w-none sm:flex-row">
                            <Link
                                to={LOGIN_PATH}
                                className="group inline-flex min-h-[52px] w-full min-w-[190px] items-center justify-center gap-2 rounded-md border border-slate-950 bg-[#86efac] px-7 text-[0.95rem] font-extrabold uppercase text-black shadow-[2px_2px_0_#0f172a] transition-[background-color,box-shadow,transform] duration-200 motion-safe:hover:-translate-y-0.5 hover:bg-[#6ee7a0] active:translate-y-0 active:shadow-none sm:w-auto sm:px-8"
                            >
                                <span>Get Started $0</span>
                                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                            </Link>
                            <Link
                                to="/demo"
                                className="group inline-flex min-h-[52px] w-full min-w-[190px] items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-7 text-[0.95rem] font-extrabold uppercase text-black shadow-sm transition-[background-color,border-color,box-shadow,transform] duration-200 motion-safe:hover:-translate-y-0.5 hover:border-slate-400 hover:bg-[#ecfeff] hover:shadow-md active:translate-y-0 sm:w-auto sm:px-8"
                            >
                                <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-slate-900 text-white transition-transform duration-300 group-hover:scale-105">
                                    <Play className="ml-px h-3 w-3 fill-current" aria-hidden="true" />
                                </span>
                                Live Demo
                            </Link>
                        </div>

                        {/* Compliance & Data Sovereignty Trust Bar */}
                        <ComplianceSection />

                        <div className="landing-platforms mx-auto mt-16 flex w-full max-w-6xl flex-col items-center justify-center gap-3 border-t border-slate-200/70 pt-6">
                            <p className="text-[0.68rem] font-extrabold uppercase tracking-[0.18em] text-slate-400">
                                Supported platforms
                            </p>
                            <div className="landing-platform-marquee relative w-full overflow-hidden py-1">
                                <div className="landing-platform-marquee-track flex w-max items-center">
                                    {[0, 1].map((groupIndex) => (
                                        <div
                                            key={groupIndex}
                                            className="flex shrink-0 items-center gap-3 pr-3"
                                            aria-hidden={groupIndex === 1 ? true : undefined}
                                        >
                                            {supportedPlatforms.map((platform) => {
                                                const Icon = platform.icon;
                                                return (
                                                    <Link
                                                        key={platform.label}
                                                        to={platform.href}
                                                        aria-label={`${platform.label} setup documentation`}
                                                        tabIndex={groupIndex === 1 ? -1 : undefined}
                                                        className="group inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/75 px-3.5 text-xs font-extrabold text-slate-600 shadow-sm shadow-slate-200/60 ring-1 ring-white/60 backdrop-blur-sm transition-all duration-200 hover:border-indigo-200 hover:bg-white hover:text-indigo-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
                                                    >
                                                        <Icon className="h-4 w-4 shrink-0 transition-transform group-hover:scale-110" style={{ color: platform.color }} />
                                                        <span className="whitespace-nowrap">{platform.label}</span>
                                                    </Link>
                                                );
                                            })}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                </div>
            </section>

            <div className="landing-after-hero relative z-10 overflow-hidden bg-[#fdfbf7]">
                <div className="pointer-events-none absolute inset-x-0 top-[33rem] z-[1] h-px bg-gradient-to-r from-transparent via-slate-200/60 to-transparent" aria-hidden="true" />

            {/* Interactive Features tab section */}
            <section className="landing-section relative z-10 overflow-hidden border-t border-slate-200/70 bg-transparent px-5 py-20 sm:px-8 sm:py-24 lg:px-10">
                <div className="mx-auto max-w-[1440px]">
                    <div className="grid gap-8 lg:grid-cols-[minmax(320px,0.36fr)_minmax(0,0.64fr)] lg:items-center xl:gap-10">
                        
                        {/* Left Column: Headline and Tabs */}
                        <div className="space-y-6">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Product toolkit</p>
                                <h2 className="mt-2 font-display text-3xl font-extrabold leading-tight tracking-tight text-slate-950 sm:text-4xl">
                                    Full toolbox for teams
                                </h2>
                                <p className="mt-3 max-w-lg text-sm font-medium leading-6 text-slate-600 sm:text-base">
                                    Move from user evidence to a fix without switching between disconnected tools.
                                </p>
                            </div>
                            
                            {/* Vertical Tabs stack */}
                            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
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
                                    },
                                    {
                                        id: 'leaks',
                                        title: 'Leak Automations',
                                        description: 'Automatically detect conversion leaks and anomalous drops in user success, routing them to the right team immediately.',
                                        href: '/leak-automations',
                                        icon: Workflow,
                                        image: LEAK_AUTOMATIONS_IMAGE,
                                        imageAlt: 'Leak detection automation'
                                    }
                                ].map((tab) => {
                                    const isActive = activeFeatureTab === tab.id;
                                    const Icon = tab.icon;
                                    
                                    return (
                                        <button
                                            key={tab.id}
                                            onClick={() => setActiveFeatureTab(tab.id as 'replay' | 'heatmaps' | 'api' | 'stability' | 'geo' | 'leaks')}
                                            className={`flex w-full flex-col items-start gap-2.5 border-l-2 px-4 py-3.5 text-left transition-colors duration-200 ${
                                                isActive
                                                    ? 'border-l-indigo-500 bg-slate-50 text-slate-950'
                                                    : 'border-l-transparent bg-white text-slate-600 hover:bg-slate-50/70 hover:text-slate-950'
                                            }`}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
                                                    isActive ? 'bg-blue-50 border-blue-100 text-blue-600' : 'bg-slate-50 border-slate-100 text-slate-500'
                                                }`}>
                                                    <Icon className="h-4 w-4" />
                                                </div>
                                                <span className="text-sm font-bold sm:text-base">{tab.title}</span>
                                            </div>
                                            
                                            {isActive && (
                                                <div className="space-y-2.5 pl-11 pr-2">
                                                    <p className="text-sm font-normal leading-6 text-slate-600">
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
                        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
                            {[
                                { id: 'replay', image: SESSION_REPLAY_IMAGE, alt: 'User recording workbench' },
                                { id: 'heatmaps', image: HEATMAPS_IMAGE, alt: 'Heatmaps attention mapping' },
                                { id: 'api', image: API_INSIGHTS_IMAGE, alt: 'API endpoint insights' },
                                { id: 'stability', image: STABILITY_IMAGE, alt: 'Stability monitoring' },
                                { id: 'geo', image: GEO_IMAGE, alt: 'Geographic recovery map' },
                                { id: 'leaks', image: LEAK_AUTOMATIONS_IMAGE, alt: 'Leak detection automation' }
                            ].map((item) => {
                                const isActive = activeFeatureTab === item.id;
                                if (!isActive) return null;
                                return (
                                    <img
                                        key={item.id}
                                        src={item.image}
                                        alt={item.alt}
                                        loading="lazy"
                                        decoding="async"
                                        className="w-full rounded-lg object-cover"
                                    />
                                );
                            })}
                        </div>
                        
                    </div>
                </div>
            </section>

            {/* Performance Benchmarks Section */}
            <PerformanceMetrics copy={homeCopy.performance} />

            {/* ── Customer success gallery ── */}
            <section className="landing-section relative z-10 overflow-hidden px-5 py-24 sm:px-8 sm:py-28 lg:px-10 border-t border-black/15 bg-[#fdfbf7]">
                <div className="mx-auto max-w-5xl">
                    <div className="mb-8 flex flex-col items-center justify-between gap-4 sm:flex-row">
                        <div>
                            <p className="text-center text-xs font-black uppercase tracking-[0.18em] text-slate-500 sm:text-left">Customer success</p>
                            <h2 className="mt-2 text-center font-sans text-3xl font-black uppercase tracking-tight text-slate-955 sm:text-left">One story at a time.</h2>
                        </div>
                    </div>

                    <div className="relative px-14 sm:px-20">
                        {/* Side Gallery Navigation */}
                        <button
                            type="button"
                            onClick={() => setActiveSuccessStory(activeSuccessStory === 'burst' ? 'merch' : 'burst')}
                            className="absolute left-0 sm:left-2 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-800 shadow-md hover:bg-slate-50 hover:text-black transition-all active:scale-95 shrink-0"
                            aria-label="Previous story"
                        >
                            <ChevronLeft className="h-5 w-5 stroke-[2.5px]" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveSuccessStory(activeSuccessStory === 'burst' ? 'merch' : 'burst')}
                            className="absolute right-0 sm:right-2 top-1/2 -translate-y-1/2 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-800 shadow-md hover:bg-slate-50 hover:text-black transition-all active:scale-95 shrink-0"
                            aria-label="Next story"
                        >
                            <ChevronRight className="h-5 w-5 stroke-[2.5px]" />
                        </button>

                        {/* Case study card — white background */}
                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white px-6 py-10 text-black shadow-[0_8px_24px_rgba(15,23,42,0.06)] sm:px-10 sm:py-12">
                            {activeSuccessStory === 'burst' ? (
                                <div>
                                    {/* Top: logo circle + headline */}
                                    <div className="flex flex-col items-center text-center gap-5 mb-14">
                                        <div className="h-16 w-16 rounded-full overflow-hidden border border-black bg-white shadow-neo-sm shrink-0">
                                            <img
                                                src="/images/burst-creatine-logo-red.webp"
                                                alt="Burst Creatine"
                                                loading="lazy"
                                                decoding="async"
                                                className="h-full w-full object-cover"
                                            />
                                        </div>
                                        <div className="space-y-3">
                                            <h3 className="font-sans text-2xl font-black uppercase leading-tight tracking-tight text-slate-955 sm:text-3xl">
                                                Burst Creatine Increased Sales by 103%.
                                            </h3>
                                            <p className="max-w-lg mx-auto text-sm font-bold leading-relaxed text-slate-800">
                                                Rejourney surfaced the UX friction points causing drop-off. Simple fixes.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Sankey diagrams */}
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
                                    <p className="mt-8 text-center text-sm font-bold text-slate-800">
                                        Same Meta Ads Budget. <span className="text-emerald-700 font-extrabold">+2,189 more checkouts</span> from fixing easy UX leaks.
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    {/* Top: logo circle + headline */}
                                    <div className="flex flex-col items-center text-center gap-5 mb-14">
                                        <div className="h-16 w-16 rounded-full overflow-hidden border border-black bg-white shadow-neo-sm shrink-0">
                                            <img
                                                src="/images/customer-onboarding-logo.webp"
                                                alt="Campus Merch Live"
                                                loading="lazy"
                                                decoding="async"
                                                className="h-full w-full object-cover"
                                            />
                                        </div>
                                        <div className="space-y-3">
                                            <h3 className="font-sans text-2xl font-black uppercase leading-tight tracking-tight text-slate-955 sm:text-3xl">
                                                Campus Merch Live Increased Onboarding to 93%.
                                            </h3>
                                            <p className="max-w-lg mx-auto text-sm font-bold leading-relaxed text-slate-800">
                                                Rejourney revealed where new users were getting stuck, turning onboarding friction into a clear path.
                                            </p>
                                        </div>
                                    </div>

                                    {/* Sankey diagrams */}
                                    <div className="grid gap-8 lg:grid-cols-2">
                                        <SankeyPanel
                                            title="Before Rejourney"
                                            addToCart={4500}
                                            checkout={3555}
                                            accent="#f87171"
                                            accentLight="rgba(248,113,113,0.22)"
                                            dropColor="#94a3b8"
                                            dropLight="rgba(148,163,184,0.14)"
                                            sourceLabel="Signups"
                                            completionLabel="Verified"
                                        />
                                        <SankeyPanel
                                            title="After Rejourney"
                                            addToCart={4500}
                                            checkout={4185}
                                            accent="#34d399"
                                            accentLight="rgba(52,211,153,0.22)"
                                            dropColor="#94a3b8"
                                            dropLight="rgba(148,163,184,0.12)"
                                            sourceLabel="Signups"
                                            completionLabel="Verified"
                                        />
                                    </div>
                                    <p className="mt-8 text-center text-sm font-bold text-slate-800">
                                        Same Onboarding Traffic. <span className="text-emerald-700 font-extrabold">+630 more verified users</span> from fixing safari layout bug.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </section>

            {/* Full-width Bottom CTA Bar */}
            <section className="relative z-10 w-full overflow-hidden border-t border-[#e7e5e1] bg-[#faf9f7] px-5 py-14 text-slate-900 sm:px-8 sm:py-16 lg:px-12 lg:py-20">
                <div className="mx-auto max-w-[1440px]">
                    <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center xl:gap-16">
                        
                        {/* Left Headline */}
                        <div className="max-w-2xl">
                            <h2 className="font-display text-4xl font-extrabold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl leading-[1.08]">
                                Ready for lighter analytics?
                            </h2>
                        </div>

                        {/* Right Content & Actions */}
                        <div className="flex flex-col gap-5 max-w-md">
                            <p className="text-base font-medium leading-relaxed text-slate-700 sm:text-lg">
                                The complete analytics & replay suite for Web & Mobile: GDPR compliant, hosted in Germany, open source, and live in minutes.
                            </p>

                            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                                <Link
                                    to={LOGIN_PATH}
                                    className="group inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-[#4f8a63] bg-[#86efac] px-4 text-sm font-extrabold text-slate-950 shadow-sm transition-colors hover:border-[#3f7552] hover:bg-[#74e79b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f8a63]/30 focus-visible:ring-offset-2 sm:px-6"
                                >
                                    <span>Start for $0</span>
                                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                                </Link>
                                <Link
                                    to="/demo"
                                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-extrabold text-slate-900 shadow-sm transition-colors hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 sm:px-6"
                                >
                                    <span>Live demo</span>
                                    <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
                                </Link>
                            </div>

                            <p className="text-xs font-semibold text-slate-500" aria-live="polite">
                                {catHasBeenPet
                                    ? 'The cat agrees. Start free whenever you are ready.'
                                    : 'No credit card required. Free tier forever.'}
                            </p>
                        </div>

                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setCatHasBeenPet(true)}
                    className={`group absolute bottom-0 right-3 z-10 grid h-24 w-24 place-items-end rounded-t-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 focus-visible:ring-offset-2 sm:right-7 sm:h-28 sm:w-28 lg:right-10 lg:h-32 lg:w-32 ${catHasBeenPet ? 'landing-hero-cat--purring' : ''}`}
                    aria-label="Pet the Rejourney cat"
                    aria-pressed={catHasBeenPet}
                >
                    <img
                        src="/images/rejourney-cat.webp"
                        alt=""
                        width={288}
                        height={288}
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full origin-bottom-right scale-[1.15] object-contain object-bottom transition-transform duration-200 group-hover:scale-125"
                    />
                </button>
            </section>

            </div>
            </div>
        </div>
    );
};
