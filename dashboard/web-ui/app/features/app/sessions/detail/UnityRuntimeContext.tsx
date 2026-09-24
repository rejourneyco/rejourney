import React from 'react';

type Event = { timestamp?: unknown; name?: string; properties?: Record<string, unknown> };
export function UnityRuntimeContext({ metadata, events, onSeek }: {
  metadata?: Record<string, unknown>;
  events: Event[];
  onSeek?: (timestamp: number) => void;
}) {
  if (metadata?.sdkFamily !== 'unity') return null;
  const samples = events.filter((event) => event.name === 'unity_performance')
    .map((event) => ({ value: Number(event.properties?.frameTimeP95Ms), timestamp: Number(event.timestamp) }))
    .filter(({ value, timestamp }) => Number.isFinite(value) && value >= 0 && Number.isFinite(timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const maximum = samples.reduce((max, item) => Math.max(max, item.value), 33.33);
  const first = samples[0]?.timestamp ?? 0;
  const span = Math.max(1, (samples[samples.length - 1]?.timestamp ?? first) - first);
  const points = samples.map(({ value, timestamp }) => `${(timestamp - first) * 300 / span},${54 - value * 48 / maximum}`).join(' ');
  const worst = samples.reduce((previous, item) => !previous || item.value > previous.value ? item : previous, samples[0]);
  return <section aria-label="Unity runtime" className="border-b border-slate-200 bg-slate-950 px-4 py-3 text-slate-100">
    <p className="text-sm font-bold">Unity {String(metadata.unityVersion || '')}</p>
    <p className="text-xs text-slate-300">{[metadata.scriptingBackend, metadata.graphicsApi, metadata.renderPipeline].filter(Boolean).map(String).join(' · ')}</p>
    {metadata.buildIdentifier ? <p className="mt-1 break-all font-mono text-[10px]">Build {String(metadata.buildIdentifier)}</p> : null}
    {samples.length > 0 ? <>
      <p className="mt-3 text-xs">Frame time p95 · {samples.length} samples · max {worst.value.toFixed(1)} ms</p>
      <svg role="img" aria-label="Frame time p95 over this session" viewBox="0 0 300 60" className="mt-1 h-16 w-full">
        <line x1="0" x2="300" y1={54 - 16.67 * 48 / maximum} y2={54 - 16.67 * 48 / maximum} stroke="#475569" strokeDasharray="3 3" />
        <polyline points={points} fill="none" stroke="#67e8f9" strokeWidth="2" />
      </svg>
      {onSeek ? <button type="button" onClick={() => onSeek(worst.timestamp)} className="text-xs text-cyan-300 underline">Seek to slowest sample</button> : null}
    </> : <p className="mt-2 text-xs text-slate-400">Performance samples have not arrived.</p>}
  </section>;
}
