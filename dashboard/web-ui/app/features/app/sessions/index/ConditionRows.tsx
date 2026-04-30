import React from 'react';
import {
  X, AlertOctagon, Calendar, LayoutGrid, Zap, Tag, Users,
  Smartphone, ArrowRight, Plus, Info, Route, ChevronDown,
} from 'lucide-react';
import {
  type IssueCondition, type DateCondition, type ScreenCondition,
  type EventCondition, type MetadataCondition, type LifecycleCondition,
  type ConversionCondition, type PlatformCondition, type JourneyCondition,
  CONDITION_TYPE_META,
} from './queryBuilderTypes';

export interface AvailableFilters {
  events: string[];
  eventPropertyKeys: string[];
  screens: string[];
  metadata: Record<string, string[]>;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function Chip({
  value, onChange, options, placeholder, className = '',
}: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string; className?: string;
}) {
  return (
    <div className="relative inline-flex items-center shrink-0">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none bg-slate-100 hover:bg-slate-200 transition-colors rounded-lg pl-3 pr-7 py-1.5 text-xs font-semibold text-slate-800 cursor-pointer outline-none focus:ring-2 focus:ring-[#5dadec]/40 ${className}`}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 shrink-0" />
    </div>
  );
}

function NumInput({
  value, onChange, placeholder, min = 0, width = 'w-14',
}: {
  value: string; onChange: (v: string) => void;
  placeholder?: string; min?: number; width?: string;
}) {
  return (
    <input
      type="number" min={min} value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${width} bg-slate-100 hover:bg-slate-200 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:ring-2 focus:ring-[#5dadec]/40 text-center`}
    />
  );
}

const COUNT_OPS = [
  { value: '', label: 'any count' },
  { value: 'eq', label: '= exactly' },
  { value: 'gt', label: '> more than' },
  { value: 'lt', label: '< fewer than' },
  { value: 'gte', label: '≥ at least' },
  { value: 'lte', label: '≤ at most' },
];

// ── Row shell ─────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, { icon: React.ReactNode; bg: string; text: string; border: string }> = {
  issue:      { icon: <AlertOctagon className="w-4 h-4" />, bg: 'bg-slate-800', text: 'text-white', border: 'border-slate-700' },
  date:       { icon: <Calendar className="w-4 h-4" />,     bg: 'bg-sky-500',   text: 'text-white', border: 'border-sky-400' },
  screen:     { icon: <LayoutGrid className="w-4 h-4" />,   bg: 'bg-violet-500',text: 'text-white', border: 'border-violet-400' },
  event:      { icon: <Zap className="w-4 h-4" />,          bg: 'bg-indigo-500',text: 'text-white', border: 'border-indigo-400' },
  metadata:   { icon: <Tag className="w-4 h-4" />,          bg: 'bg-emerald-500',text: 'text-white', border: 'border-emerald-400' },
  lifecycle:  { icon: <Users className="w-4 h-4" />,        bg: 'bg-amber-500', text: 'text-white', border: 'border-amber-400' },
  platform:   { icon: <Smartphone className="w-4 h-4" />,   bg: 'bg-cyan-500',  text: 'text-white', border: 'border-cyan-400' },
  journey:    { icon: <Route className="w-4 h-4" />,        bg: 'bg-teal-500',  text: 'text-white', border: 'border-teal-400' },
  conversion: { icon: <Tag className="w-4 h-4" />,          bg: 'bg-pink-500',  text: 'text-white', border: 'border-pink-400' },
};

export function ConditionRowShell({
  type, children, onRemove,
}: {
  type: string; children: React.ReactNode; onRemove: () => void;
}) {
  const c = TYPE_COLORS[type] ?? TYPE_COLORS.issue;
  const meta = CONDITION_TYPE_META[type as keyof typeof CONDITION_TYPE_META];
  return (
    <div className="flex flex-col gap-2 px-3 py-2.5 bg-white rounded-xl border border-slate-200 shadow-sm">
      {/* Row 1: type label + remove */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 shrink-0">
          <div className={`${c.bg} ${c.text} p-1.5 rounded-lg shrink-0`}>{c.icon}</div>
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{meta?.label ?? type}</span>
        </div>
        <button
          onClick={onRemove}
          className="p-1.5 rounded-lg text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors shrink-0"
          title="Remove rule"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      {/* Row 2: controls */}
      <div className="flex items-center gap-2 flex-wrap pl-1">{children}</div>
    </div>
  );
}

// ── Individual rows ───────────────────────────────────────────────────────────

export function IssueRow({ cond, onChange, onRemove }: { cond: IssueCondition; onChange: (c: IssueCondition) => void; onRemove: () => void }) {
  return (
    <ConditionRowShell type="issue" onRemove={onRemove}>
      <Chip
        value={cond.issueFilter}
        onChange={(v) => onChange({ ...cond, issueFilter: v as IssueCondition['issueFilter'] })}
        options={[
          { value: 'crashes', label: '💥 Crashes' },
          { value: 'anrs', label: '🔴 ANRs' },
          { value: 'errors', label: '⚠️ Errors' },
          { value: 'rage', label: '😤 Rage taps' },
          { value: 'dead_taps', label: '💀 Dead taps' },
          { value: 'slow_start', label: '🐢 Slow start' },
          { value: 'slow_api', label: '📡 Slow API' },
        ]}
      />
    </ConditionRowShell>
  );
}

const TIME_OPTS = [
  { value: '24h', label: 'Last 24h' }, { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last year' },
];

export function DateRow({ cond, onChange, onRemove }: { cond: DateCondition; onChange: (c: DateCondition) => void; onRemove: () => void }) {
  return (
    <ConditionRowShell type="date" onRemove={onRemove}>
      <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs font-semibold">
        {(['range', 'exact'] as const).map((m) => (
          <button key={m} onClick={() => onChange({ ...cond, mode: m })}
            className={`px-3 py-1.5 transition-colors ${cond.mode === m ? 'bg-sky-500 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
            {m === 'range' ? 'Range' : 'Exact date'}
          </button>
        ))}
      </div>
      {cond.mode === 'range' && (
        <Chip value={cond.timeRange ?? '7d'} onChange={(v) => onChange({ ...cond, timeRange: v as DateCondition['timeRange'] })} options={TIME_OPTS} />
      )}
      {cond.mode === 'exact' && (
        <input type="date" value={cond.date ?? ''} onChange={(e) => onChange({ ...cond, date: e.target.value })}
          className="bg-slate-100 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none" />
      )}
    </ConditionRowShell>
  );
}

export function ScreenRow({ cond, onChange, onRemove, filters, loading }: {
  cond: ScreenCondition; onChange: (c: ScreenCondition) => void; onRemove: () => void;
  filters: AvailableFilters; loading: boolean;
}) {
  const screenOpts = filters.screens.map((s) => ({ value: s, label: s }));
  return (
    <ConditionRowShell type="screen" onRemove={onRemove}>
      {loading ? <span className="text-xs text-slate-400">Loading…</span> : (
        <Chip value={cond.screenName} onChange={(v) => onChange({ ...cond, screenName: v, screenVisitCountOp: undefined, screenVisitCountValue: undefined })}
          options={screenOpts} placeholder="Pick screen…" className="min-w-[140px]" />
      )}
      <Chip
        value={cond.screenVisitCountOp ?? ''}
        onChange={(v) => onChange({ ...cond, screenVisitCountOp: (v || undefined) as ScreenCondition['screenVisitCountOp'], screenVisitCountValue: v ? cond.screenVisitCountValue : undefined })}
        options={COUNT_OPS.map((o) => ({ value: o.value, label: o.value ? o.label.replace('count', 'visits') : 'any visits' }))}
      />
      {cond.screenVisitCountOp && (
        <NumInput value={cond.screenVisitCountValue ?? ''} onChange={(v) => onChange({ ...cond, screenVisitCountValue: v })} placeholder="1" min={1} />
      )}
      <span className="text-xs text-slate-400">→</span>
      <Chip
        value={cond.screenOutcome ?? ''}
        onChange={(v) => onChange({ ...cond, screenOutcome: (v || undefined) as ScreenCondition['screenOutcome'] })}
        options={[{ value: '', label: 'any outcome' }, { value: 'bounced', label: '↩ bounced (exit)' }, { value: 'continued', label: '→ continued' }]}
      />
      <span title="Bounced = last screen before session ended. Continued = navigated to at least one more screen after." className="cursor-help text-slate-300 hover:text-slate-500 transition-colors">
        <Info className="w-3.5 h-3.5" />
      </span>
    </ConditionRowShell>
  );
}

export function EventRow({ cond, onChange, onRemove, filters, loading }: {
  cond: EventCondition; onChange: (c: EventCondition) => void; onRemove: () => void;
  filters: AvailableFilters; loading: boolean;
}) {
  const eventOpts = filters.events.map((e) => ({ value: e, label: e }));
  const propOpts = filters.eventPropertyKeys.map((k) => ({ value: k, label: k }));
  return (
    <ConditionRowShell type="event" onRemove={onRemove}>
      {loading ? <span className="text-xs text-slate-400">Loading…</span> : (
        <Chip value={cond.eventName} onChange={(v) => onChange({ ...cond, eventName: v, eventCountOp: undefined, eventCountValue: undefined, eventPropKey: undefined, eventPropValue: undefined })}
          options={eventOpts} placeholder="Pick event…" className="min-w-[140px]" />
      )}
      {cond.eventName && (
        <>
          <Chip value={cond.eventCountOp ?? ''} onChange={(v) => onChange({ ...cond, eventCountOp: (v || undefined) as EventCondition['eventCountOp'], eventCountValue: v ? cond.eventCountValue : undefined })} options={COUNT_OPS} />
          {cond.eventCountOp && <NumInput value={cond.eventCountValue ?? ''} onChange={(v) => onChange({ ...cond, eventCountValue: v })} placeholder="1" min={1} />}
          {propOpts.length > 0 && (
            <Chip value={cond.eventPropKey ?? ''} onChange={(v) => onChange({ ...cond, eventPropKey: v || undefined, eventPropValue: v ? cond.eventPropValue : undefined })}
              options={[{ value: '', label: 'any property' }, ...propOpts]} />
          )}
          {cond.eventPropKey && (
            <input type="text" value={cond.eventPropValue ?? ''} onChange={(e) => onChange({ ...cond, eventPropValue: e.target.value || undefined })}
              placeholder="value" className="bg-slate-100 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none w-24" />
          )}
        </>
      )}
    </ConditionRowShell>
  );
}

export function MetadataRow({ cond, onChange, onRemove, filters, loading }: {
  cond: MetadataCondition; onChange: (c: MetadataCondition) => void; onRemove: () => void;
  filters: AvailableFilters; loading: boolean;
}) {
  const keyOpts = Object.keys(filters.metadata).map((k) => ({ value: k, label: k }));
  const valOpts = cond.metaKey ? (filters.metadata[cond.metaKey] ?? []).map((v) => ({ value: v, label: v })) : [];
  return (
    <ConditionRowShell type="metadata" onRemove={onRemove}>
      {loading ? <span className="text-xs text-slate-400">Loading…</span> : (
        <Chip value={cond.metaKey} onChange={(v) => onChange({ ...cond, metaKey: v, metaValue: undefined })} options={keyOpts} placeholder="Pick key…" className="min-w-[120px]" />
      )}
      {cond.metaKey && (
        <>
          <span className="text-xs text-slate-400">=</span>
          {valOpts.length > 0 ? (
            <Chip value={cond.metaValue ?? ''} onChange={(v) => onChange({ ...cond, metaValue: v || undefined })} options={[{ value: '', label: 'any value' }, ...valOpts]} />
          ) : (
            <input type="text" value={cond.metaValue ?? ''} onChange={(e) => onChange({ ...cond, metaValue: e.target.value || undefined })}
              placeholder="value" className="bg-slate-100 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-800 outline-none w-28" />
          )}
        </>
      )}
    </ConditionRowShell>
  );
}

export function LifecycleRow({ cond, onChange, onRemove }: { cond: LifecycleCondition; onChange: (c: LifecycleCondition) => void; onRemove: () => void }) {
  return (
    <ConditionRowShell type="lifecycle" onRemove={onRemove}>
      <div className="flex rounded-lg overflow-hidden border border-amber-200 text-xs font-semibold">
        {(['early_user', 'returning_user'] as const).map((p) => (
          <button key={p} onClick={() => onChange({ ...cond, preset: p, returnedCountOp: undefined, returnedCountValue: undefined })}
            className={`px-3 py-1.5 transition-colors ${cond.preset === p ? 'bg-amber-500 text-white' : 'text-amber-700 hover:bg-amber-50'}`}>
            {p === 'early_user' ? '🌱 Early user' : '🔄 Returning'}
          </button>
        ))}
      </div>
      <span className="text-xs text-slate-400">{cond.preset === 'early_user' ? '≤' : '>'}</span>
      <NumInput value={String(cond.sessionWindowSize ?? 5)} onChange={(v) => onChange({ ...cond, sessionWindowSize: Math.min(25, Math.max(1, parseInt(v) || 5)) })} min={1} width="w-12" />
      <span className="text-xs text-slate-500">sessions</span>
      {cond.preset === 'returning_user' && (
        <>
          <span className="text-xs text-slate-300 mx-1">·</span>
          <Chip
            value={cond.returnedCountOp ?? ''}
            onChange={(v) => onChange({ ...cond, returnedCountOp: (v || undefined) as LifecycleCondition['returnedCountOp'], returnedCountValue: v ? cond.returnedCountValue : undefined })}
            options={[{ value: '', label: 'any return count' }, { value: 'eq', label: 'returned =' }, { value: 'gt', label: 'returned >' }, { value: 'lt', label: 'returned <' }, { value: 'gte', label: 'returned ≥' }, { value: 'lte', label: 'returned ≤' }]}
          />
          {cond.returnedCountOp && (
            <><NumInput value={cond.returnedCountValue ?? ''} onChange={(v) => onChange({ ...cond, returnedCountValue: v })} placeholder="#" min={1} width="w-12" />
            <span className="text-xs text-slate-500">×</span></>
          )}
        </>
      )}
    </ConditionRowShell>
  );
}

export function PlatformRow({ cond, onChange, onRemove }: { cond: PlatformCondition; onChange: (c: PlatformCondition) => void; onRemove: () => void }) {
  return (
    <ConditionRowShell type="platform" onRemove={onRemove}>
      <div className="flex rounded-lg overflow-hidden border border-cyan-200 text-xs font-semibold">
        {(['ios', 'android'] as const).map((p) => (
          <button key={p} onClick={() => onChange({ ...cond, platform: p })}
            className={`px-3 py-1.5 transition-colors uppercase ${cond.platform === p ? 'bg-cyan-500 text-white' : 'text-cyan-700 hover:bg-cyan-50'}`}>
            {p === 'ios' ? '🍎 iOS' : '🤖 Android'}
          </button>
        ))}
      </div>
    </ConditionRowShell>
  );
}

export function JourneyRow({ cond, onChange, onRemove, filters, loading }: {
  cond: JourneyCondition; onChange: (c: JourneyCondition) => void; onRemove: () => void;
  filters: AvailableFilters; loading: boolean;
}) {
  const screenOpts = filters.screens.map((s) => ({ value: s, label: s }));
  function updateStep(idx: number, v: string) { const s = [...cond.steps]; s[idx] = v; onChange({ ...cond, steps: s }); }
  function removeStep(idx: number) { const s = cond.steps.filter((_, i) => i !== idx); onChange({ ...cond, steps: s.length ? s : [''] }); }
  return (
    <ConditionRowShell type="journey" onRemove={onRemove}>
      {loading ? <span className="text-xs text-slate-400">Loading…</span> : (
        <div className="flex flex-wrap items-center gap-2">
          {cond.steps.map((step, idx) => (
            <React.Fragment key={idx}>
              <div className="flex items-center gap-1">
                <select value={step} onChange={(e) => updateStep(idx, e.target.value)}
                  className="appearance-none bg-teal-50 border border-teal-200 rounded-lg px-3 py-1.5 text-xs font-semibold text-teal-800 outline-none cursor-pointer hover:bg-teal-100 transition-colors">
                  <option value="">Pick screen…</option>
                  {screenOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <button onClick={() => removeStep(idx)} className="p-1 text-teal-300 hover:text-red-400 hover:bg-red-50 rounded transition-colors" title="Remove step">
                  <X className="w-3 h-3" />
                </button>
              </div>
              {idx < cond.steps.length - 1 && <ArrowRight className="w-4 h-4 text-teal-400 shrink-0" />}
            </React.Fragment>
          ))}
          <button onClick={() => onChange({ ...cond, steps: [...cond.steps, ''] })}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-teal-300 text-teal-600 text-xs font-semibold hover:bg-teal-50 transition-colors">
            <Plus className="w-3 h-3" /> Add step
          </button>
        </div>
      )}
    </ConditionRowShell>
  );
}

export function ConversionRow({ cond, onChange, onRemove }: { cond: ConversionCondition; onChange: (c: ConversionCondition) => void; onRemove: () => void }) {
  return (
    <ConditionRowShell type="conversion" onRemove={onRemove}>
      <div className="flex rounded-lg overflow-hidden border border-pink-200 text-xs font-semibold">
        {(['checkout_bounced', 'checkout_success'] as const).map((p) => (
          <button key={p} onClick={() => onChange({ ...cond, preset: p })}
            className={`px-3 py-1.5 transition-colors ${cond.preset === p ? 'bg-pink-500 text-white' : 'text-pink-700 hover:bg-pink-50'}`}>
            {p === 'checkout_bounced' ? '↩ Dropped off' : '✓ Completed'}
          </button>
        ))}
      </div>
      <span title={`⚠️ Heuristic only — works if your app uses these screen/event names:\n• Screens: checkout, cart, payment, confirmation, success, receipt, order\n• Events: checkout_started, purchase_completed, add_to_cart, order_placed\n\nFor custom funnels, use Screen Journey instead.`}
        className="cursor-help text-pink-300 hover:text-pink-500 transition-colors">
        <Info className="w-4 h-4" />
      </span>
    </ConditionRowShell>
  );
}
