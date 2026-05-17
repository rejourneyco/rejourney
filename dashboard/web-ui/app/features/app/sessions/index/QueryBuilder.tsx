import React, { useState, useRef, useEffect } from 'react';
import {
  Plus, ChevronDown, Loader, AlertOctagon, Calendar, LayoutGrid, Zap,
  Tag, Users, Route, GitMerge, Trash2, MousePointerClick,
  Timer, UserPlus, CheckCircle, AlertCircle, Search,
  MonitorSmartphone,
} from 'lucide-react';
import { buildSessionQueryFromPrompt } from '~/shared/api/client';
import {
  type QueryCondition, type QueryGroup, type ConditionType,
  type IssueCondition, type DateCondition, type ScreenCondition,
  type EventCondition, type MetadataCondition, type LifecycleCondition,
  type ConversionCondition, type PlatformCondition, type JourneyCondition,
  generateConditionId, generateGroupId,
  groupsBuildHumanSummary,
} from './queryBuilderTypes';
import {
  type AvailableFilters, IssueRow, DateRow, ScreenRow, EventRow,
  MetadataRow, LifecycleRow, PlatformRow, JourneyRow, ConversionRow,
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

// ── Add-rule menu ─────────────────────────────────────────────────────────────

const ADD_MENU: { type: ConditionType; label: string; desc: string; icon: React.ReactNode }[] = [
  { type: 'screen',    label: 'Screen visited',   desc: 'Visited a screen (+ bounce / count)', icon: <LayoutGrid className="w-4 h-4" /> },
  { type: 'journey',   label: 'Screen journey',   desc: 'Followed a path in order',            icon: <Route className="w-4 h-4" /> },
  { type: 'issue',     label: 'Issue type',        desc: 'Crashes, ANRs, rage taps…',           icon: <AlertOctagon className="w-4 h-4" /> },
  { type: 'event',     label: 'Event fired',       desc: 'Custom event with optional count',    icon: <Zap className="w-4 h-4" /> },
  { type: 'lifecycle', label: 'Lifecycle',         desc: 'First-time or returning users',       icon: <Users className="w-4 h-4" /> },
  { type: 'date',      label: 'Date / Time',       desc: 'When the session occurred',           icon: <Calendar className="w-4 h-4" /> },
  { type: 'metadata',  label: 'Metadata',          desc: 'Session metadata key=value',          icon: <Tag className="w-4 h-4" /> },
  { type: 'platform',  label: 'Platform',          desc: 'iOS, Android, or Web',                 icon: <MonitorSmartphone className="w-4 h-4" /> },
];

const BG: Record<ConditionType, string> = {
  screen: 'bg-violet-50 text-violet-700', journey: 'bg-teal-50 text-teal-700',
  issue: 'bg-[#f4f4f5] text-black', event: 'bg-[#dbeafe] text-black',
  lifecycle: 'bg-pink-50 text-pink-700', date: 'bg-sky-50 text-sky-700',
  metadata: 'bg-emerald-50 text-emerald-700', platform: 'bg-cyan-50 text-cyan-700',
  conversion: 'bg-pink-50 text-pink-700',
};

function AddRuleMenu({ onAdd, presentTypes }: { onAdd: (t: ConditionType) => void; presentTypes: Set<ConditionType> }) {
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
        className="flex items-center gap-1.5 border-2 border-dashed border-black bg-white px-3 py-1.5 text-xs font-black text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo">
        <Plus className="w-3.5 h-3.5" /> Add rule <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-50 w-72 overflow-hidden border-2 border-black bg-white shadow-neo">
          <div className="p-1.5">
            {ADD_MENU.map((item) => {
              const used = presentTypes.has(item.type) && item.type !== 'screen' && item.type !== 'event';
              return (
                <button key={item.type} disabled={used}
                  onClick={() => { if (!used) { onAdd(item.type); setOpen(false); } }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${used ? 'opacity-30 cursor-not-allowed' : 'hover:bg-[#ecfeff] cursor-pointer'}`}>
                  <div className={`border border-black p-2 ${BG[item.type]}`}>{item.icon}</div>
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{item.label}</div>
                    <div className="text-[11px] text-slate-400">{item.desc}</div>
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

function makeCondition(type: ConditionType, filters: AvailableFilters): QueryCondition {
  const id = generateConditionId();
  switch (type) {
    case 'issue':     return { id, type, issueFilter: 'crashes' };
    case 'date':      return { id, type, mode: 'range', timeRange: '7d' };
    case 'screen':    return { id, type, screenName: filters.screens[0] ?? '' };
    case 'event':     return { id, type, eventName: filters.events[0] ?? '' };
    case 'metadata':  return { id, type, metaKey: Object.keys(filters.metadata)[0] ?? '' };
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

  function addCond(type: ConditionType) {
    onChange({ ...group, conditions: [...group.conditions, makeCondition(type, filters)] });
  }
  function updateCond(id: string, updated: QueryCondition) {
    onChange({ ...group, conditions: group.conditions.map((c) => (c.id === id ? updated : c)) });
  }
  function removeCond(id: string) {
    onChange({ ...group, conditions: group.conditions.filter((c) => c.id !== id) });
  }

  return (
    <div className="border-2 border-black bg-[#f8fafc] shadow-neo-sm">
      {/* Group header */}
      <div className="flex items-center justify-between border-b-2 border-black bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <GitMerge className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-[11px] font-black text-slate-600 uppercase">
            {totalGroups > 1 ? `Group ${groupIndex + 1}` : 'Rules'}
          </span>
          {totalGroups > 1 && (
            <span className="border border-black bg-[#c4b5fd] px-1.5 py-0.5 text-[10px] font-black text-black">
              AND within group
            </span>
          )}
        </div>
        {totalGroups > 1 && (
          <button onClick={onRemove} className="border border-transparent p-1 text-slate-500 transition-colors hover:border-black hover:bg-[#fecaca] hover:text-black" title="Remove group">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Conditions */}
      <div className="p-3 space-y-2">
        {group.conditions.length === 0 && !loading && (
          <div className="text-center py-4 text-sm text-slate-400">
            Add a rule below to filter sessions
          </div>
        )}
        {loading && group.conditions.length === 0 && (
          <div className="flex items-center gap-2 py-4 justify-center text-sm text-slate-400">
            <Loader className="w-4 h-4 animate-spin" /> Loading filter options…
          </div>
        )}
        {group.conditions.map((cond, idx) => (
          <React.Fragment key={cond.id}>
            <ConditionRow cond={cond} onChange={(u) => updateCond(cond.id, u)} onRemove={() => removeCond(cond.id)} filters={filters} loading={loading} />
            {idx < group.conditions.length - 1 && (
              <div className="flex items-center gap-2 px-4">
                <div className="h-0.5 flex-1 bg-black/20" />
                <span className="border border-black bg-white px-2 py-0.5 text-[10px] font-black text-black">AND</span>
                <div className="h-0.5 flex-1 bg-black/20" />
              </div>
            )}
          </React.Fragment>
        ))}
        <div className="pt-1">
          <AddRuleMenu onAdd={addCond} presentTypes={presentTypes} />
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
    <div className="soft-border-scope space-y-4">
      <div className="border-2 border-black bg-white p-2.5 shadow-neo-sm sm:p-3">
        <div className="flex flex-col gap-2">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex items-center gap-2 text-xs font-black uppercase text-slate-600">
                  <Search className="h-3.5 w-3.5" />
                  AI query builder
                </div>
                <div className="mt-0.5 max-w-3xl text-[11px] font-medium text-slate-500">
                  This is an AI query builder that uses this project’s screens, pages, events, metadata, and setup.
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px] font-black uppercase text-slate-600">
                {isLoadingFilters ? (
                  <span className="border border-black bg-[#f8fafc] px-2 py-1">Loading project context</span>
                ) : (
                  <>
                    <span className="border border-black bg-[#f8fafc] px-2 py-1">{availableFilters.screens.length} screens/pages</span>
                    <span className="border border-black bg-[#f8fafc] px-2 py-1">{availableFilters.events.length} events</span>
                    <span className="border border-black bg-[#f8fafc] px-2 py-1">{Object.keys(availableFilters.metadata).length} metadata keys</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
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
                placeholder="Example: web sessions referred by www.google.com in the last 7 days"
                className="min-h-[44px] flex-1 resize-none border-2 border-black bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:ring-2 focus:ring-black placeholder:text-slate-500"
              />
              <button
                onClick={() => void handleBuildQuery()}
                disabled={!projectId || !trimmedPrompt || isBuilding}
                className="inline-flex items-center justify-center gap-2 border-2 border-black bg-black px-4 py-2 text-xs font-black uppercase text-white shadow-neo-sm transition-all hover:-translate-y-0.5 hover:shadow-neo disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-40"
              >
                {isBuilding ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Generate
              </button>
            </div>
            {totalConditions > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={clearQueries}
                  className="inline-flex items-center gap-1.5 border-2 border-black bg-white px-2.5 py-1.5 text-[10px] font-black uppercase text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#fecaca] hover:shadow-neo"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear query
                </button>
              </div>
            )}
            {builderError && (
              <div className="flex items-start gap-2 border-2 border-black bg-[#fecaca] px-3 py-2 text-xs font-bold text-black">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{builderError}</span>
              </div>
            )}
            {builderExplanation && !builderError && (
              <div className="flex items-start gap-2 border-2 border-black bg-[#86efac] px-3 py-2 text-xs font-bold text-black">
                <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{builderExplanation}</span>
              </div>
            )}
          </div>
        </div>
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
                <div className="h-0.5 flex-1 bg-black/20" />
                <div className="flex items-center gap-1.5 border-2 border-black bg-[#c4b5fd] px-3 py-1 shadow-neo-sm">
                  <span className="text-[11px] font-black text-black uppercase">OR</span>
                </div>
                <div className="h-0.5 flex-1 bg-black/20" />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Add OR group */}
      <button onClick={addGroup}
        className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-black bg-white px-3 py-3 text-xs font-black text-black shadow-neo-sm transition-all hover:-translate-y-0.5 hover:bg-[#ecfeff] hover:shadow-neo sm:w-auto sm:py-2">
        <Plus className="w-4 h-4" /> Add OR group
        <span className="text-[10px] font-semibold text-violet-400 ml-1">(match ANY group)</span>
      </button>

      {/* Summary */}
      {totalConditions > 0 && (
        <div className="flex items-start gap-2 border-2 border-black bg-[#f8fafc] px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-neo-sm">
          <CheckCircle className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
          <span className="font-medium">{summary}</span>
          {groups.length > 1 && (
            <span className="ml-auto shrink-0 border border-black bg-[#f9a8d4] px-1.5 py-0.5 text-[10px] font-black text-black">
              multi-group approx.
            </span>
          )}
        </div>
      )}

      {/* AI Suggestions removed from bottom as requested */}
    </div>
  );
}
