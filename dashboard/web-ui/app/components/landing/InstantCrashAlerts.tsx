import React from 'react';
import { Mail, AlertCircle, Check } from 'lucide-react';

export const InstantCrashAlerts: React.FC = () => {
    return (
        <section className="w-full px-4 sm:px-6 lg:px-8 py-12 sm:py-16 lg:py-20 border-t-2 border-black bg-white">
            <div className="max-w-4xl mx-auto">
                <div className="bg-white border-2 border-black shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] p-6 sm:p-8 md:p-10">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="relative">
                            <div className="w-12 h-12 sm:w-16 sm:h-16 bg-black rounded-full flex items-center justify-center">
                                <Mail size={24} className="sm:w-8 sm:h-8 text-white" strokeWidth={2.5} />
                            </div>
                            <div className="absolute -top-1 -right-1 w-6 h-6 sm:w-7 sm:h-7 bg-red-500 border-2 border-black rounded-full flex items-center justify-center">
                                <AlertCircle size={14} className="sm:w-4 sm:h-4 text-white" strokeWidth={3} />
                            </div>
                        </div>
                        <div>
                            <h2 className="text-2xl sm:text-3xl md:text-4xl font-black uppercase tracking-tight mb-1">
                                INSTANT CRASH ALERTS
                            </h2>
                            <p className="text-sm sm:text-base font-mono text-gray-600 uppercase tracking-wide">
                                Know about issues before your users complain
                            </p>
                        </div>
                    </div>

                    <div className="border-t-2 border-black pt-6 mt-6">
                        <p className="font-mono text-base sm:text-lg font-bold text-gray-900 mb-6 leading-relaxed">
                            Get notified the moment a crash happens:
                        </p>
                        
                        <div className="space-y-3 sm:space-y-4 mb-6">
                            <div className="flex items-start gap-3">
                                <Check size={20} className="text-green-600 flex-shrink-0 mt-0.5" strokeWidth={3} />
                                <span className="font-mono text-sm sm:text-base font-bold text-gray-900">
                                    Email alerts (unlimited, free)
                                </span>
                            </div>
                            <div className="flex items-start gap-3">
                                <Check size={20} className="text-green-600 flex-shrink-0 mt-0.5" strokeWidth={3} />
                                <span className="font-mono text-sm sm:text-base font-bold text-gray-900">
                                    Crash details with stack trace
                                </span>
                            </div>
                            <div className="flex items-start gap-3">
                                <Check size={20} className="text-green-600 flex-shrink-0 mt-0.5" strokeWidth={3} />
                                <span className="font-mono text-sm sm:text-base font-bold text-gray-900">
                                    Link directly to session replay
                                </span>
                            </div>
                            <div className="flex items-start gap-3">
                                <Check size={20} className="text-green-600 flex-shrink-0 mt-0.5" strokeWidth={3} />
                                <span className="font-mono text-sm sm:text-base font-bold text-gray-900">
                                    API calls that preceded the crash
                                </span>
                            </div>
                        </div>

                        <div className="bg-gray-50 border-2 border-gray-300 p-4 sm:p-5 mt-6">
                            <p className="font-mono text-sm sm:text-base font-bold text-gray-900 text-center">
                                No configuration needed. Works out of the box.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
};





