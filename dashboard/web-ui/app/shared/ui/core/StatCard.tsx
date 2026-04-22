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
        <div className="h-full bg-white border-2 border-black p-5 shadow-neo-sm hover:shadow-neo transition-all hover:-translate-y-1 relative group overflow-hidden">
            {/* Subtle background wash on hover matching their brand */}
            <div className="absolute inset-0 bg-[#5dadec]/5 transform -translate-x-full group-hover:translate-x-0 transition-transform duration-500 ease-out z-0 pointer-events-none" />
            
            <div className="relative z-10">
                <div className="flex items-start justify-between mb-4">
                    <div className="text-xs font-black uppercase tracking-widest text-slate-800">{title}</div>
                    {icon && <div className="text-black border-2 border-black bg-white shadow-neo-sm p-1.5 group-hover:bg-[#5dadec] group-hover:shadow-none transition-all">{icon}</div>}
                </div>

                <div className="flex items-end gap-3 mb-1">
                    <div className="text-3xl font-black tracking-tight text-black">
                        {value}
                    </div>
                    {subValue && (
                        <div className="text-sm font-bold text-slate-500 font-mono tracking-tighter mb-1 uppercase">
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
                            className="font-bold uppercase tracking-wider rounded-none border-2 border-black shadow-neo-sm"
                        >
                            {trend.value > 0 ? <ArrowUpRight className="w-3 h-3 flex-shrink-0" /> :
                                trend.value < 0 ? <ArrowDownRight className="w-3 h-3 flex-shrink-0" /> :
                                    <Minus className="w-3 h-3 flex-shrink-0" />}
                            {Math.abs(trend.value)}%
                        </Badge>
                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                            {trend.label}
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};
