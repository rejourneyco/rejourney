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
    color?: 'blue' | 'emerald' | 'rose' | 'rose' | 'purple';
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
        <div className="group relative h-full border-2 border-black bg-white p-4 shadow-neo-sm transition-all hover:-translate-y-1 hover:shadow-neo sm:p-5">
            {/* Subtle background wash on hover matching their brand */}
            <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-[#5dadec]/5 transition-transform duration-500 ease-out transform -translate-x-full group-hover:translate-x-0" />
            
            <div className="relative z-10">
                <div className="flex items-start justify-between mb-4">
                    <div className="dashboard-label text-slate-700">{title}</div>
                    {icon && <div className="text-black border-2 border-black bg-white shadow-neo-sm p-1.5 group-hover:bg-[#5dadec] group-hover:shadow-none transition-all">{icon}</div>}
                </div>

                <div className="flex items-end gap-3 mb-1">
                    <div className="dashboard-value-lg">
                        {value}
                    </div>
                    {subValue && (
                        <div className="mb-1 text-sm font-semibold uppercase text-slate-500">
                            {subValue}
                        </div>
                    )}
                </div>

                {trend && (
                    <div className="flex items-center gap-2 mt-4">
                        <Badge
                            variant={
                                trend.value === 0 ? 'neutral' :
                                    (trend.value > 0 === (trend.positiveIsGood ?? true)) ? 'success' : 'error'
                            }
                            size="sm"
                            className="rounded-none border-2 border-black font-semibold uppercase shadow-neo-sm"
                        >
                            {trend.value > 0 ? <ArrowUpRight className="w-3 h-3 flex-shrink-0" /> :
                                trend.value < 0 ? <ArrowDownRight className="w-3 h-3 flex-shrink-0" /> :
                                    <Minus className="w-3 h-3 flex-shrink-0" />}
                            {Math.abs(trend.value)}%
                        </Badge>
                        <span className="dashboard-label">
                            {trend.label}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};
