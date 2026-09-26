import React, { useMemo, useEffect, useState } from 'react';
import { NeoCard } from '~/shared/ui/core/neo/NeoCard';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useSessionData } from '~/shared/providers/SessionContext';
import { getSessionsPaginated, getUserEngagementTrends, UserEngagementTrends } from '~/shared/api/client';
import { Tag } from 'lucide-react';

interface UserTypeTrendsProps {
    className?: string;
}

export const UserTypeTrends: React.FC<UserTypeTrendsProps> = ({ className }) => {
    const { selectedProject, timeRange } = useSessionData();
    const [trends, setTrends] = useState<UserEngagementTrends | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [sessions, setSessions] = useState<any[]>([]);

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

    useEffect(() => {
        if (!selectedProject?.id) {
            setSessions([]);
            return;
        }

        let cancelled = false;
        getSessionsPaginated({
            projectId: selectedProject.id,
            timeRange: timeRange === 'all' ? undefined : timeRange,
            limit: 200,
            includeTotal: false,
        }).then((response) => {
            if (cancelled) return;
            setSessions(response.sessions || []);
        }).catch((err) => {
            if (cancelled) return;
            console.error('Failed to fetch sessions for version markers', err);
            setSessions([]);
        });

        return () => {
            cancelled = true;
        };
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
                    rx={0}
                    fill="#ffffff"
                    fillOpacity={0.9}
                    stroke="#5f6368"
                    strokeWidth={0.8}
                />
                <text
                    x={textX}
                    y={textY}
                    fill="#3c4043"
                    fontSize={9}
                    fontWeight={500}
                >
                    {text}
                </text>
            </g>
        );
    };

    return (
        <NeoCard title="User type trends" className={className}>
            {/* Legend */}
            <div className="mb-6 flex flex-wrap items-center gap-4 rounded-none border border-[#e8eaed] bg-[#f8fafd] p-3">
                <span className="flex items-center gap-2 text-xs font-medium text-[#5f6368]">
                    Segments:
                </span>
                <span className="flex items-center gap-2 text-xs font-medium text-[#3c4043]">
                    <span className="h-3 w-3 bg-[#188038]"></span> Loyalists
                </span>
                <span className="flex items-center gap-2 text-xs font-medium text-[#3c4043]">
                    <span className="h-3 w-3 bg-[#1a73e8]"></span> Explorers
                </span>
                <span className="flex items-center gap-2 text-xs font-medium text-[#3c4043]">
                    <span className="h-3 w-3 bg-[#e37400]"></span> Casuals
                </span>
                <span className="flex items-center gap-2 text-xs font-medium text-[#3c4043]">
                    <span className="h-3 w-3 bg-[#d93025]"></span> Bouncers
                </span>

                {/* Version markers legend */}
                {versionMarkersOnChart.length > 0 && (
                    <>
                        <div className="mx-2 h-4 w-px bg-[#dadce0]" />
                        <span className="flex items-center gap-2 text-xs font-medium text-[#5f6368]">
                            <Tag className="h-3 w-3" /> Version releases
                        </span>
                    </>
                )}
            </div>

            <div className="w-full h-[300px] relative">
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10">
                        <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-[#1a73e8]" />
                    </div>
                )}
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 45, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e8eaed" />
                        <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: '#5f6368' }}
                            dy={10}
                        />
                        <YAxis
                            axisLine={{ stroke: '#dadce0', strokeWidth: 1 }}
                            tickLine={{ stroke: '#dadce0', strokeWidth: 1 }}
                            tick={{ fontSize: 11, fill: '#5f6368' }}
                        />
                        <Tooltip
                            contentStyle={{
                                border: '1px solid #dadce0',
                                boxShadow: 'none',
                                borderRadius: '0px',
                                fontVariantNumeric: 'tabular-nums',
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
                                stroke="#5f6368"
                                strokeWidth={1.5}
                                strokeDasharray="4 4"
                                label={buildReleaseLineLabel(release.version, index)}
                            />
                        ))}

                        <Area type="monotone" dataKey="bouncers" stackId="1" stroke="#d93025" fill="#d93025" name="Bouncers (<10s)" isAnimationActive={false} />
                        <Area type="monotone" dataKey="casuals" stackId="1" stroke="#e37400" fill="#e37400" name="Casuals (10-60s)" isAnimationActive={false} />
                        <Area type="monotone" dataKey="explorers" stackId="1" stroke="#1a73e8" fill="#1a73e8" name="Explorers (active)" isAnimationActive={false} />
                        <Area type="monotone" dataKey="loyalists" stackId="1" stroke="#188038" fill="#188038" name="Loyalists (>3m)" isAnimationActive={false} />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* Explanation */}
            <div className="mt-6 flex items-start gap-2 text-xs text-[#5f6368]">
                Unique users per day by engagement level. Version markers show when new app versions were first detected.
            </div>
        </NeoCard>
    );
};
