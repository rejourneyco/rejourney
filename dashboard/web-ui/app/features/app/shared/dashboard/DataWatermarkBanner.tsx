import React from 'react';
import { Calendar } from 'lucide-react';

/**
 * Displays the data completeness watermark so users know analytics exclude
 * days after this date (rollups not yet run). Prevents misinterpretation
 * of zeros for incomplete days.
 */
export const DataWatermarkBanner: React.FC<{
    dataCompleteThrough?: string | null;
    className?: string;
}> = ({ dataCompleteThrough, className = '' }) => {
    if (!dataCompleteThrough || !/^\d{4}-\d{2}-\d{2}$/.test(dataCompleteThrough)) {
        return null;
    }

    const formatted = (() => {
        const d = new Date(`${dataCompleteThrough}T12:00:00Z`);
        if (Number.isNaN(d.getTime())) return dataCompleteThrough;
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    })();

    return (
        <div
            className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-slate-50/80 px-2.5 py-1.5 text-xs font-medium text-slate-600 ${className}`}
            title="Analytics rollups have completed through this date. Later days are excluded until rollups run."
        >
            <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            <span>Data complete through {formatted}</span>
        </div>
    );
};
