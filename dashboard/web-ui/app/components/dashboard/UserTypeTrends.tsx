import React, { useMemo, useEffect, useState } from 'react';
import { NeoCard } from '../ui/neo/NeoCard';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useSessionData } from '../../context/SessionContext';
import { getUserEngagementTrends, UserEngagementTrends } from '../../services/api';
import { Tag } from 'lucide-react';

interface UserTypeTrendsProps {
    className?: string;
}

export const UserTypeTrends: React.FC<UserTypeTrendsProps> = ({ className }) => {
    const { selectedProject, timeRange, sessions } = useSessionData();
    const [trends, setTrends] = useState<UserEngagementTrends | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!selectedProject?.id) return;

        const fetchTrends = async () => {
            setIsLoading(true);
            try {
                const tr = timeRange === 'all' ? undefined : (timeRange === '24h' ? '1d' : timeRange);
                const data = await getUserEngagementTrends(selectedProject.id, tr);
                setTrends(data);
            } catch (err) {
                console.error('Failed to fetch user engagement trends', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchTrends();
    }, [selectedProject?.id, timeRange]);

    // Derive version first-seen dates from sessions
    const versionReleases = useMemo(() => {
        if (!sessions || sessions.length === 0) return [];

        const versionFirstSeen: Record<string, string> = {};

        // Sort sessions by date (oldest first)
        const sortedSessions = [...sessions].sort(
            (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
        );

        sortedSessions.forEach(session => {
            const version = session.appVersion;
            if (version && version !== 'Unknown' && !versionFirstSeen[version]) {
                versionFirstSeen[version] = session.startedAt;
            }
        });

        // Convert to array and sort by date
        return Object.entries(versionFirstSeen)
            .map(([version, date]) => ({
                version,
                date: new Date(date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
                fullDate: date
            }))
            .sort((a, b) => new Date(a.fullDate).getTime() - new Date(b.fullDate).getTime());
    }, [sessions]);

    const chartData = useMemo(() => {
        if (!trends?.daily) return [];
        return trends.daily.map(d => ({
            date: new Date(d.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
            fullDate: d.date,
            bouncers: d.bouncers,
            casuals: d.casuals,
            explorers: d.explorers,
            loyalists: d.loyalists,
        }));
    }, [trends]);

    // Find which chart dates have version releases
    const versionMarkersOnChart = useMemo(() => {
        if (!chartData.length || !versionReleases.length) return [];

        const chartDates = new Set(chartData.map(d => d.date));
        return versionReleases.filter(v => chartDates.has(v.date));
    }, [chartData, versionReleases]);

    type ReleaseLabelViewBox = {
        x?: number;
        y?: number;
        width?: number;
    };

    const buildReleaseLineLabel = (version: string, index: number) => ({ viewBox }: { viewBox?: ReleaseLabelViewBox }) => {
        const x = typeof viewBox?.x === 'number' ? viewBox.x : NaN;
        const y = typeof viewBox?.y === 'number' ? viewBox.y : NaN;
        const width = typeof viewBox?.width === 'number' ? viewBox.width : NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

        const text = `v${version}`;
        const rowOffset = (index % 3) * 11;
        const textWidth = text.length * 6;
        const placeLabelOnRight = Number.isFinite(width) ? x + textWidth + 12 <= width : true;
        const textY = y + 9 + rowOffset;
        const rectX = placeLabelOnRight ? x + 1 : x - textWidth - 7;
        const textX = placeLabelOnRight ? x + 4 : x - textWidth - 4;

        return (
            <g>
                <rect
                    x={rectX}
                    y={textY - 8}
                    width={textWidth + 6}
                    height={10}
                    rx={2}
                    fill="#ffffff"
                    fillOpacity={0.9}
                    stroke="#000"
                    strokeWidth={0.8}
                />
                <text
                    x={textX}
                    y={textY}
                    fill="#000"
                    fontSize={9}
                    fontWeight={700}
                    fontFamily="monospace"
                >
                    {text}
                </text>
            </g>
        );
    };

    return (
        <NeoCard title="User Type Trends" className={`border-4 border-black bg-white shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] ${className}`}>
            {/* Legend */}
            <div className="flex items-center gap-4 mb-6 px-2 flex-wrap bg-slate-50 p-3 border-2 border-slate-100 rounded-lg">
                <span className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                    SEGMENTS:
                </span>
                <span className="flex items-center gap-2 text-xs font-bold font-mono">
                    <span className="w-3 h-3 bg-emerald-500 border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"></span> LOYALISTS
                </span>
                <span className="flex items-center gap-2 text-xs font-bold font-mono">
                    <span className="w-3 h-3 bg-blue-500 border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"></span> EXPLORERS
                </span>
                <span className="flex items-center gap-2 text-xs font-bold font-mono">
                    <span className="w-3 h-3 bg-amber-400 border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"></span> CASUALS
                </span>
                <span className="flex items-center gap-2 text-xs font-bold font-mono">
                    <span className="w-3 h-3 bg-red-500 border border-black shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"></span> BOUNCERS
                </span>

                {/* Version markers legend */}
                {versionMarkersOnChart.length > 0 && (
                    <>
                        <div className="w-px h-4 bg-slate-300 mx-2" />
                        <span className="flex items-center gap-2 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                            <Tag className="w-3 h-3" /> VERSION RELEASES
                        </span>
                    </>
                )}
            </div>

            <div className="w-full h-[300px] relative">
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-slate-900" />
                    </div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 45, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#cbd5e1" />
                        <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700 }}
                            dy={10}
                        />
                        <YAxis
                            axisLine={{ stroke: '#000', strokeWidth: 2 }}
                            tickLine={{ stroke: '#000', strokeWidth: 2 }}
                            tick={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 700, fill: '#000' }}
                        />
                        <Tooltip
                            contentStyle={{
                                border: '3px solid #000',
                                boxShadow: '6px 6px 0 0 #000',
                                borderRadius: '0px',
                                fontFamily: 'monospace',
                                fontWeight: 'bold',
                                textTransform: 'uppercase'
                            }}
                            itemStyle={{
                                fontSize: '12px'
                            }}
                        />

                        {/* Version release markers */}
                        {versionMarkersOnChart.map((release, index) => (
                            <ReferenceLine
                                key={release.version}
                                x={release.date}
                                stroke="#000"
                                strokeWidth={2}
                                strokeDasharray="4 4"
                                label={buildReleaseLineLabel(release.version, index)}
                            />
                        ))}

                        <Area type="monotone" dataKey="bouncers" stackId="1" stroke="#ef4444" fill="#ef4444" name="Bouncers (<10s)" />
                        <Area type="monotone" dataKey="casuals" stackId="1" stroke="#fbbf24" fill="#fbbf24" name="Casuals (10-60s)" />
                        <Area type="monotone" dataKey="explorers" stackId="1" stroke="#3b82f6" fill="#3b82f6" name="Explorers (Active)" />
                        <Area type="monotone" dataKey="loyalists" stackId="1" stroke="#10b981" fill="#10b981" name="Loyalists (>3m)" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Explanation */}
            <div className="mt-6 flex items-start gap-2 text-xs font-bold text-slate-400 uppercase tracking-wide">
                <div className="min-w-[4px] h-[4px] mt-1.5 bg-black rounded-full"></div>
                Unique users per day by engagement level. Version markers show when new app versions were first detected.
            </div>
        </NeoCard>
    );
};
