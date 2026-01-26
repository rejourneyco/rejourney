import React from 'react';
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts';

interface SparklineProps {
    data: number[];
    color?: string;
    width?: number;
    height?: number;
    strokeWidth?: number;
    showTooltip?: boolean;
}

/**
 * Compact inline sparkline chart for trend visualization
 * Uses Recharts for consistency with other dashboard charts
 */
export const Sparkline: React.FC<SparklineProps> = ({
    data,
    color = '#2563eb',
    width = 100,
    height = 30,
    strokeWidth = 2,
    showTooltip = true,
}) => {
    // Convert raw numbers to chart data format
    const chartData = data.map((value, index) => ({
        index,
        value,
    }));

    if (data.length === 0) {
        return (
            <div
                style={{ width, height }}
                className="bg-slate-100 rounded-sm animate-pulse"
            />
        );
    }

    return (
        <div style={{ width, height }} className="overflow-visible">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 0, left: 0, bottom: 5 }}>
                    <defs>
                        <linearGradient id={`sparkline-gradient-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                        </linearGradient>
                    </defs>
                    {showTooltip && (
                        <Tooltip
                            contentStyle={{
                                backgroundColor: '#0f172a',
                                border: 'none',
                                borderRadius: '4px',
                                padding: '4px 8px',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                color: '#fff',
                            }}
                            formatter={(value) => [value ?? 0, '']}
                            labelFormatter={() => ''}
                        />
                    )}
                    <Area
                        type="monotone"
                        dataKey="value"
                        stroke={color}
                        strokeWidth={strokeWidth}
                        fill={`url(#sparkline-gradient-${color.replace('#', '')})`}
                        isAnimationActive={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
};

export default Sparkline;
