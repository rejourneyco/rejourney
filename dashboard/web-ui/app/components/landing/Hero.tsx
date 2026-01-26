import React, { useState } from 'react';
import { Link } from 'react-router';
import { Terminal, UserPlus, Check } from 'lucide-react';
import { DocsCodeBlock } from '~/components/features/docs/DocsCodeBlock';
import { AI_INTEGRATION_PROMPT } from '../../constants/aiPrompts';

const quickStartCode = `import { initRejourney, startRejourney } from '@rejourneyco/react-native';

initRejourney('YOUR_PUBLIC_ID');
startRejourney();
// That's it!`;

export const Hero: React.FC = () => {
    const [copied, setCopied] = useState(false);
    const [aiCopied, setAiCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(quickStartCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    const handleCopyAI = async () => {
        try {
            await navigator.clipboard.writeText(AI_INTEGRATION_PROMPT);
            setAiCopied(true);
            setTimeout(() => setAiCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <section aria-label="Hero section" className="w-full px-4 sm:px-6 lg:px-8 pt-20 pb-24 sm:pt-24 sm:pb-32 relative bg-white overflow-hidden">
            {/* Background Accent */}
            <div className="absolute top-0 right-0 w-1/3 h-full bg-slate-50 -skew-x-12 translate-x-1/2 pointer-events-none opacity-50"></div>

            <div className="max-w-7xl mx-auto relative z-10">
                <div className="grid gap-12 lg:gap-16 lg:grid-cols-[1.2fr_1fr] items-center">
                    <div className="space-y-8 sm:space-y-10 lg:space-y-12">

                        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl leading-[0.95] tracking-tight uppercase animate-fade-in-up opacity-0">
                            <span className="font-light text-gray-400">LIGHTWEIGHT</span> <br className="hidden sm:block" />
                            <span className="font-black" style={{ color: '#000000ff' }}>Sentry Alternative</span> <br className="hidden sm:block" />
                            <span className="font-light" style={{ color: '#5dadec' }}>For React Native</span>
                        </h1>
                        <p className="text-lg sm:text-xl md:text-2xl font-serif italic text-gray-500 max-w-xl animate-fade-in-up opacity-0" style={{ animationDelay: '0.2s' }}>
                            Know about friction before users complain.
                        </p>


                        {/* Deployment Options */}
                        <div className="pt-4">
                            <div className="flex flex-col sm:flex-row flex-wrap gap-6 items-start sm:items-center">
                                <Link to="/login" className="border-2 border-black bg-white text-black px-8 py-4 text-base font-black uppercase tracking-widest hover:bg-gray-50 hover:translate-x-1 hover:translate-y-1 hover:shadow-none transition-all shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex items-center gap-2 animate-fade-in-up hover-lift hover-glow opacity-0" style={{ animationDelay: '0.4s' }}>
                                    Get Started Free
                                </Link>
                                <Link to="/docs#self-hosting" className="group flex items-center gap-3 text-sm font-black uppercase tracking-widest hover:text-[#5dadec] transition-colors animate-fade-in-up opacity-0" style={{ animationDelay: '0.5s' }}>
                                    <div className="p-2 border-2 border-black group-hover:border-[#5dadec] transition-colors">
                                        <Terminal size={18} className="stroke-[3]" />
                                    </div>
                                    Self-Host Rejourney
                                </Link>
                            </div>
                        </div>
                    </div>

                    <div className="relative hidden lg:block animate-fade-in-right opacity-0">
                        <div className="relative">
                            {/* Floating Badge - Top Left */}
                            <div className="absolute -top-6 -left-6 z-20">
                                <div className="bg-[#5dadec] border-2 border-black px-4 py-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rotate-[-2deg] hover:rotate-0 transition-transform duration-300">
                                    <span className="text-xs font-black uppercase tracking-wider text-black flex items-center gap-2">
                                        Setup in 3 Lines
                                    </span>
                                </div>
                            </div>

                            {/* "Yes, really" Badge - Floating Right */}
                            <div className="absolute -right-12 top-1/2 -translate-y-1/2 z-20 hidden xl:block">
                                <div className="relative group">
                                    <div className="absolute inset-0 bg-black translate-x-1 translate-y-1 group-hover:translate-x-2 group-hover:translate-y-2 transition-transform duration-300"></div>
                                    <div className="relative bg-white border-2 border-black px-4 py-3 rotate-3 group-hover:rotate-0 transition-all duration-300">
                                        <p className="text-[10px] font-black uppercase text-gray-500 leading-none mb-1">Wait, really?</p>
                                        <p className="text-sm font-black uppercase text-black">Just 3 lines.</p>
                                    </div>
                                    {/* Connection Line */}
                                    <div className="absolute top-1/2 -left-8 w-8 h-0.5 bg-black/20"></div>
                                </div>
                            </div>

                            {/* Main Code Block */}
                            <div className="hover-lift duration-500">
                                <DocsCodeBlock code={quickStartCode} />
                            </div>

                            {/* Trust Badge - Bottom Right */}
                            <div className="absolute -bottom-4 right-8 z-20">
                                <div className="bg-[#34d399] border-2 border-black px-3 py-1 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] flex items-center gap-1.5">
                                    <Check size={12} className="text-black stroke-[3]" />
                                    <span className="text-[10px] font-black uppercase text-black">Zero Config Required</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};
