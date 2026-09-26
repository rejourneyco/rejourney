import React, { useMemo, useState } from 'react';
import { Database, Search } from 'lucide-react';
import { dashboardChipClass } from '~/shared/ui/core/dashboardStyles';

export interface ReduxReplayEvent {
    type: string;
    name?: string;
    timestamp: number;
    properties?: Record<string, any>;
}

export function isReduxReplayEvent(event: ReduxReplayEvent): boolean {
    const type = String(event.type || '').toLowerCase();
    const name = String(event.name || '').toLowerCase();
    return type === 'redux_action'
        || name === '$redux_action'
        || event.properties?.source === 'redux';
}

export function getReduxActionType(event: ReduxReplayEvent): string {
    return String(event.properties?.actionType || event.properties?.action?.type || event.name || 'unknown action');
}

interface ReduxReplayPanelProps {
    events: ReduxReplayEvent[];
    currentPlaybackTime: number;
    toPlaybackSeconds: (timestamp: number) => number;
    onSeek: (seconds: number) => void;
}

type DetailTab = 'action' | 'previousState' | 'nextState';

function formatJson(value: unknown): string {
    if (value === undefined) return 'Not captured';
    if (typeof value === 'string') return value;
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

export default function ReduxReplayPanel({
    events,
    currentPlaybackTime,
    toPlaybackSeconds,
    onSeek,
}: ReduxReplayPanelProps) {
    const [query, setQuery] = useState('');
    const [detailTab, setDetailTab] = useState<DetailTab>('nextState');

    const filteredEvents = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return events;
        return events.filter((event) => {
            const properties = event.properties || {};
            return getReduxActionType(event).toLowerCase().includes(normalized)
                || JSON.stringify(properties.action || {}).toLowerCase().includes(normalized);
        });
    }, [events, query]);

    const activeEvent = useMemo(() => {
        let current: ReduxReplayEvent | null = null;
        for (const event of events) {
            if (toPlaybackSeconds(event.timestamp) > currentPlaybackTime + 0.05) break;
            current = event;
        }
        return current || events[0] || null;
    }, [currentPlaybackTime, events, toPlaybackSeconds]);

    const activeProperties = activeEvent?.properties || {};
    const detailValue = activeProperties[detailTab];

    return (
        <div className="absolute inset-0 flex min-h-0 flex-col bg-white text-[#3c4043]">
            <div className="border-b border-[#e8eaed] bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <h3 className="text-[15px] font-medium text-[#202124]">Redux replay</h3>
                        <p className="truncate text-xs text-[#5f6368]">Actions and state synchronized to playback</p>
                    </div>
                    <span className={`${dashboardChipClass('neutral')} shrink-0 tabular-nums`}>
                        {events.length} actions
                    </span>
                </div>
                <label className="relative mt-2 block">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#80868b]" />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Filter action types"
                        className="h-8 w-full rounded-none border border-[#dadce0] bg-white pl-8 pr-3 text-xs text-[#202124] outline-none placeholder:text-[#80868b] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20"
                    />
                </label>
            </div>

            <div className="grid min-h-0 flex-1 grid-rows-[minmax(8rem,0.8fr)_minmax(12rem,1.2fr)]">
                <div className="min-h-0 overflow-y-auto border-b border-[#dadce0] bg-white text-[#202124]">
                    {filteredEvents.map((event, index) => {
                        const actionType = getReduxActionType(event);
                        const isActive = event === activeEvent;
                        const playbackSeconds = toPlaybackSeconds(event.timestamp);
                        return (
                            <button
                                key={`${event.timestamp}-${actionType}-${index}`}
                                onClick={() => onSeek(playbackSeconds)}
                                className={`flex w-full items-start gap-2 border-b border-[#e8eaed] px-3 py-2 text-left transition-colors ${isActive ? 'bg-[#e8f0fe]' : 'hover:bg-[#f8fafd]'}`}
                            >
                                <Database className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isActive ? 'text-[#1967d2]' : 'text-[#9aa0a6]'}`} />
                                <span className="min-w-0 flex-1">
                                    <span className={`block truncate font-mono text-[11px] font-medium ${isActive ? 'text-[#1967d2]' : 'text-[#202124]'}`}>{actionType}</span>
                                    <span className="mt-0.5 block text-[11px] tabular-nums text-[#5f6368]">
                                        #{event.properties?.sequence ?? index}
                                        {typeof event.properties?.durationMs === 'number' ? ` · ${event.properties.durationMs} ms` : ''}
                                    </span>
                                </span>
                                <span className="shrink-0 text-[11px] tabular-nums text-[#5f6368]">
                                    {playbackSeconds.toFixed(2)}s
                                </span>
                            </button>
                        );
                    })}
                    {filteredEvents.length === 0 ? (
                        <div className="p-6 text-center text-xs text-[#5f6368]">No Redux actions match this filter.</div>
                    ) : null}
                </div>

                <div className="flex min-h-0 flex-col bg-white">
                    <div className="flex shrink-0 border-b border-[#e8eaed]">
                        {([
                            ['action', 'Action'],
                            ['previousState', 'Before'],
                            ['nextState', 'After'],
                        ] as Array<[DetailTab, string]>).map(([id, label]) => (
                            <button
                                key={id}
                                onClick={() => setDetailTab(id)}
                                aria-pressed={detailTab === id}
                                className={`flex-1 rounded-none px-2 py-2 text-xs font-medium transition-colors ${detailTab === id ? 'text-[#1967d2] shadow-[inset_0_-2px_0_#1a73e8]' : 'text-[#5f6368] hover:bg-[#f8fafd] hover:text-[#202124]'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 border-b border-[#e8eaed] px-3 py-2">
                        <span className="truncate font-mono text-[11px] font-medium text-[#202124]">
                            {activeEvent ? getReduxActionType(activeEvent) : 'No action selected'}
                        </span>
                        {activeProperties.truncated ? (
                            <span className={`${dashboardChipClass('warning')} shrink-0`}>Truncated</span>
                        ) : null}
                    </div>
                    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-[#f8fafd] p-3 font-mono text-[11px] leading-4 text-[#3c4043]">
                        {formatJson(detailValue)}
                    </pre>
                </div>
            </div>
        </div>
    );
}

