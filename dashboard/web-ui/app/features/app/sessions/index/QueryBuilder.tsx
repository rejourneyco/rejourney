import React, { useState, useRef, useEffect } from 'react';
import {
  Plus, ChevronDown, Loader, AlertOctagon, Calendar, LayoutGrid, Zap,
  Tag, Users, Route, GitMerge, Trash2, MousePointerClick,
  Timer, UserPlus, CheckCircle, AlertCircle, Search, Bot,
  MonitorSmartphone, Globe2, Megaphone, ScanEye, MapPin,
} from 'lucide-react';
import { buildSessionQueryFromPrompt, type SmartCaptureRule } from '~/shared/api/client';
import { dashboardButtonClass, dashboardCardClass, dashboardChipClass } from '~/shared/ui/core/dashboardStyles';
import {
  type QueryCondition, type QueryGroup, type ConditionType,
  type IssueCondition, type DateCondition, type ScreenCondition,
  type EventCondition, type MetadataCondition, type LifecycleCondition,
  type ConversionCondition, type PlatformCondition, type JourneyCondition,
  type ReferralCondition, type UtmCondition, type UtmField, type SmartCaptureCondition,
  type LocationCondition,
  generateConditionId, generateGroupId,
  groupsBuildHumanSummary, UTM_FIELD_META_KEYS,
} from './queryBuilderTypes';
import {
  type AvailableFilters, IssueRow, DateRow, ScreenRow, EventRow,
  MetadataRow, LocationRow, ReferralRow, UtmRow, LifecycleRow, PlatformRow, JourneyRow, ConversionRow, SmartCaptureRow,
} from './ConditionRows';

export type { AvailableFilters };

interface QueryBuilderProps {
  groups: QueryGroup[];
  onGroupsChange: (groups: QueryGroup[]) => void;
  onClearQueries: () => void;
  onSearchQuery?: (value: string) => void;
  availableFilters: AvailableFilters;
  isLoadingFilters: boolean;
  projectId?: string;
  smartCaptureRules?: SmartCaptureRule[];
  loadLocationOptions?: (
    kind: 'country' | 'city',
    search: string,
    country?: string,
  ) => Promise<Array<{ country?: string; city?: string }>>;
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
  { type: 'date',      label: 'Date / time',       desc: 'When the session occurred',           icon: <Calendar className="w-4 h-4" /> },
  { type: 'location',  label: 'Location',          desc: 'Country, city, or a precise match',    icon: <MapPin className="w-4 h-4" /> },
  { type: 'referral',  label: 'Referral',          desc: 'Web sessions by referrer/source',     icon: <Globe2 className="w-4 h-4" /> },
  { type: 'utm',       label: 'UTM',               desc: 'Web sessions by campaign tags',       icon: <Megaphone className="w-4 h-4" /> },
  { type: 'smart_capture', label: 'Smart Capture', desc: 'Captured by a custom rule',           icon: <ScanEye className="w-4 h-4" /> },
  { type: 'metadata',  label: 'Metadata',          desc: 'Session metadata key=value',          icon: <Tag className="w-4 h-4" /> },
  { type: 'platform',  label: 'Platform',          desc: 'iOS, Android, or Web',                 icon: <MonitorSmartphone className="w-4 h-4" /> },
];

const UTM_ADD_FIELD_ORDER: UtmField[] = ['source', 'medium', 'campaign', 'term', 'content', 'campaignId', 'sourcePlatform'];

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
        className={dashboardButtonClass('secondary', 'sm')}>
        <Plus className="w-3.5 h-3.5" /> Add rule <ChevronDown className="w-3 h-3 text-[#5f6368]" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 overflow-hidden rounded-none border border-[#dadce0] bg-white shadow-[0_4px_16px_rgba(60,64,67,0.2)]">
          <div className="p-1">
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
                  className={`flex w-full items-center gap-3 rounded-none px-3 py-2 text-left transition-colors ${used ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-[#f1f3f4]'}`}>
                  <div className="shrink-0 bg-[#f1f3f4] p-2 text-[#5f6368]">{item.icon}</div>
                  <div>
                    <div className="text-sm font-medium text-[#202124]">{item.label}</div>
                    <div className="mt-0.5 text-[11px] leading-4 text-[#5f6368]">{item.desc}</div>
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

function makeCondition(type: ConditionType, filters: AvailableFilters, init: AddRuleInit = {}, smartCaptureRules: SmartCaptureRule[] = []): QueryCondition {
  const id = generateConditionId();
  switch (type) {
    case 'issue':     return { id, type, issueFilter: 'crashes' };
    case 'date':      return { id, type, mode: 'range', timeRange: '7d' };
    case 'screen':    return { id, type, screenName: filters.screens[0] ?? '' };
    case 'event':     return { id, type, eventName: filters.events[0] ?? '' };
    case 'metadata':  return { id, type, metaKey: Object.keys(filters.metadata)[0] ?? '' };
    case 'location':  return { id, type, mode: 'country' };
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
    case 'smart_capture': return {
      id,
      type,
      status: 'kept',
      ruleId: smartCaptureRules[0]?.id,
      ruleName: smartCaptureRules[0] ? (smartCaptureRules[0].name ?? smartCaptureRules[0].label) : undefined,
    };
  }
}

// ── Condition row dispatcher ──────────────────────────────────────────────────

function ConditionRow({ cond, onChange, onRemove, filters, loading, smartCaptureRules, loadLocationOptions }: {
  cond: QueryCondition; onChange: (c: QueryCondition) => void; onRemove: () => void;
  filters: AvailableFilters; loading: boolean;
  smartCaptureRules: SmartCaptureRule[];
  loadLocationOptions?: QueryBuilderProps['loadLocationOptions'];
}) {
  switch (cond.type) {
    case 'issue':      return <IssueRow cond={cond} onChange={onChange as (c: IssueCondition) => void} onRemove={onRemove} />;
    case 'date':       return <DateRow cond={cond} onChange={onChange as (c: DateCondition) => void} onRemove={onRemove} />;
    case 'screen':     return <ScreenRow cond={cond} onChange={onChange as (c: ScreenCondition) => void} onRemove={onRemove} filters={filters} loading={loading} />;
    case 'event':      return <EventRow cond={cond} onChange={onChange as (c: EventCondition) => void} onRemove={onRemove} filters={filters} loading={loading} />;
    case 'metadata':   return <MetadataRow cond={cond} onChange={onChange as (c: MetadataCondition) => void} onRemove={onRemove} filters={filters} loading={loading} />;
    case 'location':   return <LocationRow cond={cond} onChange={onChange as (c: LocationCondition) => void} onRemove={onRemove} filters={filters} loading={loading} loadLocationOptions={loadLocationOptions} />;
    case 'referral':   return <ReferralRow cond={cond} onChange={onChange as (c: ReferralCondition) => void} onRemove={onRemove} filters={filters} loading={loading} />;
    case 'utm':        return <UtmRow cond={cond} onChange={onChange as (c: UtmCondition) => void} onRemove={onRemove} filters={filters} loading={loading} />;
    case 'lifecycle':  return <LifecycleRow cond={cond} onChange={onChange as (c: LifecycleCondition) => void} onRemove={onRemove} />;
    case 'conversion': return <ConversionRow cond={cond} onChange={onChange as (c: ConversionCondition) => void} onRemove={onRemove} />;
    case 'platform':   return <PlatformRow cond={cond} onChange={onChange as (c: PlatformCondition) => void} onRemove={onRemove} />;
    case 'journey':    return <JourneyRow cond={cond} onChange={onChange as (c: JourneyCondition) => void} onRemove={onRemove} filters={filters} loading={loading} />;
    case 'smart_capture': return <SmartCaptureRow cond={cond} onChange={onChange as (c: SmartCaptureCondition) => void} onRemove={onRemove} smartCaptureRules={smartCaptureRules} />;
  }
}

// ── Group card ────────────────────────────────────────────────────────────────

function GroupCard({ group, groupIndex, totalGroups, onChange, onRemove, filters, loading, smartCaptureRules, loadLocationOptions }: {
  group: QueryGroup; groupIndex: number; totalGroups: number;
  onChange: (g: QueryGroup) => void; onRemove: () => void;
  filters: AvailableFilters; loading: boolean;
  smartCaptureRules: SmartCaptureRule[];
  loadLocationOptions?: QueryBuilderProps['loadLocationOptions'];
}) {
  const presentTypes = new Set(group.conditions.map((c) => c.type));
  const presentUtmFields = new Set(
    group.conditions
      .filter((condition): condition is UtmCondition => condition.type === 'utm')
      .map((condition) => condition.field),
  );

  function addCond(type: ConditionType, init?: AddRuleInit) {
    onChange({ ...group, conditions: [...group.conditions, makeCondition(type, filters, init, smartCaptureRules)] });
  }
  function updateCond(id: string, updated: QueryCondition) {
    onChange({ ...group, conditions: group.conditions.map((c) => (c.id === id ? updated : c)) });
  }
  function removeCond(id: string) {
    onChange({ ...group, conditions: group.conditions.filter((c) => c.id !== id) });
  }

  return (
    <div className={dashboardCardClass}>
      {/* Group header */}
      <div className="flex items-center justify-between border-b border-[#e8eaed] bg-[#f8fafd] px-3 py-2">
        <div className="flex items-center gap-2">
          <GitMerge className="w-3.5 h-3.5 text-[#5f6368]" />
          <span className="text-[13px] font-medium text-[#202124]">
            {totalGroups > 1 ? `Group ${groupIndex + 1}` : 'Rules'}
          </span>
          {totalGroups > 1 && (
            <span className={dashboardChipClass('neutral')}>
              AND within group
            </span>
          )}
        </div>
        {totalGroups > 1 && (
          <button onClick={onRemove} className="rounded-none p-1.5 text-[#5f6368] transition-colors hover:bg-[#fce8e6] hover:text-[#d93025]" title="Remove group">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Conditions */}
      <div className="space-y-2 p-2.5">
        {group.conditions.length === 0 && !loading && (
          <div className="rounded-none border border-dashed border-[#dadce0] bg-[#f8fafd] py-3 text-center text-sm text-[#5f6368]">
            Add a rule below to filter sessions
          </div>
        )}
        {loading && group.conditions.length === 0 && (
          <div className="flex items-center justify-center gap-2 rounded-none border border-dashed border-[#dadce0] bg-[#f8fafd] py-3 text-sm text-[#5f6368]">
            <Loader className="w-4 h-4 animate-spin" /> Loading filter options…
          </div>
        )}
        {group.conditions.map((cond, idx) => (
          <React.Fragment key={cond.id}>
            <ConditionRow cond={cond} onChange={(u) => updateCond(cond.id, u)} onRemove={() => removeCond(cond.id)} filters={filters} loading={loading} smartCaptureRules={smartCaptureRules} loadLocationOptions={loadLocationOptions} />
            {idx < group.conditions.length - 1 && (
              <div className="flex items-center gap-2 px-4">
                <div className="h-px flex-1 bg-[#e8eaed]" />
                <span className="border border-[#dadce0] bg-white px-2 py-0.5 text-[11px] font-medium text-[#5f6368]">AND</span>
                <div className="h-px flex-1 bg-[#e8eaed]" />
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


// ── Main QueryBuilder ─────────────────────────────────────────────────────────

export function QueryBuilder({
  groups,
  onGroupsChange,
  onClearQueries,
  onSearchQuery,
  availableFilters,
  isLoadingFilters,
  projectId,
  smartCaptureRules = [],
  loadLocationOptions,
}: QueryBuilderProps) {
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
      if (result.searchQuery !== undefined) onSearchQuery?.(result.searchQuery);
      setBuilderExplanation(result.explanation || 'Built a query from your description.');
    } catch (err) {
      setBuilderError(err instanceof Error ? err.message : 'Could not build a query from that description.');
    } finally {
      setIsBuilding(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className={`${dashboardCardClass} p-2.5`}>
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="flex min-w-0 items-center gap-2 xl:w-56">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#e8f0fe] text-[#1967d2]">
              <Bot className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-[#202124]">AI query builder</div>
              <div className="flex flex-wrap gap-1 text-[11px] tabular-nums text-[#5f6368]">
                {isLoadingFilters ? (
                  <span>Loading context</span>
                ) : (
                  <span>{availableFilters.screens.length} screens · {availableFilters.events.length} events · {availableFilters.locations?.length ?? 0} locations</span>
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
              placeholder="sessions in Austin, US with crashes in the last 7 days"
              className="min-h-10 flex-1 resize-none rounded-none border border-[#dadce0] bg-white px-3 py-2 text-sm text-[#202124] outline-none transition-colors placeholder:text-[#80868b] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20"
            />
            <button
              onClick={() => void handleBuildQuery()}
              disabled={!projectId || !trimmedPrompt || isBuilding}
              className={`${dashboardButtonClass('primary', 'lg')} sm:w-36`}
            >
              {isBuilding ? <Loader className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Generate
            </button>
          </div>
          {totalConditions > 0 && (
            <button
              onClick={clearQueries}
              className={`${dashboardButtonClass('secondary', 'lg')} xl:ml-1`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear
            </button>
          )}
        </div>
        {(builderError || (builderExplanation && !builderError)) && (
          <div className="mt-2">
          {builderError && (
            <div className="flex items-start gap-2 rounded-none border border-[#f6aea9] bg-[#fce8e6] px-3 py-2 text-sm text-[#a50e0e]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{builderError}</span>
            </div>
          )}
          {builderExplanation && !builderError && (
            <div className="flex items-start gap-2 rounded-none border border-[#ceead6] bg-[#e6f4ea] px-3 py-2 text-sm text-[#137333]">
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
              smartCaptureRules={smartCaptureRules}
              loadLocationOptions={loadLocationOptions}
            />
            {idx < groups.length - 1 && (
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-[#dadce0]" />
                <span className="border border-[#dadce0] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#5f6368]">OR</span>
                <div className="h-px flex-1 bg-[#dadce0]" />
              </div>
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Add OR group */}
      <button onClick={addGroup}
        className={`${dashboardButtonClass('secondary', 'md')} w-full sm:w-auto`}>
        <Plus className="w-4 h-4" /> Add OR group
      </button>

      {/* Summary */}
      {totalConditions > 0 && (
        <div className="flex items-start gap-2 rounded-none border border-[#dadce0] bg-white px-4 py-3 text-xs text-[#3c4043]">
          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5f6368]" />
          <span>{summary}</span>
          {groups.length > 1 && (
            <span className={`${dashboardChipClass('info')} ml-auto shrink-0`}>
              Multi-group approx.
            </span>
          )}
        </div>
      )}

    </div>
  );
}
