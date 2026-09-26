import React from 'react';
import { formatGameplayDuration, gameplayOutcomeLabel, type ReplayGameplayInterval } from '~/shared/lib/gameplayIntervals';

type Event = { timestamp?: unknown; name?: string; properties?: Record<string, unknown> };
export function UnityRuntimeContext({ metadata, events, gameplay = [], onSeek }: {
  metadata?: Record<string, unknown>;
  events: Event[];
  gameplay?: ReplayGameplayInterval[];
  onSeek?: (timestamp: number) => void;
}) {
  if (metadata?.sdkFamily !== 'unity') return null;
  const playedMs = gameplay.reduce((total, segment) => total + (segment.end - segment.start), 0);
  const samples = events.filter((event) => event.name === 'unity_performance')
    .map((event) => ({ value: Number(event.properties?.frameTimeP95Ms), timestamp: Number(event.timestamp) }))
    .filter(({ value, timestamp }) => Number.isFinite(value) && value >= 0 && Number.isFinite(timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const maximum = samples.reduce((max, item) => Math.max(max, item.value), 33.33);
  const first = samples[0]?.timestamp ?? 0;
  const span = Math.max(1, (samples[samples.length - 1]?.timestamp ?? first) - first);
  const points = samples.map(({ value, timestamp }) => `${(timestamp - first) * 300 / span},${54 - value * 48 / maximum}`).join(' ');
  const worst = samples.reduce((previous, item) => !previous || item.value > previous.value ? item : previous, samples[0]);
  return <section aria-label="Unity runtime" className="border-b border-[#e8eaed] bg-white px-4 py-3 text-[#3c4043]">
    <p className="text-[15px] font-medium text-[#202124]">Unity {String(metadata.unityVersion || '')}</p>
    <p className="text-xs text-[#5f6368]">{[metadata.scriptingBackend, metadata.graphicsApi, metadata.renderPipeline].filter(Boolean).map(String).join(' · ')}</p>
    {metadata.buildIdentifier ? <p className="mt-1 break-all font-mono text-[11px] text-[#5f6368]">Build {String(metadata.buildIdentifier)}</p> : null}
    {samples.length > 0 ? <>
      <p className="mt-3 text-xs font-medium tabular-nums text-[#3c4043]">Frame time p95 · {samples.length} samples · max {worst.value.toFixed(1)} ms</p>
      <svg role="img" aria-label="Frame time p95 over this session" viewBox="0 0 300 60" className="mt-1 h-16 w-full">
        <line x1="0" x2="300" y1={54 - 16.67 * 48 / maximum} y2={54 - 16.67 * 48 / maximum} stroke="#bdc1c6" strokeDasharray="3 3" />
        <polyline points={points} fill="none" stroke="#1a73e8" strokeWidth="2" />
      </svg>
      {onSeek ? <button type="button" onClick={() => onSeek(worst.timestamp)} className="text-xs font-medium text-[#1a73e8] hover:text-[#1765cc] hover:underline">Seek to slowest sample</button> : null}
    </> : <p className="mt-2 text-xs text-[#5f6368]">Performance samples have not arrived.</p>}
    {gameplay.length > 0 ? <div className="mt-3">
      <p className="text-xs font-medium tabular-nums text-[#3c4043]">Gameplay · {gameplay.length} {gameplay.length === 1 ? 'segment' : 'segments'} · {formatGameplayDuration(playedMs)}</p>
      <p className="text-[11px] text-[#5f6368]">Taps during play are left out of frustration signals and heatmaps.</p>
      <ul className="mt-1 space-y-1">
        {gameplay.slice(0, 20).map((segment) => <li key={segment.index} className="flex items-center justify-between gap-2 text-xs text-[#3c4043]">
          <span className="truncate">{segment.name ?? 'Gameplay'} · {gameplayOutcomeLabel(segment.outcome)} · {formatGameplayDuration(segment.end - segment.start)}</span>
          {onSeek ? <button type="button" onClick={() => onSeek(segment.start)} className="shrink-0 font-medium text-[#1a73e8] hover:text-[#1765cc] hover:underline">Seek</button> : null}
        </li>)}
      </ul>
    </div> : null}
  </section>;
}
