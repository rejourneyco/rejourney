import React, { useMemo, useState } from 'react';

export interface GeoIssueMapRegion {
    id: string;
    country: string;
    lat: number;
    lng: number;
    activeUsers: number;
    issueCount: number;
    issueRate: number;
    impactScore: number;
    dominantIssue: string;
    confidence: 'high' | 'low';
    avgLatencyMs?: number;
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

    const highRiskCount = useMemo(
        () =>
            regions.filter(
                (region) =>
                    region.activeUsers >= minSampleSize &&
                    region.issueRate >= 0.1 &&
                    region.issueCount > 0
            ).length,
        [regions, minSampleSize]
    );

    return (
        <div className={`relative w-full aspect-[2/1] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm ${className || ''}`}>
            <img
                src="/Eckert4-optimized.jpg"
                alt="World Map (Eckert IV)"
                className="absolute inset-0 h-full w-full object-fill"
                loading="lazy"
                decoding="async"
            />

            <div className="pointer-events-none absolute inset-0 bg-slate-900/[0.08]" />

            <div className="absolute left-4 bottom-4 z-10 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
                <div className="mb-2 text-[11px] font-semibold text-slate-600">{issueLabel} Rate</div>
                <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-[11px] text-slate-600">
                        <div className={`h-3 w-3 rounded-full border-2 ${RATE_COLORS.critical.bg} ${RATE_COLORS.critical.border}`} />
                        <span>{RATE_COLORS.critical.label}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-600">
                        <div className={`h-3 w-3 rounded-full border-2 ${RATE_COLORS.high.bg} ${RATE_COLORS.high.border}`} />
                        <span>{RATE_COLORS.high.label}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-600">
                        <div className={`h-3 w-3 rounded-full border-2 ${RATE_COLORS.moderate.bg} ${RATE_COLORS.moderate.border}`} />
                        <span>{RATE_COLORS.moderate.label}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-600">
                        <div className={`h-3 w-3 rounded-full border-2 ${RATE_COLORS.low.bg} ${RATE_COLORS.low.border}`} />
                        <span>{RATE_COLORS.low.label}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-slate-600">
                        <div className={`h-3 w-3 rounded-full border-2 ${RATE_COLORS.lowSample.bg} ${RATE_COLORS.lowSample.border}`} />
                        <span>{RATE_COLORS.lowSample.label} (&lt; {minSampleSize} users)</span>
                    </div>
                </div>
            </div>

            <div className="absolute top-4 right-4 z-10 rounded-lg border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
                <div className="text-[11px] font-semibold text-slate-600">High-Risk Regions</div>
                <div className="text-2xl font-semibold text-slate-900">{highRiskCount}</div>
                <div className="text-[11px] text-slate-500">rate &gt;=10% with enough traffic</div>
            </div>

            <div className="absolute inset-0">
                {regions.map((region) => {
                    const { x, y } = projectEckert4(region.lat, region.lng, 100, 100);
                    const isLowSample = region.activeUsers < minSampleSize;
                    const rateBucket = getRateBucket(region.issueRate, isLowSample);
                    const colors = RATE_COLORS[rateBucket];
                    const size = 8 + Math.sqrt(region.activeUsers / maxUsers) * 22;
                    const isHovered = hoveredRegionId === region.id;

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
                                className={`relative rounded-full border-2 transition-all duration-200 hover:scale-125 ${colors.bg} ${colors.border}`}
                                style={{
                                    width: `${size}px`,
                                    height: `${size}px`,
                                    boxShadow: `0 0 12px ${colors.shadow}`,
                                }}
                            />

                            <div
                                className={`pointer-events-none absolute bottom-full left-1/2 z-[1001] mb-3 min-w-[220px] -translate-x-1/2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white shadow-lg transition-all duration-200 ${isHovered ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'
                                    }`}
                            >
                                <div className="mb-1 text-sm font-semibold">{region.country}</div>
                                <div className="mb-2 text-[10px] text-slate-400">
                                    {region.activeUsers.toLocaleString()} active users
                                </div>
                                <div className="space-y-1 border-t border-slate-700 pt-2">
                                    <div className="flex justify-between">
                                        <span className="text-slate-300">{issueLabel}</span>
                                        <span className="font-semibold">{region.issueCount.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-300">Issue rate</span>
                                        <span className="font-semibold">{formatRate(region.issueRate)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-300">Impact score</span>
                                        <span className="font-semibold">{region.impactScore}/100</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-300">Top issue</span>
                                        <span className="font-semibold">{region.dominantIssue}</span>
                                    </div>
                                    {region.avgLatencyMs !== undefined && (
                                        <div className="flex justify-between">
                                            <span className="text-slate-300">Avg API latency</span>
                                            <span className="font-semibold">{region.avgLatencyMs} ms</span>
                                        </div>
                                    )}
                                    {isLowSample && (
                                        <div className="pt-1 text-[10px] text-slate-400">
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
