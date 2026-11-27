import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, History, Loader2, Search, Settings } from 'lucide-react';
import { useLocation } from 'react-router';
import { MCP_SERVER_URL } from '~/shared/config/appConfig';
import { useDashboardManualRefreshVersion } from '~/shared/providers/DashboardManualRefreshContext';
import { useDemoMode } from '~/shared/providers/DemoModeContext';
import { useSafeTeam } from '~/shared/providers/TeamContext';
import { DashboardPageHeader } from '~/shared/ui/core/DashboardPageHeader';
import { dashboardButtonClass, dashboardChipClass } from '~/shared/ui/core/dashboardStyles';
import { dashboardPageHeaderProps } from '~/shell/navigation/dashboardPageMeta';
import { writeClipboardText } from './clipboard';
import { MCP_CONNECT_GUIDES, MCP_PROMPT_GUIDES } from './content';
import { getMcpActivity, getMcpOverview, isMcpNotEnabledError, revokeMcpConnection, updateMcpSettings } from './mcpApi';
import { AskPane, ConnectPane, ConnectionPane, NoConnectionsState, OverviewPane, UsagePane } from './McpDetailPanes';
import { ActivityModal, SettingsModal } from './McpModals';
import { GroupHeading, ListRow } from './McpPrimitives';
import {
    creditsRemaining,
    formatCreditCount,
    formatDate,
    formatProjectCount,
    formatRelativeTime,
    formatUsageBadge,
    maskingChip,
    matchesSearch,
    usagePercent,
    usageTone,
} from './presentation';
import type { McpActivityItem, McpOverview, McpSettings } from './types';

export const meta = () => [
    { title: 'MCP - Rejourney' },
    { name: 'robots', content: 'noindex' },
];

type LoadStatus = 'loading' | 'ready' | 'unavailable';

const OVERVIEW_ID = 'overview';
const USAGE_ID = 'usage';
const connectionRowId = (connectionId: string) => `connection:${connectionId}`;

function formatBadgeCount(value: number): string | null {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value > 99 ? '99+' : String(value);
}

export const McpPage: React.FC = () => {
    const { isDemoMode } = useDemoMode();
    const { currentTeam, isLoading: teamLoading } = useSafeTeam();
    const location = useLocation();
    const manualRefreshVersion = useDashboardManualRefreshVersion();
    const serverUrl = MCP_SERVER_URL;
    const teamId = currentTeam?.id ?? '';
    // Demo only: ?preview=empty or ?preview=unavailable shows those states without a backend.
    const demoPreview = isDemoMode ? new URLSearchParams(location.search).get('preview') : null;

    const [status, setStatus] = useState<LoadStatus>('loading');
    const [overview, setOverview] = useState<McpOverview | null>(null);
    const [now, setNow] = useState(0);
    const [reload, setReload] = useState(0);
    const [selection, setSelection] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [activity, setActivity] = useState<McpActivityItem[] | null>(null);
    const [activityLoading, setActivityLoading] = useState(false);
    const [activityError, setActivityError] = useState<string | null>(null);
    const [showActivity, setShowActivity] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [settingsSaving, setSettingsSaving] = useState(false);
    const [settingsError, setSettingsError] = useState<string | null>(null);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    const [revokeError, setRevokeError] = useState<string | null>(null);
    const [copiedKey, setCopiedKey] = useState<string | null>(null);
    const [copyFailed, setCopyFailed] = useState(false);
    const copiedResetTimerRef = useRef<number | null>(null);
    const overviewScopeRef = useRef<string | null>(null);
    const overviewShownRef = useRef(false);
    const activityRequestRef = useRef(0);

    useEffect(() => {
        let cancelled = false;

        if (isDemoMode) {
            void import('./demoData').then((demo) => {
                if (cancelled) return;
                setNow(demo.DEMO_MCP_NOW);
                if (demoPreview === 'unavailable') {
                    setOverview(null);
                    setActivity([]);
                    setStatus('unavailable');
                    return;
                }
                setOverview(demoPreview === 'empty' ? { ...demo.demoMcpOverview, connections: [] } : demo.demoMcpOverview);
                setActivity(demoPreview === 'empty' ? [] : demo.demoMcpActivity.items);
                setStatus('ready');
            });
            return () => {
                cancelled = true;
            };
        }

        if (!teamId) {
            overviewScopeRef.current = null;
            overviewShownRef.current = false;
            setOverview(null);
            setStatus(teamLoading ? 'loading' : 'unavailable');
            return;
        }

        // A refresh keeps the current team's data on screen; another team starts empty.
        if (overviewScopeRef.current !== teamId) {
            overviewScopeRef.current = teamId;
            overviewShownRef.current = false;
            setOverview(null);
            setActivity(null);
            setSelection(null);
            setStatus('loading');
        }

        const controller = new AbortController();
        getMcpOverview(teamId, controller.signal)
            .then((next) => {
                if (cancelled) return;
                overviewShownRef.current = true;
                setNow(Date.now());
                setOverview(next);
                setStatus('ready');
            })
            .catch(() => {
                // A missing endpoint and a failed request read the same to the user: not available yet.
                // A failed refresh keeps what is already on screen.
                if (cancelled || overviewShownRef.current) return;
                setOverview(null);
                setStatus('unavailable');
            });

        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [demoPreview, isDemoMode, manualRefreshVersion, reload, teamId, teamLoading]);

    const loadActivity = useCallback(async () => {
        if (isDemoMode) return;
        if (!teamId) {
            setActivity([]);
            return;
        }
        const requestId = ++activityRequestRef.current;
        setActivityLoading(true);
        setActivityError(null);
        try {
            const next = await getMcpActivity(teamId);
            if (requestId !== activityRequestRef.current) return;
            setNow(Date.now());
            setActivity(next.items ?? []);
        } catch (error) {
            if (requestId !== activityRequestRef.current) return;
            setActivity((current) => current ?? []);
            if (!isMcpNotEnabledError(error)) setActivityError('Activity could not be loaded. Try again in a moment.');
        } finally {
            if (requestId === activityRequestRef.current) setActivityLoading(false);
        }
    }, [isDemoMode, teamId]);

    useEffect(() => () => {
        if (copiedResetTimerRef.current !== null) window.clearTimeout(copiedResetTimerRef.current);
    }, []);

    const handleCopy = useCallback(async (text: string, key: string) => {
        const copied = await writeClipboardText(text);
        setCopiedKey(copied ? key : null);
        setCopyFailed(!copied);
        if (copiedResetTimerRef.current !== null) window.clearTimeout(copiedResetTimerRef.current);
        copiedResetTimerRef.current = window.setTimeout(() => {
            setCopiedKey(null);
            setCopyFailed(false);
            copiedResetTimerRef.current = null;
        }, 3200);
    }, []);

    const handleSettingsChange = async (next: Partial<McpSettings>) => {
        if (isDemoMode || !teamId || !overview) return;
        setSettingsSaving(true);
        setSettingsError(null);
        try {
            const saved = await updateMcpSettings(teamId, next);
            setOverview((current) => (current ? { ...current, settings: saved } : current));
        } catch {
            setSettingsError('The setting could not be saved. Try again in a moment.');
        } finally {
            setSettingsSaving(false);
        }
    };

    const handleRevoke = async (connectionId: string, clientName: string) => {
        if (isDemoMode || !teamId) return;
        if (typeof window !== 'undefined' && !window.confirm(`Revoke access for ${clientName}? It stops working at once.`)) return;
        setRevokingId(connectionId);
        setRevokeError(null);
        try {
            await revokeMcpConnection(teamId, connectionId);
            setOverview((current) => (current
                ? { ...current, connections: current.connections.filter((connection) => connection.id !== connectionId) }
                : current));
            setSelection(null);
        } catch {
            setRevokeError('Access could not be revoked. Try again in a moment.');
        } finally {
            setRevokingId(null);
        }
    };

    const usage = overview?.usage ?? null;
    const settings = overview?.settings ?? null;
    const connections = useMemo(() => overview?.connections ?? [], [overview]);
    const isLoading = status === 'loading';
    const notEnabled = status === 'unavailable';
    const masking = settings ? settings.maskEndUserIdentifiers : null;
    const maskChip = maskingChip(masking);
    const percentUsed = usage ? usagePercent(usage.creditsUsed, usage.creditLimit) : 0;
    const remaining = usage ? creditsRemaining(usage.creditsUsed, usage.creditLimit) : null;

    const connectRows = useMemo(
        () => MCP_CONNECT_GUIDES.filter((guide) => matchesSearch(search, [guide.title, guide.summary, 'connect', ...guide.steps])),
        [search],
    );
    const askRows = useMemo(
        () => MCP_PROMPT_GUIDES.filter((guide) => matchesSearch(search, [guide.title, guide.summary, ...guide.prompts, ...guide.tools])),
        [search],
    );
    const connectionRows = useMemo(
        () => connections.filter((connection) => matchesSearch(search, [
            connection.clientName,
            connection.connectedBy.name,
            connection.connectedBy.email,
            'connection',
            ...connection.projects.map((project) => project.name),
        ])),
        [connections, search],
    );
    const showUsageRow = Boolean(usage) && matchesSearch(search, ['usage', 'this period', 'credits', 'allowance', usage?.planName]);
    const hasSearch = search.trim().length > 0;
    const nothingMatches = hasSearch && connectRows.length === 0 && askRows.length === 0 && connectionRows.length === 0 && !showUsageRow;

    // Drop a selection whose row no longer exists (revoked app, or data that failed to load).
    const selectedConnection = selection?.startsWith('connection:')
        ? connections.find((connection) => connectionRowId(connection.id) === selection) ?? null
        : null;
    const selectedConnectGuide = MCP_CONNECT_GUIDES.find((guide) => guide.id === selection) ?? null;
    const selectedPromptGuide = MCP_PROMPT_GUIDES.find((guide) => guide.id === selection) ?? null;
    const activeSelection = selection === OVERVIEW_ID
        || (selection === USAGE_ID && usage)
        || selectedConnection
        || selectedConnectGuide
        || selectedPromptGuide
        ? selection
        : null;

    const closeDetail = () => {
        setSelection(null);
        setRevokeError(null);
    };
    const selectRow = (id: string) => {
        setSelection(id);
        setRevokeError(null);
    };

    const listSubtitle = isLoading
        ? 'Loading'
        : notEnabled
            ? 'Not enabled on this server yet'
            : `${connections.length} ${connections.length === 1 ? 'app' : 'apps'} connected`;
    const activityBadge = formatBadgeCount(activity?.length ?? 0);

    return (
        <div className="rejourney-general-page flex h-full min-h-0 flex-col overflow-hidden bg-[#f8fafd] font-sans text-[#202124]">
            <div className="shrink-0">
                <DashboardPageHeader
                    title="MCP"
                    {...dashboardPageHeaderProps('mcp')}
                >
                    <div className="flex min-w-0 max-w-full items-center">
                        <span
                            className="inline-flex h-8 min-w-0 items-center rounded-none border border-[#dadce0] bg-white px-2.5 font-mono text-xs text-[#3c4043]"
                            title="MCP server URL"
                        >
                            <span className="truncate">{serverUrl}</span>
                        </span>
                        <button
                            type="button"
                            onClick={() => void handleCopy(serverUrl, 'header-url')}
                            className={`${dashboardButtonClass('secondary', 'sm')} -ml-px`}
                            aria-label="Copy MCP server URL"
                        >
                            {copiedKey === 'header-url' ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                            {copiedKey === 'header-url' ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setShowActivity(true);
                            void loadActivity();
                        }}
                        className={dashboardButtonClass('secondary', 'sm')}
                    >
                        <History className="h-4 w-4" />
                        Activity
                        {activityBadge && (
                            <span className={`${dashboardChipClass('neutral')} ml-0.5 min-w-5 justify-center tabular-nums`}>
                                {activityBadge}
                            </span>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setSettingsError(null);
                            setShowSettings(true);
                        }}
                        className={dashboardButtonClass('secondary', 'sm')}
                    >
                        <Settings className="h-4 w-4" />
                        Settings
                    </button>
                </DashboardPageHeader>
            </div>

            <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
                <div className="grid min-h-0 min-w-0 w-full flex-1 grid-cols-1 bg-white shadow-none lg:grid-cols-[360px_minmax(0,1fr)]">
                    <section className={`min-h-[420px] min-w-0 flex-col bg-white sm:min-h-[560px] lg:flex lg:min-h-0 lg:border-r lg:border-[#dadce0] ${activeSelection ? 'hidden' : 'flex'}`}>
                        <div className="border-b border-[#dadce0] bg-white px-4 py-4 sm:px-5">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <h2 className="truncate text-[15px] font-medium leading-6 text-[#202124]">
                                        Connect and manage
                                    </h2>
                                    <p className="mt-0.5 text-xs leading-5 text-[#5f6368]">
                                        {listSubtitle}
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => selectRow(OVERVIEW_ID)}
                                    className={`${dashboardButtonClass('secondary', 'sm')} mt-0.5 lg:hidden`}
                                >
                                    Overview
                                </button>
                            </div>

                            <label className="mt-3 flex h-9 min-w-0 items-center gap-2 rounded-none border border-[#dadce0] bg-white px-3 transition-colors focus-within:border-[#1a73e8] focus-within:ring-2 focus-within:ring-[#1a73e8]/20">
                                <Search className="h-4 w-4 shrink-0 text-[#5f6368]" />
                                <input
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder="Search clients, apps and prompts"
                                    aria-label="Search clients, apps and prompts"
                                    className="min-w-0 flex-1 bg-transparent text-sm text-[#202124] outline-none placeholder:text-[#80868b]"
                                />
                            </label>

                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className={dashboardChipClass('info')}>Read-only</span>
                                <span className={dashboardChipClass(maskChip.tone)}>{maskChip.label}</span>
                                <span className="text-xs leading-5 text-[#5f6368]">AI clients see only the projects you share.</span>
                            </div>
                        </div>

                        <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden">
                            {nothingMatches && (
                                <div className="flex h-56 flex-col items-center justify-center px-6 text-center text-sm font-medium text-[#5f6368]">
                                    <CheckCircle2 className="mb-3 h-8 w-8 text-[#80868b]" />
                                    Nothing matches this search.
                                </div>
                            )}

                            {connectRows.length > 0 && (
                                <>
                                    <GroupHeading>Connect</GroupHeading>
                                    {connectRows.map((guide) => (
                                        <ListRow
                                            key={guide.id}
                                            active={activeSelection === guide.id}
                                            title={guide.title}
                                            description={guide.summary}
                                            onSelect={() => selectRow(guide.id)}
                                        />
                                    ))}
                                </>
                            )}

                            {(showUsageRow || (isLoading && !hasSearch)) && (
                                <>
                                    <GroupHeading>Usage</GroupHeading>
                                    {usage ? (
                                        <ListRow
                                            active={activeSelection === USAGE_ID}
                                            title="This period"
                                            description={`${usage.planName} plan. ${remaining === null ? 'No credit limit.' : `${formatCreditCount(remaining)} remaining.`}`}
                                            meta={[`Resets ${formatDate(usage.resetsAt)}`]}
                                            badge={formatUsageBadge(usage.creditsUsed, usage.creditLimit)}
                                            badgeTone={usageTone(percentUsed)}
                                            sideNote={usage.creditLimit === null ? 'credits' : `${percentUsed}% used`}
                                            onSelect={() => selectRow(USAGE_ID)}
                                        />
                                    ) : (
                                        <div className="flex h-16 items-center border-b border-[#e8eaed] px-4 text-sm font-medium text-[#5f6368] sm:px-5">
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading usage
                                        </div>
                                    )}
                                </>
                            )}

                            {!notEnabled && (connectionRows.length > 0 || !hasSearch) && (
                                <>
                                    <GroupHeading count={isLoading ? undefined : connectionRows.length}>Connections</GroupHeading>
                                    {isLoading ? (
                                        <div className="flex h-16 items-center border-b border-[#e8eaed] px-4 text-sm font-medium text-[#5f6368] sm:px-5">
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading connections
                                        </div>
                                    ) : connections.length === 0 ? (
                                        <NoConnectionsState />
                                    ) : connectionRows.map((connection) => (
                                        <ListRow
                                            key={connection.id}
                                            active={activeSelection === connectionRowId(connection.id)}
                                            title={connection.clientName}
                                            description={`Connected by ${connection.connectedBy.name}`}
                                            meta={[
                                                `Used ${formatRelativeTime(connection.lastUsedAt, now)}`,
                                                formatProjectCount(connection.projects.length),
                                            ]}
                                            onSelect={() => selectRow(connectionRowId(connection.id))}
                                        />
                                    ))}
                                </>
                            )}

                            {notEnabled && !hasSearch && (
                                <div className="flex items-start gap-2 border-b border-[#e8eaed] bg-[#f8fafd] px-4 py-3 text-xs font-medium leading-5 text-[#5f6368] sm:px-5">
                                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                                    <span>MCP is not enabled on this server yet. Usage and connections will appear here once it is.</span>
                                </div>
                            )}

                            {askRows.length > 0 && (
                                <>
                                    <GroupHeading>What you can ask</GroupHeading>
                                    {askRows.map((guide) => (
                                        <ListRow
                                            key={guide.id}
                                            active={activeSelection === guide.id}
                                            title={guide.title}
                                            description={guide.summary}
                                            badge={guide.comingSoon ? 'Coming soon' : undefined}
                                            badgeTone="purple"
                                            onSelect={() => selectRow(guide.id)}
                                        />
                                    ))}
                                </>
                            )}
                        </div>
                    </section>

                    <section className={`min-h-[420px] min-w-0 flex-col bg-white sm:min-h-[560px] lg:flex lg:min-h-0 ${activeSelection ? 'flex' : 'hidden'}`}>
                        {selectedConnectGuide ? (
                            <ConnectPane
                                guide={selectedConnectGuide}
                                serverUrl={serverUrl}
                                copiedKey={copiedKey}
                                onCopy={handleCopy}
                                onClose={closeDetail}
                            />
                        ) : selectedPromptGuide ? (
                            <AskPane
                                guide={selectedPromptGuide}
                                copiedKey={copiedKey}
                                onCopy={handleCopy}
                                onClose={closeDetail}
                            />
                        ) : selectedConnection ? (
                            <ConnectionPane
                                connection={selectedConnection}
                                isDemoMode={isDemoMode}
                                masking={masking}
                                now={now}
                                revoking={revokingId === selectedConnection.id}
                                revokeError={revokeError}
                                onRevoke={() => void handleRevoke(selectedConnection.id, selectedConnection.clientName)}
                                onClose={closeDetail}
                            />
                        ) : activeSelection === USAGE_ID && usage ? (
                            <UsagePane usage={usage} onClose={closeDetail} />
                        ) : (
                            <OverviewPane
                                serverUrl={serverUrl}
                                usage={usage}
                                connections={connections}
                                settings={settings}
                                loading={isLoading}
                                notEnabled={notEnabled}
                                now={now}
                                copiedKey={copiedKey}
                                onCopy={handleCopy}
                                onSelect={selectRow}
                                onRetry={() => {
                                    setStatus('loading');
                                    setReload((value) => value + 1);
                                }}
                                onClose={activeSelection === OVERVIEW_ID ? closeDetail : undefined}
                            />
                        )}
                    </section>
                </div>
            </div>

            {(copiedKey || copyFailed) && (
                <div
                    role="status"
                    aria-live="polite"
                    className="fixed bottom-5 right-5 z-[1200] flex max-w-[min(360px,calc(100vw-2rem))] items-start gap-3 rounded-none bg-[#202124] px-4 py-3 text-sm font-medium text-white shadow-[0_3px_10px_rgba(60,64,67,0.3)]"
                >
                    {copyFailed
                        ? <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-white" />
                        : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-white" />}
                    <div>
                        <p className="text-white">{copyFailed ? 'Could not copy automatically' : 'Copied to clipboard'}</p>
                        {copyFailed && (
                            <p className="mt-0.5 text-xs font-normal text-[#bdc1c6]">Select the text and copy it manually.</p>
                        )}
                    </div>
                </div>
            )}

            <ActivityModal
                isOpen={showActivity}
                items={activity ?? []}
                loading={activityLoading || (isDemoMode && activity === null)}
                error={activityError}
                notEnabled={notEnabled}
                now={now}
                onClose={() => setShowActivity(false)}
                onRefresh={() => void loadActivity()}
            />

            <SettingsModal
                isOpen={showSettings}
                settings={settings}
                canManage={overview?.canManageSettings ?? false}
                isDemoMode={isDemoMode}
                notEnabled={notEnabled}
                saving={settingsSaving}
                error={settingsError}
                onChange={(next) => void handleSettingsChange(next)}
                onClose={() => setShowSettings(false)}
            />
        </div>
    );
};

export default McpPage;
