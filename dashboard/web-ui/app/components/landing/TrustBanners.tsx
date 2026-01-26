import React from 'react';
import { Check } from 'lucide-react';

export const TrustBanners: React.FC = () => {
    return (
        <section className="w-full px-4 sm:px-6 lg:px-8 pb-20 sm:pb-24 bg-white">
            <div className="max-w-7xl mx-auto">
                <div className="flex flex-col sm:flex-row gap-8 sm:gap-12 items-center justify-center border-t-2 border-black/5 pt-8">
                    <div className="flex items-center gap-4 group">
                        <div className="w-12 h-12 rounded-full border-2 border-black overflow-hidden bg-white flex items-center justify-center shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group-hover:translate-x-1 group-hover:translate-y-1 group-hover:shadow-none transition-all">
                            <img
                                src="/Flag_of_Germany.svg"
                                alt="Hosted in Germany"
                                className="w-full h-full object-cover"
                                title="Hosted in Germany"
                            />
                        </div>
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-[#5dadec] mb-0.5">Privacy First</p>
                            <span className="text-sm font-black uppercase text-gray-700">Hosted in Germany</span>
                        </div>
                    </div>

                    {/* GDPR Compliance Feature */}
                    <div className="flex items-center gap-4 group">
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-500 border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group-hover:translate-x-1 group-hover:translate-y-1 group-hover:shadow-none transition-all">
                            <Check size={24} className="text-white stroke-[4]" />
                        </div>
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-green-600 mb-0.5">Compliant</p>
                            <span className="text-sm font-black uppercase text-gray-700">
                                GDPR Ready
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-4 group">
                        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] group-hover:translate-x-1 group-hover:translate-y-1 group-hover:shadow-none transition-all p-2">
                            <img src="/rejourneyIcon-removebg-preview.png" alt="Lightweight Logo" className="w-full h-full object-contain" />
                        </div>
                        <div>
                            <p className="text-xs font-black uppercase tracking-widest text-[#5dadec] mb-0.5">Engineering</p>
                            <span className="text-sm font-black uppercase text-gray-700">
                                Ultra Lightweight
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};
