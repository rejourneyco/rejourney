import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
    ArrowRight,
    Bug,
    CheckCircle2,
    Eye,
    EyeOff,
    Github,
    LockKeyhole,
    MousePointerClick,
    Server,
    ShieldCheck,
    TrendingUp,
    Zap,
} from 'lucide-react';
import { MarkExpo, MarkReactNative, MarkSwift } from './PlatformMarks';
import type { MarketingHomeCopy } from '~/shared/lib/internationalMarketing';

const EuFlag: React.FC<{ className?: string }> = ({ className = '' }) => (
    <svg viewBox="0 0 48 32" className={className} role="img" aria-label="European Union flag">
        <rect width="48" height="32" rx="6" fill="#1d4ed8" />
        {Array.from({ length: 12 }).map((_, index) => {
            const angle = (index / 12) * Math.PI * 2 - Math.PI / 2;
            const cx = (24 + Math.cos(angle) * 8.5).toFixed(3);
            const cy = (16 + Math.sin(angle) * 8.5).toFixed(3);
            return <circle key={index} cx={cx} cy={cy} r="1.2" fill="#fde047" />;
        })}
    </svg>
);

type SankeyNode = {
    id: string;
    label: string;
    value: string;
    x: number;
    y: number;
    h: number;
    w?: number;
    color: string;
    labelX: number;
    labelY: number;
    labelAnchor?: 'start' | 'end';
};

type SankeyFlow = {
    from: string;
    to: string;
    fromY: number;
    toY: number;
    width: number;
    color: string;
    delay: number;
};

const sankeyStages = [
    { step: '01', label: 'Identify issue', x: 42, width: 350, color: '#2563eb' },
    { step: '02', label: 'Ship fix', x: 392, width: 388, color: '#f59e0b' },
    { step: '03', label: 'Measure milestone', x: 780, width: 380, color: '#16a34a' },
];

const sankeyNodes: SankeyNode[] = [
    { id: 'launch', label: 'Session scan', value: '2,857', x: 42, y: 58, h: 230, color: '#5dadec', labelX: 62, labelY: 56 },
    { id: 'home', label: 'Normal flow', value: '2,084', x: 222, y: 54, h: 158, color: '#2f3137', labelX: 242, labelY: 49 },
    { id: 'first', label: 'First action', value: '492', x: 222, y: 246, h: 62, color: '#60a5fa', labelX: 242, labelY: 247 },
    { id: 'email', label: 'Top users flagged', value: '42', x: 392, y: 44, h: 54, color: '#10b981', labelX: 412, labelY: 58 },
    { id: 'detail', label: 'Drop-off issue', value: '545', x: 392, y: 128, h: 112, color: '#6366f1', labelX: 412, labelY: 154 },
    { id: 'churn', label: 'Churn risk', value: '18', x: 392, y: 276, h: 48, color: '#fb7185', labelX: 412, labelY: 279 },
    { id: 'cart', label: 'Checkout fix', value: 'scoped', x: 590, y: 118, h: 96, color: '#0f766e', labelX: 610, labelY: 138 },
    { id: 'replay', label: 'Replay proof', value: '545', x: 590, y: 252, h: 58, color: '#f97316', labelX: 610, labelY: 257 },
    { id: 'checkout', label: 'Fix shipped', value: '2 days', x: 780, y: 120, h: 86, color: '#f59e0b', labelX: 800, labelY: 141 },
    { id: 'winback', label: 'Winback sent', value: '64%', x: 780, y: 250, h: 62, color: '#8b5cf6', labelX: 800, labelY: 262 },
    { id: 'fix', label: 'Funnel improved', value: '+15%', x: 974, y: 124, h: 128, w: 20, color: '#84cc16', labelX: 1006, labelY: 159 },
];

const sankeyFlows: SankeyFlow[] = [
    { from: 'launch', fromY: 112, to: 'home', toY: 96, width: 48, color: '#5dadec', delay: 80 },
    { from: 'launch', fromY: 224, to: 'first', toY: 278, width: 20, color: '#5dadec', delay: 130 },
    { from: 'home', fromY: 76, to: 'email', toY: 66, width: 14, color: '#10b981', delay: 180 },
    { from: 'home', fromY: 128, to: 'detail', toY: 174, width: 36, color: '#94a3b8', delay: 230 },
    { from: 'home', fromY: 176, to: 'churn', toY: 300, width: 20, color: '#fb7185', delay: 280 },
    { from: 'first', fromY: 278, to: 'detail', toY: 218, width: 16, color: '#fbbf24', delay: 330 },
    { from: 'detail', fromY: 162, to: 'cart', toY: 160, width: 34, color: '#14b8a6', delay: 380 },
    { from: 'detail', fromY: 218, to: 'replay', toY: 278, width: 18, color: '#f472b6', delay: 430 },
    { from: 'cart', fromY: 154, to: 'checkout', toY: 154, width: 30, color: '#67e8f9', delay: 480 },
    { from: 'cart', fromY: 192, to: 'winback', toY: 282, width: 13, color: '#f59e0b', delay: 530 },
    { from: 'email', fromY: 66, to: 'fix', toY: 162, width: 13, color: '#22c55e', delay: 580 },
    { from: 'churn', fromY: 300, to: 'replay', toY: 282, width: 16, color: '#f97316', delay: 630 },
    { from: 'replay', fromY: 282, to: 'winback', toY: 282, width: 15, color: '#8b5cf6', delay: 680 },
    { from: 'checkout', fromY: 154, to: 'fix', toY: 174, width: 22, color: '#84cc16', delay: 730 },
    { from: 'winback', fromY: 282, to: 'fix', toY: 204, width: 13, color: '#8b5cf6', delay: 780 },
];

const nodeById = sankeyNodes.reduce<Record<string, SankeyNode>>((acc, node) => {
    acc[node.id] = node;
    return acc;
}, {});

const ribbonPath = (from: SankeyNode, fromY: number, to: SankeyNode, toY: number, width: number): string => {
    const fromX = from.x + (from.w ?? 14);
    const toX = to.x;
    const bend = Math.max(68, (toX - fromX) * 0.46);
    const half = width / 2;
    return [
        `M ${fromX} ${fromY - half}`,
        `C ${fromX + bend} ${fromY - half}, ${toX - bend} ${toY - half}, ${toX} ${toY - half}`,
        `L ${toX} ${toY + half}`,
        `C ${toX - bend} ${toY + half}, ${fromX + bend} ${fromY + half}, ${fromX} ${fromY + half}`,
        'Z',
    ].join(' ');
};

const SankeyLabel: React.FC<{ node: SankeyNode }> = ({ node }) => {
    if (node.id === 'fix') {
        const nodeWidth = node.w ?? 14;
        const cardX = node.labelX;
        const cardY = node.labelY;

        return (
            <g>
                <path
                    d={`M ${node.x + nodeWidth} ${node.y + node.h / 2} H ${cardX}`}
                    stroke="#0f172a"
                    strokeWidth="1.5"
                    strokeDasharray="4 3"
                    strokeLinecap="round"
                    opacity="0.3"
                />
                {/* neo-brutalist shadow */}
                <rect x={cardX + 3} y={cardY + 3} width="188" height="58" fill="#0f172a" />
                {/* card background */}
                <rect x={cardX} y={cardY} width="188" height="58" fill="white" stroke="#0f172a" strokeWidth="2" />
                {/* green accent bar */}
                <rect x={cardX} y={cardY} width="6" height="58" fill="#84cc16" />
                <text x={cardX + 16} y={cardY + 23} fill="#0f172a" fontSize="15" fontWeight="950" fontFamily="monospace" letterSpacing="0.3">
                    +15% FUNNEL
                </text>
                <text x={cardX + 16} y={cardY + 42} fill="#64748b" fontSize="9.5" fontWeight="800" fontFamily="monospace" letterSpacing="0.8">
                    MILESTONE · CHECKOUT FIX
                </text>
            </g>
        );
    }

    const text = `${node.label}: ${node.value}`;
    const width = Math.max(76, text.length * 6.1 + 18);
    const x = node.labelAnchor === 'end' ? node.labelX - width : node.labelX;
    const y = node.labelY;

    return (
        <g>
            <rect x={x} y={y} width={width} height="24" rx="2" fill="rgba(255,255,255,0.94)" stroke="rgba(15,23,42,0.18)" />
            <text x={x + 8} y={y + 16.2} fill="#0f172a" fontSize="11.5" fontWeight="850">
                {text}
            </text>
        </g>
    );
};

const SankeyDiagram: React.FC<{ active: boolean }> = ({ active }) => (
    <svg
        viewBox="0 0 1200 360"
        className="mx-auto h-auto w-full max-w-[1580px]"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
    >
        <defs>
            <filter id="sankeySoftShadow" x="-8%" y="-12%" width="116%" height="124%">
                <feDropShadow dx="0" dy="7" stdDeviation="8" floodColor="#0f172a" floodOpacity="0.09" />
            </filter>
        </defs>
        {sankeyStages.map((stage) => (
            <g key={stage.label} opacity={active ? 1 : 0} style={{ transition: 'opacity 0.35s ease-out' }}>
                <text x={stage.x} y="22" fill={stage.color} fontSize="13" fontWeight="950" letterSpacing="0.7">
                    {stage.step} / {stage.label.toUpperCase()}
                </text>
                <path d={`M ${stage.x} 35 H ${stage.x + stage.width - 18}`} stroke={stage.color} strokeWidth="3.2" strokeLinecap="round" opacity="0.62" />
            </g>
        ))}
        {sankeyFlows.map((flow) => {
            const from = nodeById[flow.from];
            const to = nodeById[flow.to];
            return (
                <path
                    key={`${flow.from}-${flow.to}-${flow.toY}`}
                    d={ribbonPath(from, flow.fromY, to, flow.toY, flow.width)}
                    fill={flow.color}
                    opacity={active ? 0.22 : 0}
                    style={{ transition: `opacity 0.45s ${flow.delay}ms ease-out` }}
                />
            );
        })}
        {sankeyNodes.map((node) => (
            <g key={node.id}>
                <rect
                    x={node.x}
                    y={node.y}
                    width={node.w ?? 14}
                    height={node.h}
                    rx="2"
                    fill={node.color}
                    filter="url(#sankeySoftShadow)"
                    opacity={active ? 1 : 0}
                    style={{ transition: `opacity 0.35s 120ms ease-out` }}
                />
                <SankeyLabel node={node} />
            </g>
        ))}
    </svg>
);

const mobileSankeyNodes: SankeyNode[] = [
    { id: 'launch', label: 'Scan', value: '2.8k', x: 24, y: 54, h: 184, w: 10, color: '#5dadec', labelX: 40, labelY: 44 },
    { id: 'home', label: 'Flow', value: '2.0k', x: 108, y: 54, h: 134, w: 10, color: '#2f3137', labelX: 124, labelY: 57 },
    { id: 'first', label: 'First', value: '492', x: 108, y: 226, h: 46, w: 10, color: '#60a5fa', labelX: 124, labelY: 225 },
    { id: 'email', label: 'Users', value: '42', x: 192, y: 26, h: 42, w: 10, color: '#10b981', labelX: 208, labelY: 27 },
    { id: 'detail', label: 'Issue', value: '545', x: 192, y: 118, h: 88, w: 10, color: '#6366f1', labelX: 208, labelY: 123 },
    { id: 'churn', label: 'Risk', value: '18', x: 192, y: 246, h: 42, w: 10, color: '#fb7185', labelX: 208, labelY: 261 },
    { id: 'checkout', label: 'Fix', value: '2d', x: 278, y: 108, h: 70, w: 10, color: '#f59e0b', labelX: 294, labelY: 108 },
    { id: 'winback', label: 'Winback', value: '64%', x: 278, y: 224, h: 56, w: 10, color: '#8b5cf6', labelX: 294, labelY: 224 },
    { id: 'fix', label: 'Funnel', value: '+15%', x: 354, y: 124, h: 80, w: 10, color: '#84cc16', labelX: 376, labelY: 144, labelAnchor: 'end' },
];

const mobileSankeyFlows: SankeyFlow[] = [
    { from: 'launch', fromY: 102, to: 'home', toY: 94, width: 32, color: '#5dadec', delay: 80 },
    { from: 'launch', fromY: 202, to: 'first', toY: 250, width: 16, color: '#5dadec', delay: 130 },
    { from: 'home', fromY: 74, to: 'email', toY: 48, width: 10, color: '#10b981', delay: 180 },
    { from: 'home', fromY: 124, to: 'detail', toY: 158, width: 24, color: '#94a3b8', delay: 230 },
    { from: 'home', fromY: 168, to: 'churn', toY: 268, width: 16, color: '#fb7185', delay: 280 },
    { from: 'first', fromY: 250, to: 'detail', toY: 188, width: 12, color: '#fbbf24', delay: 330 },
    { from: 'email', fromY: 48, to: 'fix', toY: 148, width: 9, color: '#22c55e', delay: 380 },
    { from: 'detail', fromY: 150, to: 'checkout', toY: 142, width: 20, color: '#14b8a6', delay: 430 },
    { from: 'detail', fromY: 190, to: 'winback', toY: 252, width: 12, color: '#f472b6', delay: 480 },
    { from: 'checkout', fromY: 142, to: 'fix', toY: 162, width: 16, color: '#84cc16', delay: 530 },
    { from: 'churn', fromY: 268, to: 'winback', toY: 252, width: 12, color: '#8b5cf6', delay: 580 },
    { from: 'winback', fromY: 252, to: 'fix', toY: 184, width: 10, color: '#8b5cf6', delay: 630 },
];

const mobileNodeById = mobileSankeyNodes.reduce<Record<string, SankeyNode>>((acc, node) => {
    acc[node.id] = node;
    return acc;
}, {});

const MobileSankeyLabel: React.FC<{ node: SankeyNode }> = ({ node }) => {
    if (node.id === 'fix') {
        return (
            <g>
                <rect x="258" y="136" width="118" height="44" rx="3" fill="rgba(255,255,255,0.96)" stroke="#65a30d" strokeWidth="1.4" />
                <rect x="258" y="136" width="5" height="44" rx="1.5" fill="#84cc16" />
                <text x="269" y="155" fill="#0f172a" fontSize="13.5" fontWeight="950">
                    +15% lift
                </text>
                <text x="269" y="171" fill="#334155" fontSize="7.5" fontWeight="850">
                    milestone after fix
                </text>
            </g>
        );
    }

    const text = `${node.label}: ${node.value}`;
    const width = Math.max(56, text.length * 5.8 + 13);
    const x = node.labelAnchor === 'end' ? node.labelX - width : node.labelX;
    const y = node.labelY;

    return (
        <g>
            <rect x={x} y={y} width={width} height="20" rx="2" fill="rgba(255,255,255,0.94)" stroke="rgba(15,23,42,0.18)" />
            <text x={x + 6} y={y + 13.5} fill="#0f172a" fontSize="9.5" fontWeight="850">
                {text}
            </text>
        </g>
    );
};

const MobileSankeyDiagram: React.FC<{ active: boolean }> = ({ active }) => (
    <svg viewBox="0 0 390 320" className="mx-auto h-auto w-full max-w-[560px]" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <text x="24" y="18" fill="#2563eb" fontSize="9" fontWeight="900" letterSpacing="0.7">
            IDENTIFY
        </text>
        <text x="192" y="18" fill="#f59e0b" fontSize="9" fontWeight="900" letterSpacing="0.7">
            FIX
        </text>
        <text x="300" y="18" fill="#16a34a" fontSize="9" fontWeight="900" letterSpacing="0.7">
            MILESTONE
        </text>
        {mobileSankeyFlows.map((flow) => {
            const from = mobileNodeById[flow.from];
            const to = mobileNodeById[flow.to];
            return (
                <path
                    key={`${flow.from}-${flow.to}-${flow.toY}`}
                    d={ribbonPath(from, flow.fromY, to, flow.toY, flow.width)}
                    fill={flow.color}
                    opacity={active ? 0.24 : 0}
                    style={{ transition: `opacity 0.4s ${flow.delay}ms ease-out` }}
                />
            );
        })}
        {mobileSankeyNodes.map((node) => (
            <g key={node.id}>
                <rect x={node.x} y={node.y} width={node.w ?? 10} height={node.h} rx="2" fill={node.color} />
                <MobileSankeyLabel node={node} />
            </g>
        ))}
    </svg>
);

const JourneyActionLoop: React.FC = () => {
    const ref = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const io = new IntersectionObserver(
            ([e]) => {
                if (e.isIntersecting) {
                    setActive(true);
                    io.disconnect();
                }
            },
            { threshold: 0.12 },
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);

    return (
        <div ref={ref} className="relative mt-7 min-w-0 sm:mt-9">
            <div className="pointer-events-none absolute inset-x-0 bottom-0 top-0 opacity-[0.22] [background-image:radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:18px_18px]" />
            <div className="relative hidden overflow-hidden md:block">
                <SankeyDiagram active={active} />
            </div>
            <div className="relative md:hidden">
                <MobileSankeyDiagram active={active} />
            </div>
        </div>
    );
};

const productStories = [
    {
        eyebrow: 'Session recordings',
        title: 'Watch real users move through your app.',
        copy: 'Replay mobile sessions with enough context to answer the question everyone asks first: what actually happened?',
        bullets: ['Pixel-perfect mobile replay', 'Touch trails and screen changes', 'Network, logs, and device context'],
        image: '/images/session-replay-preview.png',
        alt: 'Rejourney session replay preview',
        icon: Eye,
        accent: 'bg-[#e8f4ff]',
    },
    {
        eyebrow: 'Heatmaps and journeys',
        title: 'See what grabs attention and where people drop.',
        copy: 'Turn scattered taps, swipes, scrolls, and exits into a map of the screens that help or hurt conversion.',
        bullets: ['Tap and rage-tap clusters', 'Journey maps across screens', 'Drop-off points by flow'],
        image: '/images/heatmaps.png',
        alt: 'Rejourney touch heatmaps preview',
        icon: MousePointerClick,
        accent: 'bg-[#ffe4e6]',
    },
    {
        eyebrow: 'Crashes and ANRs',
        title: 'Tie broken experiences to the session that caused them.',
        copy: 'Crash reporting is more useful when it sits beside replay, thread analysis, device details, and the user path.',
        bullets: ['Crash and ANR detection', 'Main-thread performance clues', 'Incident stream for triage'],
        image: '/images/anr-issues.png',
        alt: 'Rejourney ANR and crash detection preview',
        icon: Bug,
        accent: 'bg-[#fef9c3]',
    },
    {
        eyebrow: 'Growth loops',
        title: 'Connect product quality to retention.',
        copy: 'Measure whether releases are creating better sessions, calmer funnels, and more users who come back.',
        bullets: ['Retention and loyalty segments', 'Release impact signals', 'Funnel recovery opportunities'],
        image: '/images/growth-engines.png',
        alt: 'Rejourney growth analytics preview',
        icon: TrendingUp,
        accent: 'bg-[#dcfce7]',
    },
];

const trustCards = [
    {
        title: 'GDPR compliance',
        copy: 'EU-oriented controls for masking, redaction, data minimization, and optional geolocation collection.',
        icon: ShieldCheck,
        flag: true,
        className: 'sm:col-span-2 bg-[#eff6ff]',
    },
    {
        title: 'Open source',
        copy: 'Inspect the code, verify the SDK behavior, and keep the roadmap accountable to real mobile teams.',
        icon: Github,
        className: 'bg-white',
    },
    {
        title: 'Self-hostable',
        copy: 'Run Rejourney on your own infrastructure when recordings and metadata need to stay under your control.',
        icon: Server,
        className: 'bg-white',
    },
    {
        title: 'Privacy controls',
        copy: 'Mask sensitive UI, redact fields, avoid unnecessary location data, and keep collection intentional.',
        icon: LockKeyhole,
        className: 'bg-white',
    },
    {
        title: 'Light mobile SDK',
        copy: "A 13.2 kB gzipped React Native SDK with async capture work kept out of the user's way.",
        icon: Zap,
        className: 'bg-white',
    },
    {
        title: 'Observe-only mode',
        copy: 'Set observeOnly: true to disable visual session replay while still sending anonymized telemetry for errors, crashes, ANRs, network activity, and events.',
        icon: EyeOff,
        className: 'sm:col-span-2 bg-[#f8fafc]',
    },
];

export const LandingNarrative: React.FC<{ copy: MarketingHomeCopy['narrative']; dir?: 'ltr' | 'rtl' }> = ({ copy, dir = 'ltr' }) => {
    const renderedStories = productStories.map((story, index) => ({
        ...story,
        ...(copy.productStories[index] ?? {}),
    }));
    const renderedTrustCards = trustCards.map((card, index) => ({
        ...card,
        ...(copy.trustCards[index] ?? {}),
    }));
    const alignClass = dir === 'rtl' ? 'text-right' : 'text-left';

    return (
        <div dir={dir} className={alignClass}>
            <section id="journey-action-center" className="relative w-full overflow-hidden border-b-2 border-black bg-[#f8fafc] px-4 pb-4 pt-10 text-slate-950 sm:px-6 sm:pb-8 sm:pt-14 lg:px-8">
                <div
                    className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(#000_1px,transparent_1px),linear-gradient(90deg,#000_1px,transparent_1px)] [background-size:34px_34px]"
                    aria-hidden
                />
                <div className="relative mx-auto max-w-[1680px]">
                    <div className="max-w-5xl lg:ml-2">
                        <p className="mb-3 text-[11px] font-black uppercase text-[#2563eb]">{copy.loopEyebrow}</p>
                        <h2 className="break-words text-4xl font-black uppercase leading-[0.96] sm:text-5xl lg:text-6xl">
                            {copy.loopHeadingLines.map((line) => (
                                <span key={line} className="block">{line}</span>
                            ))}
                        </h2>
                        <p className="mt-5 max-w-3xl text-base font-bold leading-relaxed text-slate-600 sm:text-lg lg:text-xl">
                            {copy.loopIntro}
                        </p>
                    </div>

                    <JourneyActionLoop />
                </div>
            </section>

            <section className="w-full bg-[#f8fafc] px-4 py-14 text-slate-950 sm:px-6 sm:py-24 lg:px-8">
                <div className="mx-auto max-w-7xl">
                    <div className="mb-10 flex flex-col gap-5 lg:mb-14 lg:flex-row lg:items-end lg:justify-between">
                        <div className="min-w-0">
                            <p className="mb-4 text-[11px] font-black uppercase text-[#2563eb]">{copy.signalsEyebrow}</p>
                            <h2 className="max-w-4xl break-words text-3xl font-black uppercase leading-tight tracking-tight sm:text-6xl">
                                {copy.signalsHeading}
                            </h2>
                        </div>
                        <Link
                            to="/demo"
                            className="inline-flex w-full items-center justify-center gap-2 border-2 border-black bg-[#fef08a] px-5 py-3 text-sm font-black uppercase text-black shadow-neo transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:bg-[#67e8f9] hover:shadow-neo-lg active:translate-x-0 active:translate-y-0 active:shadow-none sm:w-auto sm:px-6 sm:py-4"
                        >
                            {copy.demoCta}
                            <ArrowRight size={17} strokeWidth={3} />
                        </Link>
                    </div>

                    <div className="space-y-5 lg:space-y-7">
                        {renderedStories.map((story, index) => {
                            const Icon = story.icon;
                            const imageOrder = index % 2 === 1 ? 'lg:order-last' : '';

                            return (
                                <article
                                    key={story.title}
                                    className="grid overflow-hidden border-2 border-black bg-white shadow-neo lg:grid-cols-2"
                                >
                                    <div className={`min-h-[220px] border-b-2 border-black bg-white p-2 sm:min-h-[260px] sm:p-3 lg:min-h-[420px] lg:border-b-0 ${index % 2 === 1 ? 'lg:border-l-2 lg:border-black' : 'lg:border-r-2 lg:border-black'} ${imageOrder}`}>
                                        <div className={`flex h-full items-center ${story.accent} p-3`}>
                                            <img
                                                src={story.image}
                                                alt={story.alt}
                                                className="h-full max-h-[390px] w-full border-2 border-black object-cover object-left-top"
                                                loading="lazy"
                                            />
                                        </div>
                                    </div>
                                    <div className="flex min-w-0 flex-col justify-center p-5 sm:p-8 lg:p-12">
                                        <div className={`mb-6 grid h-12 w-12 shrink-0 place-items-center border-2 border-black ${story.accent}`}>
                                            <Icon size={22} strokeWidth={2.7} />
                                        </div>
                                        <p className="mb-3 text-[11px] font-black uppercase text-slate-400">{story.eyebrow}</p>
                                        <h3 className="max-w-xl break-words text-2xl font-black uppercase leading-tight tracking-tight sm:text-4xl">
                                            {story.title}
                                        </h3>
                                        <p className="mt-5 max-w-xl text-base font-bold leading-relaxed text-slate-600">{story.copy}</p>
                                        <div className="mt-6 grid gap-3">
                                            {story.bullets.map((bullet) => (
                                                <div key={bullet} className="flex items-center gap-3 text-sm font-black text-slate-800">
                                                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" strokeWidth={3} />
                                                    {bullet}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="w-full border-t-2 border-b-2 border-black bg-white px-4 py-14 text-slate-950 sm:px-6 sm:py-24 lg:px-8">
                <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
                    <div className="min-w-0 lg:sticky lg:top-24">
                        <p className="mb-4 text-[11px] font-black uppercase text-[#2563eb]">{copy.trustEyebrow}</p>
                        <h2 className="break-words text-3xl font-black uppercase leading-tight tracking-tight sm:text-6xl">
                            {copy.trustHeading}
                        </h2>
                        <p className="mt-5 max-w-xl text-base font-bold leading-relaxed text-slate-600">
                            {copy.trustCopy}
                        </p>

                        <div className="mt-7 flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-[11px] font-black uppercase shadow-neo-sm">
                                <MarkExpo className="h-4 w-4" />
                                Expo
                            </span>
                            <span className="inline-flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-[11px] font-black uppercase shadow-neo-sm">
                                <MarkReactNative className="h-4 w-4 text-[#2563eb]" />
                                React Native
                            </span>
                            <span className="inline-flex items-center gap-2 border-2 border-black bg-white px-3 py-2 text-[11px] font-black uppercase shadow-neo-sm">
                                <MarkSwift className="h-4 w-4 text-[#f97316]" />
                                Swift
                            </span>
                        </div>
                    </div>

                    <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                        {renderedTrustCards.map((card) => {
                            const Icon = card.icon;
                            const isFeatured = Boolean(card.flag);
                            return (
                                <article
                                    key={card.title}
                                    className={`${isFeatured ? 'border-2 border-black shadow-neo-sm' : 'border border-slate-200 shadow-none'} p-5 ${card.className}`}
                                >
                                    <div className="mb-5 flex items-center gap-3">
                                        {card.flag && <EuFlag className="h-8 w-12 shrink-0" />}
                                        {Icon && (
                                            <span className={`grid h-10 w-10 shrink-0 place-items-center bg-white text-[#2563eb] ${isFeatured ? 'border-2 border-black' : 'border border-slate-200'}`}>
                                                <Icon className="h-5 w-5" strokeWidth={2.7} />
                                            </span>
                                        )}
                                    </div>
                                    <h3 className="text-lg font-black uppercase">{card.title}</h3>
                                    <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-600">{card.copy}</p>
                                </article>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="w-full bg-[#e8f4ff] px-4 py-10 text-slate-950 sm:px-6 lg:px-8">
                <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
                    <div className="border-2 border-black bg-white px-6 py-5 shadow-neo-sm">
                        <div className="text-3xl font-black leading-none sm:text-5xl">{copy.stats.cheaper}</div>
                        <div className="mt-3 max-w-xl text-[12px] font-black uppercase leading-relaxed text-slate-500">
                            {copy.stats.cheaperCopy}
                        </div>
                    </div>
                    <div className="border-2 border-black bg-white px-6 py-5 shadow-neo-sm">
                        <div className="text-3xl font-black leading-none sm:text-4xl">{copy.stats.freeSessions}</div>
                        <div className="mt-3 text-[11px] font-black uppercase text-slate-500">{copy.stats.everyMonth}</div>
                    </div>
                    <div className="border-2 border-black bg-white px-6 py-5 shadow-neo-sm">
                        <div className="text-3xl font-black leading-none">{copy.stats.allFeatures}</div>
                        <div className="mt-3 text-[11px] font-black uppercase text-slate-500">{copy.stats.allFeaturesCopy}</div>
                    </div>
                </div>
            </section>
        </div>
    );
};
