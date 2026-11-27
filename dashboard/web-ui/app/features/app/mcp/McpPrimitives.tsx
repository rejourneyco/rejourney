import React from 'react';
import { CheckCircle2, Copy } from 'lucide-react';
import {
    dashboardButtonClass,
    dashboardChipClass,
    dashboardLabelClass,
    dashboardSelectedClass,
    type DashboardButtonVariant,
    type DashboardChipTone,
} from '~/shared/ui/core/dashboardStyles';
import { MCP_HIDDEN_DATA, MCP_VISIBLE_DATA } from './content';
import { maskingChip, usageBarClass } from './presentation';

/** Small presentational pieces for the MCP page. Styling follows the page it replaced (Leaks). */

export type CopyHandler = (text: string, key: string) => void;

export function PaneButton({
    children,
    className = '',
    disabled,
    icon,
    onClick,
    title,
    variant = 'secondary',
}: {
    children: React.ReactNode;
    className?: string;
    disabled?: boolean;
    icon?: React.ReactNode;
    onClick?: () => void;
    title?: string;
    variant?: DashboardButtonVariant;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            title={title}
            className={`${dashboardButtonClass(variant, 'md')} ${className}`}
        >
            {icon}
            {children}
        </button>
    );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
    return <h3 className="text-sm font-medium leading-5 text-[#202124]">{children}</h3>;
}

export function PaneSection({ children, className = '' }: { children: React.ReactNode; className?: string }) {
    return <section className={`border-b border-[#dadce0] px-4 py-4 sm:px-5 ${className}`}>{children}</section>;
}

export function CopyButton({
    copied,
    copyKey,
    disabled,
    label,
    onCopy,
    size = 'md',
    text,
    variant = 'primary',
}: {
    copied: boolean;
    copyKey: string;
    disabled?: boolean;
    label: string;
    onCopy: CopyHandler;
    size?: 'sm' | 'md';
    text: string;
    variant?: DashboardButtonVariant;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={() => onCopy(text, copyKey)}
            className={dashboardButtonClass(variant, size)}
        >
            {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : label}
        </button>
    );
}

/** Same block the Leaks page used for its markdown context. */
export function CodeBlock({ children }: { children: string }) {
    return (
        <pre className="mt-3 max-h-[380px] overflow-auto whitespace-pre-wrap break-words rounded-none border border-[#dadce0] bg-[#f8fafd] p-4 font-mono text-xs leading-6 text-[#3c4043]">
            {children}
        </pre>
    );
}

export function GroupHeading({ children, count }: { children: React.ReactNode; count?: number }) {
    return (
        <div className={`flex items-center justify-between gap-2 border-b border-[#e8eaed] bg-[#f8fafd] px-4 py-2 sm:px-5 ${dashboardLabelClass}`}>
            <span>{children}</span>
            {typeof count === 'number' && <span className="tabular-nums">{count}</span>}
        </div>
    );
}

export function ListRow({
    active,
    badge,
    badgeTone = 'neutral',
    description,
    meta = [],
    onSelect,
    sideNote,
    title,
}: {
    active: boolean;
    badge?: string;
    badgeTone?: DashboardChipTone;
    description: string;
    meta?: string[];
    onSelect: () => void;
    sideNote?: string;
    title: string;
}) {
    const hasSide = Boolean(badge || sideNote);

    return (
        <button
            type="button"
            onClick={onSelect}
            aria-current={active ? 'true' : undefined}
            className={`block w-full border-b border-[#e8eaed] px-4 py-3 text-left transition-colors sm:px-5 ${
                active ? dashboardSelectedClass : 'bg-white hover:bg-[#f1f3f4]'
            }`}
        >
            <div className={`grid grid-cols-1 gap-3 ${hasSide ? 'sm:grid-cols-[minmax(0,1fr)_128px]' : ''}`}>
                <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-medium leading-5 text-[#202124]">
                            {title}
                        </span>
                    </div>
                    <p className="mt-1 line-clamp-2 pr-2 text-xs leading-5 text-[#5f6368]">
                        {description}
                    </p>
                    {meta.length > 0 && (
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium tabular-nums text-[#5f6368]">
                            {meta.map((item) => <span key={item} className="truncate">{item}</span>)}
                        </div>
                    )}
                </div>
                {hasSide && (
                    <div className="flex shrink-0 flex-row flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                        {badge && (
                            <span className={`${dashboardChipClass(badgeTone)} tabular-nums`}>
                                {badge}
                            </span>
                        )}
                        {sideNote && (
                            <span className="text-[11px] font-medium tabular-nums text-[#5f6368]">{sideNote}</span>
                        )}
                    </div>
                )}
            </div>
        </button>
    );
}

/** Thin square meter, as on the billing page: blue, amber from 80%, red at the limit. */
export function UsageBar({ label, percent }: { label: string; percent: number }) {
    return (
        <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="h-1.5 overflow-hidden rounded-none bg-[#e8eaed]"
        >
            <div
                className={`h-full rounded-none transition-[width] duration-500 ${usageBarClass(percent)}`}
                style={{ width: `${percent}%` }}
            />
        </div>
    );
}

/** Label and value pair in the bordered two-column list used across detail panes. */
export function FactList({ rows }: { rows: Array<{ label: string; value: React.ReactNode }> }) {
    return (
        <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-4 border-y border-[#e8eaed] py-2 text-sm">
            {rows.map((row) => (
                <React.Fragment key={row.label}>
                    <dt className="py-1.5 font-medium text-[#5f6368]">{row.label}</dt>
                    <dd className="min-w-0 py-1.5 text-right font-medium tabular-nums text-[#202124]">{row.value}</dd>
                </React.Fragment>
            ))}
        </dl>
    );
}

export function SettingSwitch({
    checked,
    description,
    disabled,
    icon,
    label,
    onChange,
}: {
    checked: boolean;
    description: string;
    disabled?: boolean;
    icon: React.ReactNode;
    label: string;
    onChange: (next: boolean) => void;
}) {
    return (
        <div className="px-5 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        {icon}
                        <p className="text-sm font-medium text-[#202124]">{label}</p>
                    </div>
                    <p className="mt-0.5 text-xs font-medium leading-5 text-[#5f6368]">
                        {description}
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <span className={`text-xs font-medium ${checked ? 'text-[#1967d2]' : 'text-[#5f6368]'}`}>
                        {checked ? 'On' : 'Off'}
                    </span>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={checked}
                        aria-label={label}
                        disabled={disabled}
                        onClick={() => onChange(!checked)}
                        className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-none border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                            checked
                                ? 'border-[#1a73e8] bg-[#1a73e8]'
                                : 'border-[#dadce0] bg-[#e8eaed]'
                        }`}
                    >
                        <span
                            className={`pointer-events-none absolute left-[3px] top-[3px] h-5 w-5 rounded-none bg-white ring-1 ring-[#dadce0] transition-transform ${
                                checked ? 'translate-x-5' : 'translate-x-0'
                            }`}
                        />
                    </button>
                </div>
            </div>
        </div>
    );
}

/** What an AI client can and cannot read. `masking` is null while the team setting is unknown. */
export function DataPrivacySection({ masking }: { masking: boolean | null }) {
    const chip = maskingChip(masking);
    const maskingText = masking === null
        ? 'A team admin decides whether end-user identifiers and city are masked.'
        : masking
            ? 'End-user identifiers and city are masked in every response.'
            : 'End-user identifiers and city are sent as they appear in the dashboard. A team admin can mask them in Settings.';

    return (
        <PaneSection>
            <div className="flex flex-wrap items-center justify-between gap-2">
                <SectionTitle>Data and privacy</SectionTitle>
                <div className="flex flex-wrap gap-2">
                    <span className={dashboardChipClass('info')}>Read-only</span>
                    <span className={dashboardChipClass(chip.tone)}>{chip.label}</span>
                </div>
            </div>
            <p className="mt-3 max-w-[760px] text-sm leading-6 text-[#5f6368]">
                Access is read-only. No tool can change or delete anything. {maskingText}
            </p>
            <div className="mt-3 grid gap-3 xl:grid-cols-2">
                <div className="border border-[#dadce0] bg-white p-3">
                    <p className={dashboardLabelClass}>An AI client can see, for the shared projects</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {MCP_VISIBLE_DATA.map((item) => (
                            <span key={item} className={dashboardChipClass('neutral')}>{item}</span>
                        ))}
                    </div>
                </div>
                <div className="border border-[#dadce0] bg-white p-3">
                    <p className={dashboardLabelClass}>It never sees</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {MCP_HIDDEN_DATA.map((item) => (
                            <span key={item} className={dashboardChipClass('neutral')}>{item}</span>
                        ))}
                    </div>
                </div>
            </div>
        </PaneSection>
    );
}
