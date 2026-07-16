import React, { useMemo, useState } from 'react';
import { Database, Search } from 'lucide-react';

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
        <div className="absolute inset-0 flex min-h-0 flex-col bg-slate-950 text-slate-100">
            <div className="border-b-2 border-black bg-slate-900 px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-wide text-[#67e8f9]">Redux replay</p>
                        <h3 className="truncate text-sm font-bold text-white">Actions and state synchronized to playback</h3>
                    </div>
                    <span className="shrink-0 border border-slate-600 bg-slate-950 px-2 py-1 font-mono text-[10px] font-bold">
                        {events.length} actions
                    </span>
                </div>
                <label className="mt-2 flex h-8 items-center gap-2 border border-slate-700 bg-slate-950 px-2">
                    <Search className="h-3.5 w-3.5 text-slate-500" />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Filter action types"
                        className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-slate-600"
                    />
                </label>
            </div>

            <div className="grid min-h-0 flex-1 grid-rows-[minmax(8rem,0.8fr)_minmax(12rem,1.2fr)]">
                <div className="min-h-0 overflow-y-auto border-b-2 border-black bg-white text-slate-900">
                    {filteredEvents.map((event, index) => {
                        const actionType = getReduxActionType(event);
                        const isActive = event === activeEvent;
                        const playbackSeconds = toPlaybackSeconds(event.timestamp);
                        return (
                            <button
                                key={`${event.timestamp}-${actionType}-${index}`}
                                onClick={() => onSeek(playbackSeconds)}
                                className={`flex w-full items-start gap-2 border-b border-slate-200 px-3 py-2 text-left ${isActive ? 'border-l-4 border-l-[#0891b2] bg-cyan-50' : 'hover:bg-slate-50'}`}
                            >
                                <Database className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${isActive ? 'text-cyan-700' : 'text-slate-400'}`} />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate font-mono text-[11px] font-bold">{actionType}</span>
                                    <span className="mt-0.5 block text-[10px] text-slate-500">
                                        #{event.properties?.sequence ?? index}
                                        {typeof event.properties?.durationMs === 'number' ? ` · ${event.properties.durationMs} ms` : ''}
                                    </span>
                                </span>
                                <span className="shrink-0 border border-slate-300 bg-white px-1 py-0.5 font-mono text-[9px] font-bold">
                                    {playbackSeconds.toFixed(2)}s
                                </span>
                            </button>
                        );
                    })}
                    {filteredEvents.length === 0 ? (
                        <div className="p-6 text-center text-xs text-slate-500">No Redux actions match this filter.</div>
                    ) : null}
                </div>

                <div className="flex min-h-0 flex-col bg-slate-950">
                    <div className="flex shrink-0 border-b border-slate-700">
                        {([
                            ['action', 'Action'],
                            ['previousState', 'Before'],
                            ['nextState', 'After'],
                        ] as Array<[DetailTab, string]>).map(([id, label]) => (
                            <button
                                key={id}
                                onClick={() => setDetailTab(id)}
                                className={`flex-1 border-b-2 px-2 py-2 text-[10px] font-black uppercase ${detailTab === id ? 'border-[#67e8f9] bg-slate-900 text-[#67e8f9]' : 'border-transparent text-slate-400 hover:text-white'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
                        <span className="truncate font-mono text-[11px] font-bold text-white">
                            {activeEvent ? getReduxActionType(activeEvent) : 'No action selected'}
                        </span>
                        {activeProperties.truncated ? (
                            <span className="shrink-0 border border-amber-600 bg-amber-950 px-1.5 py-0.5 text-[9px] font-bold text-amber-300">TRUNCATED</span>
                        ) : null}
                    </div>
                    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[10px] leading-4 text-slate-200">
                        {formatJson(detailValue)}
                    </pre>
                </div>
            </div>
        </div>
    );
}

