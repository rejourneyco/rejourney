import React from 'react';

const features = [
    {
        title: "Pixel Perfect",
        highlight: "Session Replay",
        highlightColor: "text-[#5dadec]",
        description: (
            <>
                Experience true fidelity with our high-performance replay engine. Not just a DOM reconstruction—we capture the <span className="font-black bg-yellow-300 px-1">true state</span> of your application.
            </>
        ),
        bullets: [
            { text: "True FPS Video playback capturing every glitch. Works with maps, advanced graphics, and every view!", isBold: true, boldText: "True FPS Video" },
            { text: "Additional DOM Wireframe & Tree Inspectors.", isBold: true, boldText: "DOM Wireframe" },
            { text: "Complete Network & Touch visibility timeline.", isBold: true, boldText: "Network & Touch" }
        ],
        image: "/images/session-replay-preview.png",
        badge: "Pixel Perfect",
        badgeColor: "bg-[#34d399]"
    },
    {
        title: "Live",
        highlight: "Incident Stream",
        highlightColor: "text-[#ef4444]",
        description: "Don't wait for user reports. See crashes, errors, and rage taps as they happen in real-time.",
        bullets: [
            { text: "Instant Crash Reporting with full stack traces.", isBold: true, boldText: "Instant Crash" },
            { text: "Rage Tap identification to spot user frustration.", isBold: true, boldText: "Rage Tap" },
            { text: "Real-time feed of all application exceptions.", isBold: true, boldText: "Real-time feed" }
        ],
        image: "/images/issues-feed.png",
        badge: "Real-time",
        badgeColor: "bg-[#ef4444]"
    },
    {
        title: "Error/ANR/Crash",
        highlight: "Detection",
        highlightColor: "text-orange-500",
        description: "Automatic detection of Application Not Responding (ANR) events with full thread dumps.",
        bullets: [
            { text: "Pinpoint code blocking the Main Thread.", isBold: true, boldText: "Main Thread" },
            { text: "Full Thread Dump analysis for every issue.", isBold: true, boldText: "Thread Dump" },
            { text: "Correlate with user actions.", isBold: true, boldText: "Correlate" }
        ],
        image: "/images/anr-issues.png",
        badge: "Thread Safety",
        badgeColor: "bg-orange-400"
    },
    {
        title: "Journey",
        highlight: "Mapping",
        highlightColor: "text-[#5dadec]",
        description: "Visualize how users navigate your app. Identify high-friction drop-off points and optimize your conversion funnel.",
        bullets: [
            { text: "Visual Navigation Flows through screens.", isBold: true, boldText: "Navigation Flows" },
            { text: "Identify Drop-off points in user funnels.", isBold: true, boldText: "Drop-off points" },
            { text: "Track user pathing deviations.", isBold: true, boldText: "pathing deviations" }
        ],
        image: "/images/user-journeys.png",
        badge: "Flow Analysis",
        badgeColor: "bg-[#5dadec]"
    },
    {
        title: "Interaction",
        highlight: "Heat Maps",
        highlightColor: "text-rose-500",
        description: "Visualize user engagement with precision. See where they tap, swipe, and scroll to optimize UI placement.",
        bullets: [
            { text: "Touch Heatmaps for every screen.", isBold: true, boldText: "Touch Heatmaps" },
            { text: "Scroll Depth analysis for content engagement.", isBold: true, boldText: "Scroll Depth" },
            { text: "Dead Click detection for broken interactions.", isBold: true, boldText: "Dead Click" }
        ],
        image: "/heatmaps-demo.png",
        badge: "User Behavior",
        badgeColor: "bg-rose-400"
    },
    {
        title: "Global",
        highlight: "Stability",
        highlightColor: "text-purple-500",
        description: "Monitor performance and stability across different regions. Spot infrastructure issues before they affect your global audience.",
        bullets: [
            { text: "Regional Performance Heatmaps.", isBold: true, boldText: "Heatmaps" },
            { text: "Latency tracking by geography.", isBold: true, boldText: "Latency tracking" },
            { text: "Impact analysis for global rollouts.", isBold: true, boldText: "global rollouts" }
        ],
        image: "/images/geo-intelligence.png",
        badge: "Regional Health",
        badgeColor: "bg-purple-400"
    },
    {
        title: "Growth",
        highlight: "Engines",
        highlightColor: "text-[#34d399]",
        description: "Track user retention and loyalty segments. Understand how releases impact your power users versus bounce rates.",
        bullets: [
            { text: "Track User Loyalty segments over time.", isBold: true, boldText: "User Loyalty" },
            { text: "Analyze release impact on retention.", isBold: true, boldText: "release impact" },
            { text: "Identify Bouncers vs Returning users.", isBold: true, boldText: "Bouncers" }
        ],
        image: "/images/growth-engines.png",
        badge: "Retention",
        badgeColor: "bg-[#34d399]"
    },
    {
        title: "Team",
        highlight: "Alerts",
        highlightColor: "text-blue-500",
        description: "Ensure the right people know when things go wrong. Smart email notifications for crashes, ANRs, and error spikes.",
        bullets: [
            { text: "Smart Notification Triggers based on severity.", isBold: true, boldText: "Notification Triggers" },
            { text: "Role-based Access for engineering teams.", isBold: true, boldText: "Role-based Access" },
            { text: "Real-time notifications for critical issues.", isBold: true, boldText: "Direct Routing" }
        ],
        image: "/images/team-alerts.png",
        badge: "Teams",
        badgeColor: "bg-blue-400"
    }
];

export const Features: React.FC = () => {
    return (
        <section className="w-full border-t-2 border-black bg-white">
            <div className="max-w-7xl mx-auto">
                {features.map((feature, idx) => (
                    <div key={idx} className={`grid lg:grid-cols-2 gap-0 group/section ${idx % 2 !== 0 ? 'lg:grid-flow-dense' : ''}`}>
                        {/* Content Side */}
                        <div className={`p-8 sm:p-12 lg:p-20 flex flex-col justify-center border-b-2 lg:border-b-0 border-black ${idx % 2 === 0 ? 'lg:border-r-2' : 'lg:col-start-2'}`}>
                            <div className="flex items-center gap-3 mb-6">
                                <span className="font-mono text-xs font-bold uppercase tracking-widest text-gray-500">
                                    0{idx + 1} //
                                </span>
                            </div>
                            <h2 className="text-4xl sm:text-5xl lg:text-6xl font-black uppercase tracking-tighter mb-8 leading-[0.9]">
                                {feature.title} <span className={feature.highlightColor}>{feature.highlight}</span>
                            </h2>

                            <div className="space-y-6 text-lg sm:text-xl font-medium leading-relaxed max-w-xl">
                                <p>{feature.description}</p>

                                <ul className="space-y-4 mt-8">
                                    {feature.bullets.map((bullet, i) => (
                                        <li key={i} className="flex items-start gap-3">
                                            <div className="mt-1.5 w-3 h-3 bg-black shrink-0" />
                                            <span>
                                                {bullet.text.split(bullet.boldText).map((part, j, arr) => (
                                                    <React.Fragment key={j}>
                                                        {part}
                                                        {j < arr.length - 1 && <span className="font-bold">{bullet.boldText}</span>}
                                                    </React.Fragment>
                                                ))}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                        {/* Image Side */}
                        <div className={`relative group overflow-hidden bg-neutral-100 p-8 sm:p-12 flex items-center justify-center border-b-2 lg:border-b-0 border-black ${idx % 2 !== 0 ? 'lg:border-r-2 lg:col-start-1' : ''}`}>
                            {/* Decorative background elements */}
                            <div className="absolute top-0 right-0 w-32 h-32 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9IiMwMDAiIG9wYWNpdHk9IjAuMSIvPgo8L3N2Zz4=')] opacity-50"></div>

                            <div className="relative z-10 w-full max-w-lg transform group-hover:scale-[1.02] transition-transform duration-500 ease-out">
                                <div className="border-2 border-black shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] bg-white">
                                    <img
                                        src={feature.image}
                                        alt={`${feature.title} ${feature.highlight}`}
                                        className="w-full h-auto block"
                                    />
                                </div>

                                {/* Floating Badge */}
                                <div className={`absolute -bottom-6 -right-6 ${feature.badgeColor} border-2 border-black px-4 py-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rotate-[-2deg] group-hover:rotate-0 transition-all duration-300`}>
                                    <span className="text-xs font-black uppercase tracking-wider text-black">
                                        {feature.badge}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
};
