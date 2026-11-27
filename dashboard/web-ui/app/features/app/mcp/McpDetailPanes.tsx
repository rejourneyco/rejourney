import React from 'react';
import { ArrowRight, Ban, Inbox, Loader2, RefreshCw, X } from 'lucide-react';
import { dashboardButtonClass, dashboardChipClass, dashboardLabelClass } from '~/shared/ui/core/dashboardStyles';
import {
    MCP_COHORT_TOOL_COSTS,
    MCP_CONNECT_FACTS,
    MCP_CONNECT_GUIDES,
    MCP_LIMIT_BEHAVIOUR,
    MCP_REVIEW_TOOL_COSTS,
    type McpConnectGuide,
    type McpPromptGuide,
    type McpToolCost,
} from './content';
import {
    CodeBlock,
    CopyButton,
    DataPrivacySection,
    FactList,
    PaneButton,
    PaneSection,
    SectionTitle,
    UsageBar,
    type CopyHandler,
} from './McpPrimitives';
import {
    COHORT_REPORT_CREDITS,
    SESSION_REVIEW_CREDITS,
    buildConnectSnippet,
    creditsRemaining,
    estimateCapacity,
    formatCallCount,
    formatCreditCount,
    formatCredits,
    formatDate,
    formatDateTime,
    formatProjectCount,
    formatRelativeTime,
    formatUsageBadge,
    maskingChip,
    scopeLabel,
    sortToolUsage,
    sumToolCalls,
    sumToolCredits,
    usagePercent,
    usageTone,
} from './presentation';
import type { McpConnection, McpSettings, McpUsage } from './types';

/** Right-hand pane contents. Each pane is a header plus a stack of bordered sections. */

interface CopyProps {
    copiedKey: string | null;
    onCopy: CopyHandler;
}

export function DetailFrame({
    actions,
    children,
    closeLabel = 'Close detail',
    message,
    onClose,
    title,
    titleChip,
}: {
    actions?: React.ReactNode;
    children: React.ReactNode;
    closeLabel?: string;
    message?: React.ReactNode;
    onClose?: () => void;
    title: string;
    titleChip?: React.ReactNode;
}) {
    return (
        <>
            <div className="border-b border-[#dadce0] bg-white px-4 py-4 sm:px-5">
                <div className="flex items-start justify-between gap-4">
                    <h2 className="flex max-w-[760px] flex-wrap items-center gap-x-3 gap-y-1 text-lg font-medium leading-7 text-[#202124]">
                        {title}
                        {titleChip}
                    </h2>
                    {onClose && (
                        <button
                            type="button"
                            onClick={onClose}
                            className="mt-0.5 shrink-0 rounded-none p-1.5 text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124]"
                            aria-label={closeLabel}
                        >
                            <X className="h-5 w-5" />
                        </button>
                    )}
                </div>

                {actions && (
                    <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
                        {actions}
                    </div>
                )}

                {message && (
                    <p className={`${actions ? 'mt-4' : 'mt-2'} max-w-3xl text-sm font-medium leading-6 text-[#5f6368]`}>
                        {message}
                    </p>
                )}
            </div>

            <div className="min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden">
                {children}
            </div>
        </>
    );
}

function SimpleTable({ children, head, minWidth = 'min-w-[420px]' }: { children: React.ReactNode; head: Array<{ label: string; align?: 'right' }>; minWidth?: string }) {
    return (
        <div className="mt-3 overflow-x-auto border border-[#dadce0] bg-white">
            <table className={`w-full ${minWidth} border-collapse text-left text-sm`}>
                <thead>
                    <tr className="border-b border-[#dadce0] bg-[#f8fafd]">
                        {head.map((cell) => (
                            <th
                                key={cell.label}
                                scope="col"
                                className={`px-3 py-2 ${dashboardLabelClass} ${cell.align === 'right' ? 'text-right' : 'text-left'}`}
                            >
                                {cell.label}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-[#e8eaed]">
                    {children}
                </tbody>
            </table>
        </div>
    );
}

function ToolCostTable({ rows }: { rows: McpToolCost[] }) {
    return (
        <SimpleTable head={[{ label: 'Tool' }, { label: 'Returns' }, { label: 'Credits', align: 'right' }]} minWidth="min-w-[520px]">
            {rows.map((row) => (
                <tr key={row.tool}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-[#202124]">{row.tool}</td>
                    <td className="px-3 py-2 text-xs leading-5 text-[#5f6368]">{row.returns}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium tabular-nums text-[#202124]">{row.cost}</td>
                </tr>
            ))}
        </SimpleTable>
    );
}

function CostReference() {
    return (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="border-y border-[#e8eaed] py-3">
                <p className="text-lg font-medium tabular-nums text-[#202124]">About {SESSION_REVIEW_CREDITS} credits</p>
                <p className={`mt-0.5 ${dashboardLabelClass}`}>One session review</p>
            </div>
            <div className="border-y border-[#e8eaed] py-3">
                <p className="text-lg font-medium tabular-nums text-[#202124]">About {COHORT_REPORT_CREDITS} credits</p>
                <p className={`mt-0.5 ${dashboardLabelClass}`}>One cohort report (coming soon)</p>
            </div>
        </div>
    );
}

function AllowanceMeter({ usage }: { usage: McpUsage }) {
    const percent = usagePercent(usage.creditsUsed, usage.creditLimit);
    const remaining = creditsRemaining(usage.creditsUsed, usage.creditLimit);
    const tone = usageTone(percent);
    const toneClass = tone === 'danger' ? 'text-[#c5221f]' : tone === 'warning' ? 'text-[#b06000]' : 'text-[#202124]';

    return (
        <div className="mt-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`text-sm font-medium tabular-nums ${toneClass}`}>
                    {usage.creditLimit === null ? 'No credit limit on this server' : `${percent}% of MCP credits used`}
                </span>
                <span className="text-xs tabular-nums text-[#5f6368]">
                    {formatUsageBadge(usage.creditsUsed, usage.creditLimit)}
                </span>
            </div>
            <UsageBar label="MCP credits used this period" percent={percent} />
            <div className="flex items-center justify-between gap-3 text-xs tabular-nums text-[#5f6368]">
                <span>{remaining === null ? `${formatCreditCount(usage.creditsUsed)} used` : `${formatCreditCount(remaining)} remaining`}</span>
                <span>Resets {formatDate(usage.resetsAt)}</span>
            </div>
        </div>
    );
}

export function NotEnabledNotice({ loading, onRetry }: { loading: boolean; onRetry: () => void }) {
    return (
        <PaneSection>
            <div className="flex flex-col gap-3 rounded-none bg-[#f1f3f4] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <p className="text-sm font-medium text-[#202124]">MCP is not enabled on this server yet</p>
                    <p className="mt-0.5 text-sm leading-6 text-[#5f6368]">
                        Usage and connections will appear here once it is switched on. The setup steps below are ready to use then.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onRetry}
                    disabled={loading}
                    className={dashboardButtonClass('secondary', 'md')}
                >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Check again
                </button>
            </div>
        </PaneSection>
    );
}

export function OverviewPane({
    connections,
    copiedKey,
    loading,
    notEnabled,
    now,
    onClose,
    onCopy,
    onRetry,
    onSelect,
    serverUrl,
    settings,
    usage,
}: CopyProps & {
    connections: McpConnection[];
    loading: boolean;
    notEnabled: boolean;
    now: number;
    onClose?: () => void;
    onRetry: () => void;
    onSelect: (id: string) => void;
    serverUrl: string;
    settings: McpSettings | null;
    usage: McpUsage | null;
}) {
    const capacity = usage ? estimateCapacity(creditsRemaining(usage.creditsUsed, usage.creditLimit)) : null;

    return (
        <DetailFrame
            title="Overview"
            onClose={onClose}
            closeLabel="Close overview"
            message="Connect Claude Code to your Rejourney data. It can review sessions and triage crashes for the projects you share."
        >
            {notEnabled && <NotEnabledNotice loading={loading} onRetry={onRetry} />}

            <PaneSection>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <SectionTitle>Server URL</SectionTitle>
                    <CopyButton
                        copied={copiedKey === 'overview-url'}
                        copyKey="overview-url"
                        label="Copy URL"
                        onCopy={onCopy}
                        text={serverUrl}
                    />
                </div>
                <CodeBlock>{serverUrl}</CodeBlock>
                <div className="mt-3 divide-y divide-[#e8eaed] border-y border-[#e8eaed]">
                    {MCP_CONNECT_GUIDES.map((guide) => (
                        <button
                            key={guide.id}
                            type="button"
                            onClick={() => onSelect(guide.id)}
                            className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition-colors hover:bg-[#f1f3f4]"
                        >
                            <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-[#202124]">{guide.title}</span>
                                <span className="block truncate text-xs leading-5 text-[#5f6368]">{guide.summary}</span>
                            </span>
                            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#1a73e8]">
                                Setup steps
                                <ArrowRight className="h-3.5 w-3.5" />
                            </span>
                        </button>
                    ))}
                </div>
            </PaneSection>

            {usage && (
                <PaneSection>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <SectionTitle>Allowance this period</SectionTitle>
                        <button type="button" onClick={() => onSelect('usage')} className="text-xs font-medium text-[#1a73e8] hover:underline">
                            Usage by tool
                        </button>
                    </div>
                    <AllowanceMeter usage={usage} />
                    <p className="mt-3 max-w-[760px] text-sm leading-6 text-[#5f6368]">
                        {MCP_LIMIT_BEHAVIOUR}
                    </p>
                    <p className="mt-1 max-w-[760px] text-sm leading-6 text-[#5f6368]">
                        A session review costs about {SESSION_REVIEW_CREDITS} credits. A cohort report costs about {COHORT_REPORT_CREDITS} credits.
                        {capacity && usage.creditLimit !== null
                            ? ` The remaining credits cover about ${formatCredits(capacity.sessionReviews)} session reviews.`
                            : ''}
                    </p>
                </PaneSection>
            )}

            {!notEnabled && (
                <PaneSection>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <SectionTitle>Connected apps ({connections.length})</SectionTitle>
                    </div>
                    {loading && connections.length === 0 ? (
                        <div className="mt-3 flex h-16 items-center text-sm font-medium text-[#5f6368]">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading connections
                        </div>
                    ) : connections.length === 0 ? (
                        <p className="mt-3 max-w-[760px] text-sm leading-6 text-[#5f6368]">
                            No apps connected yet. Pick a client above to see its setup steps.
                        </p>
                    ) : (
                        <>
                            <div className="mt-3 divide-y divide-[#e8eaed] border-y border-[#e8eaed]">
                                {connections.map((connection) => (
                                    <button
                                        key={connection.id}
                                        type="button"
                                        onClick={() => onSelect(`connection:${connection.id}`)}
                                        className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition-colors hover:bg-[#f1f3f4]"
                                    >
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-medium text-[#202124]">{connection.clientName}</span>
                                            <span className="block truncate text-xs leading-5 text-[#5f6368]">
                                                Connected by {connection.connectedBy.name} · {connection.projects.map((project) => project.name).join(', ') || 'No projects'}
                                            </span>
                                        </span>
                                        <span className="shrink-0 text-xs font-medium tabular-nums text-[#5f6368]">
                                            Used {formatRelativeTime(connection.lastUsedAt, now)}
                                        </span>
                                    </button>
                                ))}
                            </div>
                            <p className="mt-3 max-w-[760px] text-sm leading-6 text-[#5f6368]">
                                To cut an app off, open it and click Revoke access. It stops working at once.
                            </p>
                        </>
                    )}
                </PaneSection>
            )}

            <DataPrivacySection masking={settings ? settings.maskEndUserIdentifiers : null} />
        </DetailFrame>
    );
}

export function ConnectPane({
    copiedKey,
    guide,
    onClose,
    onCopy,
    serverUrl,
}: CopyProps & {
    guide: McpConnectGuide;
    onClose: () => void;
    serverUrl: string;
}) {
    const snippet = buildConnectSnippet(guide.kind, serverUrl);
    const copyKey = `${guide.id}-snippet`;
    const copyButton = (
        <CopyButton
            copied={copiedKey === copyKey}
            copyKey={copyKey}
            label={guide.copyLabel}
            onCopy={onCopy}
            text={snippet}
        />
    );

    return (
        <DetailFrame
            title={`Connect ${guide.title}`}
            onClose={onClose}
            closeLabel="Close setup steps"
            actions={copyButton}
            message={`${guide.summary} Sign-in opens in your browser. There is no API key to copy.`}
        >
            <PaneSection>
                <SectionTitle>Steps</SectionTitle>
                <ol className="mt-3 grid gap-2.5">
                    {guide.steps.map((step, index) => (
                        <li key={step} className="grid grid-cols-[28px_minmax(0,1fr)] items-start gap-2 text-sm leading-6 text-[#3c4043]">
                            <span className="flex h-6 w-6 items-center justify-center bg-[#f1f3f4] text-xs font-medium tabular-nums text-[#3c4043]">
                                {index + 1}
                            </span>
                            <span>{step}</span>
                        </li>
                    ))}
                </ol>
            </PaneSection>

            <PaneSection>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <SectionTitle>{guide.snippetLabel}</SectionTitle>
                    <div className="flex flex-wrap gap-2">
                        {copyButton}
                    </div>
                </div>
                <CodeBlock>{snippet}</CodeBlock>
            </PaneSection>

            <PaneSection>
                <SectionTitle>Good to know</SectionTitle>
                <div className="mt-3 divide-y divide-[#e8eaed] border-y border-[#e8eaed]">
                    {MCP_CONNECT_FACTS.map((fact) => (
                        <p key={fact} className="py-2.5 text-sm font-medium leading-6 text-[#3c4043]">
                            {fact}
                        </p>
                    ))}
                </div>
            </PaneSection>
        </DetailFrame>
    );
}

export function UsagePane({ onClose, usage }: { onClose: () => void; usage: McpUsage }) {
    const percent = usagePercent(usage.creditsUsed, usage.creditLimit);
    const remaining = creditsRemaining(usage.creditsUsed, usage.creditLimit);
    const capacity = estimateCapacity(remaining);
    const rows = sortToolUsage(usage.byTool);
    const totalCredits = sumToolCredits(rows);
    const totalCalls = sumToolCalls(rows);

    return (
        <DetailFrame
            title="Usage this period"
            onClose={onClose}
            closeLabel="Close usage"
            message="Most MCP tool calls cost credits. Your plan includes a monthly allowance."
        >
            <PaneSection>
                <p className="text-base font-medium leading-7 text-[#5f6368]">
                    {usage.planName} plan
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                    <span className={`${dashboardChipClass(usageTone(percent))} tabular-nums`}>
                        {formatCreditCount(usage.creditsUsed)} used
                    </span>
                    {remaining !== null && (
                        <span className={`${dashboardChipClass('neutral')} tabular-nums`}>
                            {formatCreditCount(remaining)} remaining
                        </span>
                    )}
                    <span className={`${dashboardChipClass('neutral')} tabular-nums`}>
                        Resets {formatDate(usage.resetsAt)}
                    </span>
                </div>
            </PaneSection>

            <PaneSection>
                <SectionTitle>Allowance</SectionTitle>
                <AllowanceMeter usage={usage} />
                <FactList
                    rows={[
                        { label: 'Plan', value: usage.planName },
                        { label: 'Credits used', value: formatCredits(usage.creditsUsed) },
                        { label: 'Credits remaining', value: remaining === null ? 'No limit' : formatCredits(remaining) },
                        { label: 'Monthly allowance', value: usage.creditLimit === null ? 'No limit' : formatCredits(usage.creditLimit) },
                        { label: 'Resets on', value: formatDate(usage.resetsAt) },
                        ...(remaining === null ? [] : [{
                            label: 'Remaining covers about',
                            value: `${formatCredits(capacity.sessionReviews)} session reviews`,
                        }]),
                    ]}
                />
            </PaneSection>

            <PaneSection>
                <SectionTitle>At the limit</SectionTitle>
                <p className="mt-3 max-w-[760px] text-sm leading-6 text-[#5f6368]">
                    {MCP_LIMIT_BEHAVIOUR} Checking usage and listing projects stay free, so your AI client can still explain what happened.
                </p>
            </PaneSection>

            <PaneSection>
                <SectionTitle>By tool this period</SectionTitle>
                {rows.length === 0 ? (
                    <p className="mt-3 text-sm leading-6 text-[#5f6368]">No calls yet this period.</p>
                ) : (
                    <SimpleTable head={[{ label: 'Tool' }, { label: 'Calls', align: 'right' }, { label: 'Credits', align: 'right' }, { label: 'Share', align: 'right' }]}>
                        {rows.map((row) => (
                            <tr key={row.tool}>
                                <td className="px-3 py-2 font-mono text-xs text-[#202124]">{row.tool}</td>
                                <td className="px-3 py-2 text-right text-xs tabular-nums text-[#5f6368]">{formatCredits(row.calls)}</td>
                                <td className="px-3 py-2 text-right text-xs font-medium tabular-nums text-[#202124]">{formatCredits(row.credits)}</td>
                                <td className="px-3 py-2 text-right text-xs tabular-nums text-[#5f6368]">
                                    {totalCredits > 0 ? `${Math.round((row.credits / totalCredits) * 100)}%` : '0%'}
                                </td>
                            </tr>
                        ))}
                        <tr className="bg-[#f8fafd]">
                            <td className="px-3 py-2 text-xs font-medium text-[#202124]">Total</td>
                            <td className="px-3 py-2 text-right text-xs font-medium tabular-nums text-[#202124]">{formatCredits(totalCalls)}</td>
                            <td className="px-3 py-2 text-right text-xs font-medium tabular-nums text-[#202124]">{formatCredits(totalCredits)}</td>
                            <td className="px-3 py-2 text-right text-xs tabular-nums text-[#5f6368]">{totalCredits > 0 ? '100%' : '0%'}</td>
                        </tr>
                    </SimpleTable>
                )}
            </PaneSection>

            <PaneSection>
                <SectionTitle>What things cost</SectionTitle>
                <CostReference />
                <p className={`mt-4 ${dashboardLabelClass}`}>Session and crash review</p>
                <ToolCostTable rows={MCP_REVIEW_TOOL_COSTS} />
                <div className="mt-4 flex flex-wrap items-center gap-2">
                    <p className={dashboardLabelClass}>Cohort analysis</p>
                    <span className={dashboardChipClass('purple')}>Coming soon</span>
                </div>
                <ToolCostTable rows={MCP_COHORT_TOOL_COSTS} />
            </PaneSection>
        </DetailFrame>
    );
}

export function ConnectionPane({
    connection,
    isDemoMode,
    masking,
    now,
    onClose,
    onRevoke,
    revokeError,
    revoking,
}: {
    connection: McpConnection;
    isDemoMode: boolean;
    masking: boolean | null;
    now: number;
    onClose: () => void;
    onRevoke: () => void;
    revokeError: string | null;
    revoking: boolean;
}) {
    const chip = maskingChip(masking);
    const canRevoke = connection.canRevoke !== false;

    return (
        <DetailFrame
            title={connection.clientName}
            onClose={onClose}
            closeLabel="Close connection detail"
            message={`Connected by ${connection.connectedBy.name}. Read-only access to ${formatProjectCount(connection.projects.length)}.`}
        >
            <PaneSection>
                <p className="text-base font-medium leading-7 text-[#5f6368]">
                    Last used {formatRelativeTime(connection.lastUsedAt, now)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                    <span className={`${dashboardChipClass('neutral')} tabular-nums`}>
                        {formatCallCount(connection.callsThisPeriod)} this period
                    </span>
                    <span className={`${dashboardChipClass('neutral')} tabular-nums`}>
                        {formatCreditCount(connection.creditsThisPeriod)} this period
                    </span>
                    <span className={dashboardChipClass('info')}>Read-only</span>
                </div>
            </PaneSection>

            <PaneSection>
                <SectionTitle>Connection</SectionTitle>
                <FactList
                    rows={[
                        { label: 'App', value: connection.clientName },
                        {
                            label: 'Connected by',
                            value: (
                                <span className="block min-w-0">
                                    <span className="block truncate">{connection.connectedBy.name}</span>
                                    {connection.connectedBy.email && (
                                        <span className="block truncate text-xs font-normal text-[#5f6368]">{connection.connectedBy.email}</span>
                                    )}
                                </span>
                            ),
                        },
                        { label: 'Connected on', value: formatDate(connection.connectedAt) },
                        { label: 'Last used', value: connection.lastUsedAt ? formatDateTime(connection.lastUsedAt) : 'Never' },
                        { label: 'Calls this period', value: formatCredits(connection.callsThisPeriod) },
                        { label: 'Credits this period', value: formatCredits(connection.creditsThisPeriod) },
                    ]}
                />
            </PaneSection>

            <PaneSection>
                <SectionTitle>Shared projects ({connection.projects.length})</SectionTitle>
                <div className="mt-3 flex flex-wrap gap-2">
                    {connection.projects.length === 0 ? (
                        <span className="text-sm leading-6 text-[#5f6368]">No projects are shared with this app.</span>
                    ) : connection.projects.map((project) => (
                        <span key={project.id} className={dashboardChipClass('neutral')}>{project.name}</span>
                    ))}
                </div>
            </PaneSection>

            <PaneSection>
                <SectionTitle>What this app can do</SectionTitle>
                <div className="mt-3 divide-y divide-[#e8eaed] border-y border-[#e8eaed]">
                    {connection.scopes.map((scope) => (
                        <p key={scope} className="py-2.5 text-sm font-medium leading-6 text-[#3c4043]">
                            {scopeLabel(scope)}
                        </p>
                    ))}
                </div>
                <p className="mt-3 max-w-[760px] text-sm leading-6 text-[#5f6368]">
                    It cannot change or delete anything.
                </p>
            </PaneSection>

            <PaneSection>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <SectionTitle>Masking</SectionTitle>
                    <span className={dashboardChipClass(chip.tone)}>{chip.label}</span>
                </div>
                <p className="mt-3 max-w-[760px] text-sm leading-6 text-[#5f6368]">
                    {masking === null
                        ? 'A team admin decides whether end-user identifiers and city are masked.'
                        : masking
                            ? 'This app receives end-user identifiers and city masked.'
                            : 'This app receives end-user identifiers and city as they appear in the dashboard.'}
                </p>
            </PaneSection>

            {revokeError && (
                <div className="mx-4 mt-4 rounded-none border border-[#f6aea9] bg-[#fce8e6] px-3 py-2 text-sm font-medium text-[#a50e0e] sm:mx-5">
                    {revokeError}
                </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
                <p className="min-w-0 max-w-xl text-xs font-medium leading-5 text-[#5f6368]">
                    {isDemoMode
                        ? 'Revoking is turned off in the demo.'
                        : canRevoke
                            ? 'Revoking stops this app at once. The person can connect again later.'
                            : 'Only the person who connected this app or a team admin can revoke it.'}
                </p>
                <PaneButton
                    icon={revoking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                    onClick={onRevoke}
                    disabled={isDemoMode || revoking || !canRevoke}
                    variant="danger"
                >
                    Revoke access
                </PaneButton>
            </div>
        </DetailFrame>
    );
}

export function AskPane({
    copiedKey,
    guide,
    onClose,
    onCopy,
}: CopyProps & {
    guide: McpPromptGuide;
    onClose: () => void;
}) {
    return (
        <DetailFrame
            title={guide.title}
            titleChip={guide.comingSoon ? <span className={dashboardChipClass('purple')}>Coming soon</span> : undefined}
            onClose={onClose}
            closeLabel="Close examples"
            message={guide.comingSoon
                ? 'The cohort tools ship in a later phase. These prompts will not work yet.'
                : guide.summary}
        >
            <PaneSection className="py-5">
                <p className="max-w-[760px] text-sm font-medium leading-8 text-[#5f6368]">
                    {guide.explanation}
                </p>
            </PaneSection>

            <PaneSection>
                <SectionTitle>Example prompts</SectionTitle>
                <div className="mt-3 grid gap-2">
                    {guide.prompts.map((prompt, index) => {
                        const copyKey = `${guide.id}-prompt-${index}`;
                        return (
                            <div
                                key={prompt}
                                className="flex flex-col gap-3 rounded-none border border-[#dadce0] bg-white px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <p className="min-w-0 text-sm leading-6 text-[#3c4043]">{prompt}</p>
                                <CopyButton
                                    copied={copiedKey === copyKey}
                                    copyKey={copyKey}
                                    disabled={guide.comingSoon}
                                    label="Copy"
                                    onCopy={onCopy}
                                    size="sm"
                                    text={prompt}
                                    variant="secondary"
                                />
                            </div>
                        );
                    })}
                </div>
            </PaneSection>

            <PaneSection>
                <SectionTitle>Tools involved ({guide.tools.length})</SectionTitle>
                <div className="mt-3 flex flex-wrap gap-2">
                    {guide.tools.map((tool) => (
                        <span key={tool} className={`${dashboardChipClass('neutral')} font-mono`}>
                            {tool}
                        </span>
                    ))}
                </div>
            </PaneSection>

            <PaneSection>
                <SectionTitle>Credit cost</SectionTitle>
                <p className="mt-3 max-w-[760px] text-sm leading-6 text-[#5f6368]">
                    {guide.cost}
                </p>
            </PaneSection>
        </DetailFrame>
    );
}

export function NoConnectionsState() {
    return (
        <div className="flex flex-col items-center justify-center gap-4 border-b border-[#e8eaed] px-6 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-none bg-[#f1f3f4]">
                <Inbox className="h-7 w-7 text-[#80868b]" aria-hidden />
            </span>
            <div className="max-w-xs">
                <p className="text-sm font-medium text-[#202124]">No apps connected yet</p>
                <p className="mt-1.5 text-sm font-medium leading-6 text-[#5f6368]">
                    Pick a client under Connect and follow its steps. The app shows up here once you click Allow.
                </p>
            </div>
        </div>
    );
}
