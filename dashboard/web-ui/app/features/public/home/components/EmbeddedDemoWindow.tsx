/**
 * Embedded Demo Window
 *
 * A macOS-style window that embeds the full demo experience
 * directly on the landing page via iframe, loaded on user request.
 */

import React, { useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Maximize2, Play } from 'lucide-react';

export const EmbeddedDemoWindow: React.FC = () => {
    const [shouldLoadDemo, setShouldLoadDemo] = useState(false);

    return (
        <section
            aria-label="Interactive Demo"
            className="w-full px-4 sm:px-6 lg:px-8 py-24 sm:py-32 border-t-2 border-black bg-slate-50"
        >
            {/* Embed must be >1280px wide (after borders) or Tailwind `xl:` breakpoints won't apply inside the iframe. */}
            <div className="max-w-[min(100%,1600px)] mx-auto">
                {/* Section Header */}
                <div className="mb-16 border-b-2 border-black pb-8 text-left">
                    <h2 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-black uppercase tracking-tighter mb-4 leading-none">
                        Live Demo
                    </h2>
                    <p className="text-lg font-mono text-gray-500 uppercase tracking-widest mt-4">
                        Experience the dashboard in action
                    </p>
                </div>

                {/* Window Frame */}
                <div className="relative">
                    {/* Background offset for depth effect */}
                    <div className="absolute -inset-2 sm:-inset-3 bg-gray-100 border-2 border-black z-0 hidden lg:block"></div>

                    {/* Main Window */}
                    <div className="relative z-10 bg-white border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
                        {/* Title Bar */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-black bg-gray-50 px-3 py-2 sm:px-4 sm:py-3">
                            {/* Traffic Lights */}
                            <div className="flex min-w-0 items-center gap-3">
                                <div className="flex gap-2">
                                    <div className="w-3 h-3 rounded-full border border-black bg-red-400 transition-transform hover:scale-110"></div>
                                    <div className="w-3 h-3 rounded-full border border-black bg-yellow-400 transition-transform hover:scale-110"></div>
                                    <div className="w-3 h-3 rounded-full border border-black bg-green-400 transition-transform hover:scale-110"></div>
                                </div>

                                {/* URL Bar */}
                                <div className="ml-3 hidden min-w-0 items-center rounded border border-gray-300 bg-white px-3 py-1 md:flex">
                                    <span className="truncate text-xs font-mono text-gray-600 sm:text-sm">
                                        rejourney.co/demo
                                    </span>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
                                <Link
                                    to="/demo"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-mono font-bold text-gray-700 hover:bg-gray-200 border border-gray-300 rounded transition-colors"
                                    title="Open in new tab"
                                >
                                    <Maximize2 size={14} />
                                    <span className="hidden sm:inline">Fullscreen</span>
                                </Link>
                            </div>
                        </div>

                        {/* Demo Content */}
                        <div className="relative bg-gray-100">
                            {shouldLoadDemo ? (
                                <iframe
                                    src="/demo"
                                    className="w-full border-0 h-[560px] sm:h-[640px] md:h-[min(78vh,880px)] md:min-h-[680px] md:max-h-[880px]"
                                    title="Rejourney Dashboard Demo"
                                    loading="eager"
                                    tabIndex={-1}
                                />
                            ) : (
                                <div className="py-14 flex flex-col items-center justify-center gap-8 bg-white">
                                    {/* Decorative grid background */}
                                    <div
                                        className="absolute inset-0 opacity-[0.04] pointer-events-none"
                                        style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 0)', backgroundSize: '24px 24px' }}
                                    />

                                    {/* Preview mockup */}
                                    <div className="relative z-10 flex flex-col items-center gap-6 px-4 text-center">
                                        <div className="flex items-center gap-3">
                                            <div className="w-2 h-2 rounded-full bg-red-400 border border-black" />
                                            <div className="w-2 h-2 rounded-full bg-yellow-400 border border-black" />
                                            <div className="w-2 h-2 rounded-full bg-green-400 border border-black" />
                                        </div>

                                        <div className="space-y-2">
                                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#5dadec]">
                                                Interactive Demo
                                            </p>
                                            <h3 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-black">
                                                See it in action
                                            </h3>

                                        </div>

                                        {/* Launch button */}
                                        <button
                                            onClick={() => setShouldLoadDemo(true)}
                                            className="group relative flex items-center gap-3 border-2 border-black bg-black text-white px-8 py-4 text-sm font-black uppercase tracking-widest hover:bg-[#5dadec] hover:text-black hover:border-black transition-all duration-200 shadow-[6px_6px_0px_0px_rgba(0,0,0,0.2)] hover:shadow-[6px_6px_0px_0px_rgba(93,173,236,0.4)] hover:-translate-y-0.5"
                                        >
                                            <Play size={16} className="fill-current" />
                                            Launch Demo
                                        </button>

                                        <p className="text-[10px] font-mono text-gray-400 uppercase tracking-widest">
                                            No sign-up required
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* CTA below the window */}
                <div className="mt-6 sm:mt-8 text-center">
                    <div className="flex flex-wrap justify-center gap-3">
                        <Link
                            to="/demo"
                            className="inline-flex items-center gap-2 border-2 border-black bg-white text-black px-5 sm:px-6 py-3 text-sm font-black uppercase tracking-widest hover:bg-gray-50 hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
                        >
                            <ExternalLink size={16} />
                            Open Fullscreen
                        </Link>
                    </div>
                </div>
            </div>
        </section>
    );
};
