import React, { useState } from 'react';
import { Link, useLocation } from 'react-router';
import {
    ArrowRight,
    Check,
    Copy,
    Feather,
} from 'lucide-react';
import { getMarketingHomeCopy } from '~/shared/lib/internationalMarketing';
import { useToast } from '~/shared/providers/ToastContext';
import { EuFlag } from './EuFlag';
import { LandingThreeField } from './LandingThreeField';
import { MarkAngular, MarkReactNative, MarkSwift, MarkNextJs, MarkRemix, MarkSvelte, MarkVue } from './PlatformMarks';
import { FaqSection } from './FaqSection';
import { CodeBlock } from '~/shared/ui/core/CodeBlock';

const LOGIN_PATH = '/login';
const LANDING_IMAGE_VERSION = '20260619';
const landingImage = (path: string) => `${path}?v=${LANDING_IMAGE_VERSION}`;

const SESSION_REPLAY_IMAGE = landingImage('/images/landing-replay-workbench.png');
const ISSUE_FEED_IMAGE = landingImage('/images/issues-feed.png');
const REVENUE_IMAGE = landingImage('/images/growth-engines.png');
const STABILITY_IMAGE = landingImage('/images/anr-issues.png');
const CONTEXT_HANDOFF_IMAGE = landingImage('/images/readme-general-demo.png');
const GEO_IMAGE = landingImage('/images/geo-intelligence.png');

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
                        <h1 className="landing-hero-title mx-auto max-w-6xl bg-gradient-to-br from-slate-950 via-blue-950 to-sky-900 bg-clip-text font-display text-[1.68rem] font-extrabold leading-[1.04] tracking-normal text-transparent drop-shadow-[0_18px_44px_rgba(37,99,235,0.08)] min-[360px]:text-[1.95rem] min-[430px]:text-[2.2rem] sm:text-[3.05rem] md:text-[3.65rem] lg:text-[4.45rem] xl:text-[5.35rem]">
                            <span className="block whitespace-nowrap">From Session</span>
                            <span className="block whitespace-nowrap">Diagnostics To</span>
                            <span className="block whitespace-nowrap">Revenue Acceleration.</span>
                        </h1>
                        <p className="landing-hero-subtitle mx-auto mt-8 max-w-3xl text-balance text-lg font-medium leading-relaxed text-slate-600 sm:text-xl md:text-2xl">
                            Make sure your users onboard, convert, and finish checkout.
                        </p>
                        {/* Action buttons matching style */}
                        <div className="landing-hero-actions mt-9 flex w-full max-w-[20.5rem] flex-col items-center justify-center gap-3 sm:mt-11 sm:w-auto sm:max-w-none sm:flex-row">
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
                    <div className="landing-platforms mx-auto mt-24 max-w-5xl flex flex-col items-center justify-center gap-4 border-t border-slate-200/70 pt-8">

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
            </section>

            <div className="landing-after-hero relative z-10 overflow-hidden bg-[linear-gradient(180deg,#f8fafc_0%,#f4f7fe_25%,#faf6ff_50%,#f4faf6_75%,#f8fafc_100%)]">
                <LandingThreeField variant="landing-sparse" seed={307} className="landing-after-hero-field" />
                <div className="pointer-events-none absolute inset-0 z-[0] bg-[radial-gradient(circle_at_15%_9%,rgba(37,99,235,0.015),transparent_31%),radial-gradient(circle_at_86%_22%,rgba(139,92,246,0.015),transparent_34%),radial-gradient(circle_at_18%_52%,rgba(245,158,11,0.015),transparent_34%),radial-gradient(circle_at_82%_78%,rgba(16,185,129,0.015),transparent_34%)]" aria-hidden="true" />
                <div className="pointer-events-none absolute inset-0 z-[1] bg-[linear-gradient(180deg,rgba(255,255,255,0.35)_0%,rgba(255,255,255,0.12)_28%,rgba(255,255,255,0.08)_56%,rgba(255,255,255,0.25)_100%)]" aria-hidden="true" />
                <div className="pointer-events-none absolute inset-x-0 top-[33rem] z-[1] h-px bg-gradient-to-r from-transparent via-sky-200/45 to-transparent" aria-hidden="true" />

            {/* Detailed Marlin Product Sections */}
            <section className="landing-section relative z-10 overflow-hidden bg-transparent px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
                <div className="mx-auto max-w-7xl space-y-32">
                    
                    {/* Section: Replay Context */}
                    <div className="space-y-8">
                        <div className="mx-auto max-w-4xl text-center">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Replay context</p>
                            <h3 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                First, Rejourney records the user sessions.
                            </h3>
                            <p className="mt-4 text-base font-medium leading-8 text-slate-600">
                                The user's session and journey is recorded as a video with collected metadata. 
                            </p>
                        </div>
                        <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70">
                            <img src={SESSION_REPLAY_IMAGE} alt="Rejourney session replay screen showing user journey steps and timeline context" className="w-full rounded-[1.35rem] object-cover" />
                        </div>
                    </div>

                    {/* Section: Issue Detection */}
                    <div className="grid gap-12 lg:grid-cols-[0.42fr_0.58fr] lg:items-center">
                        <div className="space-y-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Issue detection</p>
                            <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                Then, Rejourney creates the ranked "leaks" feed.
                            </h3>
                            <p className="text-base font-medium leading-8 text-slate-600">
                                Rejourney groups repeated checkout failures, rage taps, broken onboarding paths, and abandoned funnels into signals. Marlin reads the same evidence your team sees: affected users, session count, failure cluster, and why the leak matters.
                            </p>
                        </div>
                        <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70">
                            <div className="overflow-hidden rounded-[1.35rem] aspect-[16/10]">
                                <img 
                                    src={ISSUE_FEED_IMAGE} 
                                    alt="Rejourney issue detection feed showing ranked leaks list" 
                                    className="w-[165%] max-w-none h-full object-cover object-left" 
                                />
                            </div>
                        </div>
                    </div>

                    {/* Section: Revenue Priority */}
                    <div className="grid gap-12 lg:grid-cols-[0.58fr_0.42fr] lg:items-center">
                        <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70 lg:order-first">
                            <img src={REVENUE_IMAGE} alt="Rejourney revenue growth dashboard with revenue trend and release markers" className="w-full rounded-[1.35rem] object-cover" />
                        </div>
                        <div className="space-y-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Revenue priority</p>
                            <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                The issues are ranked by business impact.
                            </h3>
                            <p className="text-base font-medium leading-8 text-slate-600">
                                Marlin can tell the difference between cosmetic noise and a checkout path that blocks revenue. Revenue movement, affected cohorts, and release timing travel into the GitHub suggestion so engineers know why the fix should move now.
                            </p>
                        </div>
                    </div>

                    {/* Section: Stability Evidence */}
                    <div className="grid gap-12 lg:grid-cols-[0.42fr_0.58fr] lg:items-center">
                        <div className="space-y-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Stability evidence</p>
                            <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                Crashes, ANRs, and API spikes become fix paths too.
                            </h3>
                            <p className="text-base font-medium leading-8 text-slate-600">
                                When the leak is technical, Marlin uses the same issue feed to connect stack traces, device cohorts, endpoint spikes, and replay context to likely files. The result is a focused repair brief instead of a vague stability ticket.
                            </p>
                        </div>
                        <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70">
                            <img src={STABILITY_IMAGE} alt="Rejourney stability monitoring table with crashes, ANRs, API spikes, events, and affected users" className="w-full rounded-[1.35rem] object-cover" />
                        </div>
                    </div>

                    {/* Section: IDE Handoff */}
                    <div className="grid gap-12 lg:grid-cols-[0.58fr_0.42fr] lg:items-center">
                        <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70 lg:order-first">
                            <img src={CONTEXT_HANDOFF_IMAGE} alt="Rejourney Markdown context handoff showing Copy md and Open Cursor options" className="w-full rounded-[1.35rem] object-cover" />
                        </div>
                        <div className="space-y-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">IDE Handoff</p>
                            <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                Generate a copyable .MD context file for your coding agent.
                            </h3>
                            <p className="text-base font-medium leading-8 text-slate-600">
                                Once the issue is analyzed, Marlin packs the entire diagnostic context—replay events, affected user sessions, and console stack traces—into an LLM-optimized Markdown payload. Copy it straight to your clipboard to paste into Cursor, Claude, or Copilot for an instant, precise code fix.
                            </p>
                        </div>
                    </div>

                    {/* Section: Conversion Growth */}
                    <div className="grid gap-12 lg:grid-cols-[0.42fr_0.58fr] lg:items-center">
                        <div className="space-y-4">
                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Growth impact</p>
                            <h3 className="text-3xl font-extrabold tracking-tight text-slate-950 sm:text-4xl">
                                Watch the conversion and growth impact.
                            </h3>
                            <p className="text-base font-medium leading-8 text-slate-600">
                                Track conversion recovery, regional cohorts, and revenue movement in real time. Verify that released fixes actually restored conversions and healed the leak.
                            </p>
                        </div>
                        <div className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-200/70">
                            <img src={GEO_IMAGE} alt="Rejourney geographical growth dashboard showing conversion recovery by region" className="w-full rounded-[1.35rem] object-cover" />
                        </div>
                    </div>

                </div>
            </section>

            {/* FAQ Section */}
            <FaqSection />

            {/* Bottom Call-To-Action (CTA) */}
                <section className="landing-section landing-sdk-section relative z-10 overflow-hidden bg-transparent px-5 py-24 sm:px-8 sm:py-28 lg:px-10">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-200/20 to-transparent" aria-hidden="true" />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(245,158,11,0.015),transparent_31%),radial-gradient(circle_at_82%_20%,rgba(37,99,235,0.015),transparent_33%),radial-gradient(circle_at_50%_88%,rgba(16,185,129,0.015),transparent_35%)]" aria-hidden="true" />
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
