import React from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { dashboardButtonClass } from '~/shared/ui/core/dashboardStyles';

export const booksTableClass = 'w-full border-collapse text-[13px]';
export const booksThClass = 'border-b border-[#e8eaed] px-3 py-2 text-left text-xs font-normal text-[#5f6368] first:pl-5 last:pr-5';
export const booksTdClass = 'border-b border-[#f1f3f4] px-3 py-3 align-middle first:pl-5 last:pr-5';
export const booksNumClass = 'text-right tabular-nums';

export const BooksSectionHeader: React.FC<{
    title: string;
    description?: string;
    children?: React.ReactNode;
}> = ({ title, description, children }) => (
    <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
            <h2 className="text-lg font-normal leading-6 text-[#202124]">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-[#5f6368]">{description}</p>}
        </div>
        {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
);

export type BooksStat = {
    label: string;
    value: string;
    hint?: string;
    tone?: 'default' | 'positive' | 'negative' | 'muted';
};

const toneClass: Record<NonNullable<BooksStat['tone']>, string> = {
    default: 'text-[#202124]',
    positive: 'text-[#137333]',
    negative: 'text-[#c5221f]',
    muted: 'text-[#80868b]',
};

export const BooksStatStrip: React.FC<{ stats: BooksStat[]; isLoading?: boolean }> = ({ stats, isLoading }) => (
    <div className="flex flex-wrap gap-x-10 gap-y-3 border-b border-[#e8eaed] px-5 pb-4">
        {stats.map((stat) => (
            <div key={stat.label} className="min-w-0">
                <div className="text-xs text-[#5f6368]">{stat.label}</div>
                <div className={`mt-0.5 text-xl font-normal leading-7 tabular-nums ${toneClass[stat.tone ?? 'default']} ${isLoading ? 'opacity-40' : ''}`}>
                    {stat.value}
                </div>
                {stat.hint && <div className="text-xs text-[#80868b]">{stat.hint}</div>}
            </div>
        ))}
    </div>
);

export const BooksExportButton: React.FC<{
    onClick: () => void;
    isExporting?: boolean;
    disabled?: boolean;
    label?: string;
}> = ({ onClick, isExporting, disabled, label = 'Export CSV' }) => (
    <button type="button" onClick={onClick} disabled={disabled || isExporting} className={dashboardButtonClass('secondary', 'sm')}>
        {isExporting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        {label}
    </button>
);

export const BooksEmpty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="px-5 py-14 text-center text-sm text-[#5f6368]">{children}</div>
);

export const BooksLoadingRows: React.FC<{ columns: number; rows?: number }> = ({ columns, rows = 6 }) => (
    <>
        {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
                {Array.from({ length: columns }).map((__, columnIndex) => (
                    <td key={columnIndex} className={booksTdClass}>
                        <div className="h-3 animate-pulse bg-[#f1f3f4]" style={{ width: `${40 + ((rowIndex + columnIndex) % 4) * 15}%` }} />
                    </td>
                ))}
            </tr>
        ))}
    </>
);
