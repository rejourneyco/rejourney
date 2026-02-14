import React, { useState, useMemo } from 'react';
import { GeoIssueLocation } from '../../services/api';

type IssueType = 'all' | 'crashes' | 'anrs' | 'errors' | 'rageTaps' | 'apiErrors';

interface IssuesWorldMapProps {
    locations: GeoIssueLocation[];
    selectedIssueType: IssueType;
    onLocationClick?: (location: GeoIssueLocation) => void;
    className?: string;
}

/**
 * Projects latitude/longitude to x/y using Eckert IV projection.
 */
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
        y: yNorm * height
    };
}

// Issue type colors and labels
const ISSUE_TYPE_CONFIG: Record<IssueType, { color: string; bgColor: string; borderColor: string; label: string; icon: string }> = {
    all: { color: 'text-slate-700', bgColor: 'bg-slate-500/40', borderColor: 'border-slate-500', label: 'All Issues', icon: 'Alert' },
    crashes: { color: 'text-red-600', bgColor: 'bg-red-500/40', borderColor: 'border-red-500', label: 'Crashes', icon: 'AlertOctagon' },
    anrs: { color: 'text-orange-600', bgColor: 'bg-orange-500/40', borderColor: 'border-orange-500', label: 'ANRs', icon: 'Clock' },
    errors: { color: 'text-amber-600', bgColor: 'bg-amber-500/40', borderColor: 'border-amber-500', label: 'Errors', icon: 'Terminal' },
    rageTaps: { color: 'text-purple-600', bgColor: 'bg-purple-500/40', borderColor: 'border-purple-500', label: 'Rage Taps', icon: 'Mouse' },
    apiErrors: { color: 'text-blue-600', bgColor: 'bg-blue-500/40', borderColor: 'border-blue-500', label: 'API Errors', icon: 'Activity' },
};

function getIssueCount(loc: GeoIssueLocation, type: IssueType): number {
    if (type === 'all') return loc.issues.total;
    return loc.issues[type];
}

// Severity thresholds for coloring
function getSeverityLevel(count: number, maxCount: number): 'critical' | 'high' | 'medium' | 'low' {
    const ratio = count / maxCount;
    if (ratio > 0.7) return 'critical';
    if (ratio > 0.4) return 'high';
    if (ratio > 0.15) return 'medium';
    return 'low';
}

const SEVERITY_COLORS = {
    critical: { bg: 'bg-red-500/60', border: 'border-red-600', shadow: 'rgba(239, 68, 68, 0.5)' },
    high: { bg: 'bg-orange-500/50', border: 'border-orange-500', shadow: 'rgba(249, 115, 22, 0.4)' },
    medium: { bg: 'bg-amber-400/40', border: 'border-amber-500', shadow: 'rgba(251, 191, 36, 0.4)' },
    low: { bg: 'bg-emerald-500/30', border: 'border-emerald-500', shadow: 'rgba(16, 185, 129, 0.3)' },
};

export const IssuesWorldMap: React.FC<IssuesWorldMapProps> = ({
    locations,
    selectedIssueType,
    onLocationClick,
    className
}) => {
    const [hoveredLocation, setHoveredLocation] = useState<string | null>(null);
    const canClick = Boolean(onLocationClick);

    // Filter locations with issues for selected type
    const filteredLocations = useMemo(() => {
        return locations.filter(loc => getIssueCount(loc, selectedIssueType) > 0);
    }, [locations, selectedIssueType]);

    // Calculate max count for relative sizing
    const maxCount = useMemo(() => {
        return Math.max(...filteredLocations.map(l => getIssueCount(l, selectedIssueType)), 1);
    }, [filteredLocations, selectedIssueType]);

    const xOffset = -3.0;
    const yOffset = 0;

    return (
        <div className={`relative w-full aspect-[2/1] bg-slate-50 border border-slate-200 shadow-sm rounded-xl overflow-hidden ${className}`}>
            {/* Background Map Image */}
            <img
                src="/Eckert4-optimized.jpg"
                alt="World Map (Eckert IV)"
                className="absolute inset-0 w-full h-full object-fill"
                loading="lazy"
                decoding="async"
            />

            {/* Subtle overlay to keep markers legible */}
            <div className="absolute inset-0 bg-slate-900/[0.08] pointer-events-none" />

            {/* Legend */}
            <div className="absolute bottom-4 left-4 z-10 bg-white/95 backdrop-blur border border-slate-200 p-3 shadow-sm rounded-lg">
                <div className="text-[11px] font-semibold mb-2 text-slate-600">
                    {ISSUE_TYPE_CONFIG[selectedIssueType].label} Severity
                </div>
                <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full border-2 ${SEVERITY_COLORS.critical.bg} ${SEVERITY_COLORS.critical.border}`}></div>
                        <span className="text-[11px] text-slate-600">Critical (&gt;70% of max)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full border-2 ${SEVERITY_COLORS.high.bg} ${SEVERITY_COLORS.high.border}`}></div>
                        <span className="text-[11px] text-slate-600">High (40-70%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full border-2 ${SEVERITY_COLORS.medium.bg} ${SEVERITY_COLORS.medium.border}`}></div>
                        <span className="text-[11px] text-slate-600">Medium (15-40%)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full border-2 ${SEVERITY_COLORS.low.bg} ${SEVERITY_COLORS.low.border}`}></div>
                        <span className="text-[11px] text-slate-600">Low (&lt;15%)</span>
                    </div>
                </div>
            </div>

            {/* Stats summary */}
            <div className="absolute top-4 right-4 z-10 bg-white/95 backdrop-blur border border-slate-200 p-3 shadow-sm rounded-lg">
                <div className="text-[11px] font-semibold mb-1 text-slate-600">
                    Hotspots
                </div>
                <div className="text-2xl font-semibold text-slate-900">
                    {filteredLocations.length}
                </div>
                <div className="text-[11px] text-slate-500">
                    locations affected
                </div>
            </div>

            {/* Markers */}
            <div className="absolute inset-0">
                {filteredLocations.map((loc, i) => {
                    const { x, y } = projectEckert4(loc.lat, loc.lng, 100, 100);
                    const count = getIssueCount(loc, selectedIssueType);
                    const severity = getSeverityLevel(count, maxCount);
                    const colors = SEVERITY_COLORS[severity];

                    // Relative sizing: min 8px, max 28px
                    const relativeSize = (count / maxCount) * 20;
                    const size = 8 + relativeSize;

                    const isHovered = hoveredLocation === `${loc.city}-${i}`;

                    return (
                        <div
                            key={i}
                            className={`absolute transform -translate-x-1/2 -translate-y-1/2 group ${canClick ? 'cursor-pointer' : 'cursor-default'}`}
                            style={{
                                left: `${x + xOffset}%`,
                                top: `${y + yOffset}%`,
                                zIndex: isHovered ? 1000 : Math.round(count)
                            }}
                            onMouseEnter={() => setHoveredLocation(`${loc.city}-${i}`)}
                            onMouseLeave={() => setHoveredLocation(null)}
                            onClick={() => {
                                if (onLocationClick) onLocationClick(loc);
                            }}
                        >
                            {/* Pulse effect for critical locations */}
                            {severity === 'critical' && (
                                <div className={`absolute inset-0 animate-ping rounded-full ${colors.bg}`} />
                            )}

                            {/* Dot marker */}
                            <div
                                className={`
                                    relative rounded-full transition-all duration-200 border-2
                                    ${colors.bg} ${colors.border}
                                    hover:scale-150 hover:z-50
                                `}
                                style={{
                                    width: `${size}px`,
                                    height: `${size}px`,
                                    boxShadow: `0 0 12px ${colors.shadow}`,
                                }}
                            />

                            {/* Tooltip */}
                            <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-3 transition-all duration-200 pointer-events-none z-[1001] ${isHovered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}>
                                <div className="bg-slate-800 text-white text-xs px-3 py-2 rounded-lg shadow-lg min-w-[180px]">
                                    <div className="font-semibold text-sm mb-1">{loc.city}, {loc.country}</div>
                                    <div className="text-slate-400 text-[10px] mb-2">{loc.sessions.toLocaleString()} sessions</div>
                                    <div className="border-t border-slate-700 pt-2 space-y-1">
                                        {selectedIssueType === 'all' ? (
                                            <>
                                                {loc.issues.crashes > 0 && (
                                                    <div className="flex justify-between">
                                                        <span className="text-red-400">Crashes</span>
                                                        <span className="font-semibold">{loc.issues.crashes}</span>
                                                    </div>
                                                )}
                                                {loc.issues.anrs > 0 && (
                                                    <div className="flex justify-between">
                                                        <span className="text-orange-400">ANRs</span>
                                                        <span className="font-semibold">{loc.issues.anrs}</span>
                                                    </div>
                                                )}
                                                {loc.issues.errors > 0 && (
                                                    <div className="flex justify-between">
                                                        <span className="text-amber-400">Errors</span>
                                                        <span className="font-semibold">{loc.issues.errors}</span>
                                                    </div>
                                                )}
                                                {loc.issues.rageTaps > 0 && (
                                                    <div className="flex justify-between">
                                                        <span className="text-purple-400">Rage Taps</span>
                                                        <span className="font-semibold">{loc.issues.rageTaps}</span>
                                                    </div>
                                                )}
                                                {loc.issues.apiErrors > 0 && (
                                                    <div className="flex justify-between">
                                                        <span className="text-blue-400">API Errors</span>
                                                        <span className="font-semibold">{loc.issues.apiErrors}</span>
                                                    </div>
                                                )}
                                                <div className="flex justify-between border-t border-slate-700 pt-1 mt-1">
                                                    <span className="text-white">Total</span>
                                                    <span className="font-semibold text-white">{loc.issues.total}</span>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="flex justify-between">
                                                <span className={ISSUE_TYPE_CONFIG[selectedIssueType].color}>
                                                    {ISSUE_TYPE_CONFIG[selectedIssueType].label}
                                                </span>
                                                <span className="font-semibold">{count}</span>
                                            </div>
                                        )}
                                    </div>
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
