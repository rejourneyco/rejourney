/**
 * Embedded Demo Window
 * 
 * A stylish macOS-style window that embeds the full demo experience
 * directly on the landing page via iframe.
 */

import React from 'react';
import { Link } from 'react-router';
import { ExternalLink, Maximize2 } from 'lucide-react';

export const EmbeddedDemoWindow: React.FC = () => {
    return (
        <section
            aria-label="Interactive Demo"
            className="w-full px-4 sm:px-6 lg:px-8 py-24 sm:py-32 border-t-2 border-black bg-slate-50"
        >
            <div className="max-w-7xl mx-auto">
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

                        {/* Demo Content via iframe */}
                        <div className="relative bg-gray-100">
                            <iframe
                                src="/demo"
                                className="w-full border-0"
                                style={{ height: '75vh', minHeight: '500px', maxHeight: '800px' }}
                                title="Rejourney Dashboard Demo"
                                loading="lazy"
                            />
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
