import React from 'react';
import { EyeOff, History, Loader2, Plug, RefreshCw } from 'lucide-react';
import { Modal } from '~/shared/ui/core/Modal';
import { dashboardButtonClass, dashboardChipClass, dashboardLabelClass } from '~/shared/ui/core/dashboardStyles';
import { SettingSwitch } from './McpPrimitives';
import { formatCredits, formatDateTime, formatRelativeTime, outcomeMeta } from './presentation';
import type { McpActivityItem, McpSettings } from './types';

/** The Activity and Settings dialogs. They replace the Leaks run history and alert settings. */

export function ActivityModal({
    error,
    isOpen,
    items,
    loading,
    notEnabled,
    now,
    onClose,
    onRefresh,
}: {
    error: string | null;
    isOpen: boolean;
    items: McpActivityItem[];
    loading: boolean;
    notEnabled: boolean;
    now: number;
    onClose: () => void;
    onRefresh: () => void;
}) {
    const totalCredits = items.reduce((total, item) => total + item.credits, 0);
    const latest = items[0] ?? null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Activity"
            size="xl"
            variant="modern"
            bodyClassName="p-0"
            panelClassName="max-w-[1120px]"
        >
            <div className="bg-white">
                <div className="border-b border-[#e8eaed] px-5 py-4 sm:px-6">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2 text-sm font-medium text-[#202124]">
                                <History className="h-4 w-4 text-[#5f6368]" />
                                Recent MCP calls
                            </div>
                            <p className="mt-1 max-w-3xl text-sm font-medium leading-6 text-[#5f6368]">
                                Every tool call an AI client makes for this team, newest first.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onRefresh}
                            disabled={loading}
                            className={dashboardButtonClass('secondary', 'md')}
                        >
                            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            Refresh
                        </button>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <div className="border-y border-[#e8eaed] py-3">
                            <p className="text-lg font-medium tabular-nums text-[#202124]">{formatCredits(items.length)}</p>
                            <p className={`mt-0.5 ${dashboardLabelClass}`}>Calls shown</p>
                        </div>
                        <div className="border-y border-[#e8eaed] py-3">
                            <p className="text-lg font-medium tabular-nums text-[#202124]">{formatCredits(totalCredits)}</p>
                            <p className={`mt-0.5 ${dashboardLabelClass}`}>Credits charged</p>
                        </div>
                        <div className="border-y border-[#e8eaed] py-3">
                            <p className="truncate text-sm font-medium tabular-nums text-[#202124]">
                                {latest ? formatDateTime(latest.at) : 'No calls yet'}
                            </p>
                            <p className={`mt-0.5 ${dashboardLabelClass}`}>Latest call</p>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="mx-5 mt-4 rounded-none bg-[#fef7e0] px-3 py-2 text-sm font-medium text-[#b06000] sm:mx-6">
                        {error}
                    </div>
                )}

                {loading && items.length === 0 ? (
                    <div className="flex h-72 items-center justify-center text-sm font-medium text-[#5f6368]">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading activity
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex h-72 flex-col items-center justify-center px-6 text-center">
                        <History className="h-9 w-9 text-[#80868b]" />
                        <p className="mt-3 text-sm font-medium text-[#202124]">
                            {notEnabled ? 'MCP is not enabled on this server yet' : 'No MCP calls yet'}
                        </p>
                        <p className="mt-1 max-w-sm text-sm font-medium leading-6 text-[#5f6368]">
                            {notEnabled
                                ? 'Activity will appear here once it is switched on.'
                                : 'Calls appear here as soon as a connected app uses a tool.'}
                        </p>
                    </div>
                ) : (
                    <div className="max-h-[520px] overflow-auto">
                        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                            <thead className="sticky top-0 bg-[#f8fafd]">
                                <tr className="border-b border-[#dadce0]">
                                    {['Time', 'Tool', 'User', 'Client'].map((label) => (
                                        <th key={label} scope="col" className={`px-5 py-2.5 text-left sm:px-6 ${dashboardLabelClass}`}>{label}</th>
                                    ))}
                                    <th scope="col" className={`px-5 py-2.5 text-right sm:px-6 ${dashboardLabelClass}`}>Credits</th>
                                    <th scope="col" className={`px-5 py-2.5 text-right sm:px-6 ${dashboardLabelClass}`}>Outcome</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[#e8eaed]">
                                {items.map((item) => {
                                    const outcome = outcomeMeta(item.outcome);
                                    return (
                                        <tr key={item.id} className="align-top">
                                            <td className="whitespace-nowrap px-5 py-3 sm:px-6">
                                                <p className="text-sm font-medium tabular-nums text-[#202124]">{formatDateTime(item.at)}</p>
                                                <p className="mt-0.5 text-[11px] font-medium tabular-nums text-[#5f6368]">{formatRelativeTime(item.at, now)}</p>
                                            </td>
                                            <td className="px-5 py-3 sm:px-6">
                                                <p className="font-mono text-xs leading-5 text-[#202124]">{item.tool}</p>
                                                {item.detail && (
                                                    <p className="mt-0.5 max-w-xs text-xs leading-5 text-[#5f6368]">{item.detail}</p>
                                                )}
                                            </td>
                                            <td className="whitespace-nowrap px-5 py-3 text-sm text-[#3c4043] sm:px-6">{item.userName}</td>
                                            <td className="whitespace-nowrap px-5 py-3 text-sm text-[#3c4043] sm:px-6">{item.clientName}</td>
                                            <td className="whitespace-nowrap px-5 py-3 text-right text-sm font-medium tabular-nums text-[#202124] sm:px-6">{formatCredits(item.credits)}</td>
                                            <td className="whitespace-nowrap px-5 py-3 text-right sm:px-6">
                                                <span className={dashboardChipClass(outcome.tone)}>{outcome.label}</span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Modal>
    );
}

export function SettingsModal({
    canManage,
    error,
    isDemoMode,
    isOpen,
    notEnabled,
    onChange,
    onClose,
    saving,
    settings,
}: {
    canManage: boolean;
    error: string | null;
    isDemoMode: boolean;
    isOpen: boolean;
    notEnabled: boolean;
    onChange: (next: Partial<McpSettings>) => void;
    onClose: () => void;
    saving: boolean;
    settings: McpSettings | null;
}) {
    const disabled = isDemoMode || saving || !canManage || !settings;
    const note = isDemoMode
        ? 'Settings cannot be changed in the demo.'
        : notEnabled
            ? 'MCP is not enabled on this server yet. These switches will work once it is.'
            : !canManage
                ? 'Only team admins can change these settings.'
                : null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="MCP settings"
            size="md"
            variant="modern"
            bodyClassName="p-0"
        >
            <div className="divide-y divide-[#e8eaed] bg-white">
                {note && (
                    <p className="px-5 py-3 text-xs font-medium leading-5 text-[#5f6368] sm:px-6">
                        {note}
                    </p>
                )}

                <SettingSwitch
                    icon={<Plug className="h-4 w-4 text-[#5f6368]" />}
                    label="Allow MCP access for this team"
                    description="When off, every connected app stops working and no one on the team can connect a new one."
                    checked={settings?.mcpEnabled ?? false}
                    disabled={disabled}
                    onChange={(next) => onChange({ mcpEnabled: next })}
                />

                <SettingSwitch
                    icon={<EyeOff className="h-4 w-4 text-[#5f6368]" />}
                    label="Mask end-user identifiers and city"
                    description="When on, AI clients receive emails, user IDs, device IDs and city masked in every response. Country is still sent."
                    checked={settings?.maskEndUserIdentifiers ?? false}
                    disabled={disabled}
                    onChange={(next) => onChange({ maskEndUserIdentifiers: next })}
                />

                {error && (
                    <div className="px-5 py-3 sm:px-6">
                        <div className="rounded-none border border-[#f6aea9] bg-[#fce8e6] px-3 py-2 text-xs font-medium text-[#a50e0e]">
                            {error}
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}
