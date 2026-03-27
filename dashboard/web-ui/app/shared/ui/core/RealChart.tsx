import React, { useRef, useEffect, useState } from 'react';
import { TruncatedText } from './TruncatedText';

export interface DataPoint {
  label: string;
  value: number;
  color?: string; // Optional per-bar color
}

export interface StackedSegment {
  value: number;
  color: string;
  label: string;
}

export interface StackedDataPoint {
  label: string;
  segments: StackedSegment[];
}

interface RealChartProps {
  title?: string;
  data: DataPoint[] | StackedDataPoint[];
  height?: number;
  className?: string;
  type?: 'line' | 'bar' | 'area' | 'stacked-bar';
  color?: string;
  showLabels?: boolean;
  showGrid?: boolean;
}

export const RealChart: React.FC<RealChartProps> = ({
  title,
  data = [],
  height = 200,
  className = '',
  type = 'line',
  color = '#000',
  showLabels = true,
  showGrid = true,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 400, height: height });

  // Get actual container width for proper aspect ratio
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

  if (data.length === 0) {
    return (
      <div className={`bg-white border border-gray-200 rounded-lg p-3 ${className}`}>
        {title && <div className="text-sm font-medium text-gray-700 mb-2">{title}</div>}
        <div
          ref={containerRef}
          className="bg-gray-50 rounded relative flex items-center justify-center"
          style={{ height: `${height}px` }}
        >
          <span className="text-xs text-gray-400">No data available</span>
        </div>
      </div>
    );
  }

  // Type Guard helper
  const isStacked = (d: any): d is StackedDataPoint => 'segments' in d;

  let maxValue = 1;
  let minValue = 0;

  if (type === 'stacked-bar' && isStacked(data[0])) {
    // Sum up segments for max value
    maxValue = Math.max(...(data as StackedDataPoint[]).map(d => d.segments.reduce((acc, s) => acc + s.value, 0)), 1);
  } else {
    maxValue = Math.max(...(data as DataPoint[]).map(d => d.value), 1);
    minValue = Math.min(...(data as DataPoint[]).map(d => d.value), 0);
  }

  const range = maxValue - minValue || 1;

  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = dimensions.width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate Y-axis labels
  const yAxisLabels = Array.from({ length: 5 }, (_, i) => {
    const value = minValue + (range * (4 - i) / 4);
    return {
      value: Math.round(value),
      y: padding.top + (i * chartHeight / 4),
    };
  });

  // Generate points with actual pixel positions (Only for line/area)
  let points: { x: number; y: number; data: DataPoint }[] = [];
  if (type !== 'stacked-bar' && !isStacked(data[0])) {
    points = (data as DataPoint[]).map((d, i) => {
      const x = padding.left + (data.length > 1 ? (i / (data.length - 1)) * chartWidth : chartWidth / 2);
      const y = padding.top + chartHeight - ((d.value - minValue) / range) * chartHeight;
      return { x, y, data: d };
    });
  }

  // Generate path for line/area chart
  const linePath = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
  ).join(' ');

  const areaPath = points.length > 0 ? `${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z` : '';

  return (
    <div className={`bg-white border border-gray-200 rounded-lg p-3 ${className}`}>
      {title && <div className="text-sm font-medium text-gray-700 mb-2">{title}</div>}
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
              {/* Horizontal grid lines */}
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
              {/* Vertical grid lines */}
              {data.length <= 15 && data.map((_, i) => {
                const x = padding.left + (data.length > 1 ? (i / (data.length - 1)) * chartWidth : chartWidth / 2);
                return (
                  <line
                    key={`v-${i}`}
                    x1={x}
                    y1={padding.top}
                    x2={x}
                    y2={padding.top + chartHeight}
                    stroke="#e5e5e5"
                    strokeWidth="1"
                  />
                );
              })}
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

          {/* Area fill */}
          {type === 'area' && (
            <path
              d={areaPath}
              fill={color}
              fillOpacity="0.1"
            />
          )}

          {/* Line */}
          {(type === 'line' || type === 'area') && (
            <path
              d={linePath}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Data points for line/area */}
          {(type === 'line' || type === 'area') && points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="4"
              fill="white"
              stroke={color}
              strokeWidth="2"
            >
              <title>{p.data.label}: {p.data.value}</title>
            </circle>
          ))}

          {/* Bar chart (Simple) */}
          {type === 'bar' && !isStacked(data[0]) && (data as DataPoint[]).map((d, i) => {
            const barPadding = 4;
            const totalBarWidth = chartWidth / data.length;
            const barWidth = Math.max(totalBarWidth - barPadding * 2, 8);
            const x = padding.left + (i * totalBarWidth) + (totalBarWidth - barWidth) / 2;
            const barHeight = ((d.value - minValue) / range) * chartHeight;
            const y = padding.top + chartHeight - barHeight;

            // Use per-bar color if provided, otherwise fall back to default color
            const barColor = d.color || color;

            return (
              <rect
                key={i}
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                fill={barColor}
                rx="2"
              >
                <title>{d.label}: {d.value}</title>
              </rect>
            );
          })}

          {/* Stacked Bar Chart */}
          {type === 'stacked-bar' && isStacked(data[0]) && (data as StackedDataPoint[]).map((d, i) => {
            const barPadding = 4;
            const totalBarWidth = chartWidth / data.length;
            const barWidth = Math.max(totalBarWidth - barPadding * 2, 8);
            const x = padding.left + (i * totalBarWidth) + (totalBarWidth - barWidth) / 2;

            // Stack segments upwards
            let currentY = padding.top + chartHeight;

            return (
              <g key={i}>
                {d.segments.map((seg, j) => {
                  const segHeight = (seg.value / range) * chartHeight;
                  currentY -= segHeight; // Move up for this segment

                  if (seg.value === 0) return null;

                  return (
                    <rect
                      key={j}
                      x={x}
                      y={currentY}
                      width={barWidth}
                      height={segHeight}
                      fill={seg.color}
                      rx="0" // Sharp edges for stacked
                      stroke="white"
                      strokeWidth="1" // Visual separator
                    >
                      <title>{seg.label}: {seg.value}</title>
                    </rect>
                  );
                })}
              </g>
            );
          })}

          {/* Y-axis labels */}
          {showLabels && yAxisLabels.map((label, i) => (
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
          {showLabels && data.map((d, i) => {
            // Only show some labels if there are many data points
            const showEvery = data.length > 10 ? Math.ceil(data.length / 7) : 1;
            if (i % showEvery !== 0) return null;

            const x = padding.left + (data.length > 1 ? (i / (data.length - 1)) * chartWidth : chartWidth / 2);
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
                {d.label.length > 8 ? d.label.substring(0, 6) + '..' : d.label}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

// Simple bar chart for quick stats
interface SimpleBarChartProps {
  data: { label: string; value: number; color?: string }[];
  height?: number;
  showValues?: boolean;
  className?: string;
}

export const SimpleBarChart: React.FC<SimpleBarChartProps> = ({
  data,
  height = 100,
  showValues = true,
  className = '',
}) => {
  const maxValue = Math.max(...data.map(d => d.value), 1);

  return (
    <div className={`flex items-end gap-2 ${className}`} style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex-1 flex flex-col items-center min-w-0">
          <div
            className="w-full border-2 border-black rounded-t-sm"
            style={{
              height: `${Math.max((d.value / maxValue) * (height - 30), 4)}px`,
              backgroundColor: d.color || '#000',
            }}
            title={`${d.label}: ${d.value}`}
          />
          {showValues && (
            <span className="text-xs font-mono mt-1">{d.value}</span>
          )}
          <div className="text-xs text-gray-500 w-full text-center">
            <TruncatedText text={d.label} />
          </div>
        </div>
      ))}
    </div>
  );
};

// Sparkline for inline mini charts
interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  width = 80,
  height = 20,
  color = '#000',
  className = '',
}) => {
  if (data.length === 0) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1 || 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className={className}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default RealChart;
