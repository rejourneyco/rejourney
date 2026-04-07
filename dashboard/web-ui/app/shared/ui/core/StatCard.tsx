import React from 'react';
import { Card } from './Card';
import { Badge } from './Badge';
import { ArrowUpRight, ArrowDownRight, Minus } from 'lucide-react';

interface StatCardProps {
    title: string;
    value: string | number;
    subValue?: string;
    trend?: {
        value: number;
        label: string;
        positiveIsGood?: boolean;
    };
    icon?: React.ReactNode;
    color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'purple';
}

export const StatCard: React.FC<StatCardProps> = ({
    title,
    value,
    subValue,
    trend,
    icon,
    color = 'blue'
}) => {
    return (
        <Card className="h-full">
            <div className="flex items-start justify-between mb-4">
                <div className="text-xs font-mono font-semibold uppercase tracking-wide text-slate-500">{title}</div>
                {icon && <div className="border-2 border-black bg-white p-1">{icon}</div>}
            </div>

            <div className="flex items-end gap-3 mb-2">
                <div className="text-[1.75rem] font-black font-mono leading-none text-black">
                    {value}
                </div>
                {subValue && (
                    <div className="text-sm font-medium text-slate-500 mb-1.5 font-mono">
                        {subValue}
                    </div>
                )}
            </div>

            {trend && (
                <div className="flex items-center gap-2 mt-3">
                    <Badge
                        variant={
                            trend.value === 0 ? 'neutral' :
                                (trend.value > 0 === (trend.positiveIsGood ?? true)) ? 'success' : 'error'
                        }
                        size="sm"
                        className="font-mono"
                    >
                        {trend.value > 0 ? <ArrowUpRight className="w-3 h-3 mr-1" /> :
                            trend.value < 0 ? <ArrowDownRight className="w-3 h-3 mr-1" /> :
                                <Minus className="w-3 h-3 mr-1" />}
                        {Math.abs(trend.value)}%
                    </Badge>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                        {trend.label}
                    </span>
                </div>
            )}
        </Card>
    );
};
