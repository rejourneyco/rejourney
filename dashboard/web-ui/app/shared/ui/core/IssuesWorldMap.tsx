import React, { useMemo, useState } from 'react';

export interface GeoIssueMapRegion {
    id: string;
    city?: string;
    country: string;
    lat: number;
    lng: number;
    activeUsers: number;
    issueCount: number;
    issueRate: number;
    dominantIssue: string;
    confidence: 'high' | 'low';
    avgLatencyMs?: number;
    engagementSegments?: {
        loyalists: number;
        explorers: number;
        casuals: number;
        bouncers: number;
    };
}

interface IssuesWorldMapProps {
    regions: GeoIssueMapRegion[];
    issueLabel: string;
    minSampleSize: number;
    onRegionClick?: (region: GeoIssueMapRegion) => void;
    className?: string;
}

type RateBucket = 'critical' | 'high' | 'moderate' | 'low' | 'lowSample';

function projectEckert4(lat: number, lng: number, width: number, height: number): { x: number; y: number } {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const phi = toRad(lat);
    const lambda = toRad(lng);
    const pi = Math.PI;
    const k = (2 + pi / 2) * Math.sin(phi);

    let theta = phi / 2;
    const maxIter = 10;
    const tolerance = 1e-6;

    for (let i = 0; i < maxIter; i++) {
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const f = theta + sinTheta * cosTheta + 2 * sinTheta - k;
        const fPrime = 2 * cosTheta * cosTheta + 2 * cosTheta + 1;
        if (Math.abs(f) < tolerance) break;
        theta = theta - f / fPrime;
    }

    const Cx = 2 / Math.sqrt(pi * (4 + pi));
    const Cy = 2 * Math.sqrt(pi / (4 + pi));
    const xRaw = Cx * lambda * (1 + Math.cos(theta));
    const yRaw = Cy * Math.sin(theta);
    const maxX = Cx * Math.PI * 2;
    const maxY = Cy;
    const xNorm = (xRaw / maxX + 1) / 2;
    const yNorm = 1 - (yRaw / maxY + 1) / 2;

    return {
        x: xNorm * width,
        y: yNorm * height,
    };
}

const RATE_COLORS: Record<RateBucket, { bg: string; border: string; shadow: string; label: string }> = {
    critical: {
        bg: 'bg-rose-500/65',
        border: 'border-rose-600',
        shadow: 'rgba(225, 29, 72, 0.55)',
        label: '>=20%',
    },
    high: {
        bg: 'bg-orange-500/55',
        border: 'border-orange-600',
        shadow: 'rgba(249, 115, 22, 0.5)',
        label: '10-20%',
    },
    moderate: {
        bg: 'bg-amber-400/55',
        border: 'border-amber-500',
        shadow: 'rgba(251, 191, 36, 0.45)',
        label: '5-10%',
    },
    low: {
        bg: 'bg-emerald-500/45',
        border: 'border-emerald-600',
        shadow: 'rgba(16, 185, 129, 0.35)',
        label: '<5%',
    },
    lowSample: {
        bg: 'bg-slate-400/45',
        border: 'border-slate-500',
        shadow: 'rgba(100, 116, 139, 0.35)',
        label: `Low sample`,
    },
};

function getRateBucket(issueRate: number, isLowSample: boolean): RateBucket {
    if (isLowSample) return 'lowSample';
    if (issueRate >= 0.2) return 'critical';
    if (issueRate >= 0.1) return 'high';
    if (issueRate >= 0.05) return 'moderate';
    return 'low';
}

function formatRate(issueRate: number): string {
    return `${(issueRate * 100).toFixed(1)}%`;
}

export const IssuesWorldMap: React.FC<IssuesWorldMapProps> = ({
    regions,
    issueLabel,
    minSampleSize,
    onRegionClick,
    className,
}) => {
    const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
    const canClick = Boolean(onRegionClick);
    const xOffset = -3.0;
    const yOffset = 0;

    const maxUsers = useMemo(
        () => Math.max(...regions.map((region) => region.activeUsers), 1),
        [regions]
    );

    return (
        <div className={`relative h-[520px] max-h-[72vh] min-h-[360px] w-full rounded-xl border border-slate-200 bg-slate-50 shadow-sm ${className || ''}`}>
            <img
                src="/Eckert4-optimized.jpg"
                alt="World Map (Eckert IV)"
                className="absolute inset-0 h-full w-full object-fill rounded-xl"
                loading="lazy"
                decoding="async"
            />

            <div className="pointer-events-none absolute inset-0 bg-slate-900/[0.08] rounded-xl" />

            <div className="absolute left-6 bottom-6 z-20 rounded-xl border-2 border-slate-900 bg-white p-4 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">{issueLabel} Rate</div>
                <div className="space-y-2">
                    {Object.entries(RATE_COLORS).map(([key, config]) => (
                        <div key={key} className="flex items-center gap-2 text-[11px] font-medium text-slate-700">
                            <div className={`h-3 w-3 rounded-full border border-slate-900 ${config.bg} ${config.border}`} />
                            <span>{config.label} {key === 'lowSample' ? `(<${minSampleSize})` : ''}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="absolute inset-0">
                {regions.map((region) => {
                    const { x, y } = projectEckert4(region.lat, region.lng, 100, 100);
                    const isLowSample = region.activeUsers < minSampleSize;
                    const rateBucket = getRateBucket(region.issueRate, isLowSample);
                    const colors = RATE_COLORS[rateBucket];
                    const size = 8 + Math.sqrt(region.activeUsers / maxUsers) * 22;
                    const isHovered = hoveredRegionId === region.id;

                    const isNearTop = y < 45;
                    const isNearLeft = x < 25;
                    const isNearRight = x > 75;
                    const segmentMix = region.engagementSegments
                        ? [
                            { label: 'Loyalists', value: region.engagementSegments.loyalists },
                            { label: 'Explorers', value: region.engagementSegments.explorers },
                            { label: 'Casuals', value: region.engagementSegments.casuals },
                            { label: 'Bouncers', value: region.engagementSegments.bouncers },
                        ]
                        : [];
                    const totalSegments = segmentMix.reduce((sum, segment) => sum + segment.value, 0);
                    const topSegments = totalSegments > 0
                        ? segmentMix
                            .map((segment) => ({
                                ...segment,
                                share: Math.round((segment.value / totalSegments) * 100),
                            }))
                            .sort((a, b) => b.share - a.share)
                            .slice(0, 2)
                        : [];

                    return (
                        <div
                            key={region.id}
                            className={`group absolute -translate-x-1/2 -translate-y-1/2 transform ${canClick ? 'cursor-pointer' : 'cursor-default'}`}
                            style={{
                                left: `${x + xOffset}%`,
                                top: `${y + yOffset}%`,
                                zIndex: isHovered ? 1000 : Math.max(10, Math.round(size)),
                            }}
                            onMouseEnter={() => setHoveredRegionId(region.id)}
                            onMouseLeave={() => setHoveredRegionId(null)}
                            onClick={() => {
                                if (onRegionClick) onRegionClick(region);
                            }}
                        >
                            {rateBucket === 'critical' && (
                                <div className={`absolute inset-0 animate-ping rounded-full ${colors.bg}`} />
                            )}

                            <div
                                className={`relative rounded-full border-2 transition-all duration-200 hover:scale-125 ${colors.bg} ${colors.border} border-slate-900`}
                                style={{
                                    width: `${size}px`,
                                    height: `${size}px`,
                                    boxShadow: isHovered ? `0 0 0 4px rgba(0,0,0,0.1), 4px 4px 0px 0px rgba(0,0,0,1)` : `2px 2px 0px 0px rgba(0,0,0,1)`,
                                }}
                            />

                            <div
                                className={`pointer-events-none absolute z-[1001] min-w-[240px] rounded-xl border-2 border-slate-900 bg-slate-900 px-4 py-3 text-xs text-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all duration-200 ${isNearTop ? 'top-full mt-4' : 'bottom-full mb-4'
                                    } ${isNearLeft ? 'left-0' : isNearRight ? 'right-0' : 'left-1/2 -translate-x-1/2'
                                    } ${isHovered ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-2'}`}
                            >
                                <div className="mb-1 text-sm font-black tracking-tight">{region.city ? `${region.city}, ${region.country}` : region.country}</div>
                                <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                    {region.activeUsers.toLocaleString()} active users
                                </div>
                                <div className="space-y-1.5 border-t border-slate-700 pt-3">
                                    <div className="flex justify-between">
                                        <span className="font-medium text-slate-400">{issueLabel}</span>
                                        <span className="font-bold">{region.issueCount.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="font-medium text-slate-400">Issue rate</span>
                                        <span className="font-bold text-amber-400">{formatRate(region.issueRate)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="font-medium text-slate-400">Top issue</span>
                                        <span className="font-bold">{region.dominantIssue}</span>
                                    </div>
                                    {region.avgLatencyMs !== undefined && (
                                        <div className="flex justify-between">
                                            <span className="font-medium text-slate-400">Avg API latency</span>
                                            <span className="font-bold text-blue-400">{region.avgLatencyMs} ms</span>
                                        </div>
                                    )}
                                    {topSegments.length > 0 && (
                                        <div className="flex justify-between">
                                            <span className="font-medium text-slate-400">Top user types</span>
                                            <span className="font-bold text-emerald-300">
                                                {topSegments.map((segment) => `${segment.label} ${segment.share}%`).join(' • ')}
                                            </span>
                                        </div>
                                    )}
                                    {isLowSample && (
                                        <div className="mt-2 rounded-md bg-slate-800 p-2 text-[10px] font-medium text-slate-400 border border-slate-700">
                                            Low confidence due to limited user volume.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default IssuesWorldMap;
