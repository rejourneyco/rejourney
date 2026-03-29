import React from 'react';
import { ArrowRight, Terminal } from 'lucide-react';
import { Link } from 'react-router';

export const EngineeringCTA: React.FC = () => {
    return (
        <section className="w-full bg-white text-black border-t-2 border-black">
            <div className="w-full px-4 sm:px-6 lg:px-8 py-32 sm:py-40 text-center relative overflow-hidden">
                <div className="max-w-5xl mx-auto relative z-10">
                    <div className="flex justify-center mb-6">
                        <span className="bg-black text-white px-3 py-1 text-xs font-mono uppercase tracking-widest font-bold">
                            Open Architecture
                        </span>
                    </div>

                    <h2 className="text-5xl sm:text-6xl md:text-7xl lg:text-8xl font-black uppercase mb-6 tracking-tighter leading-none">
                        ENGINEERED FOR <br className="hidden sm:block" />
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-black via-gray-700 to-black animate-gradient-x">
                            TRANSPARENCY
                        </span>
                    </h2>

                    <p className="text-lg sm:text-xl font-mono text-gray-600 mb-10 max-w-2xl mx-auto leading-relaxed">
                        We believe in open standards and visible constraints. Explore our architectural decisions or start observing your mobile app deployment in minutes.
                    </p>

                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                        <Link to="/engineering">
                            <button
                                className="w-full sm:w-auto bg-black text-white px-8 py-4 text-base font-black uppercase tracking-widest hover:bg-[#5dadec] hover:text-black transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] active:translate-y-0 active:scale-[0.99] flex items-center justify-center gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)]"
                            >
                                <Terminal size={20} />
                                View Engineering
                            </button>
                        </Link>

                        <Link to="/login">
                            <button
                                className="w-full sm:w-auto bg-white text-black border-2 border-black px-8 py-4 text-base font-black uppercase tracking-widest hover:bg-gray-50 transition-all duration-200 hover:-translate-y-0.5 hover:scale-[1.02] active:translate-y-0 active:scale-[0.99] flex items-center justify-center gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]"
                            >
                                Start Building
                                <ArrowRight size={20} />
                            </button>
                        </Link>
                    </div>
                </div>

                {/* Decorative Background Elements */}
                <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-5">
                    <div className="absolute top-[10%] left-[5%] w-64 h-64 border-2 border-black rounded-full mix-blend-multiply filter blur-xl animate-blob"></div>
                    <div className="absolute top-[10%] right-[5%] w-64 h-64 border-2 border-black rounded-full mix-blend-multiply filter blur-xl animate-blob animation-delay-2000"></div>
                </div>
            </div>
        </section>
    );
};
