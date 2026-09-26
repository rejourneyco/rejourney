import React from 'react';
import {
  X, AlertOctagon, Calendar, LayoutGrid, Zap, Tag, Users,
  Smartphone, ArrowRight, Plus, Info, Route, ChevronDown,
  MonitorSmartphone, Globe2, Megaphone, ScanEye, MapPin,
} from 'lucide-react';
import type { SmartCaptureRule } from '~/shared/api/client';
import { formatCountryDisplayName } from '~/shared/lib/geoDisplay';
import { dashboardButtonClass, dashboardChipClass, dashboardSelectedClass } from '~/shared/ui/core/dashboardStyles';
import {
  type IssueCondition, type DateCondition, type ScreenCondition,
  type EventCondition, type MetadataCondition, type LifecycleCondition,
  type ConversionCondition, type PlatformCondition, type JourneyCondition,
  type ReferralCondition, type UtmCondition, type UtmField, type SmartCaptureCondition, type LocationCondition,
  CONDITION_TYPE_META, UTM_FIELD_SHORT_LABELS, UTM_FIELD_META_KEYS,
} from './queryBuilderTypes';

export interface AvailableFilters {
  events: string[];
  eventPropertyKeys: string[];
  screens: string[];
  metadata: Record<string, string[]>;
  locations: Array<{ country?: string; city?: string }>;
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Compact square field used by every rule control (selects, text and number inputs). */
const FIELD_CLASS = 'h-8 rounded-none border border-[#dadce0] bg-white text-xs font-medium text-[#202124] outline-none transition-colors placeholder:text-[#80868b] hover:bg-[#f8fafd] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20';

/** Segmented control, matching the platform lens filter. */
const SEGMENT_GROUP_CLASS = 'inline-flex gap-0.5 rounded-none border border-[#dadce0] bg-white p-0.5 text-xs font-medium';

function segmentClass(selected: boolean): string {
  return `inline-flex h-7 items-center gap-1.5 rounded-none px-3 transition-colors ${selected ? dashboardSelectedClass : 'text-[#5f6368] hover:bg-[#f1f3f4] hover:text-[#202124]'}`;
}

/** Borderless icon button for removing a rule or step. */
const REMOVE_BUTTON_CLASS = 'shrink-0 rounded-none text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124]';

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
        className={`${FIELD_CLASS} cursor-pointer appearance-none pl-3 pr-7 ${className}`}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#5f6368] shrink-0" />
    </div>
  );
}

function SearchableChip({
  value, onChange, options, placeholder, searchLabel, onSearchChange, loading = false, className = '',
}: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string; searchLabel: string;
  onSearchChange?: (query: string | null) => void;
  loading?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listboxId = React.useId();
  const selectedOption = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = React.useMemo(
    () => options.filter((option) => (
      !normalizedQuery ||
      option.label.toLocaleLowerCase().includes(normalizedQuery) ||
      option.value.toLocaleLowerCase().includes(normalizedQuery)
    )),
    [normalizedQuery, options],
  );

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
        onSearchChange?.(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [onSearchChange, open]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery]);

  const chooseOption = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
    onSearchChange?.(null);
  };

  return (
    <div ref={rootRef} className={`relative min-w-[150px] ${className}`}>
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-label={searchLabel}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && filteredOptions[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          value={open ? query : (selectedOption?.label ?? value)}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setQuery('');
            onSearchChange?.('');
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            onSearchChange?.(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.min(index + 1, Math.max(0, filteredOptions.length - 1)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(0, index - 1));
            } else if (event.key === 'Enter' && open && filteredOptions[activeIndex]) {
              event.preventDefault();
              chooseOption(filteredOptions[activeIndex].value);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              setQuery('');
              onSearchChange?.(null);
            } else if (event.key === 'Tab') {
              setOpen(false);
              setQuery('');
              onSearchChange?.(null);
            }
          }}
          className={`${FIELD_CLASS} w-full pl-3 pr-7`}
        />
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#5f6368]" />
      </div>
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${searchLabel} options`}
          className="absolute left-0 top-full z-[70] mt-1 max-h-56 w-full min-w-[190px] overflow-y-auto rounded-none border border-[#dadce0] bg-white p-1 shadow-[0_4px_16px_rgba(60,64,67,0.2)]"
        >
          {loading && (
            <div className="px-3 py-2 text-center text-xs text-[#5f6368]">
              Searching…
            </div>
          )}
          {filteredOptions.length > 0 ? filteredOptions.map((option, index) => (
            <button
              key={option.value}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => chooseOption(option.value)}
              className={`block w-full rounded-none px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                index === activeIndex
                  ? 'bg-[#f1f3f4] text-[#202124]'
                  : option.value === value
                    ? dashboardSelectedClass
                    : 'text-[#3c4043] hover:bg-[#f1f3f4]'
              }`}
            >
              {option.label}
            </button>
          )) : !loading ? (
            <div className="px-3 py-3 text-center text-xs text-[#5f6368]">
              No matching {searchLabel.toLocaleLowerCase()}
            </div>
          ) : null}
        </div>
      )}
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
      className={`${width} ${FIELD_CLASS} px-2 text-center tabular-nums`}
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

// Rule types share one neutral tile; the icon tells them apart.
const TYPE_ICONS: Record<string, React.ReactNode> = {
  issue:      <AlertOctagon className="w-4 h-4" />,
  date:       <Calendar className="w-4 h-4" />,
  screen:     <LayoutGrid className="w-4 h-4" />,
  event:      <Zap className="w-4 h-4" />,
  metadata:   <Tag className="w-4 h-4" />,
  location:   <MapPin className="w-4 h-4" />,
  referral:   <Globe2 className="w-4 h-4" />,
  utm:        <Megaphone className="w-4 h-4" />,
  smart_capture: <ScanEye className="w-4 h-4" />,
  lifecycle:  <Users className="w-4 h-4" />,
  platform:   <Smartphone className="w-4 h-4" />,
  journey:    <Route className="w-4 h-4" />,
  conversion: <Tag className="w-4 h-4" />,
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
  const icon = TYPE_ICONS[type] ?? TYPE_ICONS.issue;
  const meta = CONDITION_TYPE_META[type as keyof typeof CONDITION_TYPE_META];
  const renderRemoveButton = () => (
    <button
      onClick={onRemove}
      className={`${REMOVE_BUTTON_CLASS} p-1.5`}
      title="Remove rule"
    >
      <X className="w-4 h-4" />
    </button>
  );

  return (
    <div className="flex flex-col gap-2 rounded-none border border-[#e8eaed] bg-white px-3 py-2 sm:flex-row sm:items-center">
      <div className="flex items-center justify-between gap-2 sm:w-36 sm:justify-start">
        <div className="flex items-center gap-2 shrink-0">
          <div className="shrink-0 bg-[#f1f3f4] p-1.5 text-[#5f6368]">{icon}</div>
          <span className="text-xs font-medium text-[#3c4043]">{meta?.label ?? type}</span>
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
      <div className={SEGMENT_GROUP_CLASS}>
        {(['range', 'exact'] as const).map((m) => (
          <button key={m} onClick={() => onChange({ ...cond, mode: m })}
            className={segmentClass(cond.mode === m)}>
            {m === 'range' ? 'Range' : 'Exact date'}
          </button>
        ))}
      </div>
      {cond.mode === 'range' && (
        <Chip value={cond.timeRange ?? '7d'} onChange={(v) => onChange({ ...cond, timeRange: v as DateCondition['timeRange'] })} options={TIME_OPTS} />
      )}
      {cond.mode === 'exact' && (
        <input type="date" value={cond.date ?? ''} onChange={(e) => onChange({ ...cond, date: e.target.value })}
          className={`${FIELD_CLASS} px-3`} />
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
      {loading ? <span className="text-xs text-[#5f6368]">Loading…</span> : (
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
      <span className="text-xs text-[#5f6368]">→</span>
      <Chip
        value={cond.screenOutcome ?? ''}
        onChange={(v) => onChange({ ...cond, screenOutcome: (v || undefined) as ScreenCondition['screenOutcome'] })}
        options={[{ value: '', label: 'any outcome' }, { value: 'bounced', label: '↩ bounced (exit)' }, { value: 'continued', label: '→ continued' }]}
      />
      <span title="Bounced = last screen before session ended. Continued = navigated to at least one more screen after." className="cursor-help text-[#80868b] hover:text-[#5f6368] transition-colors">
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
      {loading ? <span className="text-xs text-[#5f6368]">Loading…</span> : (
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
              placeholder="value" className={`${FIELD_CLASS} w-24 px-3`} />
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
      {loading ? <span className="text-xs text-[#5f6368]">Loading…</span> : (
        <Chip value={cond.metaKey} onChange={(v) => onChange({ ...cond, metaKey: v, metaValue: undefined })} options={keyOpts} placeholder="Pick key…" className="min-w-[120px]" />
      )}
      {cond.metaKey && (
        <>
          <span className="text-xs text-[#5f6368]">=</span>
          {valOpts.length > 0 ? (
            <Chip value={cond.metaValue ?? ''} onChange={(v) => onChange({ ...cond, metaValue: v || undefined })} options={[{ value: '', label: 'any value' }, ...valOpts]} />
          ) : (
            <input type="text" value={cond.metaValue ?? ''} onChange={(e) => onChange({ ...cond, metaValue: e.target.value || undefined })}
              placeholder="value" className={`${FIELD_CLASS} w-28 px-3`} />
          )}
        </>
      )}
    </ConditionRowShell>
  );
}

const LOCATION_MODE_OPTIONS = [
  { value: 'country', label: 'Country' },
  { value: 'city', label: 'City' },
  { value: 'both', label: 'Country + city' },
];

export function LocationRow({
  cond,
  onChange,
  onRemove,
  filters,
  loading,
  loadLocationOptions,
}: {
  cond: LocationCondition;
  onChange: (c: LocationCondition) => void;
  onRemove: () => void;
  filters: AvailableFilters;
  loading: boolean;
  loadLocationOptions?: (
    kind: 'country' | 'city',
    search: string,
    country?: string,
  ) => Promise<Array<{ country?: string; city?: string }>>;
}) {
  const [activeSearch, setActiveSearch] = React.useState<{ kind: 'country' | 'city'; query: string } | null>(null);
  const [remoteLocations, setRemoteLocations] = React.useState<Array<{ country?: string; city?: string }>>([]);
  const [isSearching, setIsSearching] = React.useState(false);

  React.useEffect(() => {
    if (!activeSearch || !loadLocationOptions) {
      setRemoteLocations([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setIsSearching(true);
      loadLocationOptions(
        activeSearch.kind,
        activeSearch.query.trim(),
        activeSearch.kind === 'city' && cond.mode === 'both' ? cond.country : undefined,
      )
        .then((locations) => {
          if (!cancelled) setRemoteLocations(locations);
        })
        .catch(() => {
          if (!cancelled) setRemoteLocations([]);
        })
        .finally(() => {
          if (!cancelled) setIsSearching(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [activeSearch, cond.country, cond.mode, loadLocationOptions]);

  const locations = React.useMemo(() => {
    const uniqueLocations = new Map<string, { country?: string; city?: string }>();
    for (const location of [...(filters.locations ?? []), ...remoteLocations]) {
      const country = location.country?.trim() || undefined;
      const city = location.city?.trim() || undefined;
      if (!country && !city) continue;
      uniqueLocations.set(`${country ?? ''}\u0000${city ?? ''}`, { country, city });
    }
    return [...uniqueLocations.values()];
  }, [filters.locations, remoteLocations]);
  const countries = uniqueValues(locations.map((location) => location.country)).sort((a, b) => (
    (formatCountryDisplayName(a) || a).localeCompare(formatCountryDisplayName(b) || b)
  ));
  const allCities = uniqueValues(locations.map((location) => location.city)).sort((a, b) => a.localeCompare(b));
  const citiesForCountry = cond.country
    ? uniqueValues(locations
        .filter((location) => location.country === cond.country)
        .map((location) => location.city))
        .sort((a, b) => a.localeCompare(b))
    : allCities;

  function setMode(mode: LocationCondition['mode']) {
    if (mode === 'country') {
      onChange({ ...cond, mode, country: cond.country || countries[0], city: undefined });
      return;
    }
    if (mode === 'city') {
      onChange({ ...cond, mode, country: undefined, city: cond.city || allCities[0] });
      return;
    }
    const country = cond.country || countries[0];
    const matchingCities = country
      ? uniqueValues(locations.filter((location) => location.country === country).map((location) => location.city))
      : allCities;
    onChange({ ...cond, mode, country, city: matchingCities.includes(cond.city ?? '') ? cond.city : matchingCities[0] });
  }

  function locationValueControl(kind: 'country' | 'city') {
    const isCountry = kind === 'country';
    const values = isCountry ? countries : (cond.mode === 'both' ? citiesForCountry : allCities);
    const value = (isCountry ? cond.country : cond.city) ?? '';
    const update = (nextValue: string) => {
      if (isCountry) {
        const nextCities = uniqueValues(locations
          .filter((location) => location.country === nextValue)
          .map((location) => location.city));
        onChange({
          ...cond,
          country: nextValue || undefined,
          city: cond.mode === 'both'
            ? (nextCities.includes(cond.city ?? '') ? cond.city : nextCities[0])
            : cond.city,
        });
      } else {
        onChange({ ...cond, city: nextValue || undefined });
      }
    };

    if (values.length > 0 || loadLocationOptions) {
      const options = uniqueValues([...values, value]).map((option) => ({
        value: option,
        label: isCountry ? (formatCountryDisplayName(option) || option) : option,
      }));
      return (
        <SearchableChip
          value={value}
          onChange={update}
          options={options}
          placeholder={`Find ${kind}…`}
          searchLabel={isCountry ? 'Country' : 'City'}
          onSearchChange={(query) => setActiveSearch(query === null ? null : { kind, query })}
          loading={isSearching && activeSearch?.kind === kind}
        />
      );
    }

    return (
      <input
        type="text"
        value={value}
        onChange={(event) => update(event.target.value)}
        placeholder={`Enter ${kind}`}
        aria-label={isCountry ? 'Country' : 'City'}
        className={`${FIELD_CLASS} w-36 px-3`}
      />
    );
  }

  return (
    <ConditionRowShell type="location" onRemove={onRemove}>
      <Chip value={cond.mode} onChange={(value) => setMode(value as LocationCondition['mode'])} options={LOCATION_MODE_OPTIONS} />
      {loading ? <span className="text-xs text-[#5f6368]">Loading locations…</span> : (
        <>
          <span className="text-xs text-[#5f6368]">is</span>
          {cond.mode !== 'city' && locationValueControl('country')}
          {cond.mode === 'both' && <span className="text-xs text-[#5f6368]">and</span>}
          {cond.mode !== 'country' && locationValueControl('city')}
          {cond.mode === 'both' && (
            <span
              title="Matches the city only inside the selected country."
              className={`${dashboardChipClass('info')} cursor-help`}
            >
              Precise match <Info className="h-3 w-3" />
            </span>
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
      <span className={dashboardChipClass('neutral')}>Web only</span>
      {loading ? <span className="text-xs text-[#5f6368]">Loading…</span> : (
        <>
          <span className="text-xs text-[#5f6368]">from</span>
          {referralValues.length > 0 ? (
            <Chip value={cond.referralValue ?? ''} onChange={(v) => onChange({ ...cond, referralValue: v || undefined })} options={valOpts} />
          ) : (
            <input type="text" value={cond.referralValue ?? ''} onChange={(e) => onChange({ ...cond, referralValue: e.target.value || undefined })}
              placeholder="domain or source" className={`${FIELD_CLASS} w-36 px-3`} />
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
      <span className={dashboardChipClass('neutral')}>Web only</span>
      <Chip
        value={cond.field}
        onChange={(v) => onChange({ ...cond, field: v as UtmField, value: undefined })}
        options={UTM_FIELD_OPTIONS}
      />
      <span className="text-xs text-[#5f6368]">=</span>
      {loading ? <span className="text-xs text-[#5f6368]">Loading…</span> : values.length > 0 ? (
        <Chip value={cond.value ?? ''} onChange={(v) => onChange({ ...cond, value: v || undefined })} options={valOpts} />
    ) : (
      <input type="text" value={cond.value ?? ''} onChange={(e) => onChange({ ...cond, value: e.target.value || undefined })}
          placeholder="value" className={`${FIELD_CLASS} w-32 px-3`} />
      )}
    </ConditionRowShell>
  );
}

const SMART_CAPTURE_STATUS_OPTIONS = [
  { value: '', label: 'any decision' },
  { value: 'kept', label: 'kept replay' },
  { value: 'pending', label: 'waiting' },
  { value: 'discarded', label: 'discarded' },
];

function smartCaptureRuleName(rule: SmartCaptureRule): string {
  return rule.name || rule.label || rule.id;
}

export function SmartCaptureRow({ cond, onChange, onRemove, smartCaptureRules }: {
  cond: SmartCaptureCondition;
  onChange: (c: SmartCaptureCondition) => void;
  onRemove: () => void;
  smartCaptureRules: SmartCaptureRule[];
}) {
  const ruleOptions = [
    { value: '', label: 'any rule' },
    ...smartCaptureRules.map((rule) => ({ value: rule.id, label: smartCaptureRuleName(rule) })),
  ];

  return (
    <ConditionRowShell type="smart_capture" onRemove={onRemove}>
      <Chip
        value={cond.status ?? ''}
        onChange={(v) => onChange({ ...cond, status: (v || undefined) as SmartCaptureCondition['status'] })}
        options={SMART_CAPTURE_STATUS_OPTIONS}
      />
      <span className="text-xs text-[#5f6368]">by</span>
      {smartCaptureRules.length > 0 ? (
        <Chip
          value={cond.ruleId ?? ''}
          onChange={(v) => {
            const selectedRule = smartCaptureRules.find((rule) => rule.id === v);
            onChange({
              ...cond,
              ruleId: v || undefined,
              ruleName: selectedRule ? smartCaptureRuleName(selectedRule) : cond.ruleName,
            });
          }}
          options={ruleOptions}
          className="max-w-[220px]"
        />
      ) : (
        <input
          type="text"
          value={cond.ruleName ?? ''}
          onChange={(e) => onChange({ ...cond, ruleName: e.target.value || undefined })}
          placeholder="rule name"
          className={`${FIELD_CLASS} w-40 px-3`}
        />
      )}
      {smartCaptureRules.length > 0 && !cond.ruleId && (
        <input
          type="text"
          value={cond.ruleName ?? ''}
          onChange={(e) => onChange({ ...cond, ruleName: e.target.value || undefined })}
          placeholder="or rule name"
          className={`${FIELD_CLASS} w-36 px-3`}
        />
      )}
    </ConditionRowShell>
  );
}

export function LifecycleRow({ cond, onChange, onRemove }: { cond: LifecycleCondition; onChange: (c: LifecycleCondition) => void; onRemove: () => void }) {
  return (
    <ConditionRowShell type="lifecycle" onRemove={onRemove}>
      <div className={SEGMENT_GROUP_CLASS}>
        {(['early_user', 'returning_user'] as const).map((p) => (
          <button key={p} onClick={() => onChange({ ...cond, preset: p, returnedCountOp: undefined, returnedCountValue: undefined })}
            className={segmentClass(cond.preset === p)}>
            {p === 'early_user' ? 'Early user' : 'Returning'}
          </button>
        ))}
      </div>
      <span className="text-xs text-[#5f6368]">{cond.preset === 'early_user' ? '≤' : '>'}</span>
      <NumInput value={String(cond.sessionWindowSize ?? 5)} onChange={(v) => onChange({ ...cond, sessionWindowSize: Math.min(25, Math.max(1, parseInt(v) || 5)) })} min={1} width="w-12" />
      <span className="text-xs text-[#5f6368]">sessions</span>
      {cond.preset === 'returning_user' && (
        <>
          <span className="text-xs text-[#bdc1c6] mx-1">·</span>
          <Chip
            value={cond.returnedCountOp ?? ''}
            onChange={(v) => onChange({ ...cond, returnedCountOp: (v || undefined) as LifecycleCondition['returnedCountOp'], returnedCountValue: v ? cond.returnedCountValue : undefined })}
            options={[{ value: '', label: 'any return count' }, { value: 'eq', label: 'returned =' }, { value: 'gt', label: 'returned >' }, { value: 'lt', label: 'returned <' }, { value: 'gte', label: 'returned ≥' }, { value: 'lte', label: 'returned ≤' }]}
          />
          {cond.returnedCountOp && (
            <><NumInput value={cond.returnedCountValue ?? ''} onChange={(v) => onChange({ ...cond, returnedCountValue: v })} placeholder="#" min={1} width="w-12" />
            <span className="text-xs text-[#5f6368]">×</span></>
          )}
        </>
      )}
    </ConditionRowShell>
  );
}

export function PlatformRow({ cond, onChange, onRemove }: { cond: PlatformCondition; onChange: (c: PlatformCondition) => void; onRemove: () => void }) {
  return (
    <ConditionRowShell type="platform" onRemove={onRemove}>
      <div className={SEGMENT_GROUP_CLASS}>
        {(['ios', 'android', 'web'] as const).map((p) => (
          <button key={p} onClick={() => onChange({ ...cond, platform: p })}
            className={segmentClass(cond.platform === p)}>
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
      {loading ? <span className="text-xs text-[#5f6368]">Loading…</span> : (
        <div className="flex flex-wrap items-center gap-2">
          {cond.steps.map((step, idx) => (
            <React.Fragment key={idx}>
              <div className="flex items-center gap-1">
                <div className="relative inline-flex shrink-0 items-center">
                  <select value={step} onChange={(e) => updateStep(idx, e.target.value)}
                    className={`${FIELD_CLASS} cursor-pointer appearance-none pl-3 pr-7`}>
                    <option value="">Pick screen…</option>
                    {screenOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[#5f6368]" />
                </div>
                <button onClick={() => removeStep(idx)} className={`${REMOVE_BUTTON_CLASS} p-1`} title="Remove step">
                  <X className="w-3 h-3" />
                </button>
              </div>
              {idx < cond.steps.length - 1 && <ArrowRight className="w-4 h-4 text-[#80868b] shrink-0" />}
            </React.Fragment>
          ))}
          <button onClick={() => onChange({ ...cond, steps: [...cond.steps, ''] })}
            className={dashboardButtonClass('secondary', 'sm')}>
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
      <div className={SEGMENT_GROUP_CLASS}>
        {(['checkout_bounced', 'checkout_success'] as const).map((p) => (
          <button key={p} onClick={() => onChange({ ...cond, preset: p })}
            className={segmentClass(cond.preset === p)}>
            {p === 'checkout_bounced' ? 'Dropped off' : 'Completed'}
          </button>
        ))}
      </div>
      <span title={`Heuristic only - works if your app uses these screen/event names:\n- Screens: checkout, cart, payment, confirmation, success, receipt, order\n- Events: checkout_started, purchase_completed, add_to_cart, order_placed\n\nFor custom funnels, use Screen Journey instead.`}
        className="cursor-help text-[#80868b] hover:text-[#5f6368] transition-colors">
        <Info className="w-4 h-4" />
      </span>
    </ConditionRowShell>
  );
}
