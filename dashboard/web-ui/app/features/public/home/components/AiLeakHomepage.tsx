import React, { useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
    Activity,
    ArrowRight,
    Bot,
    Check,
    Copy,
    Feather,
    Gauge,
    Globe2,
    MousePointerClick,
    Play,
    Route,
    TerminalSquare,
    TrendingUp,
    Users,
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
        title: 'Autonomous Session Observer',
        copy: 'Monitors user behavior and interaction streams in the background, automatically capturing transaction-blocking bugs, rage-clicks, and console exceptions.',
        icon: Bot,
        image: '/images/issues-feed.png',
        imagePosition: 'left top',
        href: '/ai-funnel-leak-detection',
    },
    {
        title: 'Replay to Leak Fix',
        copy: 'Converts raw session events, network request logs, and layout state snapshots into structured, markdown-formatted debugging payloads optimized for LLMs.',
        icon: TerminalSquare,
        image: '/images/session-replay-preview.png',
        imagePosition: 'center top',
        href: '/ai-agent-handoff',
    },
    {
        title: 'Copy-Paste Fix to Agent',
        copy: 'Exposes session-replay context packets directly to your IDE and developer agent workflows via standard .md context files.',
        icon: Users,
        image: '/images/readme-general-demo.png',
        imagePosition: 'right top',
        href: '/ai-agent-handoff',
    },
    {
        title: 'Watch the Growth Impact',
        copy: 'Map positive, neutral, and frustrated sessions by country so teams can spot regional UX friction before it spreads.',
        icon: Gauge,
        image: '/images/geo-intelligence.png',
        imagePosition: 'center top',
        href: '/geographic-analytics',
    },
];

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

const winTogetherTabs = [
    {
        id: 'product',
        title: 'Product teams',
        category: 'Prioritize & Route',
        headline: 'Identify leaks and route fixable context directly to developers or AI agents.',
        summary: 'Use journey ribbons to see where users branch, loop, or drop, then open the replay evidence behind the path.',
        points: ['Weighted paths expose the highest-volume leaks', 'Drop-off labels show where the flow loses intent', 'Replay evidence keeps product and engineering aligned'],
        image: '/images/readme-user-journeys.png',
        href: '/funnel-replay-evidence',
    },
    {
        id: 'growth',
        title: 'Growth teams',
        category: 'Accelerate Resolution',
        headline: 'Connect revenue movement to sessions, releases, and recovery work.',
        summary: 'Use the General revenue dashboard to track gross revenue, transactions, active users, and retention next to the sessions that explain movement.',
        points: ['Revenue trend and transaction counts stay visible', 'Release markers connect changes to outcomes', 'Top users and active-session cards show who is affected'],
        image: '/images/geo-analytics.png',
        href: '/revenue-recovery-analytics',
    },
    {
        id: 'data',
        title: 'Data teams',
        category: 'Standardized Context',
        headline: 'Format behavioral exceptions into clean context schemas.',
        summary: 'Turn sessions, regions, events, and technical signals into consistent context that can be queried, shared, and compared.',
        points: ['Session metadata and events use shared identifiers', 'Regional and behavioral views stay tied to replay evidence', 'Exportable context reduces one-off debugging notes'],
        image: '/images/growth-engines.png',
        href: '/standardized-context',
    },
    {
        id: 'engineering',
        title: 'Engineering teams',
        category: 'Autonomous Debugging',
        headline: 'Let AI agents fix production bugs using exact session context.',
        summary: 'Open fix-ready packets with replay links, signals, stack context, and handoff text for Cursor, Claude, Codex, or your IDE.',
        points: ['Issue context is grouped by repeated signals', 'Replay links keep the bug reproducible', 'Markdown handoff text is ready for an agent workflow'],
        image: '/images/anr-issues.png',
        href: '/autonomous-debugging',
    },
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

    // Win Together tabs state
    const [activeWinTab, setActiveWinTab] = useState<'product' | 'growth' | 'data' | 'engineering'>('product');

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
    const activeWin = winTogetherTabs.find(t => t.id === activeWinTab) || winTogetherTabs[0];
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
                        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                            Supported Platforms
                        </p>
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

            <div className="relative overflow-hidden bg-[linear-gradient(180deg,#ffffff_0%,#e8fbff_18%,#eef2ff_39%,#ecfdf5_62%,#fff7ed_82%,#f8fafc_100%)]">
                <LandingThreeField variant="landing-sparse" seed={661} className="opacity-75" />
                <FloatingDataNodes className="opacity-70" seed={662} />
                <TechRingsScanner className="opacity-[0.55]" seed={526} />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(45,212,191,0.18),transparent_36%),radial-gradient(circle_at_82%_25%,rgba(79,70,229,0.14),transparent_40%),radial-gradient(circle_at_20%_61%,rgba(16,185,129,0.16),transparent_42%),radial-gradient(circle_at_73%_92%,rgba(249,115,22,0.12),transparent_40%)]" aria-hidden="true" />

            {/* Your Unfair AI Advantage Cards Section */}
                <section className="relative overflow-visible border-t border-transparent bg-[linear-gradient(180deg,rgba(248,253,255,0.94)_0%,rgba(228,248,255,0.9)_100%)] px-5 py-24 sm:px-8 lg:px-10">
                    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(125,211,252,0.16),transparent_38%),radial-gradient(circle_at_80%_60%,rgba(59,130,246,0.12),transparent_40%)]" aria-hidden="true" />
                    <NetworkConstellation className="opacity-[0.85]" />
                
                <div className="relative z-10 mx-auto max-w-7xl">
                    <div className="mx-auto max-w-3xl text-center">
                        <h2 className="font-display text-4xl font-extrabold tracking-tight bg-gradient-to-br from-slate-950 via-blue-950 to-sky-900 bg-clip-text text-transparent sm:text-5xl pb-1">
                            Self-Healing Funnels
                        </h2>
                        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-500 font-medium">
                            Record user session drop-offs and compile exact, high-fidelity context packets ready for developer or AI agent resolution.
                        </p>
                    </div>

                    <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                        {aiCards.map(({ title, copy, icon: Icon, image, imagePosition, href }, index) => {
                            const cardGradients = [
                                { bg: 'from-cyan-50/50 via-sky-50/30 to-white/10', iconColor: 'text-cyan-600', badgeBg: 'bg-cyan-50/60 border-cyan-200/40' },
                                { bg: 'from-sky-50/50 via-blue-50/30 to-white/10', iconColor: 'text-sky-600', badgeBg: 'bg-sky-50/60 border-sky-200/40' },
                                { bg: 'from-blue-50/50 via-cyan-50/30 to-white/10', iconColor: 'text-blue-600', badgeBg: 'bg-blue-50/60 border-blue-200/40' },
                                { bg: 'from-emerald-50/50 via-teal-50/30 to-white/10', iconColor: 'text-emerald-600', badgeBg: 'bg-emerald-50/60 border-emerald-200/40' },
                            ];
                            const style = cardGradients[index % cardGradients.length];
                            const tiltClass = index % 2 === 0 ? 'group-hover:rotate-1.5' : 'group-hover:-rotate-1.5';
                            
                            return (
                                <article 
                                    key={title} 
                                    className="group flex flex-col justify-between rounded-2xl border border-slate-200 bg-white/45 backdrop-blur-lg text-slate-900 overflow-hidden shadow-sm ring-1 ring-slate-100/5 transition-all duration-300 hover:shadow-xl hover:border-slate-350 hover:bg-white/70 hover:-translate-y-2 text-left"
                                >
                                    <div className={`h-48 bg-gradient-to-br ${style.bg} border-b border-slate-200/50 overflow-hidden relative flex flex-col justify-start`}>
                                        <div className={`relative flex h-full w-full origin-center flex-col overflow-hidden bg-white transition-all duration-500 group-hover:scale-[1.04] ${tiltClass}`}>
                                            <div className="flex h-5 shrink-0 select-none items-center gap-1 border-b border-slate-100 bg-slate-50/80 px-2">
                                                <span className="h-1 w-1 rounded-full bg-slate-300" />
                                                <span className="h-1 w-1 rounded-full bg-slate-300" />
                                                <span className="h-1 w-1 rounded-full bg-slate-300" />
                                            </div>
                                            <img 
                                                src={image} 
                                                alt={title} 
                                                className="h-full w-full object-cover object-top opacity-90 transition-opacity duration-300 group-hover:opacity-100"
                                                style={{ objectPosition: imagePosition }}
                                            />
                                        </div>
                                    </div>
                                    
                                    <div className="flex flex-1 flex-col justify-between p-6">
                                        <div>
                                            <div className="mb-3 flex items-center gap-2.5">
                                                <div className={`h-7 w-7 shrink-0 rounded-lg ${style.badgeBg} border flex items-center justify-center ${style.iconColor} shadow-sm backdrop-blur-sm`}>
                                                    <Icon className="h-4 w-4" />
                                                </div>
                                                <h3 className="text-base font-bold tracking-tight text-slate-950">{title}</h3>
                                            </div>
                                            <p className="text-sm font-medium leading-relaxed text-slate-500">{copy}</p>
                                        </div>
                                        <Link 
                                            to={href} 
                                            className="mt-6 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-600 transition-all hover:translate-x-0.5 hover:text-sky-700"
                                        >
                                            Learn more <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                                        </Link>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </div>
            </section>

            {/* Understand What Your Customers Want Section */}
                <section className="relative overflow-hidden bg-[linear-gradient(180deg,rgba(228,248,255,0.9)_0%,rgba(239,244,255,0.9)_56%,rgba(246,240,255,0.88)_100%)] py-24 sm:py-28 lg:overflow-visible">
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

            {/* Win Together Section (Horizontal tabs + Testimonials + Images) */}
                <section className="relative overflow-hidden bg-[linear-gradient(180deg,rgba(246,240,255,0.88)_0%,rgba(236,253,245,0.92)_100%)] py-20 sm:py-28 lg:overflow-visible">
                <div className={`${shellClass} relative z-10`}>
                    <div className="mx-auto max-w-3xl text-center">
                        <h2 className="text-balance pb-1 font-display text-4xl font-extrabold tracking-normal bg-gradient-to-br from-slate-950 via-blue-950 to-emerald-900 bg-clip-text text-transparent sm:text-5xl">Plug leaks as a team</h2>
                        <p className="mx-auto mt-4 max-w-2xl text-balance text-lg font-medium text-slate-500">
                            Unite your product, growth, and engineering teams to isolate conversion friction and stream code-fix context packages directly to developer AI workflows.
                        </p>
                    </div>

                    {/* Horizontal Tabs selector */}
                    <div className="mt-10 flex justify-center sm:mt-12">
                        <div className="grid w-full max-w-xl grid-cols-2 gap-2 rounded-2xl border border-slate-200/80 bg-white/60 p-2 shadow-sm backdrop-blur-md sm:inline-flex sm:w-auto sm:max-w-none sm:rounded-full sm:p-1.5">
                            {winTogetherTabs.map(tab => {
                                const isActive = activeWinTab === tab.id;
                                return (
                                    <button
                                        key={tab.id}
                                        onClick={() => setActiveWinTab(tab.id as 'product' | 'growth' | 'data' | 'engineering')}
                                        className={`flex min-w-0 flex-col items-center rounded-xl border px-2.5 py-2.5 text-center font-sans text-xs font-bold transition sm:shrink-0 sm:rounded-full sm:px-5 ${
                                            isActive 
                                                ? 'border-blue-600/30 bg-gradient-to-r from-blue-600 to-sky-700 text-white shadow-md ring-1 ring-blue-500/20'
                                                : 'border-transparent text-slate-500 hover:text-slate-950 hover:bg-white/45'
                                        }`}
                                    >
                                        <span className="max-w-full break-words text-[9px] font-medium uppercase leading-tight tracking-[0.06em] opacity-[0.65] sm:text-[10px] sm:tracking-wider">{tab.category}</span>
                                        <span className="mt-0.5 max-w-full break-words leading-tight">{tab.title}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Dynamic Tabs Content */}
                    <div className="relative z-10 mt-10 grid min-w-0 gap-8 rounded-[1.5rem] border border-slate-200/80 bg-white/[0.52] p-5 text-left shadow-xl ring-1 ring-slate-100/5 backdrop-blur-md sm:mt-12 sm:rounded-3xl sm:p-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:gap-12">
                        {/* Workflow details */}
                        <div className="space-y-6">
                            <h3 className="text-balance text-2xl font-extrabold leading-tight tracking-normal text-slate-900 [overflow-wrap:anywhere] sm:text-3xl">
                                {activeWin.headline}
                            </h3>
                            
                            <p className="border-l-4 border-blue-600 pl-4 text-sm leading-relaxed text-slate-600 sm:text-base">
                                {activeWin.summary}
                            </p>

                            <div className="mt-6 space-y-4">
                                {activeWin.points.map((point) => (
                                    <div key={point} className="flex items-start gap-3 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 group/point">
                                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 transition-transform group-hover/point:scale-110" />
                                        <span className="leading-relaxed">{point}</span>
                                    </div>
                                ))}
                            </div>

                            <div>
                                <Link 
                                    to={activeWin.href} 
                                    className="inline-flex items-center gap-1.5 text-sm font-bold text-blue-600 hover:text-sky-700 transition hover:translate-x-0.5"
                                >
                                    Learn more <ArrowRight className="h-4 w-4 transition-transform hover:translate-x-0.5" />
                                </Link>
                            </div>
                        </div>

                        {/* Image Panel */}
                        <div className="rounded-2xl border border-slate-200/80 bg-white/35 backdrop-blur-md p-2 shadow-xl overflow-hidden relative group">
                            <div className="rounded-xl border border-slate-200/70 bg-white shadow-md overflow-hidden transition-all duration-500 group-hover:scale-[1.015]">
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
                                    src={activeWin.image} 
                                    alt={activeWin.title} 
                                    className="w-full h-auto object-cover opacity-95 group-hover:opacity-100 transition-opacity"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Rejourney Marlin GitHub App Section */}
                <section className="relative overflow-hidden bg-[linear-gradient(180deg,rgba(236,253,245,0.92)_0%,rgba(240,249,255,0.9)_44%,rgba(255,247,237,0.9)_100%)] px-5 py-24 sm:px-8 sm:py-28 lg:overflow-visible lg:px-10">
                <div className="relative z-10 mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
                    <div className="max-w-3xl">
                        <p className="text-xs font-bold uppercase tracking-wider text-cyan-700">
                            Rejourney Marlin for GitHub
                        </p>
                        <h2 className="mt-5 max-w-4xl font-display text-4xl font-extrabold leading-tight tracking-normal text-slate-950 sm:text-6xl lg:text-7xl">
                            Fix the leaks your replays expose.
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
                <section className="relative overflow-hidden bg-[linear-gradient(180deg,rgba(255,247,237,0.9)_0%,rgba(248,251,255,0.95)_100%)] px-5 py-24 sm:px-8 sm:py-28 lg:px-10">
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
