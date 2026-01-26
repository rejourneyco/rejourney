import React, { useState, useEffect, useRef } from 'react';
import { Check, X, Minus } from 'lucide-react';

interface TooltipCellProps {
    children: React.ReactNode;
    explanation: string;
    bgColor?: string;
    showBorder?: boolean;
    position?: 'top' | 'bottom';
}

const TooltipCell: React.FC<TooltipCellProps> = ({ children, explanation, bgColor = 'bg-white', showBorder = true, position = 'top' }) => {
    return (
        <td className={`px-4 sm:px-6 py-4 sm:py-5 text-center transition-colors group relative cursor-help ${bgColor} ${showBorder ? 'border-r-2 border-black' : ''}`}>
            <div className="flex justify-center items-center">
                {children}
            </div>
            {/* Neo-brutalist Tooltip */}
            <div className={`
                absolute left-1/2 -translate-x-1/2 hidden group-hover:block w-64 p-3 bg-black text-white text-[11px] font-bold rounded-sm border-2 border-white shadow-[4px_4px_0px_0px_rgba(255,255,255,0.3)] z-50 pointer-events-none text-left leading-relaxed
                ${position === 'top' ? 'bottom-[90%] mb-2' : 'top-[90%] mt-2'}
            `}>
                {explanation}
                {/* Arrow */}
                <div className={`
                    absolute left-1/2 -translate-x-1/2 border-8 border-transparent
                    ${position === 'top' ? 'top-full border-t-black' : 'bottom-full border-b-black'}
                `}></div>
            </div>
        </td>
    );
};

export const ComparisonTable: React.FC = () => {
    const sectionRef = useRef<HTMLElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const elements = entry.target.querySelectorAll('.reveal');
                    elements.forEach((el, index) => {
                        setTimeout(() => {
                            el.classList.add('reveal-active');
                        }, index * 200);
                    });
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1 });

        if (sectionRef.current) {
            observer.observe(sectionRef.current);
        }

        return () => observer.disconnect();
    }, []);

    return (
        <section ref={sectionRef} className="w-full px-4 sm:px-6 lg:px-8 py-24 sm:py-32 border-t-2 border-black bg-white">
            <div className="max-w-7xl mx-auto">
                <div className="mb-12 border-b-2 border-black pb-6 text-left reveal reveal-up">
                    <h2 className="text-4xl sm:text-5xl md:text-6xl font-black uppercase tracking-tighter mb-4 leading-none">
                        Why Rejourney?
                    </h2>
                </div>

                <div className="bg-white border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] reveal reveal-up">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-black text-white">
                                    <th className="px-4 sm:px-6 py-4 sm:py-5 border-r-2 border-white text-left font-black uppercase text-xs sm:text-sm md:text-base w-[20%]">Feature</th>
                                    <th className="px-4 sm:px-6 py-4 sm:py-5 border-r-2 border-white text-center font-black uppercase text-xs sm:text-sm md:text-base w-[20%]" style={{ backgroundColor: '#5dadec' }}>Rejourney</th>
                                    <th className="px-4 sm:px-6 py-4 sm:py-5 border-r-2 border-white text-center font-black uppercase text-xs sm:text-sm md:text-base w-[20%]">Sentry</th>
                                    <th className="px-4 sm:px-6 py-4 sm:py-5 border-r-2 border-white text-center font-black uppercase text-xs sm:text-sm md:text-base w-[20%]">PostHog</th>
                                    <th className="px-4 sm:px-6 py-4 sm:py-5 text-center font-black uppercase text-xs sm:text-sm md:text-base w-[20%]">LogRocket</th>
                                </tr>
                            </thead>
                            <tbody className="font-mono">
                                {/* Row: Mobile First - Position BOTTOM to avoid clipping */}
                                <tr className="border-b-2 border-black hover:bg-gray-50 transition-colors text-gray-900">
                                    <td className="px-4 sm:px-6 py-4 sm:py-5 font-bold border-r-2 border-black bg-white text-sm sm:text-base">Mobile First</td>
                                    <TooltipCell
                                        explanation="ReJourney is designed specifically for mobile applications (React Native–first), with data models, replay, and performance capture optimized for mobile constraints such as bandwidth, storage, and battery."
                                        bgColor="bg-[#5dadec]/10"
                                        position="bottom"
                                    >
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Strong mobile SDKs, but inherits architecture from its web-first origins." position="bottom">
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Primarily optimized for web events; mobile auto-capture is less robust." position="bottom">
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="LogRocket is web-first. Mobile support exists but is secondary and more limited (especially React Native depth vs web)." showBorder={false} position="bottom">
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                </tr>

                                {/* Row: Zero Dependency - Position BOTTOM to avoid clipping */}
                                <tr className="border-b-2 border-black hover:bg-gray-50 transition-colors text-gray-900">
                                    <td className="px-4 sm:px-6 py-4 sm:py-5 font-bold border-r-2 border-black bg-white text-sm sm:text-base">Zero Dependency Architecture</td>
                                    <TooltipCell
                                        explanation="The SDK is intentionally lightweight and avoids large third-party native dependencies. Replay capture, buffering, and transport are handled internally to minimize bundle size and integration complexity."
                                        bgColor="bg-[#5dadec]/10"
                                        position="bottom"
                                    >
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Requires significant SDK boilerplate and specific build-time integrations." position="bottom">
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Needs a platform-specific SDK and doesn't follow a minimal dependency model." position="bottom">
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Requires a JS SDK + integrations; not a minimal/no-dependency model." showBorder={false} position="bottom">
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                </tr>

                                {/* Row: Crash Tracking */}
                                <tr className="border-b-2 border-black hover:bg-gray-50 transition-colors text-gray-900">
                                    <td className="px-4 sm:px-6 py-4 sm:py-5 font-bold border-r-2 border-black bg-white text-sm sm:text-base">Crash Tracking</td>
                                    <TooltipCell
                                        explanation="ReJourney captures application crashes and fatal errors in the mobile runtime and correlates them directly with session replay and API activity for end-to-end debugging context."
                                        bgColor="bg-[#5dadec]/10"
                                    >
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Industry standard for symbolication and grouping across platforms.">
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Good basic error tracking but lacks deep native symbolication depth.">
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Captures JS errors, not true native crashes (no NDK/iOS symbolicated native crash handling)." showBorder={false}>
                                        <div className="flex justify-center items-center gap-0.5">
                                            <Minus size={16} className="text-yellow-500" strokeWidth={4} />
                                            <span className="text-gray-400">/</span>
                                            <X size={16} className="text-red-500" strokeWidth={3} />
                                        </div>
                                    </TooltipCell>
                                </tr>

                                {/* Row: API Monitoring */}
                                <tr className="border-b-2 border-black hover:bg-gray-50 transition-colors text-gray-900">
                                    <td className="px-4 sm:px-6 py-4 sm:py-5 font-bold border-r-2 border-black bg-white text-sm sm:text-base">API Monitoring</td>
                                    <TooltipCell
                                        explanation="Network requests are automatically captured and linked to sessions, allowing developers to see API failures, latency, and payload behavior in the exact user context where issues occur."
                                        bgColor="bg-[#5dadec]/10"
                                    >
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Comprehensive network request and performance tracing available.">
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Event-driven network tracking; less focus on forensic latency.">
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Network request logging is a core feature." showBorder={false}>
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                </tr>

                                {/* Row: Unlimited Emails */}
                                <tr className="border-b-2 border-black hover:bg-gray-50 transition-colors text-gray-900">
                                    <td className="px-4 sm:px-6 py-4 sm:py-5 font-bold border-r-2 border-black bg-white text-sm sm:text-base">Unlimited Emails</td>
                                    <TooltipCell
                                        explanation="Alerts and notifications are not artificially capped by tier, allowing teams to receive critical signals without worrying about quota-based suppression."
                                        bgColor="bg-[#5dadec]/10"
                                    >
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Alerting limits are strictly enforced by subscription event quotas.">
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Alerts are capped based on the monthly billing tier and event volume.">
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Alerts and notifications are plan-limited." showBorder={false}>
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                </tr>

                                {/* Row: Pixel Perfect Replay */}
                                <tr className="border-b-2 border-black hover:bg-gray-50 transition-colors text-gray-900">
                                    <td className="px-4 sm:px-6 py-4 sm:py-5 font-bold border-r-2 border-black bg-white text-sm sm:text-base">Pixel Perfect Replay</td>
                                    <TooltipCell
                                        explanation="ReJourney uses native, frame-accurate session replay rather than DOM or event reconstruction, enabling faithful reproduction of the user’s actual UI state on mobile."
                                        bgColor="bg-[#5dadec]/10"
                                    >
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Robust session replay that relies on high-volume data capture.">
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Uses DOM-reconstruction which can differ from the actual user view.">
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="DOM-based reconstruction, not true pixel/frame capture (unlike native replay)." showBorder={false}>
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                </tr>

                                {/* Row: 2-Minute Setup */}
                                <tr className="border-b-2 border-black hover:bg-gray-50 transition-colors text-gray-900">
                                    <td className="px-4 sm:px-6 py-4 sm:py-5 font-bold border-r-2 border-black bg-white text-sm sm:text-base">2-Minute Setup</td>
                                    <TooltipCell
                                        explanation="Installation requires minimal configuration: add the SDK, initialize with a key, and run. No symbol uploads, complex pipelines, or multi-step dashboards are required to get value."
                                        bgColor="bg-[#5dadec]/10"
                                    >
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Initial setup is fast, but complex instrumentation takes significant time.">
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Platform complexity means full configuration often requires hours, not minutes.">
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Setup is non-trivial once privacy masking, performance, and replay tuning are configured." showBorder={false}>
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                </tr>

                                {/* Row: No Subscription */}
                                <tr className="hover:bg-gray-50 transition-colors text-gray-900">
                                    <td className="px-4 sm:px-6 py-4 sm:py-5 font-bold border-r-2 border-black bg-white text-sm sm:text-base">No Subscription</td>
                                    <TooltipCell
                                        explanation="ReJourney operates on a pay-for-what-you-use model, removing long-term contracts and fixed subscription tiers."
                                        bgColor="bg-[#5dadec]/10"
                                    >
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Exclusively operates on monthly or annual recurring billing models.">
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Cloud version is subscription-based; focuses on high-volume recurring fees.">
                                        <Check size={20} className="text-green-600" strokeWidth={3} />
                                    </TooltipCell>
                                    <TooltipCell explanation="Subscription-based only." showBorder={false}>
                                        <X size={20} className="text-red-500" strokeWidth={3} />
                                    </TooltipCell>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div className="mt-8 p-4 sm:p-5 md:p-6 border-2 border-black bg-gray-50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] reveal reveal-up">
                    <p className="text-xs sm:text-sm md:text-base font-mono text-gray-900 text-center leading-relaxed">
                        * Sentry limits alerts by tier and event quota. ReJourney includes unlimited alerts at all pricing levels.
                        <br />Estimates based on public pricing as of {new Date().getFullYear()}.
                    </p>
                </div>
            </div>
        </section>
    );
};
