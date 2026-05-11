import React from 'react';
import { Link } from 'react-router';
import {
    ArrowRight,
    Bookmark,
    ChevronLeft,
    MapPin,
    Navigation,
    Server,
    Zap,
} from 'lucide-react';
import type { MarketingHomeCopy, MarketingLocale } from '~/shared/lib/internationalMarketing';

const PhoneCursor: React.FC<{ className?: string }> = ({ className }) => (
    <svg viewBox="0 0 16 20" fill="none" className={className}>
        <path d="M0 0 L0 16 L4.5 12 L7.5 18.5 L10 17.5 L7 11 L12 11 Z" fill="#5dadec" />
        <path d="M0 0 L0 16 L4.5 12 L7.5 18.5 L10 17.5 L7 11 L12 11 Z" stroke="#020617" strokeWidth="1" />
    </svg>
);

const IPhone: React.FC<{
    children: React.ReactNode;
    size: 'sm' | 'lg';
    darkStatus?: boolean;
    shadowClass: string;
    className?: string;
}> = ({ children, size, darkStatus = false, shadowClass, className = '' }) => {
    const isLg = size === 'lg';
    const width = isLg ? 'clamp(230px, 17.5vw, 258px)' : 'clamp(188px, 13.2vw, 204px)';
    const shellRadius = isLg ? 'rounded-[44px]' : 'rounded-[38px]';
    const screenRadius = isLg ? 'rounded-[38px]' : 'rounded-[32px]';
    const islandWidth = isLg ? 'w-[82px]' : 'w-[68px]';
    const islandHeight = isLg ? 'h-[24px]' : 'h-[20px]';
    const sideButtonHeight = isLg ? 'h-14' : 'h-11';

    return (
        <div className={`relative ${className}`} style={{ width }}>
            <div className="absolute -left-[3px] top-[18%] h-6 w-[3px] rounded-l-full bg-[#101216]" />
            <div className="absolute -left-[3px] top-[28%] h-10 w-[3px] rounded-l-full bg-[#101216]" />
            <div className="absolute -left-[3px] top-[39%] h-10 w-[3px] rounded-l-full bg-[#101216]" />
            <div className={`absolute -right-[3px] top-[32%] w-[3px] rounded-r-full bg-[#101216] ${sideButtonHeight}`} />

            <div className={`relative overflow-hidden border border-black/80 bg-[#07090d] p-[4px] ${shellRadius} ${shadowClass}`}>
                <div className="pointer-events-none absolute inset-[2px] rounded-[inherit] border border-white/10" />

                <div
                    className={`relative overflow-hidden bg-[#f8fafc] ${screenRadius}`}
                    style={{ aspectRatio: '9 / 19.5' }}
                >
                    <div className={`pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between px-5 pt-[12px] font-mono text-[8px] font-black ${darkStatus ? 'text-white' : 'text-slate-900'}`}>
                        <span>9:41</span>
                        <div className="flex items-center gap-1 pt-[2px]">
                            <span className={`h-[5px] w-[13px] rounded-[2px] border ${darkStatus ? 'border-white' : 'border-black'}`}>
                                <span className={`block h-full w-[9px] ${darkStatus ? 'bg-white' : 'bg-black'}`} />
                            </span>
                        </div>
                    </div>
                    <div className={`absolute left-1/2 top-[8px] z-30 -translate-x-1/2 ${islandWidth} ${islandHeight} rounded-full bg-black shadow-[0_1px_6px_rgba(0,0,0,0.22)]`}>
                        <span className="absolute right-2.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[#111827]" />
                    </div>
                    {children}
                    <div className={`absolute bottom-[8px] left-1/2 h-[3px] w-20 -translate-x-1/2 rounded-full ${darkStatus ? 'bg-white/45' : 'bg-black/25'}`} />
                    <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[linear-gradient(120deg,rgba(255,255,255,0.14),transparent_34%,transparent_72%,rgba(255,255,255,0.08))]" />
                </div>
            </div>
        </div>
    );
};

type TouchTone = 'blue' | 'rose' | 'amber' | 'green';

const touchGradients: Record<TouchTone, string> = {
    blue: 'radial-gradient(circle, rgba(93,173,236,1) 0%, rgba(93,173,236,0.78) 24%, rgba(93,173,236,0.38) 52%, rgba(93,173,236,0.12) 74%, transparent 100%)',
    rose: 'radial-gradient(circle, rgba(244,63,94,1) 0%, rgba(251,113,133,0.82) 24%, rgba(251,113,133,0.42) 52%, rgba(251,113,133,0.14) 74%, transparent 100%)',
    amber: 'radial-gradient(circle, rgba(251,191,36,1) 0%, rgba(251,191,36,0.78) 24%, rgba(251,191,36,0.38) 52%, rgba(251,191,36,0.12) 74%, transparent 100%)',
    green: 'radial-gradient(circle, rgba(16,185,129,1) 0%, rgba(52,211,153,0.78) 24%, rgba(52,211,153,0.38) 52%, rgba(52,211,153,0.12) 74%, transparent 100%)',
};

const touchGlows: Record<TouchTone, string> = {
    blue: 'rgba(93,173,236,0.55)',
    rose: 'rgba(244,63,94,0.52)',
    amber: 'rgba(251,191,36,0.5)',
    green: 'rgba(16,185,129,0.5)',
};

const TouchPulse: React.FC<{
    top: string;
    left: string;
    size: number;
    tone?: TouchTone;
    className?: string;
}> = ({ top, left, size, tone = 'blue', className = '' }) => (
    <div
        className={`pointer-events-none absolute z-40 rounded-full blur-[1.5px] ${className}`}
        style={{
            top,
            left,
            width: size,
            height: size,
            transform: 'translate(-50%, -50%)',
            background: touchGradients[tone],
            boxShadow: `0 0 ${Math.round(size * 0.38)}px ${touchGlows[tone]}`,
            opacity: 0.98,
        }}
    />
);

const MountainScene: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`relative overflow-hidden bg-[linear-gradient(180deg,#d9f4ff_0%,#9bd5f3_42%,#437fa7_100%)] ${className}`}>
        <div className="absolute left-8 top-8 h-20 w-20 rounded-full bg-amber-100/75 blur-xl" />
        <svg viewBox="0 0 220 210" className="absolute inset-0 h-full w-full" fill="none" aria-hidden>
            <path d="M-24 142 C28 103 63 98 105 120 C146 142 164 83 246 94 L246 220 L-24 220 Z" fill="#a7d5ee" opacity="0.66" />
            <path d="M-8 160 L39 113 L67 132 L112 50 L154 117 L181 91 L232 164 L232 220 L-8 220 Z" fill="#236e9b" />
            <path d="M112 50 L132 82 L119 76 L141 116 L112 96 L82 149 Z" fill="#f8fbff" />
            <path d="M39 113 L55 128 L48 126 L67 132 L55 146 L11 167 Z" fill="#eaf7ff" opacity="0.78" />
            <path d="M181 91 L198 114 L189 111 L211 146 L180 128 L151 171 Z" fill="#eefaff" opacity="0.8" />
            <path d="M-20 180 C22 157 49 159 84 174 C122 190 160 148 238 158 L238 220 L-20 220 Z" fill="#0f4267" />
            <path d="M-5 153 C36 139 64 149 101 134 C137 118 164 125 228 103" stroke="rgba(255,255,255,0.28)" strokeWidth="5" strokeLinecap="round" />
            <path d="M102 170 C117 146 133 129 155 111" stroke="#f8fafc" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 6" />
            <circle cx="103" cy="170" r="4" fill="#34d399" />
            <circle cx="155" cy="111" r="4" fill="#f97316" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-slate-950/62 to-transparent" />
    </div>
);

const CoastScene: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`relative overflow-hidden bg-[linear-gradient(180deg,#d9fbff_0%,#a7e6ef_48%,#4fb3be_100%)] ${className}`}>
        <div className="absolute left-6 top-5 h-16 w-16 rounded-full bg-amber-100/90 blur-lg" />
        <svg viewBox="0 0 220 210" className="absolute inset-0 h-full w-full" fill="none" aria-hidden>
            <path d="M-20 92 C25 72 61 78 97 64 C135 49 170 49 240 26 L240 210 L-20 210 Z" fill="#91d3c8" opacity="0.78" />
            <path d="M-12 134 C31 107 61 115 104 96 C150 75 183 82 236 58 L236 210 L-12 210 Z" fill="#0f766e" />
            <path d="M-18 157 C26 137 54 142 91 132 C139 119 169 130 239 103 L239 210 L-18 210 Z" fill="#164e63" />
            <path d="M-10 163 C35 151 68 157 107 147 C149 136 179 142 234 126 L234 210 L-10 210 Z" fill="#5eead4" opacity="0.78" />
            <path d="M-12 176 C42 157 75 166 112 155 C151 144 178 150 235 137" stroke="rgba(255,255,255,0.48)" strokeWidth="6" strokeLinecap="round" />
            <path d="M18 188 C53 166 83 162 121 144 C153 129 177 116 208 85" stroke="#f8fafc" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 7" />
            <circle cx="20" cy="188" r="4" fill="#34d399" />
            <circle cx="208" cy="85" r="4" fill="#f97316" />
            <path d="M19 112 C28 98 35 91 47 78 C54 93 60 104 75 118 C52 113 39 112 19 112 Z" fill="#fef3c7" opacity="0.95" />
            <path d="M128 82 C139 69 149 60 165 47 C171 67 181 80 199 94 C171 91 151 89 128 82 Z" fill="#fef3c7" opacity="0.9" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-cyan-950/64 to-transparent" />
    </div>
);

const ForestScene: React.FC<{ className?: string }> = ({ className = '' }) => (
    <div className={`relative overflow-hidden bg-[linear-gradient(180deg,#e8fff3_0%,#b7e7d0_45%,#386b58_100%)] ${className}`}>
        <div className="absolute right-8 top-7 h-14 w-14 rounded-full bg-amber-100/80 blur-lg" />
        <svg viewBox="0 0 220 210" className="absolute inset-0 h-full w-full" fill="none" aria-hidden>
            <path d="M-22 104 C18 74 56 81 92 61 C133 39 173 44 240 16 L240 210 L-22 210 Z" fill="#9bd6b5" opacity="0.72" />
            <path d="M-20 134 C30 102 74 105 113 89 C158 70 189 80 240 54 L240 210 L-20 210 Z" fill="#27765b" />
            <path d="M-18 161 C35 134 75 139 113 127 C153 114 185 117 241 91 L241 210 L-18 210 Z" fill="#14513e" />
            <path d="M-12 178 C30 164 66 168 103 158 C147 146 179 148 236 125 L236 210 L-12 210 Z" fill="#0f3c35" />
            <path d="M63 210 C78 176 98 158 126 145 C148 135 166 117 188 84" stroke="#9eead4" strokeWidth="13" strokeLinecap="round" opacity="0.82" />
            <path d="M64 210 C79 176 99 158 127 145 C149 135 167 117 189 84" stroke="rgba(255,255,255,0.38)" strokeWidth="4" strokeLinecap="round" />
            <path d="M33 156 L45 122 L58 156 Z" fill="#052e26" opacity="0.92" />
            <path d="M52 154 L68 108 L84 154 Z" fill="#0f513d" opacity="0.95" />
            <path d="M161 135 L177 88 L195 135 Z" fill="#0f513d" opacity="0.94" />
            <path d="M29 184 C63 164 92 159 123 143 C150 129 174 113 197 83" stroke="#f8fafc" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="5 7" />
            <circle cx="29" cy="184" r="4" fill="#34d399" />
            <circle cx="197" cy="83" r="4" fill="#f97316" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-emerald-950/66 to-transparent" />
    </div>
);

const OutdoorClientApp: React.FC = () => (
    <div className="relative h-full overflow-hidden bg-[#f4f7ef] px-3.5 pb-8 pt-12 text-slate-950">
        <div className="flex items-center justify-between">
            <button type="button" className="grid h-8 w-8 place-items-center rounded-[10px] bg-white shadow-sm">
                <ChevronLeft size={17} strokeWidth={3} />
            </button>
            <div className="text-center">
                <div className="text-[7px] font-black uppercase text-slate-400">Ridgeline</div>
                <div className="text-[14px] font-black">Saturday climb</div>
            </div>
            <button type="button" className="grid h-8 w-8 place-items-center rounded-[10px] bg-white shadow-sm">
                <Bookmark size={15} strokeWidth={2.6} />
            </button>
        </div>

        <div className="relative mt-4 h-[220px] overflow-hidden rounded-[20px] shadow-[0_20px_38px_rgba(15,23,42,0.18)]">
            <MountainScene className="h-full w-full" />
            <div className="absolute left-3 top-3 rounded-[10px] bg-white/86 px-2.5 py-1.5 text-[8px] font-black uppercase text-slate-950 shadow-sm backdrop-blur">
                Open trail
            </div>
            <div className="absolute bottom-3 left-3 right-3 rounded-[16px] bg-slate-950/74 p-3.5 text-white backdrop-blur">
                <div className="text-[19px] font-black leading-none">Cinder Ridge</div>
                <div className="mt-2 flex items-center justify-between text-[9px] font-bold text-white/76">
                    <span className="flex items-center gap-1">
                        <MapPin size={10} strokeWidth={3} />
                        West face
                    </span>
                    <span>1,240 ft gain</span>
                </div>
            </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
            {[
                ['8.2 mi', 'Trail'],
                ['6:30', 'Start'],
                ['41 F', 'Weather'],
            ].map(([value, label]) => (
                <div key={label} className="rounded-[12px] bg-white px-2 py-2 shadow-sm">
                    <div className="text-[12px] font-black leading-none">{value}</div>
                    <div className="mt-1 text-[6px] font-black uppercase text-slate-400">{label}</div>
                </div>
            ))}
        </div>

        <div className="mt-3 rounded-[17px] bg-white p-3.5 shadow-[0_12px_24px_rgba(15,23,42,0.07)]">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-[13px] font-black leading-tight">Trail kit</div>
                    <div className="mt-1 text-[8px] font-bold text-slate-400">Packed for the route</div>
                </div>
                <span className="rounded-[10px] bg-emerald-50 px-2 py-1 text-[8px] font-black text-emerald-700">
                    Ready
                </span>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
                {['Water', 'Shell', 'Permit'].map((item, index) => (
                    <div
                        key={item}
                        className={`rounded-[11px] px-2 py-2 text-center text-[8px] font-black ${index === 2 ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'}`}
                    >
                        {item}
                    </div>
                ))}
            </div>
        </div>

        <button type="button" className="absolute bottom-10 left-4 right-4 flex h-11 items-center justify-center gap-2 rounded-[14px] bg-slate-950 text-[10px] font-black uppercase text-white shadow-[0_12px_20px_rgba(15,23,42,0.18)]">
            <Zap size={13} fill="currentColor" />
            Start route
        </button>

        <TouchPulse top="43%" left="61%" size={88} tone="green" />
        <TouchPulse top="50%" left="69%" size={58} tone="amber" />
        <TouchPulse top="87%" left="56%" size={68} tone="blue" />
        <div className="pointer-events-none absolute right-[30%] top-[47%] z-50">
            <PhoneCursor className="h-5 w-4 drop-shadow-[0_0_8px_rgba(16,185,129,0.72)]" />
        </div>
    </div>
);

const RetailClientApp: React.FC = () => (
    <div className="relative h-full overflow-hidden bg-[#f3f8ef] px-3 pb-8 pt-12 text-slate-950">
        <div className="flex items-center justify-between">
            <button type="button" className="grid h-8 w-8 place-items-center rounded-[10px] bg-white shadow-sm">
                <ChevronLeft size={17} strokeWidth={3} />
            </button>
            <div className="text-center">
                <div className="text-[7px] font-black uppercase text-slate-400">Coastline</div>
                <div className="text-[13px] font-black">Tide walk</div>
            </div>
            <button type="button" className="grid h-8 w-8 place-items-center rounded-[10px] bg-white text-slate-950 shadow-sm">
                <Bookmark size={15} strokeWidth={2.6} />
            </button>
        </div>

        <div className="relative mt-4 h-[174px] overflow-hidden rounded-[18px] shadow-[0_18px_32px_rgba(15,23,42,0.16)]">
            <CoastScene className="h-full w-full" />
            <div className="absolute left-3 top-3 rounded-[10px] bg-white/88 px-2.5 py-1.5 text-[8px] font-black uppercase text-slate-950 shadow-sm backdrop-blur">
                Open coast
            </div>
            <div className="absolute bottom-3 left-3 right-3 rounded-[15px] bg-slate-950/76 p-3 text-white backdrop-blur">
                <div className="text-[14px] font-black leading-none">Sea Glass Cove</div>
                <div className="mt-2 flex items-center justify-between text-[8px] font-bold text-white/76">
                    <span className="flex items-center gap-1">
                        <MapPin size={9} strokeWidth={3} />
                        Pacific rim
                    </span>
                    <span>520 ft rise</span>
                </div>
            </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
            {[
                ['4.8 mi', 'Trail'],
                ['7:10', 'Start'],
                ['62 F', 'Air'],
            ].map(([value, label]) => (
                <div key={label} className="rounded-[12px] bg-white px-2 py-2 shadow-sm">
                    <div className="text-[11px] font-black leading-none">{value}</div>
                    <div className="mt-1 text-[6px] font-black uppercase text-slate-400">{label}</div>
                </div>
            ))}
        </div>

        <div className="mt-3 rounded-[15px] bg-white p-3 shadow-[0_12px_24px_rgba(15,23,42,0.08)]">
            <div className="flex items-center justify-between">
                <div>
                    <div className="text-[12px] font-black leading-tight">Route notes</div>
                    <div className="mt-1 text-[7px] font-bold text-slate-400">Sea path is clear</div>
                </div>
                <span className="rounded-[9px] bg-emerald-50 px-2 py-1 text-[7px] font-black text-emerald-700">
                    Ready
                </span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
                {['Cliffs', 'Cove', 'Sunset'].map((item, index) => (
                    <div
                        key={item}
                        className={`rounded-[10px] px-1.5 py-2 text-center text-[7px] font-black ${index === 1 ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'}`}
                    >
                        {item}
                    </div>
                ))}
            </div>
        </div>

        <button type="button" className="absolute bottom-10 left-4 right-4 flex h-11 items-center justify-center gap-2 rounded-[14px] bg-slate-950 text-[10px] font-black uppercase text-white shadow-[0_12px_20px_rgba(15,23,42,0.18)]">
            <Zap size={13} fill="currentColor" />
            Start route
        </button>

        <TouchPulse top="55%" left="55%" size={80} tone="rose" />
        <TouchPulse top="48%" left="34%" size={52} tone="amber" />
        <TouchPulse top="87%" left="55%" size={68} tone="green" />
        <div className="pointer-events-none absolute left-[58%] top-[56%] z-50">
            <PhoneCursor className="h-5 w-4 drop-shadow-[0_0_8px_rgba(244,63,94,0.72)]" />
        </div>
    </div>
);

const CafeClientApp: React.FC = () => (
    <div className="relative h-full overflow-hidden bg-[#f4faf5] px-3 pb-8 pt-12 text-slate-950">
        <div className="flex items-center justify-between">
            <button type="button" className="grid h-8 w-8 place-items-center rounded-[10px] bg-white shadow-sm">
                <ChevronLeft size={17} strokeWidth={3} />
            </button>
            <div className="text-center">
                <div className="text-[7px] font-black uppercase text-slate-400">Wildflower</div>
                <div className="text-[13px] font-black">Forest loop</div>
            </div>
            <button type="button" className="grid h-8 w-8 place-items-center rounded-[10px] bg-slate-950 text-white">
                <Navigation size={14} strokeWidth={2.8} />
            </button>
        </div>

        <div className="relative mt-4 h-[204px] overflow-hidden rounded-[18px] shadow-[0_18px_32px_rgba(15,23,42,0.14)]">
            <ForestScene className="h-full w-full" />
            <div className="absolute left-3 top-3 rounded-[10px] bg-white/88 px-2.5 py-1.5 text-[8px] font-black uppercase text-slate-950 shadow-sm backdrop-blur">
                Open forest
            </div>
            <div className="absolute bottom-3 left-3 right-3 rounded-[15px] bg-slate-950/76 p-3 text-white backdrop-blur">
                <div className="text-[14px] font-black leading-none">Fern Hollow</div>
                <div className="mt-2 flex items-center justify-between text-[8px] font-bold text-white/76">
                    <span className="flex items-center gap-1">
                        <MapPin size={9} strokeWidth={3} />
                        North grove
                    </span>
                    <span>3.6 mi</span>
                </div>
            </div>
        </div>

        <div className="mt-3 rounded-[17px] bg-white p-3 shadow-[0_16px_28px_rgba(15,23,42,0.12)]">
            <div className="flex items-start justify-between gap-2">
                <div>
                    <div className="text-[13px] font-black leading-tight">Lookout notes</div>
                    <div className="mt-1 flex items-center gap-1 text-[8px] font-bold text-slate-400">
                        <MapPin size={10} strokeWidth={3} />
                        Creek overlook
                    </div>
                </div>
                <div className="rounded-[9px] bg-emerald-50 px-2 py-1 text-[8px] font-black text-emerald-600">Clear</div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
                {['Mist', 'Moss', 'Creek'].map((item, index) => (
                    <div
                        key={item}
                        className={`rounded-[10px] px-2 py-2 text-center text-[8px] font-black ${index === 1 ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600'}`}
                    >
                        {item}
                    </div>
                ))}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
                {[
                    ['6:50', 'Start'],
                    ['58 F', 'Air'],
                    ['Low', 'Wind'],
                ].map(([value, label]) => (
                    <div key={label} className="rounded-[10px] bg-slate-50 px-2 py-1.5">
                        <div className="text-[10px] font-black leading-none">{value}</div>
                        <div className="mt-1 text-[6px] font-black uppercase text-slate-400">{label}</div>
                    </div>
                ))}
            </div>
                </div>

        <button type="button" className="absolute bottom-10 left-4 right-4 flex h-11 items-center justify-center gap-2 rounded-[14px] bg-slate-950 text-[10px] font-black uppercase text-white shadow-[0_12px_20px_rgba(15,23,42,0.18)]">
            <Zap size={13} fill="currentColor" />
            Start route
        </button>

        <TouchPulse top="49%" left="36%" size={78} tone="blue" />
        <TouchPulse top="58%" left="63%" size={58} tone="green" />
        <TouchPulse top="87%" left="56%" size={68} tone="rose" />
        <div className="pointer-events-none absolute right-[36%] bottom-[54px] z-50">
            <PhoneCursor className="h-5 w-4 drop-shadow-[0_0_8px_rgba(244,63,94,0.72)]" />
        </div>
    </div>
);

type HeroCopy = MarketingLocale['hero'];

const renderHeadlineWithProtectedPunctuation = (text: string) => {
    const match = text.match(/^([\s\S]*?)(\S+)([.!?])$/);

    if (!match) {
        return text;
    }

    const [, prefix, finalWord, punctuation] = match;

    return (
        <>
            {prefix}
            <span className="whitespace-nowrap">
                {finalWord}
                <span className="inline-block w-0">{punctuation}</span>
            </span>
        </>
    );
};

export const Hero: React.FC<{ copy: HeroCopy; homeCopy: MarketingHomeCopy['hero']; dir?: 'ltr' | 'rtl' }> = ({ copy, homeCopy, dir = 'ltr' }) => {
    const isRtl = dir === 'rtl';
    const alignClass = dir === 'rtl' ? 'text-right' : 'text-left';
    const headlinePrimaryClass = isRtl
        ? 'block max-w-full break-words text-[2.35rem] font-black leading-[1.2] tracking-normal min-[380px]:text-[2.75rem] sm:text-[3.35rem] md:text-[4.15rem] lg:text-[4.55rem] xl:text-[4.95rem] 2xl:text-[5.35rem]'
        : 'block max-w-full break-words text-[2.65rem] font-black uppercase leading-[0.92] tracking-tight min-[380px]:text-5xl sm:text-6xl md:text-7xl lg:text-8xl';
    const headlineSecondaryClass = isRtl
        ? 'mt-2 block max-w-full break-words font-mono text-[2rem] font-black leading-[1.18] tracking-normal text-[#5dadec] min-[380px]:text-[2.3rem] sm:mt-3 sm:text-[3rem] md:text-[3.7rem] lg:mt-4 lg:text-[4.1rem] xl:text-[4.55rem] 2xl:text-[5rem]'
        : 'mt-3 block max-w-full break-words font-mono text-3xl font-black uppercase leading-[0.96] tracking-normal text-[#5dadec] min-[380px]:text-4xl sm:mt-3 sm:text-5xl md:text-6xl lg:mt-4 lg:text-7xl';

    return (
        <section
            aria-label={homeCopy.ariaLabel}
            className={`relative w-full overflow-hidden border-b-2 border-black bg-[#f8fafc] px-4 pb-16 text-black sm:px-6 sm:pb-20 lg:px-8 lg:pb-28 ${isRtl ? 'pt-20 sm:pt-28 lg:pt-32' : 'pt-16 sm:pt-24 lg:pt-28'}`}
        >
            <div
                className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(#000_1px,transparent_1px),linear-gradient(90deg,#000_1px,transparent_1px)] [background-size:32px_32px]"
                aria-hidden
            />
            <div
                className="pointer-events-none absolute -left-20 bottom-10 hidden h-40 w-80 rotate-[7deg] border-2 border-black bg-[#fef08a] shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] lg:block"
                aria-hidden
            />

            <div className="relative z-10 mx-auto max-w-7xl">
                <div className="grid min-w-0 items-center gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(520px,1fr)] lg:gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(640px,1fr)] xl:gap-10">

                    {/* Left - copy */}
                    <div className={`relative min-w-0 space-y-7 ${alignClass}`} dir={dir}>


                        <h1 className="max-w-4xl text-black">
                            <span className={headlinePrimaryClass}>
                                {renderHeadlineWithProtectedPunctuation(copy.headlinePrimary)}
                            </span>
                            <span className={headlineSecondaryClass}>
                                {renderHeadlineWithProtectedPunctuation(copy.headlineSecondary)}
                            </span>
                        </h1>

                        <p className="max-w-full text-base font-extrabold leading-relaxed text-slate-700 sm:max-w-2xl sm:text-lg">
                            {homeCopy.description}
                        </p>

                        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
                            <Link
                                to="/login"
                                className="animate-fade-in-up inline-flex w-full items-center justify-center gap-3 border-2 border-black bg-black px-6 py-4 text-center text-sm font-black uppercase tracking-widest text-white shadow-[6px_6px_0px_0px_rgba(93,173,236,1)] opacity-0 transition-all hover:-translate-y-0.5 hover:bg-[#5dadec] hover:text-black hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] sm:w-auto sm:px-8"
                                style={{ animationDelay: '0.48s' }}
                            >
                                {copy.primaryCta}
                                <ArrowRight size={18} strokeWidth={3} />
                            </Link>
                            <Link
                                to="/docs#self-hosting"
                                className="animate-fade-in-up inline-flex items-center gap-1.5 text-sm font-black uppercase tracking-widest text-black underline underline-offset-4 opacity-0 transition-colors hover:text-slate-500"
                                style={{ animationDelay: '0.56s' }}
                            >
                                <Server size={14} strokeWidth={3} />
                                {copy.secondaryCta}
                            </Link>
                        </div>

                        <div className="public-visual-copy flex justify-center pt-4 lg:hidden">
                            <div className="relative h-[390px] w-full max-w-[390px] min-[380px]:h-[420px]">
                                <div className="absolute left-6 top-14 z-10 origin-bottom-left -rotate-[7deg] scale-[0.62] transform-gpu min-[380px]:scale-[0.66]">
                                    <IPhone size="sm" shadowClass="shadow-[0_18px_38px_rgba(15,23,42,0.2)]">
                                        <RetailClientApp />
                                    </IPhone>
                                </div>

                                <div className="absolute left-1/2 top-0 z-30 origin-top -translate-x-1/2 scale-[0.7] transform-gpu min-[380px]:scale-[0.74]">
                                    <IPhone size="lg" shadowClass="shadow-[0_24px_54px_rgba(15,23,42,0.26)]">
                                        <OutdoorClientApp />
                                    </IPhone>
                                </div>

                                <div className="absolute right-6 top-16 z-20 origin-bottom-right rotate-[7deg] scale-[0.62] transform-gpu min-[380px]:scale-[0.66]">
                                    <IPhone size="sm" shadowClass="shadow-[0_18px_38px_rgba(15,23,42,0.2)]">
                                        <CafeClientApp />
                                    </IPhone>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Right - phones */}
                    <div
                        className="public-visual-copy relative hidden animate-fade-in-right opacity-0 lg:flex lg:items-end lg:justify-end"
                        style={{ animationDelay: '0.2s' }}
                    >
                        <div className="relative h-[610px] w-[760px] origin-right translate-x-16 scale-[0.66] xl:translate-x-14 xl:scale-[0.8] 2xl:translate-x-12 2xl:scale-[0.92]">
                            <div className="absolute bottom-[88px] left-[9%] right-[9%] h-px bg-gradient-to-r from-transparent via-black/18 to-transparent" />
                            <div className="relative z-10 flex h-full items-end justify-center gap-7 xl:gap-8">
                                <div className="relative z-10 mb-5 -rotate-[5deg] translate-y-1 transform-gpu">
                                    <IPhone size="sm" shadowClass="shadow-[0_24px_52px_rgba(15,23,42,0.2)]">
                                        <RetailClientApp />
                                    </IPhone>
                                </div>

                                <div className="relative z-30 -translate-y-3 transform-gpu">
                                    <IPhone size="lg" shadowClass="shadow-[0_34px_78px_rgba(15,23,42,0.28)]">
                                        <OutdoorClientApp />
                                    </IPhone>
                                </div>

                                <div className="relative z-20 mb-8 rotate-[5deg] transform-gpu">
                                    <IPhone size="sm" shadowClass="shadow-[0_24px_52px_rgba(15,23,42,0.2)]">
                                        <CafeClientApp />
                                    </IPhone>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </section>
    );
};
