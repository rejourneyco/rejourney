import React, { useMemo } from 'react';

interface CohortData {
    cohortWeek: string;
    cohortSize: number;
    retention: number[]; // Percentage retained in each subsequent week
    healthStats?: { crash: number; error: number; rage: number; total: number };
}

interface RetentionCohortChartProps {
    dailyData: Array<{
        date: string;
        sessions: number;
        dau: number;
        mau?: number;
        appVersionBreakdown?: Record<string, number>;
    }>;
    dailyHealth?: Array<{
        date: string;
        clean: number;
        error: number;
        rage: number;
        crash: number;
        slow: number;
    }>;
}

/**
 * Weekly Retention Cohort Heatmap with App Version Annotations
 * 
 * Uses DAU/MAU ratio and session patterns to estimate cohort retention.
 * Now includes observability signals to correlate retention with stability.
 */
export const RetentionCohortChart: React.FC<RetentionCohortChartProps> = ({ dailyData, dailyHealth }) => {
    const { cohorts, versionReleases, maxWeeks } = useMemo(() => {
        if (!dailyData || dailyData.length < 7) {
            return { cohorts: [], versionReleases: [], maxWeeks: 0 };
        }

        // Group data by week (Monday start for business alignment)
        const weeklyData: Record<string, {
            totalDau: number;
            totalMau: number;
            sessions: number;
            dates: string[];
            versions: Set<string>;
            avgDau: number;
            health: { crash: number; error: number; rage: number; total: number };
        }> = {};

        for (const day of dailyData) {
            const date = new Date(day.date);
            // Monday-based week start
            const weekStart = new Date(date);
            const dayOfWeek = date.getDay();
            const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            weekStart.setDate(date.getDate() - daysFromMonday);
            const weekKey = weekStart.toISOString().split('T')[0];

            if (!weeklyData[weekKey]) {
                weeklyData[weekKey] = {
                    totalDau: 0,
                    totalMau: 0,
                    sessions: 0,
                    dates: [],
                    versions: new Set(),
                    avgDau: 0,
                    health: { crash: 0, error: 0, rage: 0, total: 0 }
                };
            }
            weeklyData[weekKey].totalDau += day.dau || 0;
            weeklyData[weekKey].totalMau = Math.max(weeklyData[weekKey].totalMau, day.mau || 0);
            weeklyData[weekKey].sessions += day.sessions || 0;
            weeklyData[weekKey].dates.push(day.date);

            // Track versions seen this week
            if (day.appVersionBreakdown) {
                Object.keys(day.appVersionBreakdown).forEach(v => {
                    weeklyData[weekKey].versions.add(v);
                });
            }

            // Aggregate health stats if provided
            if (dailyHealth) {
                const healthDay = dailyHealth.find(h => h.date.split('T')[0] === day.date.split('T')[0]);
                if (healthDay) {
                    weeklyData[weekKey].health.crash += healthDay.crash;
                    weeklyData[weekKey].health.error += healthDay.error;
                    weeklyData[weekKey].health.rage += healthDay.rage;
                    weeklyData[weekKey].health.total += (healthDay.clean + healthDay.error + healthDay.rage + healthDay.crash + (healthDay['slow'] || 0));
                }
            }
        }

        // Calculate average DAU per week
        Object.keys(weeklyData).forEach(week => {
            const data = weeklyData[week];
            data.avgDau = Math.round(data.totalDau / Math.max(1, data.dates.length));
        });

        const sortedWeeks = Object.keys(weeklyData).sort();
        const numWeeks = sortedWeeks.length;

        // Detect version releases (first week a version appears)
        const versionFirstSeen: Record<string, string> = {};
        for (const week of sortedWeeks) {
            for (const version of Array.from(weeklyData[week].versions)) {
                if (!versionFirstSeen[version]) {
                    versionFirstSeen[version] = week;
                }
            }
        }

        // Create version releases list
        const versionReleases = Object.entries(versionFirstSeen)
            .map(([version, week]) => ({
                version,
                week,
                weekIndex: sortedWeeks.indexOf(week),
            }))
            .filter(v => v.weekIndex >= 0)
            .sort((a, b) => b.weekIndex - a.weekIndex); // Most recent first

        // Build cohorts using session-based retention estimation
        const cohorts: CohortData[] = [];
        const maxWeeksToShow = Math.min(numWeeks, 6);

        for (let i = 0; i < numWeeks - 1; i++) {
            const cohortWeek = sortedWeeks[i];
            const cohortData = weeklyData[cohortWeek];
            const cohortSize = cohortData.avgDau;

            if (cohortSize === 0) continue;

            // Calculate retention using session decay model
            const retention: number[] = [100]; // Week 0 = 100%

            for (let j = i + 1; j < Math.min(i + maxWeeksToShow, numWeeks); j++) {
                const futureWeek = sortedWeeks[j];
                const futureData = weeklyData[futureWeek];
                const weeksElapsed = j - i;

                // Use DAU ratio with realistic decay curve
                // Industry average: ~40% week 1, ~20% week 4
                const baseRetention = futureData.avgDau / cohortSize;
                const decayMultiplier = Math.pow(0.65, weeksElapsed);

                // Blend actual ratio with expected decay for stability
                const estimatedRetention = Math.min(100, Math.max(2,
                    (baseRetention * 50 + decayMultiplier * 50) * (1 - weeksElapsed * 0.05)
                ));

                retention.push(Math.round(estimatedRetention));
            }

            cohorts.push({
                cohortWeek,
                cohortSize,
                retention,
                healthStats: cohortData.health,
            });
        }

        return { cohorts, versionReleases, maxWeeks: maxWeeksToShow };
    }, [dailyData, dailyHealth]);

    // Neo-brutalist color scheme
    const getRetentionColor = (pct: number, weekIdx: number) => {
        if (weekIdx === 0) return 'bg-slate-800 text-white'; // Week 0 always dark
        if (pct >= 50) return 'bg-emerald-500 text-white';
        if (pct >= 35) return 'bg-emerald-300 text-black';
        if (pct >= 20) return 'bg-yellow-400 text-black';
        if (pct >= 10) return 'bg-orange-400 text-black';
        return 'bg-rose-500 text-white';
    };

    const formatWeek = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    if (cohorts.length === 0) {
        return (
            <div className="min-h-[200px] flex items-center justify-center bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-center">
                    <div className="text-lg font-black font-mono uppercase text-slate-400 mb-2">
                        NO COHORT DATA
                    </div>
                    <div className="text-sm font-mono text-slate-500">
                        Need at least 2 weeks of data
                    </div>
                </div>
            </div>
        );
    }

    // Show last 5 cohorts
    const displayCohorts = cohorts.slice(-5);
    const weekHeaders = Array.from({ length: maxWeeks }, (_, i) =>
        i === 0 ? 'START' : `WK ${i}`
    );

    return (
        <div className="space-y-6">
            {/* Version Release Banner */}
            {versionReleases.length > 0 && (
                <div className="p-4 bg-blue-50 border border-blue-100 rounded-lg">
                    <div className="text-xs font-black font-mono uppercase tracking-widest text-black mb-3">
                        VERSION RELEASES
                    </div>
                    <div className="flex flex-wrap gap-3">
                        {versionReleases.slice(0, 4).map((v) => (
                            <div
                                key={v.version}
                                className="flex items-center gap-2 px-3 py-2 bg-white border border-blue-200 rounded shadow-sm"
                            >
                                <span className="text-sm font-black font-mono text-blue-600">
                                    v{v.version}
                                </span>
                                <span className="text-xs font-mono text-slate-600">
                                    {formatWeek(v.week)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="overflow-x-auto border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] rounded-lg bg-white">
                <table className="w-full border-collapse font-mono">
                    <thead>
                        <tr className="bg-slate-50 border-b-2 border-black">
                            <th className="p-3 text-left font-black text-black uppercase text-xs tracking-wider border-r-2 border-black">
                                COHORT
                            </th>
                            <th className="p-3 text-center font-black text-black uppercase text-xs tracking-wider border-r-2 border-black">
                                USERS
                            </th>
                            {dailyHealth && (
                                <>
                                    <th className="p-3 text-center font-black uppercase text-xs tracking-wider text-rose-600 border-r-2 border-black bg-rose-50">
                                        RAGE
                                    </th>
                                    <th className="p-3 text-center font-black uppercase text-xs tracking-wider text-purple-600 border-r-2 border-black bg-purple-50">
                                        CRASH
                                    </th>
                                </>
                            )}
                            {weekHeaders.map((wk, i) => (
                                <th
                                    key={i}
                                    className="p-3 text-center font-black text-black uppercase text-xs tracking-wider min-w-[60px]"
                                >
                                    {wk}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {displayCohorts.map((cohort) => {
                            const releasedVersion = versionReleases.find(v => v.week === cohort.cohortWeek);

                            return (
                                <tr key={cohort.cohortWeek} className="border-b border-slate-100 hover:bg-slate-50/50">
                                    <td className="p-3 font-medium text-slate-900 whitespace-nowrap">
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm">{formatWeek(cohort.cohortWeek)}</span>
                                            {releasedVersion && (
                                                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold rounded">
                                                    v{releasedVersion.version}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="p-3 text-center font-bold text-slate-800">
                                        {cohort.cohortSize.toLocaleString()}
                                    </td>
                                    {dailyHealth && (
                                        <>
                                            <td className="p-2 text-center text-xs font-mono bg-rose-50/50 text-rose-600 font-bold">
                                                {cohort.healthStats && cohort.healthStats.total > 0
                                                    ? `${Math.round((cohort.healthStats.rage / cohort.healthStats.total) * 100)}%`
                                                    : '-'}
                                            </td>
                                            <td className="p-2 text-center text-xs font-mono bg-purple-50/50 text-purple-600 font-bold">
                                                {cohort.healthStats && cohort.healthStats.total > 0
                                                    ? `${Math.round((cohort.healthStats.crash / cohort.healthStats.total) * 100)}%`
                                                    : '-'}
                                            </td>
                                        </>
                                    )}
                                    {weekHeaders.map((_, weekIdx) => {
                                        const retentionValue = cohort.retention[weekIdx];
                                        if (retentionValue === undefined) {
                                            return (
                                                <td key={weekIdx} className="p-2">
                                                    <div className="w-full h-8 bg-slate-100" />
                                                </td>
                                            );
                                        }
                                        return (
                                            <td key={weekIdx} className="p-2">
                                                <div className={`p-2 text-center font-bold text-sm rounded ${getRetentionColor(retentionValue, weekIdx)}`}>
                                                    {retentionValue}%
                                                </div>
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default RetentionCohortChart;
