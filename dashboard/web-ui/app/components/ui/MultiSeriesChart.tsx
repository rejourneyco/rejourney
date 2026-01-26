import React, { useRef, useEffect, useState } from 'react';

interface Series {
    name: string;
    color: string;
    data: number[]; // Values for each label
}

interface MultiSeriesChartProps {
    title?: string;
    labels: string[];
    series: Series[];
    height?: number;
    className?: string;
    showLegend?: boolean;
    showGrid?: boolean;
}

/**
 * Multi-series line chart for displaying multiple metrics (e.g., DAU/MAU)
 */
export const MultiSeriesChart: React.FC<MultiSeriesChartProps> = ({
    title,
    labels,
    series,
    height = 200,
    className = '',
    showLegend = true,
    showGrid = true,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 400, height: height });

    useEffect(() => {
        const updateDimensions = () => {
            if (containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                setDimensions({ width: rect.width || 400, height });
            }
        };

        updateDimensions();
        window.addEventListener('resize', updateDimensions);
        return () => window.removeEventListener('resize', updateDimensions);
    }, [height]);

    if (labels.length === 0 || series.length === 0) {
        return (
            <div className={`border border-black p-3 bg-white ${className}`}>
                {title && <div className="text-xs font-mono font-bold mb-2">{title}</div>}
                <div
                    ref={containerRef}
                    className="border border-gray-300 bg-gray-50 relative flex items-center justify-center"
                    style={{ height: `${height}px` }}
                >
                    <span className="text-xs text-gray-500 font-mono">No data available</span>
                </div>
            </div>
        );
    }

    // Find global min/max across all series
    const allValues = series.flatMap((s) => s.data);
    const maxValue = Math.max(...allValues, 1);
    const minValue = Math.min(...allValues, 0);
    const range = maxValue - minValue || 1;

    const padding = { top: 20, right: 20, bottom: 40, left: 50 };
    const chartWidth = dimensions.width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Calculate Y-axis labels
    const yAxisLabels = Array.from({ length: 5 }, (_, i) => {
        const value = minValue + (range * (4 - i)) / 4;
        return {
            value: Math.round(value),
            y: padding.top + (i * chartHeight) / 4,
        };
    });

    // Generate line paths for each series
    const seriesPaths = series.map((s) => {
        const points = s.data.map((value, i) => {
            const x =
                padding.left +
                (labels.length > 1 ? (i / (labels.length - 1)) * chartWidth : chartWidth / 2);
            const y = padding.top + chartHeight - ((value - minValue) / range) * chartHeight;
            return { x, y, value };
        });

        const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

        return { ...s, points, linePath };
    });

    return (
        <div className={`border border-black p-3 bg-white ${className}`}>
            {/* Title and Legend Row */}
            <div className="flex items-center justify-between mb-2">
                {title && <div className="text-xs font-mono font-bold">{title}</div>}
                {showLegend && (
                    <div className="flex items-center gap-4">
                        {series.map((s) => (
                            <div key={s.name} className="flex items-center gap-1">
                                <div
                                    className="w-3 h-3 rounded-full"
                                    style={{ backgroundColor: s.color }}
                                />
                                <span className="text-xs font-mono">{s.name}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div ref={containerRef} style={{ height: `${height}px` }}>
                <svg
                    width="100%"
                    height={height}
                    viewBox={`0 0 ${dimensions.width} ${height}`}
                    preserveAspectRatio="xMidYMid meet"
                >
                    {/* Grid lines */}
                    {showGrid && (
                        <g className="grid-lines">
                            {yAxisLabels.map((label, i) => (
                                <line
                                    key={`h-${i}`}
                                    x1={padding.left}
                                    y1={label.y}
                                    x2={dimensions.width - padding.right}
                                    y2={label.y}
                                    stroke="#e5e5e5"
                                    strokeWidth="1"
                                />
                            ))}
                        </g>
                    )}

                    {/* Axes */}
                    <line
                        x1={padding.left}
                        y1={padding.top}
                        x2={padding.left}
                        y2={padding.top + chartHeight}
                        stroke="#ccc"
                        strokeWidth="1"
                    />
                    <line
                        x1={padding.left}
                        y1={padding.top + chartHeight}
                        x2={dimensions.width - padding.right}
                        y2={padding.top + chartHeight}
                        stroke="#ccc"
                        strokeWidth="1"
                    />

                    {/* Lines for each series */}
                    {seriesPaths.map((s) => (
                        <path
                            key={s.name}
                            d={s.linePath}
                            fill="none"
                            stroke={s.color}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    ))}

                    {/* Data points for each series */}
                    {seriesPaths.map((s) =>
                        s.points.map((p, i) => (
                            <circle
                                key={`${s.name}-${i}`}
                                cx={p.x}
                                cy={p.y}
                                r="4"
                                fill="white"
                                stroke={s.color}
                                strokeWidth="2"
                            >
                                <title>
                                    {s.name} - {labels[i]}: {p.value}
                                </title>
                            </circle>
                        ))
                    )}

                    {/* Y-axis labels */}
                    {yAxisLabels.map((label, i) => (
                        <text
                            key={`y-${i}`}
                            x={padding.left - 8}
                            y={label.y + 4}
                            fontSize="11"
                            fill="#666"
                            textAnchor="end"
                            fontFamily="monospace"
                        >
                            {label.value}
                        </text>
                    ))}

                    {/* X-axis labels */}
                    {labels.map((label, i) => {
                        const showEvery = labels.length > 10 ? Math.ceil(labels.length / 7) : 1;
                        if (i % showEvery !== 0) return null;

                        const x =
                            padding.left +
                            (labels.length > 1 ? (i / (labels.length - 1)) * chartWidth : chartWidth / 2);
                        return (
                            <text
                                key={`x-${i}`}
                                x={x}
                                y={height - 8}
                                fontSize="10"
                                fill="#666"
                                textAnchor="middle"
                                fontFamily="monospace"
                            >
                                {label.length > 8 ? label.substring(0, 6) + '..' : label}
                            </text>
                        );
                    })}
                </svg>
            </div>
        </div>
    );
};

export default MultiSeriesChart;
