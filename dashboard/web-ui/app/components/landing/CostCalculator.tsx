import React, { useState } from 'react';

export const CostCalculator: React.FC = () => {
    const [sessions, setSessions] = useState(100000);
    const [avgDuration, setAvgDuration] = useState(3); // minutes per session

    const minutes = sessions * avgDuration;

    // Rejourney tiered pricing (per minute)
    const calculateRejourneyCost = (mins: number) => {
        let remaining = mins;
        let totalCost = 0;

        // Tier 1: 0 - 1,000 (Free)
        const tier1 = 1000;
        if (remaining <= tier1) return 0;
        remaining -= tier1;

        // Tier 2: 1,001 - 50,000 ($0.001)
        const tier2 = 50000 - 1000;
        if (remaining <= tier2) {
            totalCost += remaining * 0.001;
            return totalCost;
        }
        totalCost += tier2 * 0.001;
        remaining -= tier2;

        // Tier 3: 50,001 - 200,000 ($0.0005)
        const tier3 = 200000 - 50000;
        if (remaining <= tier3) {
            totalCost += remaining * 0.0005;
            return totalCost;
        }
        totalCost += tier3 * 0.0005;
        remaining -= tier3;

        // Tier 4: 200,001 - 500,000 ($0.00025)
        const tier4 = 500000 - 200000;
        if (remaining <= tier4) {
            totalCost += remaining * 0.00025;
            return totalCost;
        }
        totalCost += tier4 * 0.00025;
        remaining -= tier4;

        // Tier 5: 500,000+ ($0.0001)
        totalCost += remaining * 0.0001;

        return totalCost;
    };

    // PostHog tiered pricing (per session/recording)
    // Free: 2,500 recordings
    // 2,500–15,000: $0.0100
    // 15,000–50,000: $0.0070
    // 50,000–150,000: $0.0040
    // 150,000–500,000: $0.0034
    // 500,000+: $0.0030
    const calculatePostHogCost = (sessionCount: number) => {
        if (sessionCount <= 2500) return 0;

        let remaining = sessionCount - 2500;
        let totalCost = 0;

        // Tier 1: 2,500-15,000 @ $0.01
        const tier1 = 15000 - 2500;
        if (remaining <= tier1) {
            totalCost += remaining * 0.01;
            return totalCost;
        }
        totalCost += tier1 * 0.01;
        remaining -= tier1;

        // Tier 2: 15,000-50,000 @ $0.007
        const tier2 = 50000 - 15000;
        if (remaining <= tier2) {
            totalCost += remaining * 0.007;
            return totalCost;
        }
        totalCost += tier2 * 0.007;
        remaining -= tier2;

        // Tier 3: 50,000-150,000 @ $0.004
        const tier3 = 150000 - 50000;
        if (remaining <= tier3) {
            totalCost += remaining * 0.004;
            return totalCost;
        }
        totalCost += tier3 * 0.004;
        remaining -= tier3;

        // Tier 4: 150,000-500,000 @ $0.0034
        const tier4 = 500000 - 150000;
        if (remaining <= tier4) {
            totalCost += remaining * 0.0034;
            return totalCost;
        }
        totalCost += tier4 * 0.0034;
        remaining -= tier4;

        // Tier 5: 500,000+ @ $0.003
        totalCost += remaining * 0.003;

        return totalCost;
    };

    // Sentry session replay pricing (cumulative costs)
    // Pricing tiers based on total session count including 50 free
    const calculateSentryCost = (sessionCount: number) => {
        // Sentry includes 50 free session replays in all plans
        if (sessionCount <= 50) {
            return 0; // Free tier
        }
        
        // Cumulative pricing tiers for session replays
        if (sessionCount <= 5000) {
            return 14; // $14 for up to 5k sessions
        } else if (sessionCount <= 10000) {
            return 27; // $27 for up to 10k sessions
        } else if (sessionCount <= 25000) {
            return 65; // $65 for up to 25k sessions
        } else if (sessionCount <= 50000) {
            return 129; // $129 for up to 50k sessions
        } else if (sessionCount <= 75000) {
            return 193; // $193 for up to 75k sessions
        } else if (sessionCount <= 100000) {
            return 257; // $257 for up to 100k sessions
        } else if (sessionCount <= 300000) {
            return 720; // $720 for up to 300k sessions
        } else if (sessionCount <= 500000) {
            return 1182; // $1,182 for up to 500k sessions
        } else if (sessionCount <= 1000000) {
            return 2315; // $2,315 for up to 1M sessions
        } else {
            // For 1M+, use linear extrapolation from 500k-1M rate
            // Rate: ($2,315 - $1,182) / 500k = $0.002266 per session
            const overage = sessionCount - 1000000;
            return 2315 + (overage * 0.002266);
        }
    };

    const rejourneyCost = calculateRejourneyCost(minutes);
    const postHogCost = calculatePostHogCost(sessions);
    const sentryCost = calculateSentryCost(sessions);

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
    };

    const formatNumber = (val: number) => {
        return new Intl.NumberFormat('en-US').format(val);
    };

    return (
        <section className="container mx-auto px-4 py-16 border-t-2 border-black bg-white">
            <div className="max-w-4xl mx-auto">
                <div className="text-center mb-10">
                    <h2 className="text-3xl md:text-4xl font-black uppercase mb-3 tracking-tight">
                        Cost Comparison
                    </h2>
                    <p className="font-mono text-base font-bold max-w-xl mx-auto">
                        Adjust sessions and average duration to see estimated monthly costs.
                    </p>
                </div>

                <div className="bg-white border-2 border-black shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]">
                    <div className="bg-black text-white p-4 border-b-2 border-black">
                        <h3 className="font-black uppercase text-lg">Monthly Cost Calculator</h3>
                        <p className="text-sm font-mono opacity-80">Interactive pricing comparison</p>
                    </div>
                    
                    <div className="p-6">
                        {/* Sliders */}
                        <div className="grid md:grid-cols-2 gap-6 mb-8">
                            <div>
                                <label className="block font-black uppercase mb-3 text-sm">
                                    Monthly Sessions: <span style={{ color: '#5dadec' }}>{formatNumber(sessions)}</span>
                                </label>
                                <input
                                    type="range"
                                    min="1000"
                                    max="1000000"
                                    step="1000"
                                    value={sessions}
                                    onChange={(e) => setSessions(Number(e.target.value))}
                                    className="w-full h-3 bg-gray-200 border-2 border-black appearance-none cursor-pointer"
                                    style={{ accentColor: '#5dadec' }}
                                />
                                <div className="flex justify-between font-mono text-xs text-gray-600 mt-2">
                                    <span>1k</span>
                                    <span>1M</span>
                                </div>
                            </div>
                            <div>
                                <label className="block font-black uppercase mb-3 text-sm">
                                    Avg Duration: <span style={{ color: '#5dadec' }}>{avgDuration} min/session</span>
                                </label>
                                <input
                                    type="range"
                                    min="1"
                                    max="10"
                                    step="1"
                                    value={avgDuration}
                                    onChange={(e) => setAvgDuration(Number(e.target.value))}
                                    className="w-full h-3 bg-gray-200 border-2 border-black appearance-none cursor-pointer"
                                    style={{ accentColor: '#5dadec' }}
                                />
                                <div className="flex justify-between font-mono text-xs text-gray-600 mt-2">
                                    <span>1 min</span>
                                    <span>10 min</span>
                                </div>
                            </div>
                        </div>

                        {/* Cost Display */}
                        <div className="grid md:grid-cols-3 gap-4">
                            <div className="text-white p-5 border-2 border-black" style={{ backgroundColor: '#5dadec' }}>
                                <div className="text-xs font-mono uppercase tracking-widest opacity-90 mb-2 font-bold">Rejourney</div>
                                <div className="text-3xl font-black mb-1">{formatCurrency(rejourneyCost)}</div>
                                <div className="text-xs font-mono opacity-80">{formatNumber(minutes)} minutes</div>
                            </div>
                            <div className="bg-white p-5 border-2 border-black">
                                <div className="text-xs font-mono uppercase tracking-widest text-gray-600 mb-2 font-bold">PostHog</div>
                                <div className="text-3xl font-black text-gray-900 mb-1">{formatCurrency(postHogCost)}</div>
                                <div className="text-xs font-mono text-gray-600">{formatNumber(sessions)} sessions</div>
                            </div>
                            <div className="bg-white p-5 border-2 border-black">
                                <div className="text-xs font-mono uppercase tracking-widest text-gray-600 mb-2 font-bold">Sentry</div>
                                <div className="text-3xl font-black text-gray-900 mb-1">{formatCurrency(sentryCost)}</div>
                                <div className="text-xs font-mono text-gray-600">{formatNumber(sessions)} sessions</div>
                            </div>
                        </div>
                    </div>

                    <div className="p-4 border-t-2 border-black bg-gray-50">
                        <p className="text-xs font-mono text-gray-600 text-center">
                            * Rejourney: per recorded minute. PostHog: per session recording. Sentry: session replay pricing (50 free, then tiered pricing: $14 for 5k, $27 for 10k, $65 for 25k, $129 for 50k, $193 for 75k, $257 for 100k, $720 for 300k, $1,182 for 500k, $2,315 for 1M).
                            <br />Estimates based on public pricing as of 2025.
                        </p>
                    </div>
                </div>
            </div>
        </section>
    );
};
