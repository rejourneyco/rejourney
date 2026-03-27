import React, { useState } from 'react';
import { Badge } from './Badge';

interface Location {
    lat: number;
    lng: number;
    count: number;
    country: string;
    city: string;
}

interface WorldMapProps {
    locations: Location[];
    className?: string;
}

/**
 * Projects latitude/longitude to x/y using Eckert IV projection.
 * Formula:
 * x = 2 / sqrt(pi * (4 + pi)) * lambda * (1 + cos(theta))
 * y = 2 * sqrt(pi / (4 + pi)) * sin(theta)
 * where theta + sin(theta) * cos(theta) + 2 * sin(theta) = (2 + pi/2) * sin(phi)
 * lambda is longitude in radians, phi is latitude in radians.
 */
function projectEckert4(lat: number, lng: number, width: number, height: number): { x: number; y: number } {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const phi = toRad(lat);
    const lambda = toRad(lng);

    const pi = Math.PI;
    const k = (2 + pi / 2) * Math.sin(phi);

    // Helper to solve for theta using Newton-Raphson
    // f(theta) = theta + sin(theta)cos(theta) + 2sin(theta) - k = 0
    // which simplifies to: theta + 0.5*sin(2*theta) + 2*sin(theta) - k = 0
    let theta = phi / 2; // Initial guess
    const maxIter = 10;
    const tolerance = 1e-6;

    for (let i = 0; i < maxIter; i++) {
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const f = theta + sinTheta * cosTheta + 2 * sinTheta - k;
        const fPrime = 2 * cosTheta * cosTheta + 2 * cosTheta + 1; // Derivative approximation
        // Actually derivative of theta + 0.5sin(2theta) + 2sin(theta) is 1 + cos(2theta) + 2cos(theta)
        // 1 + cos(2theta) = 2cos^2(theta). So 2cos^2(theta) + 2cos(theta) + 1. Yes.

        if (Math.abs(f) < tolerance) break;
        theta = theta - f / fPrime;
    }

    // Calculate x, y in -1 to 1 range (approx)
    // standard x formula constant C_x = 2 / sqrt(pi * (4 + pi)) ≈ 0.4222382
    // standard y formula constant C_y = 2 * sqrt(pi / (4 + pi)) ≈ 1.3265004
    const Cx = 2 / Math.sqrt(pi * (4 + pi));
    const Cy = 2 * Math.sqrt(pi / (4 + pi));

    const xRaw = Cx * lambda * (1 + Math.cos(theta));
    const yRaw = Cy * Math.sin(theta);

    // Map to width/height. 
    // Eckert IV is defined for lambda in [-pi, pi].
    // Max x is when lambda = pi, theta = 0 (equator). cos(0)=1. 
    // Max x = Cx * pi * 2 ≈ 0.422 * 6.28 ≈ 2.65
    // Wait, let's normalize raw values to [0, 1].
    // The map usually has a 2:1 aspect ratio? Eckert IV is exactly 2:1 at the equator but the bounds are:
    // x range: [-2.65, 2.65] roughly?
    // Let's rely on standard scaling.
    // x is proportional to longitude. -180 to 180.
    // y is proportional to sin(theta). -1 to 1?

    // Normalization:
    // For Map width W and height H.
    // x = (xRaw / MaxX + 1) / 2 * W
    // y = (1 - (yRaw / MaxY + 1) / 2) * H (y is inverted for screen coords)

    // Max X occurs at lambda=pi, theta=0 => xRaw = Cx * pi * 2
    const maxX = Cx * Math.PI * 2;
    // Max Y occurs at phi=pi/2, theta=pi/2 => yRaw = Cy * 1
    const maxY = Cy;

    const xNorm = (xRaw / maxX + 1) / 2;
    const yNorm = 1 - (yRaw / maxY + 1) / 2; // Invert Y

    return {
        x: xNorm * width,
        y: yNorm * height
    };
}


export const WorldMap: React.FC<WorldMapProps> = ({ locations, className }) => {
    const [hoveredLocation, setHoveredLocation] = useState<string | null>(null);

    // Map settings
    const width = 1000; // Internal coordinate system width
    const height = 500; // Internal coordinate system height

    // Adjustment offsets (fine-tune based on visual feedback)
    const xOffset = -3.0; // Increased left shift
    const yOffset = 0;   // percentage

    // Calculate max count for relative sizing
    const maxCount = Math.max(...locations.map(l => l.count), 1);

    return (
        <div className={`relative w-full aspect-[2/1] bg-slate-100 border-2 border-slate-900 shadow-[8px_8px_0_0_#0f172a] overflow-hidden ${className}`}>
            {/* Background Map Image - Original colors, no filters */}
            <img
                src="/Eckert4-optimized.jpg"
                alt="World Map (Eckert IV)"
                className="absolute inset-0 w-full h-full object-fill"
                loading="lazy"
                decoding="async"
            />

            {/* Grid Overlay - Lighter for original map visibility */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.05)_1px,transparent_1px)] bg-[size:20px_20px] pointer-events-none" />

            {/* Legend */}
            <div className="absolute bottom-4 left-4 z-10 bg-white/90 backdrop-blur border border-slate-900 p-3 shadow-sm rounded-sm">
                <div className="text-[10px] font-bold font-mono uppercase mb-2 text-slate-500">Session Volume</div>
                <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full border border-rose-600 bg-rose-600/40"></div>
                        <span className="text-[10px] font-mono">&gt; 100 Sessions</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full border border-amber-400 bg-amber-400/40"></div>
                        <span className="text-[10px] font-mono">20 - 100 Sessions</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full border border-emerald-500 bg-emerald-500/40"></div>
                        <span className="text-[10px] font-mono">&lt; 20 Sessions</span>
                    </div>
                </div>
            </div>

            {/* Markers */}
            <div className="absolute inset-0">
                {locations.map((loc, i) => {
                    const { x, y } = projectEckert4(loc.lat, loc.lng, 100, 100);

                    // Relative sizing: min 4px, max 24px
                    const relativeSize = (loc.count / maxCount) * 20;
                    const size = 6 + relativeSize;

                    // Color logic: Red (High), Yellow (Medium), Green (Low)
                    // Style: Semi-transparent fill with solid border
                    let markerClass = 'bg-emerald-500/40 border-emerald-500'; // Green
                    let shadowColor = 'rgba(16, 185, 129, 0.4)';

                    if (loc.count > 100) {
                        markerClass = 'bg-rose-600/40 border-rose-600'; // Red
                        shadowColor = 'rgba(225, 29, 72, 0.4)';
                    } else if (loc.count > 20) {
                        markerClass = 'bg-amber-400/40 border-amber-400'; // Yellow
                        shadowColor = 'rgba(251, 191, 36, 0.4)';
                    }

                    return (
                        <div
                            key={i}
                            className="absolute transform -translate-x-1/2 -translate-y-1/2 group cursor-pointer"
                            style={{
                                left: `${x + xOffset}%`,
                                top: `${y + yOffset}%`,
                                zIndex: Math.round(loc.count)
                            }}
                            onMouseEnter={() => setHoveredLocation(`${loc.city}-${i}`)}
                            onMouseLeave={() => setHoveredLocation(null)}
                        >
                            {/* Pulse effect for hot locations */}
                            {loc.count > 50 && (
                                <div className={`absolute inset-0 animate-ping rounded-full opacity-50 ${markerClass.split(' ')[0].replace('/40', '')}`} />
                            )}

                            {/* Dot */}
                            <div
                                className={`
                                    relative rounded-full transition-all duration-300 border-2
                                    ${markerClass} shadow-[0_0_8px_${shadowColor}]
                                    hover:scale-125 hover:bg-opacity-80 hover:z-50
                                `}
                                style={{
                                    width: `${size}px`,
                                    height: `${size}px`,
                                }}
                            />

                            {/* Tooltip */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                <div className="bg-slate-900 text-white text-[10px] px-2 py-1 font-mono whitespace-nowrap border border-white shadow-[4px_4px_0_0_black]">
                                    <div className="font-bold">{loc.city}, {loc.country}</div>
                                    <div className="text-slate-400">{loc.count.toLocaleString()} sessions</div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Legend / Overlay Text */}
            <div className="absolute bottom-4 left-4 font-mono text-[10px] text-slate-500 bg-slate-900/80 px-2 py-1 border border-slate-700">
                ECKERT IV PROJECTION
            </div>
        </div>
    );
};
