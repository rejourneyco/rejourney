import type { Route } from "./+types/changelog";
import { Header } from "~/components/layout/Header";
import { Footer } from "~/components/layout/Footer";
import { Cpu, Map, Zap, Shield, Rocket } from "lucide-react";

export const meta: Route.MetaFunction = () => [
    { title: "Changelog - Rejourney" },
    {
        name: "description",
        content: "Stay up to date with the latest improvements and features in Rejourney.",
    },
    { property: "og:title", content: "Changelog - Rejourney" },
    { property: "og:type", content: "website" },
    { tagName: "link", rel: "canonical", href: "https://rejourney.co/changelog" },
];

export default function ChangelogPage() {
    return (
        <div className="min-h-screen w-full bg-white text-slate-900 font-sans selection:bg-yellow-200 flex flex-col">
            <Header />
            <main className="flex-grow w-full">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">

                    {/* Page Header */}
                    <div className="mb-20 border-b-8 border-black pb-12">
                        <h1 className="text-6xl sm:text-7xl lg:text-9xl font-black uppercase tracking-tighter mb-8 leading-[0.85]">
                            Channel <span className="text-transparent bg-clip-text bg-gradient-to-r from-gray-700 to-gray-400">Log</span>
                        </h1>
                        <p className="text-xl font-bold uppercase tracking-widest text-gray-500">
                            Version History & Product Updates
                        </p>
                    </div>

                    {/* Versions List */}
                    <div className="space-y-24">

                        {/* Version 1.0.10 */}
                        <div className="relative">
                            <div className="absolute -left-4 top-0 bottom-0 w-1 bg-black hidden sm:block" />
                            <div className="flex flex-col md:flex-row gap-8 items-start">
                                <div className="md:w-1/4">
                                    <div className="sticky top-24">
                                        <div className="text-4xl font-black uppercase tracking-tighter mb-2">v1.0.10</div>
                                        <div className="text-xs font-mono font-black uppercase tracking-widest text-blue-600 mb-4">Feb 27, 2026</div>
                                        <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-100 text-green-700 text-[10px] font-black uppercase tracking-widest rounded shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] border border-black">
                                            Latest
                                        </div>
                                    </div>
                                </div>
                                <div className="md:w-3/4 space-y-8">
                                    <div>
                                        <h2 className="text-3xl font-black uppercase tracking-tighter mb-6 flex items-center gap-3">
                                            <Rocket size={32} strokeWidth={3} />
                                            React Native Tracking Polish
                                        </h2>
                                        <div className="prose prose-lg prose-slate max-w-none">
                                            <p className="font-bold text-gray-700">
                                                Version 1.0.10 tightens up screen tracking across React Native projects and clarifies how to wire in custom tracking.
                                            </p>
                                            <ul className="list-none pl-0 space-y-4 mt-6">
                                                <li className="flex gap-4">
                                                    <div className="mt-1 flex-shrink-0 w-6 h-6 bg-black text-white flex items-center justify-center text-[10px] font-bold">01</div>
                                                    <div>
                                                        <strong className="uppercase tracking-tight text-sm">Custom Screen Tracking Docs:</strong>
                                                        <p className="text-gray-600 mt-1">Updated documentation that walks through adding your own screen tracking hooks and naming conventions for React Navigation and Expo Router.</p>
                                                    </div>
                                                </li>
                                                <li className="flex gap-4">
                                                    <div className="mt-1 flex-shrink-0 w-6 h-6 bg-black text-white flex items-center justify-center text-[10px] font-bold">02</div>
                                                    <div>
                                                        <strong className="uppercase tracking-tight text-sm">Auto Screen Tracking Fixes:</strong>
                                                        <p className="text-gray-600 mt-1">Resolved bugs in the auto screen tracking pipeline for setups that do not use Expo Router, ensuring consistent screen names and session timelines.</p>
                                                    </div>
                                                </li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Version 1.0.9 */}
                        <div className="relative">
                            <div className="absolute -left-4 top-0 bottom-0 w-1 bg-gray-200 hidden sm:block" />
                            <div className="flex flex-col md:flex-row gap-8 items-start">
                                <div className="md:w-1/4">
                                    <div className="sticky top-24">
                                        <div className="text-4xl font-black uppercase tracking-tighter mb-2 text-gray-400">v1.0.9</div>
                                        <div className="text-xs font-mono font-black uppercase tracking-widest text-gray-400 mb-4">Feb 25, 2026</div>
                                    </div>
                                </div>
                                <div className="md:w-3/4 space-y-8 opacity-80">
                                    <div>
                                        <h2 className="text-3xl font-black uppercase tracking-tighter mb-6 flex items-center gap-3">
                                            <Rocket size={32} strokeWidth={3} />
                                            Advanced Observability & UX
                                        </h2>
                                        <div className="prose prose-lg prose-slate max-w-none">
                                            <p className="font-bold text-gray-700">
                                                Version 1.0.9 introduces deep native interception, a bulletproof console log pipeline, and a complete dashboard overhaul.
                                            </p>
                                            <ul className="list-none pl-0 space-y-4 mt-6">
                                                <li className="flex gap-4">
                                                    <div className="mt-1 flex-shrink-0 w-6 h-6 bg-gray-200 text-gray-500 flex items-center justify-center text-[10px] font-bold">01</div>
                                                    <div>
                                                        <strong className="uppercase tracking-tight text-sm">Native API Tracking:</strong>
                                                        <p className="text-gray-600 mt-1">Full interception of native network traffic (OkHttp on Android, URLSession on iOS) integrated directly into the replay timeline.</p>
                                                    </div>
                                                </li>
                                                <li className="flex gap-4">
                                                    <div className="mt-1 flex-shrink-0 w-6 h-6 bg-gray-200 text-gray-500 flex items-center justify-center text-[10px] font-bold">02</div>
                                                    <div>
                                                        <strong className="uppercase tracking-tight text-sm">Reliable Console Logs:</strong>
                                                        <p className="text-gray-600 mt-1">Completely redesigned JS log pipeline ensuring 100% delivery of logs, warnings, and errors with zero main-thread overhead.</p>
                                                    </div>
                                                </li>
                                                <li className="flex gap-4">
                                                    <div className="mt-1 flex-shrink-0 w-6 h-6 bg-gray-200 text-gray-500 flex items-center justify-center text-[10px] font-bold">03</div>
                                                    <div>
                                                        <strong className="uppercase tracking-tight text-sm">Enhanced Fingerprinting:</strong>
                                                        <p className="text-gray-600 mt-1">Improved user uniqueness algorithms for more accurate session association and cross-device identification.</p>
                                                    </div>
                                                </li>
                                                <li className="flex gap-4">
                                                    <div className="mt-1 flex-shrink-0 w-6 h-6 bg-gray-200 text-gray-500 flex items-center justify-center text-[10px] font-bold">04</div>
                                                    <div>
                                                        <strong className="uppercase tracking-tight text-sm">Dashboard Overhaul:</strong>
                                                        <p className="text-gray-600 mt-1">Massive UX/UI improvements across Growth, General Overview, and the Replay Workbench for a more premium feel.</p>
                                                    </div>
                                                </li>
                                            </ul>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="border-2 border-black p-4 bg-slate-50 flex items-start gap-4">
                                            <Zap className="mt-1 text-blue-600" size={20} />
                                            <div>
                                                <div className="font-black uppercase text-xs tracking-widest text-gray-500 mb-1">Native</div>
                                                <p className="text-xs font-bold">Interception for OkHttp and URLSession.</p>
                                            </div>
                                        </div>
                                        <div className="border-2 border-black p-4 bg-slate-50 flex items-start gap-4">
                                            <Shield className="mt-1 text-green-600" size={20} />
                                            <div>
                                                <div className="font-black uppercase text-xs tracking-widest text-gray-500 mb-1">Privacy</div>
                                                <p className="text-xs font-bold">Enhanced redaction during native captures.</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Version 1.0.8 */}
                        <div className="relative">
                            <div className="absolute -left-4 top-0 bottom-0 w-1 bg-gray-200 hidden sm:block" />
                            <div className="flex flex-col md:flex-row gap-8 items-start">
                                <div className="md:w-1/4">
                                    <div className="sticky top-24">
                                        <div className="text-4xl font-black uppercase tracking-tighter mb-2 text-gray-400">v1.0.8</div>
                                        <div className="text-xs font-mono font-black uppercase tracking-widest text-gray-400">Feb 17, 2026</div>

                                    </div>
                                </div>
                                <div className="md:w-3/4 space-y-8 opacity-80">
                                    <div>
                                        <h2 className="text-3xl font-black uppercase tracking-tighter mb-6 flex items-center gap-3">
                                            <Rocket size={32} strokeWidth={3} />
                                            Zero-Interference Pipeline
                                        </h2>
                                        <div className="prose prose-lg prose-slate max-w-none">
                                            <p className="font-bold text-gray-700">
                                                This foundational release introduced our highly efficient capture architecture, delivering pixel-perfect accuracy without main thread impact.
                                            </p>
                                            <ul className="list-none pl-0 space-y-4 mt-6">
                                                <li className="flex gap-4">
                                                    <div className="mt-1 flex-shrink-0 w-6 h-6 bg-gray-200 text-gray-500 flex items-center justify-center text-[10px] font-bold">01</div>
                                                    <div>
                                                        <strong className="uppercase tracking-tight text-sm">Async Capture Pipeline:</strong>
                                                        <p className="text-gray-600 mt-1">Pixel buffer processing handed off to background queues (QoS: Utility) for JPEG encoding and encryption.</p>
                                                    </div>
                                                </li>
                                                <li className="flex gap-4">
                                                    <div className="mt-1 flex-shrink-0 w-6 h-6 bg-gray-200 text-gray-500 flex items-center justify-center text-[10px] font-bold">02</div>
                                                    <div>
                                                        <strong className="uppercase tracking-tight text-sm">Run Loop Gating:</strong>
                                                        <p className="text-gray-600 mt-1">Capture timer runs in default loop mode, automatically pausing during user interactions to prevent input lag.</p>
                                                    </div>
                                                </li>
                                                <li className="flex gap-4">
                                                    <div className="mt-1 flex-shrink-0 w-6 h-6 bg-gray-200 text-gray-500 flex items-center justify-center text-[10px] font-bold">03</div>
                                                    <div>
                                                        <strong className="uppercase tracking-tight text-sm">Zero-Trust Privacy:</strong>
                                                        <p className="text-gray-600 mt-1">On-device RedactionMasks identify and black out sensitive UI elements before encoding ever happens.</p>
                                                    </div>
                                                </li>
                                            </ul>
                                        </div>
                                    </div>

                                    <div className="bg-black text-white p-6 border-b-4 border-blue-600">
                                        <div className="flex items-center gap-2 mb-4">
                                            <Shield className="text-blue-400" size={20} />
                                            <div className="font-black uppercase text-xs tracking-widest opacity-60">Security Feature</div>
                                        </div>
                                        <h4 className="text-xl font-black uppercase tracking-tight mb-2">Private Data Sanitization</h4>
                                        <p className="text-sm text-gray-400">Passwords, text inputs, and camera previews are now redacted in memory, ensuring user privacy by default.</p>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>

                    {/* CTA */}
                    <div className="mt-32 pt-20 border-t-8 border-black text-center">
                        <h3 className="text-4xl font-black uppercase tracking-tighter mb-8">Ready to see it in action?</h3>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <a href="/login" className="px-10 py-4 bg-black text-white font-black uppercase tracking-widest text-sm hover:bg-gray-800 transition-colors shadow-[8px_8px_0px_0px_rgba(0,0,0,0.2)]">
                                Start Free Trial
                            </a>
                            <a href="/docs/reactnative/overview" className="px-10 py-4 border-2 border-black text-black font-black uppercase tracking-widest text-sm hover:bg-gray-50 transition-colors">
                                View Documentation
                            </a>
                        </div>
                    </div>

                </div>
            </main>
            <Footer />
        </div>
    );
}
