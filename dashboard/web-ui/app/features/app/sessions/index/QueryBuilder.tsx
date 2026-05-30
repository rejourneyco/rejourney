import React, { useState, useRef, useEffect } from 'react';
import {
  Plus, ChevronDown, Loader, AlertOctagon, Calendar, LayoutGrid, Zap,
  Tag, Users, Route, GitMerge, Trash2, MousePointerClick,
  Timer, UserPlus, CheckCircle, AlertCircle, Search,
  MonitorSmartphone, Globe2, Megaphone,
} from 'lucide-react';
import { buildSessionQueryFromPrompt } from '~/shared/api/client';
import {
  type QueryCondition, type QueryGroup, type ConditionType,
  type IssueCondition, type DateCondition, type ScreenCondition,
  type EventCondition, type MetadataCondition, type LifecycleCondition,
  type ConversionCondition, type PlatformCondition, type JourneyCondition,
  type ReferralCondition, type UtmCondition, type UtmField,
  generateConditionId, generateGroupId,
  groupsBuildHumanSummary, UTM_FIELD_META_KEYS,
} from './queryBuilderTypes';
import {
  type AvailableFilters, IssueRow, DateRow, ScreenRow, EventRow,
  MetadataRow, ReferralRow, UtmRow, LifecycleRow, PlatformRow, JourneyRow, ConversionRow,
} from './ConditionRows';

export type { AvailableFilters };

interface QueryBuilderProps {
  groups: QueryGroup[];
  onGroupsChange: (groups: QueryGroup[]) => void;
  onClearQueries: () => void;
  availableFilters: AvailableFilters;
  isLoadingFilters: boolean;
  projectId?: string;
}

type AddRuleInit = {
  utmField?: UtmField;
};

// ── Add-rule menu ─────────────────────────────────────────────────────────────

const ADD_MENU: { type: ConditionType; label: string; desc: string; icon: React.ReactNode }[] = [
  { type: 'screen',    label: 'Screen visited',   desc: 'Visited a screen (+ bounce / count)', icon: <LayoutGrid className="w-4 h-4" /> },
  { type: 'journey',   label: 'Screen journey',   desc: 'Followed a path in order',            icon: <Route className="w-4 h-4" /> },
  { type: 'issue',     label: 'Issue type',        desc: 'Crashes, ANRs, rage taps…',           icon: <AlertOctagon className="w-4 h-4" /> },
  { type: 'event',     label: 'Event fired',       desc: 'Custom event with optional count',    icon: <Zap className="w-4 h-4" /> },
  { type: 'lifecycle', label: 'Lifecycle',         desc: 'First-time or returning users',       icon: <Users className="w-4 h-4" /> },
  { type: 'date',      label: 'Date / Time',       desc: 'When the session occurred',           icon: <Calendar className="w-4 h-4" /> },
  { type: 'referral',  label: 'Referral',          desc: 'Web sessions by referrer/source',     icon: <Globe2 className="w-4 h-4" /> },
  { type: 'utm',       label: 'UTM',               desc: 'Web sessions by campaign tags',       icon: <Megaphone className="w-4 h-4" /> },
  { type: 'metadata',  label: 'Metadata',          desc: 'Session metadata key=value',          icon: <Tag className="w-4 h-4" /> },
  { type: 'platform',  label: 'Platform',          desc: 'iOS, Android, or Web',                 icon: <MonitorSmartphone className="w-4 h-4" /> },
];

const UTM_ADD_FIELD_ORDER: UtmField[] = ['source', 'medium', 'campaign', 'term', 'content', 'campaignId', 'sourcePlatform'];

const BG: Record<ConditionType, string> = {
  screen: 'bg-violet-50 text-violet-700', journey: 'bg-teal-50 text-teal-700',
  issue: 'bg-rose-50 text-rose-700', event: 'bg-blue-50 text-blue-700',
  lifecycle: 'bg-pink-50 text-pink-700', date: 'bg-sky-50 text-sky-700',
  referral: 'bg-cyan-50 text-cyan-700', utm: 'bg-amber-50 text-amber-700',
  metadata: 'bg-emerald-50 text-emerald-700', platform: 'bg-cyan-50 text-cyan-700',
  conversion: 'bg-pink-50 text-pink-700',
};

function AddRuleMenu({
  onAdd,
  presentTypes,
  presentUtmFields,
}: {
  onAdd: (type: ConditionType, init?: AddRuleInit) => void;
  presentTypes: Set<ConditionType>;
  presentUtmFields: Set<UtmField>;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-dashed border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-blue-500/20">
        <Plus className="w-3.5 h-3.5" /> Add rule <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-xl shadow-slate-900/10">
          <div className="p-2">
            {ADD_MENU.map((item) => {
              const firstAvailableUtmField = UTM_ADD_FIELD_ORDER.find((field) => !presentUtmFields.has(field)) ?? 'source';
              const used = item.type === 'utm'
                ? UTM_ADD_FIELD_ORDER.every((field) => presentUtmFields.has(field))
                : presentTypes.has(item.type) && item.type !== 'screen' && item.type !== 'event';
              return (
                <button key={item.type} disabled={used}
                  onClick={() => {
                    if (!used) {
                      onAdd(item.type, item.type === 'utm' ? { utmField: firstAvailableUtmField } : undefined);
                      setOpen(false);
                    }
                  }}
                  className={`flex w-full items-center gap-3 rounded-[6px] px-3 py-2.5 text-left transition ${used ? 'cursor-not-allowed opacity-35' : 'cursor-pointer hover:bg-slate-50'}`}>
                  <div className={`rounded-[6px] border border-slate-200 p-2 ${BG[item.type]}`}>{item.icon}</div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{item.label}</div>
                    <div className="mt-0.5 text-[11px] leading-4 text-slate-500">{item.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Default conditions ────────────────────────────────────────────────────────

function makeCondition(type: ConditionType, filters: AvailableFilters, init: AddRuleInit = {}): QueryCondition {
  const id = generateConditionId();
  switch (type) {
    case 'issue':     return { id, type, issueFilter: 'crashes' };
    case 'date':      return { id, type, mode: 'range', timeRange: '7d' };
    case 'screen':    return { id, type, screenName: filters.screens[0] ?? '' };
    case 'event':     return { id, type, eventName: filters.events[0] ?? '' };
    case 'metadata':  return { id, type, metaKey: Object.keys(filters.metadata)[0] ?? '' };
    case 'referral':  return { id, type, referralValue: filters.metadata.webReferral?.[0] ?? filters.metadata.webReferrerDomain?.[0] ?? filters.metadata.webAttributionSource?.[0] ?? '' };
    case 'utm': {
      const field = init.utmField ?? (Object.keys(UTM_FIELD_META_KEYS) as UtmField[])
        .find((candidate) => (filters.metadata[UTM_FIELD_META_KEYS[candidate]] ?? []).length > 0) ?? 'source';
      return { id, type, field, value: filters.metadata[UTM_FIELD_META_KEYS[field]]?.[0] ?? '' };
    }
    case 'lifecycle': return { id, type, preset: 'returning_user', sessionWindowSize: 5 };
    case 'conversion':return { id, type, preset: 'checkout_bounced' };
    case 'platform':  return { id, type, platform: 'ios' };
    case 'journey':   return { id, type, steps: ['', ''] };
  }
}

// ── Condition row dispatcher ──────────────────────────────────────────────────

function ConditionRow({ cond, onChange, onRemove, filters, loading }: {
  cond: QueryCondition; onChange: (c: QueryCondition) => void; onRemove: () => void;
  filters: AvailableFilters; loading: boolean;
}) {
  switch (cond.type) {
    case 'issue':      return <IssueRow cond={cond} onChange={onChange as (c: IssueCondition) => void} onRemove={onRemove} />;
    case 'date':       return <DateRow cond={cond} onChange={onChange as (c: DateCondition) => void} onRemove={onRemove} />;
    case 'screen':     return <ScreenRow cond={cond} onChange={onChange as (c: ScreenCondition) => void} onRemove={onRemove} filters={filters} loading={loading} />;
    case 'event':      return <EventRow cond={cond} onChange={onChange as (c: EventCondition) => void} onRemove={onRemove} filters={filters} loading={loading} />;
    case 'metadata':   return <MetadataRow cond={cond} onChange={onChange as (c: MetadataCondition) => void} onRemove={onRemove} filters={filters} loading={loading} />;
    case 'referral':   return <ReferralRow cond={cond} onChange={onChange as (c: ReferralCondition) => void} onRemove={onRemove} filters={filters} loading={loading} />;
    case 'utm':        return <UtmRow cond={cond} onChange={onChange as (c: UtmCondition) => void} onRemove={onRemove} filters={filters} loading={loading} />;
    case 'lifecycle':  return <LifecycleRow cond={cond} onChange={onChange as (c: LifecycleCondition) => void} onRemove={onRemove} />;
    case 'conversion': return <ConversionRow cond={cond} onChange={onChange as (c: ConversionCondition) => void} onRemove={onRemove} />;
    case 'platform':   return <PlatformRow cond={cond} onChange={onChange as (c: PlatformCondition) => void} onRemove={onRemove} />;
    case 'journey':    return <JourneyRow cond={cond} onChange={onChange as (c: JourneyCondition) => void} onRemove={onRemove} filters={filters} loading={loading} />;
  }
}

// ── Group card ────────────────────────────────────────────────────────────────

function GroupCard({ group, groupIndex, totalGroups, onChange, onRemove, filters, loading }: {
  group: QueryGroup; groupIndex: number; totalGroups: number;
  onChange: (g: QueryGroup) => void; onRemove: () => void;
  filters: AvailableFilters; loading: boolean;
}) {
  const presentTypes = new Set(group.conditions.map((c) => c.type));
  const presentUtmFields = new Set(
    group.conditions
      .filter((condition): condition is UtmCondition => condition.type === 'utm')
      .map((condition) => condition.field),
  );

  function addCond(type: ConditionType, init?: AddRuleInit) {
    onChange({ ...group, conditions: [...group.conditions, makeCondition(type, filters, init)] });
  }
  function updateCond(id: string, updated: QueryCondition) {
    onChange({ ...group, conditions: group.conditions.map((c) => (c.id === id ? updated : c)) });
  }
  function removeCond(id: string) {
    onChange({ ...group, conditions: group.conditions.filter((c) => c.id !== id) });
  }

  return (
    <div className="rounded-[8px] border border-slate-200 bg-white shadow-sm">
      {/* Group header */}
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-3 py-2">
        <div className="flex items-center gap-2">
          <GitMerge className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs font-semibold text-slate-700">
            {totalGroups > 1 ? `Group ${groupIndex + 1}` : 'Rules'}
          </span>
          {totalGroups > 1 && (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
              AND within group
            </span>
          )}
        </div>
        {totalGroups > 1 && (
          <button onClick={onRemove} className="rounded-[6px] border border-transparent p-1.5 text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600" title="Remove group">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Conditions */}
      <div className="space-y-2 p-2.5">
        {group.conditions.length === 0 && !loading && (
          <div className="rounded-[8px] border border-dashed border-slate-200 bg-slate-50 py-3 text-center text-sm text-slate-500">
            Add a rule below to filter sessions
          </div>
        )}
        {loading && group.conditions.length === 0 && (
          <div className="flex items-center justify-center gap-2 rounded-[8px] border border-dashed border-slate-200 bg-slate-50 py-3 text-sm text-slate-500">
            <Loader className="w-4 h-4 animate-spin" /> Loading filter options…
          </div>
        )}
        {group.conditions.map((cond, idx) => (
          <React.Fragment key={cond.id}>
            <ConditionRow cond={cond} onChange={(u) => updateCond(cond.id, u)} onRemove={() => removeCond(cond.id)} filters={filters} loading={loading} />
            {idx < group.conditions.length - 1 && (
              <div className="flex items-center gap-2 px-4">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">AND</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            )}
          </React.Fragment>
        ))}
        <div className="pt-1">
          <AddRuleMenu onAdd={addCond} presentTypes={presentTypes} presentUtmFields={presentUtmFields} />
        </div>
      </div>
    </div>
  );
}

// AI Builder Suggestions were here - removed as requested.


// ── Main QueryBuilder ─────────────────────────────────────────────────────────

export function QueryBuilder({ groups, onGroupsChange, onClearQueries, availableFilters, isLoadingFilters, projectId }: QueryBuilderProps) {
  const [prompt, setPrompt] = useState('');
  const [isBuilding, setIsBuilding] = useState(false);
  const [builderError, setBuilderError] = useState<string | null>(null);
  const [builderExplanation, setBuilderExplanation] = useState<string | null>(null);

  function updateGroup(id: string, updated: QueryGroup) {
    onGroupsChange(groups.map((g) => (g.id === id ? updated : g)));
  }
  function removeGroup(id: string) {
    const next = groups.filter((g) => g.id !== id);
    onGroupsChange(next.length ? next : [{ id: generateGroupId(), conditions: [] }]);
  }
  function addGroup() {
    onGroupsChange([...groups, { id: generateGroupId(), conditions: [] }]);
  }
  function clearQueries() {
    if (totalConditions > 0 && typeof window !== 'undefined' && !window.confirm('Clear all query rules?')) {
      return;
    }
    setPrompt('');
    setBuilderError(null);
    setBuilderExplanation(null);
    onClearQueries();
  }

  const totalConditions = groups.reduce((n, g) => n + g.conditions.length, 0);
  const summary = groupsBuildHumanSummary(groups);
  const trimmedPrompt = prompt.trim();

  async function handleBuildQuery() {
    if (!projectId || !trimmedPrompt || isBuilding) return;
    setIsBuilding(true);
    setBuilderError(null);
    setBuilderExplanation(null);
    try {
      const result = await buildSessionQueryFromPrompt(projectId, trimmedPrompt);
      const nextGroups = result.groups?.length ? result.groups as QueryGroup[] : [{ id: generateGroupId(), conditions: [] }];
      onGroupsChange(nextGroups);
      setBuilderExplanation(result.explanation || 'Built a query from your description.');
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Could not build a query from that description.');
    } finally {
      setIsBuilding(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-[8px] border border-slate-200 bg-white p-2.5 shadow-sm">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="flex min-w-0 items-center gap-2 xl:w-56">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-slate-950 text-white">
              <Search className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-950">AI query builder</div>
              <div className="flex flex-wrap gap-1 text-[10px] font-semibold text-slate-500">
                {isLoadingFilters ? (
                  <span>Loading context</span>
                ) : (
                  <span>{availableFilters.screens.length} screens · {availableFilters.events.length} events · {Object.keys(availableFilters.metadata).length} keys</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
            <textarea
              value={prompt}
              onChange={(event) => {
                setPrompt(event.target.value);
                setBuilderError(null);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void handleBuildQuery();
                }
              }}
              maxLength={500}
              rows={1}
              placeholder="web sessions referred by www.google.com in the last 7 days"
              className="min-h-10 flex-1 resize-none rounded-[8px] border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            />
            <button
              onClick={() => void handleBuildQuery()}
              disabled={!projectId || !trimmedPrompt || isBuilding}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[8px] border border-slate-950 bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300 sm:w-36"
            >
              {isBuilding ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Generate
            </button>
          </div>
          {totalConditions > 0 && (
            <button
              onClick={clearQueries}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 xl:ml-1"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>
        {(builderError || (builderExplanation && !builderError)) && (
          <div className="mt-2">
          {builderError && (
            <div className="flex items-start gap-2 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{builderError}</span>
            </div>
          )}
          {builderExplanation && !builderError && (
            <div className="flex items-start gap-2 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{builderExplanation}</span>
            </div>
          )}
          </div>
        )}
      </div>

      {/* Groups */}
      <div className="space-y-3">
        {groups.map((group, idx) => (
          <React.Fragment key={group.id}>
            <GroupCard
              group={group} groupIndex={idx} totalGroups={groups.length}
              onChange={(g) => updateGroup(group.id, g)}
              onRemove={() => removeGroup(group.id)}
              filters={availableFilters} loading={isLoadingFilters}
            />
            {idx < groups.length - 1 && (
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <div className="flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1">
                  <span className="text-[11px] font-semibold text-violet-700">OR</span>
                </div>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Add OR group */}
      <button onClick={addGroup}
        className="flex w-full items-center justify-center gap-2 rounded-[8px] border border-dashed border-slate-300 bg-white px-3 py-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 sm:w-auto sm:py-2">
        <Plus className="w-4 h-4" /> Add OR group
      </button>

      {/* Summary */}
      {totalConditions > 0 && (
        <div className="flex items-start gap-2 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-medium text-slate-700 shadow-sm">
          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
          <span className="font-medium">{summary}</span>
          {groups.length > 1 && (
            <span className="ml-auto shrink-0 rounded-full border border-pink-200 bg-pink-50 px-2 py-0.5 text-[10px] font-semibold text-pink-700">
              multi-group approx.
            </span>
          )}
        </div>
      )}

      {/* AI Suggestions removed from bottom as requested */}
    </div>
  );
}
