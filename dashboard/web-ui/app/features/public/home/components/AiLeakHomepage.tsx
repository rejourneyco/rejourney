import React, { useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
    Activity,
    ArrowRight,
    Check,
    Copy,
    Feather,
    Globe2,
    MousePointerClick,
    Play,
    Route,
    TrendingUp,
} from 'lucide-react';
import { getMarketingHomeCopy } from '~/shared/lib/internationalMarketing';
import { useToast } from '~/shared/providers/ToastContext';
import { EuFlag } from './EuFlag';
import { LandingThreeField } from './LandingThreeField';
import { MarkAngular, MarkReactNative, MarkSwift, MarkNextJs, MarkRemix, MarkSvelte, MarkVue } from './PlatformMarks';
import { FaqSection } from './FaqSection';
import { CodeBlock } from '~/shared/ui/core/CodeBlock';
import { NetworkConstellation, FloatingDataNodes, TechRingsScanner } from './SparseThreeAnimations';

const LOGIN_PATH = '/login';
const MARLIN_IMAGE = '/images/rejourney-marlin.png';

const shellClass = 'mx-auto w-full max-w-7xl px-5 sm:px-8 lg:px-10';

const aiCards = [
    {
        step: 'Replay',
        title: 'Rejourney Records Sessions',
        copy: 'Rejourney records the exact session, events, console logs, network calls, and layout state behind the leak.',
        image: '/images/session-replay-preview.png',
        imagePosition: 'center top',
        href: '/ai-agent-handoff',
    },
    {
        step: 'Observe',
        title: 'AI Watches and Finds Leaks',
        copy: 'Similar failures are grouped by affected users and severity so the highest-impact leak rises first.',
        image: '/images/issues-feed.png',
        imagePosition: 'left top',
        href: '/ai-funnel-leak-detection',
    },
    {
        step: 'Handoff',
        title: 'Funnel Fix Is Implemented',
        copy: 'A markdown brief is packaged for Cursor, Claude, Codex, or your IDE with links back to the evidence.',
        image: '/images/readme-general-demo.png',
        imagePosition: 'right top',
        href: '/ai-agent-handoff',
    },
    {
        step: 'Verify',
        title: 'Watch the growth impact',
        copy: 'Cohorts, regions, and revenue movement show whether the fix actually recovered users.',
        image: '/images/geo-intelligence.png',
        imagePosition: 'center top',
        href: '/geographic-analytics',
    },
];

const aiCardStyles = [
    {
        imageBg: 'from-blue-50/80 via-white to-sky-50/70',
        border: 'border-blue-500/80',
        link: 'text-blue-700 hover:text-blue-800',
    },
    {
        imageBg: 'from-yellow-50/80 via-white to-amber-50/70',
        border: 'border-yellow-500/80',
        link: 'text-yellow-700 hover:text-yellow-800',
    },
    {
        imageBg: 'from-pink-50/80 via-white to-rose-50/70',
        border: 'border-pink-500/80',
        link: 'text-pink-700 hover:text-pink-800',
    },
    {
        imageBg: 'from-green-50/80 via-white to-emerald-50/70',
        border: 'border-green-500/80',
        link: 'text-green-700 hover:text-green-800',
    },
];

const puzzleOuterPaths = [
    {
        color: '#3b82f6',
        d: 'M500 0 H36 Q0 0 0 36 V320',
    },
    {
        color: '#f59e0b',
        d: 'M500 0 H964 Q1000 0 1000 36 V320',
    },
    {
        color: '#ec4899',
        d: 'M0 320 V604 Q0 640 36 640 H500',
    },
    {
        color: '#22c55e',
        d: 'M500 640 H964 Q1000 640 1000 604 V320',
    },
];

const puzzleSeamPaths = [
    {
        color: '#3b82f6',
        d: 'M500 0 V116 C500 130 518 130 532 130 C568 130 596 158 596 192 C596 226 568 254 532 254 C518 254 500 254 500 268 V320',
    },
    {
        color: '#ec4899',
        d: 'M0 320 H130 C144 320 144 338 144 352 C144 388 172 416 208 416 C244 416 272 388 272 352 C272 338 272 320 286 320 H500',
    },
    {
        color: '#22c55e',
        d: 'M500 320 V372 C500 386 518 386 532 386 C568 386 596 414 596 448 C596 482 568 510 532 510 C518 510 500 510 500 524 V640',
    },
    {
        color: '#f59e0b',
        d: 'M500 320 H670 C684 320 684 338 684 352 C684 388 712 416 748 416 C784 416 812 388 812 352 C812 338 812 320 826 320 H1000',
    },
];

const PuzzlePieceFrame: React.FC = () => (
    <svg
        className="pointer-events-none absolute inset-0 z-30 hidden h-full w-full overflow-visible lg:block"
        viewBox="0 0 1000 640"
        preserveAspectRatio="none"
        aria-hidden="true"
    >
        <defs>
            <filter id="puzzle-piece-frame-shadow" x="-8%" y="-8%" width="116%" height="116%">
                <feDropShadow dx="0" dy="9" stdDeviation="10" floodColor="#0f172a" floodOpacity="0.10" />
            </filter>
        </defs>
        <g filter="url(#puzzle-piece-frame-shadow)">
            {[...puzzleOuterPaths, ...puzzleSeamPaths].map(({ color, d }, index) => (
                <path
                    key={`${color}-${index}-underlay`}
                    d={d}
                    fill="none"
                    stroke="rgba(255,255,255,0.92)"
                    strokeWidth="10"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                />
            ))}
            {[...puzzleOuterPaths, ...puzzleSeamPaths].map(({ color, d }, index) => (
                <path
                    key={`${color}-${index}-stroke`}
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeWidth="3.25"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                />
            ))}
        </g>
    </svg>
);

type CustomerWantTabId = 'analytics' | 'stability' | 'heatmaps' | 'journey' | 'revenue' | 'web';

const customerWantTabs: Array<{
    id: CustomerWantTabId;
    title: string;
    copy: string;
    image: string;
    icon: React.ComponentType<{ className?: string }>;
    href: string;
}> = [
    {
        id: 'analytics',
        title: 'Session Replay',
        copy: 'Record exact user journeys with lightweight DOM mutation tracking, capturing layout updates and console errors without degrading device battery or network bandwidth.',
        image: '/images/session-replay-preview.png',
        icon: Play,
        href: '/record-user-sessions',
    },
    {
        id: 'stability',
        title: 'Stability Monitoring',
        copy: 'Group crashes, ANRs, errors, and API failures by affected sessions so engineering can see the replay evidence behind each incident.',
        image: '/images/anr-issues.png',
        icon: Activity,
        href: '/stability-monitoring',
    },
    {
        id: 'heatmaps',
        title: 'Heat Maps',
        copy: 'Reveal ignored CTAs, repeated taps, rage clicks, and scroll patterns so product teams can spot friction before it drains conversion.',
        image: '/images/heatmaps.png',
        icon: MousePointerClick,
        href: '/heatmaps',
    },
    {
        id: 'journey',
        title: 'User Journey',
        copy: 'Map real paths through your funnel, then open replay evidence behind every branch, loop, and drop-off.',
        image: '/images/readme-user-journeys.png',
        icon: Route,
        href: '/funnel-replay-evidence',
    },
    {
        id: 'revenue',
        title: 'Revenue Growth Tracking',
        copy: 'Track revenue movement beside sessions, releases, retention, and affected users so growth work stays tied to evidence.',
        image: '/images/growth-engines.png',
        icon: TrendingUp,
        href: '/revenue-recovery-analytics',
    },
    {
        id: 'web',
        title: 'Geographic Analytics',
        copy: 'Spot regional friction, sentiment clusters, and infrastructure trouble by country so teams can prioritize the markets that need attention.',
        image: '/images/geo-analytics.png',
        icon: Globe2,
        href: '/geographic-analytics',
    },
];

const featureActiveStyles: Record<CustomerWantTabId, { border: string; badge: string; shadow: string }> = {
    analytics: {
        border: 'border-blue-200/70',
        badge: 'bg-blue-50 border-blue-100 text-blue-600 shadow-sm shadow-blue-100/50',
        shadow: 'shadow-[0_12px_30px_rgba(37,99,235,0.06)]'
    },
    stability: {
        border: 'border-rose-200/70',
        badge: 'bg-rose-50 border-rose-100 text-rose-600 shadow-sm shadow-rose-100/50',
        shadow: 'shadow-[0_12px_30px_rgba(225,29,72,0.06)]'
    },
    heatmaps: {
        border: 'border-orange-200/70',
        badge: 'bg-orange-50 border-orange-100 text-orange-600 shadow-sm shadow-orange-100/50',
        shadow: 'shadow-[0_12px_30px_rgba(234,88,12,0.06)]'
    },
    journey: {
        border: 'border-violet-200/70',
        badge: 'bg-violet-50 border-violet-100 text-violet-600 shadow-sm shadow-violet-100/50',
        shadow: 'shadow-[0_12px_30px_rgba(124,58,237,0.06)]'
    },
    revenue: {
        border: 'border-emerald-200/70',
        badge: 'bg-emerald-50 border-emerald-100 text-emerald-600 shadow-sm shadow-emerald-100/50',
        shadow: 'shadow-[0_12px_30px_rgba(5,150,105,0.06)]'
    },
    web: {
        border: 'border-cyan-200/70',
        badge: 'bg-cyan-50 border-cyan-100 text-cyan-600 shadow-sm shadow-cyan-100/50',
        shadow: 'shadow-[0_12px_30px_rgba(6,182,212,0.06)]'
    },
};

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

export const AiLeakHomepage: React.FC = () => {
    const location = useLocation();
    const homeCopy = getMarketingHomeCopy(location.pathname);
    const trustCopy = homeCopy.trust;
    const { showToast } = useToast();

    // Feature tabs state
    const [activeFeatureTab, setActiveFeatureTab] = useState<CustomerWantTabId>('analytics');

    // Bottom CTA Playground state
    const [activeSdkPlatform, setActiveSdkPlatform] = useState<'nextjs' | 'reactnative' | 'swift' | 'vue'>('reactnative');
    const [copied, setCopied] = useState(false);
    const [salesCopied, setSalesCopied] = useState(false);

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

    const copySalesEmail = async () => {
        try {
            await writeToClipboard('contact@rejourney.co');
            setSalesCopied(true);
            showToast(homeCopy.footer.copyEmailToast);
            setTimeout(() => setSalesCopied(false), 2000);
        } catch (error) {
            console.error('Failed to copy sales email:', error);
        }
    };

    const activeFeature = customerWantTabs.find(t => t.id === activeFeatureTab) || customerWantTabs[0];
    const activeSdk = sdkPlatforms.find(p => p.id === activeSdkPlatform) || sdkPlatforms[0];
    const activeSdkLanguage = activeSdk.id === 'swift' ? 'swift' : 'typescript';
    const activeSdkSetup = `${activeSdk.terminalCommands.join('\n')}\n\n${activeSdk.code}`;

    return (
        <div className="relative isolate w-full overflow-x-hidden bg-[#f8fbff] text-slate-900">
            <LandingThreeField variant="landing-page" seed={211} className="opacity-90" />

            <div className="relative z-10">
                {/* Hero Section */}
                <section className="relative overflow-hidden px-5 pb-28 pt-36 text-center sm:px-8 sm:pb-40 sm:pt-44 lg:overflow-visible lg:px-10 lg:pb-44 lg:pt-48">
                    <LandingThreeField variant="landing-hero" seed={11} />

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-36 bg-gradient-to-t from-white/75 via-white/35 to-transparent" aria-hidden="true" />

                    <div className="relative z-10 mx-auto flex max-w-6xl flex-col items-center">
                        <h1 className="mx-auto max-w-6xl bg-gradient-to-br from-slate-950 via-blue-950 to-sky-900 bg-clip-text font-display text-[1.68rem] font-extrabold leading-[1.04] tracking-normal text-transparent drop-shadow-[0_18px_44px_rgba(37,99,235,0.08)] min-[360px]:text-[1.95rem] min-[430px]:text-[2.2rem] sm:text-[3.05rem] md:text-[3.65rem] lg:text-[4.45rem] xl:text-[5.35rem]">
                            <span className="block whitespace-nowrap">From Session</span>
                            <span className="block whitespace-nowrap">Diagnostics To</span>
                            <span className="block whitespace-nowrap">Revenue Acceleration.</span>
                        </h1>
                        <p className="mx-auto mt-8 max-w-3xl text-balance text-lg font-medium leading-relaxed text-slate-600 sm:text-xl md:text-2xl">
                            Power self-healing products.
                        </p>
                        {/* Action buttons matching style */}
                        <div className="mt-9 flex w-full max-w-[20.5rem] flex-col items-center justify-center gap-3 sm:mt-11 sm:w-auto sm:max-w-none sm:flex-row">
                            <Link
                                to={LOGIN_PATH}
                                className="group inline-flex min-h-[52px] w-full min-w-[190px] items-center justify-center gap-2 rounded-full border border-blue-600 bg-blue-600 px-7 text-[0.95rem] font-bold text-white shadow-[0_16px_36px_rgba(37,99,235,0.24)] ring-1 ring-blue-500/20 transition-all duration-300 hover:-translate-y-0.5 hover:border-blue-700 hover:bg-blue-700 hover:shadow-[0_20px_44px_rgba(37,99,235,0.3)] active:translate-y-0 sm:min-h-[58px] sm:w-auto sm:px-8 sm:text-base"
                            >
                                <span>Free Tier</span>
                                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                            </Link>
                            <button
                                type="button"
                                onClick={() => void copySalesEmail()}
                                className="inline-flex min-h-[52px] w-full min-w-[190px] items-center justify-center rounded-full border border-slate-300/70 bg-white/50 px-7 text-[0.95rem] font-bold text-slate-700 shadow-sm shadow-slate-200/40 ring-1 ring-slate-400/10 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white/75 hover:shadow-md active:translate-y-0 sm:min-h-[58px] sm:w-auto sm:px-8 sm:text-base"
                            >
                                {salesCopied ? 'Email copied' : 'Talk To Sales'}
                            </button>
                        </div>

                    {/* Supported Platforms */}
                    <div className="mx-auto mt-24 max-w-5xl flex flex-col items-center justify-center gap-4 border-t border-slate-200/70 pt-8">

                        <div className="flex flex-wrap items-center justify-center gap-y-3 gap-x-4 text-slate-500">
                            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-slate-100">
                                <MarkReactNative className="h-4 w-4 text-[#2563eb]" />
                                <span>{trustCopy.reactNative} / {trustCopy.expo}</span>
                            </div>
                            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-slate-100">
                                <MarkSwift className="h-4 w-4 text-[#f97316]" />
                                <span>{trustCopy.swift}</span>
                            </div>
                            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-slate-100">
                                <MarkNextJs className="h-4 w-4 text-slate-900" />
                                <span>Next.js / React</span>
                            </div>
                            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-slate-100">
                                <MarkVue className="h-4 w-4 text-[#42b883]" />
                                <span>Vue / Nuxt</span>
                            </div>
                            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-slate-100">
                                <MarkAngular className="h-4 w-4 text-[#dd0031]" />
                                <span>Angular</span>
                            </div>
                            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-slate-100">
                                <MarkSvelte className="h-4 w-4 text-[#ff3e00]" />
                                <span>SvelteKit</span>
                            </div>
                            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-slate-100">
                                <MarkRemix className="h-4 w-4 text-slate-900" />
                                <span>Remix</span>
                            </div>
                        </div>
                    </div>

                    {/* Trust Compliance Row */}
                    <div className="mx-auto mt-6 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs font-semibold text-slate-400">
                        <span className="flex items-center gap-1.5">
                            <EuFlag className="h-3.5 w-5 rounded-sm shrink-0" />
                            <span>{trustCopy.gdpr}</span>
                        </span>
                        <span className="hidden sm:inline h-3.5 w-px bg-slate-200" />
                        <span className="flex items-center gap-1.5">
                            <Feather className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <span>{trustCopy.sdkSize}</span>
                        </span>
                    </div>
                </div>

                {/* Hero Dashboard Preview (landing-replay-theater.png) */}
                <div className="relative z-10 mx-auto mt-16 max-w-5xl rounded-3xl border border-slate-200 bg-slate-50 p-3 shadow-2xl overflow-hidden">
                    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
                        <div className="flex h-11 items-center gap-2 border-b border-slate-100 bg-slate-50 px-4">
                            <span className="h-3 w-3 rounded-full bg-rose-400" />
                            <span className="h-3 w-3 rounded-full bg-amber-400" />
                            <span className="h-3 w-3 rounded-full bg-emerald-400" />
                            <div className="mx-2 h-5 w-px shrink-0 bg-slate-200" />
                            <span className="min-w-0 truncate font-mono text-xs font-bold text-slate-400">https://rejourney.co/dashboard/leaks</span>
                        </div>
                        <img 
                            src="/images/landing-replay-theater.png" 
                            alt="Rejourney Issue Detection" 
                            className="w-full h-auto object-cover" 
                        />
                    </div>
                </div>
            </section>

            <div className="relative overflow-hidden bg-[linear-gradient(180deg,#f1f8ff_0%,#f7f3ff_24%,#fff6ea_48%,#effbf4_73%,#eef7ff_100%)]">
                <div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_15%_9%,rgba(37,99,235,0.10),transparent_31%),radial-gradient(circle_at_86%_22%,rgba(139,92,246,0.09),transparent_34%),radial-gradient(circle_at_18%_52%,rgba(245,158,11,0.10),transparent_34%),radial-gradient(circle_at_82%_78%,rgba(16,185,129,0.10),transparent_34%)]" aria-hidden="true" />
                <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(180deg,rgba(255,255,255,0.55)_0%,rgba(255,255,255,0.18)_28%,rgba(255,255,255,0.12)_56%,rgba(255,255,255,0.40)_100%)]" aria-hidden="true" />
                <div className="pointer-events-none absolute inset-x-0 top-[33rem] z-[1] h-px bg-gradient-to-r from-transparent via-sky-200/45 to-transparent" aria-hidden="true" />

            {/* Self-Healing Loop Section */}
                <section className="relative overflow-hidden border-t border-transparent bg-[linear-gradient(180deg,rgba(241,248,255,0.76)_0%,rgba(247,243,255,0.70)_100%)] px-5 py-24 sm:px-8 sm:py-28 lg:px-10">
                    <div className="pointer-events-none absolute inset-x-0 top-8 z-0 h-[44rem] overflow-hidden" aria-hidden="true">
                        <NetworkConstellation className="opacity-[0.52]" seed={661} />
                    </div>
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_24%_16%,rgba(37,99,235,0.08),transparent_31%),radial-gradient(circle_at_78%_22%,rgba(234,179,8,0.08),transparent_31%),radial-gradient(circle_at_27%_86%,rgba(236,72,153,0.06),transparent_32%),radial-gradient(circle_at_80%_84%,rgba(16,185,129,0.07),transparent_32%)]" aria-hidden="true" />
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-36 bg-gradient-to-b from-white/80 via-white/38 to-transparent" aria-hidden="true" />
                
                <div className="relative z-10 mx-auto max-w-7xl">
                    <div className="mx-auto max-w-4xl text-center">

                        <h2 className="mt-4 font-display text-4xl font-extrabold tracking-tight bg-gradient-to-br from-slate-950 via-blue-950 to-sky-900 bg-clip-text text-transparent sm:text-5xl pb-1">
                            Self-Healing Funnel Leaks
                        </h2>

                    </div>

                    <div className="relative mx-auto mt-14 max-w-[78rem]">
                        <div className="relative lg:rounded-[2.35rem] lg:shadow-[0_28px_70px_rgba(15,23,42,0.10)]">
                            <div className="relative z-10 grid gap-6 lg:grid-cols-2 lg:gap-0 lg:overflow-hidden lg:rounded-[2.35rem] lg:bg-white/[0.76] lg:ring-1 lg:ring-white/80">
                        {aiCards.map(({ title, copy, image, imagePosition, href }, index) => {
                            const style = aiCardStyles[index % aiCardStyles.length];

                            return (
                                <article
                                    key={title}
                                    className={`group relative overflow-hidden rounded-[2rem] border-2 ${style.border} bg-white/[0.9] text-left shadow-xl shadow-slate-900/[0.055] backdrop-blur-xl transition-colors duration-300 hover:bg-white lg:rounded-none lg:border-0 lg:bg-white/[0.88] lg:shadow-none`}
                                >
                                    <div className="relative z-20 grid min-h-[18.5rem] overflow-hidden rounded-[1.85rem] md:grid-cols-[0.95fr_1.05fr] lg:min-h-[20rem] lg:rounded-none">
                                        <div className={`relative min-h-[14rem] overflow-hidden border-b border-slate-200/70 bg-gradient-to-br ${style.imageBg} md:border-b-0 md:border-r md:border-slate-200/70`}>
                                            <div className="absolute inset-4 overflow-hidden rounded-[1.25rem] border border-white/80 bg-white shadow-lg shadow-slate-900/[0.05] transition-transform duration-500 group-hover:scale-[1.018]">
                                                <div className="flex h-6 shrink-0 select-none items-center gap-1.5 border-b border-slate-100 bg-slate-50/90 px-3">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                                                    <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                                                    <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                                                </div>
                                                <img
                                                    src={image}
                                                    alt={title}
                                                    className="h-[calc(100%-1.5rem)] w-full object-cover object-top opacity-95 transition-opacity duration-300 group-hover:opacity-100"
                                                    style={{ objectPosition: imagePosition }}
                                                />
                                            </div>
                                        </div>

                                        <div className="flex flex-col justify-center p-6 sm:p-8">
                                            <h3 className="max-w-md text-2xl font-extrabold leading-tight tracking-tight text-slate-950 sm:text-[1.7rem]">
                                                {title}
                                            </h3>
                                            <p className="mt-4 max-w-md text-[0.98rem] font-medium leading-7 text-slate-600">
                                                {copy}
                                            </p>
                                            <Link
                                                to={href}
                                                className={`mt-7 inline-flex w-fit items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider transition-all hover:translate-x-0.5 ${style.link}`}
                                            >
                                                Learn more <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                                            </Link>
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                            </div>
                            <PuzzlePieceFrame />
                        </div>
                    </div>
                </div>
            </section>

            {/* Understand What Your Customers Want Section */}
                <section className="relative overflow-hidden bg-[linear-gradient(180deg,rgba(247,243,255,0.70)_0%,rgba(255,246,234,0.68)_58%,rgba(250,251,244,0.70)_100%)] py-24 sm:py-28 lg:overflow-visible">
                <div className="pointer-events-none absolute inset-x-0 top-6 z-0 h-[40rem] overflow-hidden" aria-hidden="true">
                    <FloatingDataNodes className="opacity-[0.38]" seed={662} />
                </div>
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(245,158,11,0.08),transparent_30%),radial-gradient(circle_at_88%_18%,rgba(59,130,246,0.07),transparent_32%),radial-gradient(circle_at_18%_82%,rgba(236,72,153,0.06),transparent_32%),radial-gradient(circle_at_84%_78%,rgba(16,185,129,0.08),transparent_31%)]" aria-hidden="true" />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-200/45 to-transparent" aria-hidden="true" />
                <div className={`${shellClass} relative z-10`}>
                    <div className="mx-auto max-w-3xl text-center">
                        <h2 className="font-display text-4xl font-extrabold tracking-tight bg-gradient-to-br from-slate-950 via-blue-950 to-sky-900 bg-clip-text text-transparent sm:text-5xl pb-1">
                           A Full Toolbox for Conversion Growth
                        </h2>
                        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-500 font-medium">
                            Stop guessing why checkouts or sign-ups leak. Capture user behavior, compile technical context, and handshake directly with coding agents.
                        </p>
                    </div>

                    <div className="mt-16 grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
                        {/* Interactive vertical selectors */}
                        <div className="space-y-2.5">
                            <h3 className="mb-4 text-left text-2xl font-extrabold tracking-tight text-slate-950">Funnels & Replays</h3>
                            {customerWantTabs.map(({ id, title, copy, icon: Icon }) => {
                                const isActive = activeFeatureTab === id;
                                const activeStyle = featureActiveStyles[id] || featureActiveStyles.analytics;

                                return (
                                    <button
                                        key={id}
                                        onClick={() => setActiveFeatureTab(id)}
                                        className={`w-full rounded-2xl border text-left transition-all duration-300 ${
                                            isActive 
                                                ? `bg-white/85 p-4 ${activeStyle.border} ${activeStyle.shadow} backdrop-blur-lg ring-1 ring-slate-100/5 scale-[1.01]` 
                                                : 'border-transparent bg-transparent px-4 py-3 hover:border-slate-200/50 hover:bg-white/35 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)]'
                                        }`}
                                    >
                                        <div className="flex gap-3.5">
                                            <div className={`mt-0.5 h-8 w-8 rounded-lg flex items-center justify-center shrink-0 border transition-all duration-300 ${
                                                isActive ? activeStyle.badge : 'bg-transparent border-transparent text-slate-400 hover:text-slate-700'
                                            }`}>
                                                <Icon className="h-4 w-4" />
                                            </div>
                                            <div className="flex-1">
                                                <h4 className="flex items-center gap-1.5 text-base font-bold tracking-tight text-slate-900">
                                                    {title}
                                                </h4>
                                                {isActive && (
                                                    <div className="mt-2.5 space-y-2.5 transition-all duration-300">
                                                        <p className="text-sm font-medium leading-6 text-slate-500">{copy}</p>
                                                        <Link 
                                                            to={activeFeature.href} 
                                                            className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-600 hover:text-sky-700 transition-colors hover:translate-x-0.5"
                                                        >
                                                            Learn more <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                                                        </Link>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>

                        {/* Large product screenshot container */}
                        <div className="rounded-3xl border border-slate-200/80 bg-white/45 backdrop-blur-md p-3 shadow-xl relative group">
                            <div className="rounded-2xl border border-slate-200 bg-white shadow-md overflow-hidden transition-all duration-500 group-hover:scale-[1.015] group-hover:rotate-0.5 origin-center">
                                <div className="flex h-6 items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 font-mono text-[9px] text-slate-500 shrink-0 select-none">
                                    <div className="flex items-center gap-1.5">
                                        <span className="h-1.5 w-1.5 rounded-full bg-slate-350" />
                                        <span className="h-1.5 w-1.5 rounded-full bg-slate-350" />
                                        <span className="h-1.5 w-1.5 rounded-full bg-slate-350" />
                                    </div>
                                    <span className="opacity-80">rejourney.co/dashboard</span>
                                    <div className="w-10" />
                                </div>
                                <img 
                                    src={activeFeature.image} 
                                    alt={activeFeature.title} 
                                    className="w-full h-auto object-cover opacity-95 group-hover:opacity-100 transition-opacity duration-300"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Rejourney Marlin GitHub App Section */}
                <section className="relative overflow-hidden bg-[linear-gradient(180deg,rgba(250,251,244,0.70)_0%,rgba(240,251,244,0.68)_52%,rgba(239,247,255,0.70)_100%)] px-5 py-24 sm:px-8 sm:py-28 lg:overflow-visible lg:px-10">
                <div className="pointer-events-none absolute inset-x-0 top-8 z-0 h-[38rem] overflow-hidden" aria-hidden="true">
                    <NetworkConstellation className="opacity-[0.42]" seed={873} />
                </div>
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_18%,rgba(16,185,129,0.08),transparent_32%),radial-gradient(circle_at_86%_22%,rgba(37,99,235,0.07),transparent_33%),radial-gradient(circle_at_58%_92%,rgba(245,158,11,0.07),transparent_35%)]" aria-hidden="true" />
                <div className="relative z-10 mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
                    <div className="max-w-3xl">
                        <p className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                            Rejourney Marlin for GitHub
                        </p>
                        <h2 className="mt-5 max-w-4xl font-display text-4xl font-extrabold leading-tight tracking-normal text-slate-950 sm:text-6xl lg:text-7xl">
                            Meet Marlin. 
                        </h2>
                        <p className="mt-6 max-w-2xl text-lg font-medium leading-8 text-slate-600 sm:text-xl">
                            Marlin is the Rejourney GitHub App that uses replay context to identify funnel and revenue issues, then suggests code fixes your team can review from the repository.
                        </p>

                        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                            <Link
                                to="/rejourney-marlin"
                                className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-full bg-blue-600 px-7 text-sm font-bold text-white shadow-xl shadow-blue-200/70 transition hover:-translate-y-0.5 hover:bg-blue-700"
                            >
                                Explore Marlin
                                <ArrowRight className="h-4 w-4" />
                            </Link>
                            <Link
                                to="/pricing"
                                className="inline-flex min-h-[54px] items-center justify-center gap-2 rounded-full border border-slate-300 bg-white/70 px-7 text-sm font-bold text-slate-700 shadow-sm backdrop-blur-md transition hover:-translate-y-0.5 hover:border-slate-400 hover:bg-white"
                            >
                                See pricing
                                <ArrowRight className="h-4 w-4" />
                            </Link>
                        </div>
                    </div>

                    <div className="relative mx-auto w-full max-w-xl">
                        <div className="absolute -inset-5 rounded-[2rem] bg-cyan-200/30 blur-3xl" aria-hidden="true" />
                        <div className="relative overflow-hidden rounded-[1.75rem] border border-cyan-100 bg-white/70 p-3 shadow-2xl shadow-cyan-900/10 backdrop-blur-xl">
                            <img
                                src={MARLIN_IMAGE}
                                alt="Rejourney Marlin artwork"
                                className="aspect-square w-full rounded-[1.35rem] object-cover"
                            />
                        </div>
                        <div className="relative -mt-12 ml-auto w-[88%] rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-xl backdrop-blur-md sm:w-[78%]">
                            <div className="flex items-center justify-between gap-4">
                                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                    Marlin suggestion
                                </span>
                                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                                    450 Replays 
                                </span>
                            </div>
                            <div className="mt-3 space-y-2 font-mono text-xs font-semibold text-slate-700">
                                <p>checkout/PaymentSheet.tsx</p>
                                <p className="text-emerald-700">+ retry failed intent before empty state</p>
                                <p className="text-blue-700">+ guard CTA when plan quote is stale</p>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* FAQ Section */}
            <FaqSection />

            {/* Bottom Call-To-Action (CTA) */}
                <section className="relative overflow-hidden bg-[linear-gradient(180deg,rgba(239,247,255,0.70)_0%,rgba(246,243,255,0.70)_44%,rgba(255,248,239,0.78)_100%)] px-5 py-24 sm:px-8 sm:py-28 lg:px-10">
                <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[36rem] overflow-hidden" aria-hidden="true">
                    <TechRingsScanner className="opacity-[0.36]" seed={526} />
                </div>
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(245,158,11,0.07),transparent_31%),radial-gradient(circle_at_82%_20%,rgba(37,99,235,0.08),transparent_33%),radial-gradient(circle_at_50%_88%,rgba(16,185,129,0.07),transparent_35%)]" aria-hidden="true" />
                <div className="relative z-10 mx-auto max-w-6xl">
                    {/* Header */}
                    <div className="mx-auto max-w-3xl text-center mb-16">
                        <h2 className="font-display text-4xl font-extrabold leading-tight tracking-tight bg-gradient-to-br from-slate-950 via-blue-950 to-sky-900 bg-clip-text text-transparent sm:text-5xl">
                            Save countless customers in minutes.
                        </h2>
                        <p className="mt-4 text-base font-medium leading-relaxed text-slate-500 sm:text-lg">
                            Integrate our lightweight SDK to automatically record user drop-offs and compile exact, high-fidelity context packets.
                        </p>
                    </div>

                    {/* Interactive Playground Grid */}
                    <div className="grid items-center gap-8 rounded-3xl border border-slate-200/80 bg-white/45 p-6 shadow-xl ring-1 ring-slate-100/5 backdrop-blur-md sm:p-8 lg:grid-cols-[1fr_2fr]">
                        
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
                                            setActiveSdkPlatform(platform.id as 'nextjs' | 'reactnative' | 'swift' | 'vue');
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
                        <div className="group relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-2xl transition-all duration-300 hover:shadow-blue-500/10">
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
                            className="group inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full bg-blue-600 px-8 text-base font-bold text-white shadow-lg shadow-blue-200/70 ring-1 ring-blue-500/20 transition-all duration-300 hover:-translate-y-0.5 hover:bg-blue-700 active:translate-y-0 sm:w-auto"
                        >
                            Get Started
                            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                        <Link
                            to="/pricing"
                            className="inline-flex min-h-[56px] w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-8 text-base font-bold text-slate-700 transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-50 hover:border-slate-400 active:translate-y-0 sm:w-auto"
                        >
                            Pricing
                        </Link>
                    </div>
                </div>
                </section>
            </div>
            </div>
        </div>
    );
};
