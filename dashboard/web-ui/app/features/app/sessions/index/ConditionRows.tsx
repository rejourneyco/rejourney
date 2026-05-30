import React from 'react';
import {
  X, AlertOctagon, Calendar, LayoutGrid, Zap, Tag, Users,
  Smartphone, ArrowRight, Plus, Info, Route, ChevronDown,
  MonitorSmartphone, Globe2, Megaphone,
} from 'lucide-react';
import {
  type IssueCondition, type DateCondition, type ScreenCondition,
  type EventCondition, type MetadataCondition, type LifecycleCondition,
  type ConversionCondition, type PlatformCondition, type JourneyCondition,
  type ReferralCondition, type UtmCondition, type UtmField,
  CONDITION_TYPE_META, UTM_FIELD_SHORT_LABELS, UTM_FIELD_META_KEYS,
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
        className={`appearance-none rounded-[6px] border border-slate-300 bg-white py-1.5 pl-3 pr-7 text-xs font-medium text-slate-800 shadow-sm outline-none transition cursor-pointer hover:border-blue-300 hover:bg-slate-50 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 ${className}`}
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
      className={`${width} rounded-[6px] border border-slate-300 bg-white px-2 py-1.5 text-center text-xs font-medium text-slate-800 shadow-sm outline-none transition hover:border-blue-300 hover:bg-slate-50 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20`}
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
  issue:      { icon: <AlertOctagon className="w-4 h-4" />, bg: 'bg-rose-50',    text: 'text-rose-600',    border: 'border-rose-100' },
  date:       { icon: <Calendar className="w-4 h-4" />,     bg: 'bg-sky-50',     text: 'text-sky-600',     border: 'border-sky-100' },
  screen:     { icon: <LayoutGrid className="w-4 h-4" />,   bg: 'bg-violet-50',  text: 'text-violet-600',  border: 'border-violet-100' },
  event:      { icon: <Zap className="w-4 h-4" />,          bg: 'bg-blue-50',    text: 'text-blue-600',    border: 'border-blue-100' },
  metadata:   { icon: <Tag className="w-4 h-4" />,          bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-100' },
  referral:   { icon: <Globe2 className="w-4 h-4" />,       bg: 'bg-cyan-50',    text: 'text-cyan-600',    border: 'border-cyan-100' },
  utm:        { icon: <Megaphone className="w-4 h-4" />,    bg: 'bg-amber-50',   text: 'text-amber-600',   border: 'border-amber-100' },
  lifecycle:  { icon: <Users className="w-4 h-4" />,        bg: 'bg-pink-50',    text: 'text-pink-600',    border: 'border-pink-100' },
  platform:   { icon: <Smartphone className="w-4 h-4" />,   bg: 'bg-indigo-50',  text: 'text-indigo-600',  border: 'border-indigo-100' },
  journey:    { icon: <Route className="w-4 h-4" />,        bg: 'bg-teal-50',    text: 'text-teal-600',    border: 'border-teal-100' },
  conversion: { icon: <Tag className="w-4 h-4" />,          bg: 'bg-pink-50',    text: 'text-pink-600',    border: 'border-pink-100' },
};

function uniqueValues(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function optionsWithCurrent(values: string[], current?: string): { value: string; label: string }[] {
  const allValues = uniqueValues([...values, current]);
  return [{ value: '', label: 'any value' }, ...allValues.map((value) => ({ value, label: value }))];
}

function metadataValues(filters: AvailableFilters, keys: string[]): string[] {
  return uniqueValues(keys.flatMap((key) => filters.metadata[key] ?? []));
}

export function ConditionRowShell({
  type, children, onRemove,
}: {
  type: string; children: React.ReactNode; onRemove: () => void;
}) {
  const c = TYPE_COLORS[type] ?? TYPE_COLORS.issue;
  const meta = CONDITION_TYPE_META[type as keyof typeof CONDITION_TYPE_META];
  const renderRemoveButton = () => (
    <button
      onClick={onRemove}
      className="shrink-0 rounded-[6px] border border-transparent p-1.5 text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
      title="Remove rule"
    >
      <X className="w-4 h-4" />
    </button>
  );

  return (
    <div className="flex flex-col gap-2 rounded-[8px] border border-slate-200 bg-white px-3 py-2 shadow-sm sm:flex-row sm:items-center">
      <div className="flex items-center justify-between gap-2 sm:w-36 sm:justify-start">
        <div className="flex items-center gap-2 shrink-0">
          <div className={`${c.bg} ${c.text} ${c.border} shrink-0 rounded-[6px] border p-1.5`}>{c.icon}</div>
          <span className="text-xs font-semibold text-slate-700">{meta?.label ?? type}</span>
        </div>
        <div className="sm:hidden">{renderRemoveButton()}</div>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">{children}</div>
      <div className="hidden sm:block">{renderRemoveButton()}</div>
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
          { value: 'crashes', label: 'Crashes' },
          { value: 'anrs', label: 'ANRs' },
          { value: 'errors', label: 'Errors' },
          { value: 'rage', label: 'Rage taps' },
          { value: 'dead_taps', label: 'Dead taps' },
          { value: 'slow_start', label: 'Slow start' },
          { value: 'slow_api', label: 'Slow API' },
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
      <div className="flex overflow-hidden rounded-[8px] border border-slate-200 bg-white text-xs font-semibold shadow-sm">
        {(['range', 'exact'] as const).map((m) => (
          <button key={m} onClick={() => onChange({ ...cond, mode: m })}
            className={`px-3 py-1.5 transition ${cond.mode === m ? 'bg-slate-950 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            {m === 'range' ? 'Range' : 'Exact date'}
          </button>
        ))}
      </div>
      {cond.mode === 'range' && (
        <Chip value={cond.timeRange ?? '7d'} onChange={(v) => onChange({ ...cond, timeRange: v as DateCondition['timeRange'] })} options={TIME_OPTS} />
      )}
      {cond.mode === 'exact' && (
        <input type="date" value={cond.date ?? ''} onChange={(e) => onChange({ ...cond, date: e.target.value })}
          className="rounded-[6px] border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
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
              placeholder="value" className="w-24 rounded-[6px] border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
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
              placeholder="value" className="w-28 rounded-[6px] border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
          )}
        </>
      )}
    </ConditionRowShell>
  );
}

export function ReferralRow({ cond, onChange, onRemove, filters, loading }: {
  cond: ReferralCondition; onChange: (c: ReferralCondition) => void; onRemove: () => void;
  filters: AvailableFilters; loading: boolean;
}) {
  const referralValues = metadataValues(filters, ['webReferral', 'webReferrerDomain', 'webAttributionSource']);
  const valOpts = optionsWithCurrent(referralValues, cond.referralValue);
  return (
    <ConditionRowShell type="referral" onRemove={onRemove}>
      <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800">Web only</span>
      {loading ? <span className="text-xs text-slate-400">Loading…</span> : (
        <>
          <span className="text-xs text-slate-400">from</span>
          {referralValues.length > 0 ? (
            <Chip value={cond.referralValue ?? ''} onChange={(v) => onChange({ ...cond, referralValue: v || undefined })} options={valOpts} />
          ) : (
            <input type="text" value={cond.referralValue ?? ''} onChange={(e) => onChange({ ...cond, referralValue: e.target.value || undefined })}
              placeholder="domain or source" className="w-36 rounded-[6px] border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
          )}
        </>
      )}
    </ConditionRowShell>
  );
}

const UTM_FIELD_OPTIONS = (Object.entries(UTM_FIELD_SHORT_LABELS) as Array<[UtmField, string]>)
  .map(([value, label]) => ({ value, label }));

const UTM_VALUE_KEYS: Record<UtmField, string[]> = {
  source: ['utm_source', 'webAttributionSource'],
  medium: ['utm_medium', 'webAttributionMedium'],
  campaign: ['utm_campaign', 'webAttributionCampaign'],
  campaignId: ['utm_id', 'webAttributionCampaignId'],
  term: ['utm_term', 'webAttributionTerm'],
  content: ['utm_content', 'webAttributionContent'],
  sourcePlatform: ['utm_source_platform', 'webAttributionSourcePlatform'],
};

export function UtmRow({ cond, onChange, onRemove, filters, loading }: {
  cond: UtmCondition; onChange: (c: UtmCondition) => void; onRemove: () => void;
  filters: AvailableFilters; loading: boolean;
}) {
  const metaKey = UTM_FIELD_META_KEYS[cond.field];
  const values = metadataValues(filters, UTM_VALUE_KEYS[cond.field] ?? [metaKey]);
  const valOpts = optionsWithCurrent(values, cond.value);
  return (
    <ConditionRowShell type="utm" onRemove={onRemove}>
      <span className="rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800">Web only</span>
      <Chip
        value={cond.field}
        onChange={(v) => onChange({ ...cond, field: v as UtmField, value: undefined })}
        options={UTM_FIELD_OPTIONS}
      />
      <span className="text-xs text-slate-400">=</span>
      {loading ? <span className="text-xs text-slate-400">Loading…</span> : values.length > 0 ? (
        <Chip value={cond.value ?? ''} onChange={(v) => onChange({ ...cond, value: v || undefined })} options={valOpts} />
    ) : (
      <input type="text" value={cond.value ?? ''} onChange={(e) => onChange({ ...cond, value: e.target.value || undefined })}
          placeholder="value" className="w-32 rounded-[6px] border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
      )}
    </ConditionRowShell>
  );
}

export function LifecycleRow({ cond, onChange, onRemove }: { cond: LifecycleCondition; onChange: (c: LifecycleCondition) => void; onRemove: () => void }) {
  return (
    <ConditionRowShell type="lifecycle" onRemove={onRemove}>
      <div className="flex overflow-hidden rounded-[8px] border border-slate-200 bg-white text-xs font-semibold shadow-sm">
        {(['early_user', 'returning_user'] as const).map((p) => (
          <button key={p} onClick={() => onChange({ ...cond, preset: p, returnedCountOp: undefined, returnedCountValue: undefined })}
            className={`px-3 py-1.5 transition ${cond.preset === p ? 'bg-slate-950 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            {p === 'early_user' ? 'Early user' : 'Returning'}
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
      <div className="flex overflow-hidden rounded-[8px] border border-slate-200 bg-white text-xs font-semibold shadow-sm">
        {(['ios', 'android', 'web'] as const).map((p) => (
          <button key={p} onClick={() => onChange({ ...cond, platform: p })}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 transition ${cond.platform === p ? 'bg-slate-950 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            {p === 'web' ? <MonitorSmartphone className="h-3.5 w-3.5" /> : <Smartphone className="h-3.5 w-3.5" />}
            {p === 'ios' ? 'iOS' : p === 'android' ? 'Android' : 'Web'}
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
                  className="appearance-none rounded-[6px] border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 shadow-sm outline-none transition cursor-pointer hover:border-blue-300 hover:bg-slate-50 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20">
                  <option value="">Pick screen…</option>
                  {screenOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <button onClick={() => removeStep(idx)} className="rounded-[6px] border border-transparent p-1 text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600" title="Remove step">
                  <X className="w-3 h-3" />
                </button>
              </div>
              {idx < cond.steps.length - 1 && <ArrowRight className="w-4 h-4 text-teal-400 shrink-0" />}
            </React.Fragment>
          ))}
          <button onClick={() => onChange({ ...cond, steps: [...cond.steps, ''] })}
            className="flex items-center gap-1 rounded-[6px] border border-dashed border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50">
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
      <div className="flex overflow-hidden rounded-[8px] border border-slate-200 bg-white text-xs font-semibold shadow-sm">
        {(['checkout_bounced', 'checkout_success'] as const).map((p) => (
          <button key={p} onClick={() => onChange({ ...cond, preset: p })}
            className={`px-3 py-1.5 transition ${cond.preset === p ? 'bg-slate-950 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
            {p === 'checkout_bounced' ? 'Dropped off' : 'Completed'}
          </button>
        ))}
      </div>
      <span title={`Heuristic only - works if your app uses these screen/event names:\n- Screens: checkout, cart, payment, confirmation, success, receipt, order\n- Events: checkout_started, purchase_completed, add_to_cart, order_placed\n\nFor custom funnels, use Screen Journey instead.`}
        className="cursor-help text-pink-300 hover:text-pink-500 transition-colors">
        <Info className="w-4 h-4" />
      </span>
    </ConditionRowShell>
  );
}
