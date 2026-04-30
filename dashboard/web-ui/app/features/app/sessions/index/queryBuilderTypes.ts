import type { SessionArchiveQuery } from '~/shared/api/client';
import type { SessionArchiveIssueFilter } from './sessionArchiveFilters';

export type ConditionType =
  | 'issue'
  | 'date'
  | 'screen'
  | 'event'
  | 'metadata'
  | 'lifecycle'
  | 'conversion'
  | 'platform'
  | 'journey';

export type IssueCondition = {
  id: string;
  type: 'issue';
  issueFilter: Exclude<SessionArchiveIssueFilter, 'all'>;
};

export type DateCondition = {
  id: string;
  type: 'date';
  mode: 'exact' | 'range';
  date?: string;
  timeRange?: '24h' | '7d' | '30d' | '90d' | '1y';
};

export type ScreenCondition = {
  id: string;
  type: 'screen';
  screenName: string;
  screenOutcome?: 'bounced' | 'continued';
  /** How many times the user visited this screen */
  screenVisitCountOp?: 'eq' | 'gt' | 'lt' | 'gte' | 'lte';
  screenVisitCountValue?: string;
};

export type EventCondition = {
  id: string;
  type: 'event';
  eventName: string;
  eventCountOp?: 'eq' | 'gt' | 'lt' | 'gte' | 'lte';
  eventCountValue?: string;
  eventPropKey?: string;
  eventPropValue?: string;
};

export type MetadataCondition = {
  id: string;
  type: 'metadata';
  metaKey: string;
  metaValue?: string;
};

export type LifecycleCondition = {
  id: string;
  type: 'lifecycle';
  preset: 'early_user' | 'returning_user';
  sessionWindowSize?: number;
  /** Optional: filter by how many total sessions this visitor has had */
  returnedCountOp?: 'eq' | 'gt' | 'lt' | 'gte' | 'lte';
  returnedCountValue?: string;
};

export type ConversionCondition = {
  id: string;
  type: 'conversion';
  preset: 'checkout_bounced' | 'checkout_success';
};

export type PlatformCondition = {
  id: string;
  type: 'platform';
  platform: 'ios' | 'android';
};

export type JourneyCondition = {
  id: string;
  type: 'journey';
  steps: string[];
};

export type QueryCondition =
  | IssueCondition
  | DateCondition
  | ScreenCondition
  | EventCondition
  | MetadataCondition
  | LifecycleCondition
  | ConversionCondition
  | PlatformCondition
  | JourneyCondition;

export function generateConditionId(): string {
  return crypto.randomUUID();
}

/** A group of conditions combined with AND. Multiple groups are OR-ed together. */
export type QueryGroup = {
  id: string;
  conditions: QueryCondition[];
};

export function generateGroupId(): string {
  return crypto.randomUUID();
}

export function groupsToArchiveQuery(groups: QueryGroup[]): Partial<SessionArchiveQuery> {
  const nonEmpty = groups.filter((g) => g.conditions.length > 0);
  if (nonEmpty.length === 0) return {};
  // Single group → AND (default); multiple groups → OR between them (backend approximation)
  const logic: 'AND' | 'OR' = nonEmpty.length > 1 ? 'OR' : 'AND';
  return conditionsToArchiveQuery(nonEmpty.flatMap((g) => g.conditions), logic);
}

export function groupsBuildHumanSummary(groups: QueryGroup[]): string {
  const nonEmpty = groups.filter((g) => g.conditions.length > 0);
  if (nonEmpty.length === 0) return 'All sessions';
  if (nonEmpty.length === 1) return buildHumanSummary(nonEmpty[0].conditions, 'AND');
  const parts = nonEmpty.map((g) => {
    const inner = g.conditions.map((c) => getConditionShortLabel(c)).join(' AND ');
    return `(${inner})`;
  });
  return 'Sessions where ' + parts.join(' OR ');
}

export function conditionsToArchiveQuery(
  conditions: QueryCondition[],
  logic: 'AND' | 'OR' = 'AND'
): Partial<SessionArchiveQuery> {
  const result: Partial<SessionArchiveQuery> = {};
  if (logic === 'OR') result.conditionLogic = 'OR';

  for (const cond of conditions) {
    switch (cond.type) {
      case 'issue':
        result.issueFilter = cond.issueFilter;
        break;
      case 'date':
        if (cond.mode === 'exact' && cond.date) {
          result.date = cond.date;
        } else if (cond.mode === 'range' && cond.timeRange) {
          result.timeRange = cond.timeRange;
        }
        break;
      case 'screen':
        result.screenName = cond.screenName;
        if (cond.screenOutcome) result.screenOutcome = cond.screenOutcome;
        if (cond.screenVisitCountOp) result.eventCountOp = cond.screenVisitCountOp;
        if (cond.screenVisitCountValue) result.eventCountValue = cond.screenVisitCountValue;
        break;
      case 'event':
        result.eventName = cond.eventName;
        if (cond.eventCountOp) result.eventCountOp = cond.eventCountOp;
        if (cond.eventCountValue) result.eventCountValue = cond.eventCountValue;
        if (cond.eventPropKey) result.eventPropKey = cond.eventPropKey;
        if (cond.eventPropValue) result.eventPropValue = cond.eventPropValue;
        break;
      case 'metadata':
        result.metaKey = cond.metaKey;
        if (cond.metaValue) result.metaValue = cond.metaValue;
        break;
      case 'lifecycle':
        result.lifecyclePreset = cond.preset;
        if (cond.sessionWindowSize) result.sessionWindowSize = cond.sessionWindowSize;
        // returnedCountOp/Value maps to eventCountOp/Value repurposed for lifecycle count
        if (cond.returnedCountOp) result.eventCountOp = cond.returnedCountOp;
        if (cond.returnedCountValue) result.eventCountValue = cond.returnedCountValue;
        break;
      case 'conversion':
        result.conversionPreset = cond.preset;
        break;
      case 'platform':
        result.platform = cond.platform;
        break;
      case 'journey': {
        const validSteps = cond.steps.filter(Boolean);
        if (validSteps.length >= 2) {
          result.screenPath = validSteps.join('|');
        }
        break;
      }
    }
  }

  return result;
}

const TIME_RANGE_LABELS: Record<string, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  '1y': 'last year',
};

const ISSUE_LABELS: Record<string, string> = {
  crashes: 'Crashes',
  anrs: 'ANRs',
  errors: 'Errors',
  rage: 'Rage taps',
  dead_taps: 'Dead taps',
  slow_start: 'Slow start',
  slow_api: 'Slow API',
  new_user: 'New user',
};

const OP_SYMBOLS: Record<string, string> = {
  eq: '=',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
};

export function buildHumanSummary(conditions: QueryCondition[], logic: 'AND' | 'OR' = 'AND'): string {
  if (conditions.length === 0) return 'All sessions';

  const parts = conditions.map((cond) => {
    switch (cond.type) {
      case 'issue':
        return ISSUE_LABELS[cond.issueFilter] ?? cond.issueFilter;
      case 'date':
        if (cond.mode === 'exact' && cond.date) return `on ${cond.date}`;
        if (cond.mode === 'range' && cond.timeRange)
          return TIME_RANGE_LABELS[cond.timeRange] ?? cond.timeRange;
        return 'any date';
      case 'screen': {
        const outcome = cond.screenOutcome
          ? ` (${cond.screenOutcome})`
          : '';
        let visitCount = '';
        if (cond.screenVisitCountOp && cond.screenVisitCountValue) {
          visitCount = ` ${OP_SYMBOLS[cond.screenVisitCountOp] ?? cond.screenVisitCountOp}${cond.screenVisitCountValue}×`;
        }
        return `visited ${cond.screenName}${outcome}${visitCount}`;
      }
      case 'event': {
        let s = `fired ${cond.eventName}`;
        if (cond.eventCountOp && cond.eventCountValue) {
          s += ` ${OP_SYMBOLS[cond.eventCountOp] ?? cond.eventCountOp}${cond.eventCountValue}×`;
        }
        if (cond.eventPropKey) {
          s += ` where ${cond.eventPropKey}`;
          if (cond.eventPropValue) s += `=${cond.eventPropValue}`;
        }
        return s;
      }
      case 'metadata': {
        if (cond.metaValue) return `${cond.metaKey}=${cond.metaValue}`;
        return `has ${cond.metaKey}`;
      }
      case 'lifecycle': {
        const base = cond.preset === 'early_user' ? 'first-time users' : 'returning users';
        if (cond.returnedCountOp && cond.returnedCountValue) {
          return `${base} (${OP_SYMBOLS[cond.returnedCountOp] ?? cond.returnedCountOp}${cond.returnedCountValue} sessions)`;
        }
        return base;
      }
      case 'conversion':
        return cond.preset === 'checkout_bounced'
          ? 'checkout dropoffs'
          : 'checkout successes';
      case 'platform':
        return cond.platform === 'ios' ? 'on iOS' : 'on Android';
      case 'journey': {
        const steps = cond.steps.filter(Boolean);
        if (steps.length === 0) return 'journey (incomplete)';
        return 'journey: ' + steps.join(' → ');
      }
    }
  });

  return 'Sessions where ' + parts.join(` ${logic} `);
}

export function getConditionShortLabel(cond: QueryCondition): string {
  switch (cond.type) {
    case 'issue':
      return ISSUE_LABELS[cond.issueFilter] ?? cond.issueFilter;
    case 'date':
      if (cond.mode === 'exact' && cond.date) return cond.date;
      if (cond.mode === 'range' && cond.timeRange)
        return TIME_RANGE_LABELS[cond.timeRange] ?? cond.timeRange;
      return 'Date';
    case 'screen':
      if (!cond.screenName) return 'Screen';
      if (cond.screenOutcome === 'bounced') return `${cond.screenName} bounced`;
      if (cond.screenOutcome === 'continued') return `${cond.screenName} continued`;
      return cond.screenName;
    case 'event':
      return cond.eventName || 'Event';
    case 'metadata':
      return cond.metaKey || 'Metadata';
    case 'lifecycle':
      return cond.preset === 'early_user' ? 'Early user' : 'Returning user';
    case 'conversion':
      return cond.preset === 'checkout_bounced' ? 'Checkout bounced' : 'Checkout success';
    case 'platform':
      return cond.platform === 'ios' ? 'iOS' : 'Android';
    case 'journey': {
      const steps = cond.steps.filter(Boolean);
      if (steps.length === 0) return 'Journey';
      return steps.join(' → ');
    }
  }
}

export type PresetConditionTemplate =
  | { type: 'issue'; issueFilter: Exclude<SessionArchiveIssueFilter, 'all'> }
  | { type: 'date'; mode: 'exact' | 'range'; date?: string; timeRange?: '24h' | '7d' | '30d' | '90d' | '1y' }
  | { type: 'screen'; screenName: string; screenOutcome?: 'bounced' | 'continued' }
  | { type: 'event'; eventName: string; eventCountOp?: string; eventCountValue?: string; eventPropKey?: string; eventPropValue?: string }
  | { type: 'metadata'; metaKey: string; metaValue?: string }
  | { type: 'lifecycle'; preset: 'early_user' | 'returning_user' }
  | { type: 'conversion'; preset: 'checkout_bounced' | 'checkout_success' }
  | { type: 'platform'; platform: 'ios' | 'android' };

export type QueryPreset = {
  id: string;
  label: string;
  description: string;
  iconName: string;
  conditions: PresetConditionTemplate[];
};

export const QUERY_PRESETS: QueryPreset[] = [
  {
    id: 'crashes',
    label: 'Sessions with crashes',
    description: 'Sessions where the app crashed',
    iconName: 'AlertOctagon',
    conditions: [{ type: 'issue', issueFilter: 'crashes' }],
  },
  {
    id: 'checkout_drop',
    label: 'Checkout dropoffs',
    description: 'Users who started but abandoned checkout',
    iconName: 'ShoppingCart',
    conditions: [{ type: 'conversion', preset: 'checkout_bounced' }],
  },
  {
    id: 'checkout_success',
    label: 'Successful checkouts',
    description: 'Users who completed a purchase',
    iconName: 'CheckCircle',
    conditions: [{ type: 'conversion', preset: 'checkout_success' }],
  },
  {
    id: 'power_users',
    label: 'Power users',
    description: 'Returning, experienced users',
    iconName: 'Zap',
    conditions: [{ type: 'lifecycle', preset: 'returning_user' }],
  },
  {
    id: 'new_users',
    label: 'First-time visitors',
    description: "Users in their first few sessions",
    iconName: 'UserPlus',
    conditions: [{ type: 'lifecycle', preset: 'early_user' }],
  },
  {
    id: 'rage',
    label: 'Rage & frustration',
    description: 'Sessions with excessive rage taps',
    iconName: 'MousePointerClick',
    conditions: [{ type: 'issue', issueFilter: 'rage' }],
  },
  {
    id: 'slow_start',
    label: 'Slow app starts',
    description: 'Sessions with startup time > 3s',
    iconName: 'Timer',
    conditions: [{ type: 'issue', issueFilter: 'slow_start' }],
  },
  {
    id: 'ios',
    label: 'iOS sessions',
    description: 'Sessions on Apple devices only',
    iconName: 'Smartphone',
    conditions: [{ type: 'platform', platform: 'ios' }],
  },
];

export type ConditionTypeMeta = {
  label: string;
  description: string;
  pillBg: string;
  pillBorder: string;
  pillText: string;
  menuBg: string;
};

export const CONDITION_TYPE_META: Record<ConditionType, ConditionTypeMeta> = {
  issue: {
    label: 'ISSUE',
    description: 'Filter by issue type (crashes, errors, etc.)',
    pillBg: 'bg-slate-900',
    pillBorder: 'border-slate-700',
    pillText: 'text-white',
    menuBg: 'bg-slate-100',
  },
  date: {
    label: 'DATE',
    description: 'Filter by date or time range',
    pillBg: 'bg-sky-50',
    pillBorder: 'border-sky-200',
    pillText: 'text-sky-800',
    menuBg: 'bg-sky-50',
  },
  screen: {
    label: 'SCREEN',
    description: 'Sessions that visited a specific screen',
    pillBg: 'bg-violet-50',
    pillBorder: 'border-violet-200',
    pillText: 'text-violet-800',
    menuBg: 'bg-violet-50',
  },
  event: {
    label: 'EVENT',
    description: 'Sessions where an event was fired',
    pillBg: 'bg-indigo-50',
    pillBorder: 'border-indigo-200',
    pillText: 'text-indigo-800',
    menuBg: 'bg-indigo-50',
  },
  metadata: {
    label: 'METADATA',
    description: 'Filter by session metadata value',
    pillBg: 'bg-emerald-50',
    pillBorder: 'border-emerald-200',
    pillText: 'text-emerald-800',
    menuBg: 'bg-emerald-50',
  },
  lifecycle: {
    label: 'LIFECYCLE',
    description: 'Filter by user lifecycle stage',
    pillBg: 'bg-amber-50',
    pillBorder: 'border-amber-200',
    pillText: 'text-amber-800',
    menuBg: 'bg-amber-50',
  },
  conversion: {
    label: 'CONVERSION',
    description: 'Filter by checkout / conversion outcome',
    pillBg: 'bg-pink-50',
    pillBorder: 'border-pink-200',
    pillText: 'text-pink-800',
    menuBg: 'bg-pink-50',
  },
  platform: {
    label: 'PLATFORM',
    description: 'Filter by mobile OS platform',
    pillBg: 'bg-cyan-50',
    pillBorder: 'border-cyan-200',
    pillText: 'text-cyan-800',
    menuBg: 'bg-cyan-50',
  },
  journey: {
    label: 'JOURNEY',
    description: 'Sessions that followed a screen path in order',
    pillBg: 'bg-teal-50',
    pillBorder: 'border-teal-200',
    pillText: 'text-teal-800',
    menuBg: 'bg-teal-50',
  },
};
