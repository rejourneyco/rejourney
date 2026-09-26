import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  Clock,
  Code2,
  CreditCard,
  Gauge,
  Globe,
  Globe2,
  Info,
  Link2,
  Loader,
  Megaphone,
  Monitor,
  MousePointerClick,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  ScanEye,
  ServerCrash,
  Smartphone,
  Timer,
  Trash2,
  TrendingDown,
  UserCheck,
  X,
  Zap,
  CheckCircle,
  GitMerge,
  type LucideIcon,
} from 'lucide-react';
import { Modal } from '~/shared/ui/core/Modal';
import {
  dashboardButtonClass,
  dashboardCardClass,
  type DashboardChipTone,
} from '~/shared/ui/core/dashboardStyles';
import {
  buildSessionQueryFromPrompt,
  updateProjectSmartCaptureConfig,
  type SmartCaptureConfig,
  type SmartCaptureConfigUpdate,
  type SmartCaptureMode,
  type SmartCaptureRule,
} from '~/shared/api/client';
import { UTM_FIELD_META_KEYS, type QueryGroup, type QueryCondition } from './queryBuilderTypes';
import type { AvailableFilters } from './ConditionRows';

type RuleKind =
  | ''
  | 'bouncer'
  | 'new_user'
  | 'loyal_user'
  | 'engagement_score'
  | 'checkout_risk'
  | 'cart_abandonment'
  | 'onboarding_risk'
  | 'churn_risk'
  | 'high_friction'
  | 'rage_clicks'
  | 'dead_taps'
  | 'js_error'
  | 'api_error'
  | 'api_error_rate'
  | 'slow_api'
  | 'slow_start'
  | 'crashes'
  | 'anrs'
  | 'duration'
  | 'screen_count'
  | 'custom_event'
  | 'user_metadata'
  | 'url_path'
  | 'screen_name'
  | 'platform'
  | 'device_type'
  | 'browser'
  | 'country'
  | 'plan_tier'
  | 'utm_source'
  | 'utm_campaign'
  | 'app_version'
  | 'network_type';

type RuleOptionGroup = 'Product' | 'Business' | 'UX' | 'Engineering' | 'Audience';
type RuleConditionKind = 'signal' | 'metric' | 'attribute';
type RuleValueType = 'none' | 'number' | 'percent' | 'milliseconds' | 'seconds' | 'score' | 'text';
type DecisionWindowUnit = 'days' | 'hours';

type RuleOption = {
  value: RuleKind;
  label: string;
  icon: LucideIcon;
  group: RuleOptionGroup;
  conditionKind: RuleConditionKind;
  type: string;
  metric?: string;
  attribute?: string;
  needsValue?: boolean;
  defaultOperator?: string;
  defaultValue?: string | number;
  valueType?: RuleValueType;
  defaultWindowHours?: number;
  defaultMinVisits?: number;
  defaultMaxVisits?: number;
  delayedByDefault?: boolean;
  hidden?: boolean;
};

/**
 * A rule's color marks its note in the replay list, which renders it as one of the dashboard's
 * chip tones. Similar hues share a tone (cyan and blue are both info, rose and pink both danger).
 */
export const SMART_CAPTURE_RULE_COLOR_TONES: Record<string, DashboardChipTone> = {
  cyan: 'info',
  emerald: 'success',
  amber: 'warning',
  rose: 'danger',
  violet: 'purple',
  blue: 'info',
  pink: 'danger',
  slate: 'neutral',
};

// Swatches preview the tone the note will use.
const RULE_COLOR_OPTIONS = [
  { value: 'cyan', label: 'Cyan', className: 'bg-[#1a73e8]' },
  { value: 'emerald', label: 'Emerald', className: 'bg-[#1e8e3e]' },
  { value: 'amber', label: 'Amber', className: 'bg-[#f9ab00]' },
  { value: 'rose', label: 'Rose', className: 'bg-[#d93025]' },
  { value: 'violet', label: 'Violet', className: 'bg-[#9334e6]' },
  { value: 'blue', label: 'Blue', className: 'bg-[#1a73e8]' },
  { value: 'pink', label: 'Pink', className: 'bg-[#d93025]' },
  { value: 'slate', label: 'Slate', className: 'bg-[#80868b]' },
] as const;

const GROUP_DEFAULT_COLOR: Record<RuleOptionGroup, string> = {
  Product: 'cyan',
  Business: 'emerald',
  UX: 'amber',
  Engineering: 'rose',
  Audience: 'violet',
};

const normalizeRuleColor = (color: unknown, fallback = 'cyan') => {
  const value = typeof color === 'string' ? color.trim().toLowerCase() : '';
  return RULE_COLOR_OPTIONS.some((item) => item.value === value) ? value : fallback;
};

const uniqueStrings = (values: Array<string | undefined>) => (
  [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
);

const stringFromUnknown = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const RULE_OPTIONS: RuleOption[] = [
  { value: 'churn_risk', label: 'Pre Churn', icon: TrendingDown, group: 'Product', conditionKind: 'signal', type: 'lifecycle', defaultWindowHours: 48, defaultMinVisits: 2, delayedByDefault: true },
  { value: 'checkout_risk', label: 'Checkout risk', icon: Activity, group: 'Product', conditionKind: 'signal', type: 'conversion', hidden: true },
  { value: 'cart_abandonment', label: 'Cart abandonment', icon: Activity, group: 'Product', conditionKind: 'signal', type: 'conversion', hidden: true },
  { value: 'onboarding_risk', label: 'Onboarding risk', icon: Activity, group: 'Product', conditionKind: 'signal', type: 'lifecycle', hidden: true },
  { value: 'duration', label: 'Session duration', icon: Clock, group: 'Product', conditionKind: 'metric', type: 'duration', metric: 'duration_seconds', needsValue: true, defaultOperator: 'gte', defaultValue: 60, valueType: 'seconds' },
  { value: 'screen_count', label: 'Screens visited', icon: ScanEye, group: 'Product', conditionKind: 'metric', type: 'metric', metric: 'screen_count', needsValue: true, defaultOperator: 'gte', defaultValue: 4, valueType: 'number' },
  { value: 'custom_event', label: 'Custom event', icon: Activity, group: 'Product', conditionKind: 'attribute', type: 'event', attribute: 'event_name', needsValue: true, defaultOperator: 'contains', defaultValue: '', valueType: 'text' },

  { value: 'plan_tier', label: 'Plan tier', icon: CreditCard, group: 'Business', conditionKind: 'attribute', type: 'attribute', attribute: 'plan_tier', needsValue: true, defaultOperator: 'eq', defaultValue: 'Enterprise', valueType: 'text' },
  { value: 'utm_source', label: 'UTM source', icon: Link2, group: 'Business', conditionKind: 'attribute', type: 'attribute', attribute: 'utm_source', needsValue: true, defaultOperator: 'eq', defaultValue: 'google', valueType: 'text' },
  { value: 'utm_campaign', label: 'UTM campaign', icon: Megaphone, group: 'Business', conditionKind: 'attribute', type: 'attribute', attribute: 'utm_campaign', needsValue: true, defaultOperator: 'contains', defaultValue: 'launch', valueType: 'text' },
  { value: 'country', label: 'Country', icon: Globe, group: 'Business', conditionKind: 'attribute', type: 'attribute', attribute: 'country', needsValue: true, defaultOperator: 'eq', defaultValue: 'US', valueType: 'text' },

  { value: 'high_friction', label: 'High friction', icon: AlertCircle, group: 'UX', conditionKind: 'signal', type: 'issue', hidden: true },
  { value: 'rage_clicks', label: 'Rage taps', icon: Zap, group: 'UX', conditionKind: 'metric', type: 'metric', metric: 'rage_tap_count', needsValue: true, defaultOperator: 'gte', defaultValue: 3, valueType: 'number' },
  { value: 'dead_taps', label: 'Dead taps', icon: MousePointerClick, group: 'UX', conditionKind: 'metric', type: 'metric', metric: 'dead_tap_count', needsValue: true, defaultOperator: 'gte', defaultValue: 1, valueType: 'number' },
  { value: 'url_path', label: 'Route or path', icon: Globe2, group: 'UX', conditionKind: 'attribute', type: 'attribute', attribute: 'url_path', needsValue: true, defaultOperator: 'contains', defaultValue: '/checkout', valueType: 'text' },
  { value: 'screen_name', label: 'Screen name', icon: Monitor, group: 'UX', conditionKind: 'attribute', type: 'attribute', attribute: 'screen_name', needsValue: true, defaultOperator: 'contains', defaultValue: 'Checkout', valueType: 'text' },

  { value: 'crashes', label: 'Crashes', icon: ServerCrash, group: 'Engineering', conditionKind: 'metric', type: 'metric', metric: 'crash_count', needsValue: true, defaultOperator: 'gte', defaultValue: 1, valueType: 'number' },
  { value: 'anrs', label: 'ANRs', icon: AlertTriangle, group: 'Engineering', conditionKind: 'metric', type: 'metric', metric: 'anr_count', needsValue: true, defaultOperator: 'gte', defaultValue: 1, valueType: 'number' },
  { value: 'js_error', label: 'JS errors', icon: AlertCircle, group: 'Engineering', conditionKind: 'metric', type: 'metric', metric: 'error_count', needsValue: true, defaultOperator: 'gte', defaultValue: 1, valueType: 'number' },
  { value: 'api_error', label: 'API failures', icon: Code2, group: 'Engineering', conditionKind: 'metric', type: 'metric', metric: 'api_error_count', needsValue: true, defaultOperator: 'gte', defaultValue: 1, valueType: 'number' },
  { value: 'api_error_rate', label: 'API error rate', icon: BarChart3, group: 'Engineering', conditionKind: 'metric', type: 'metric', metric: 'api_error_rate', needsValue: true, defaultOperator: 'gte', defaultValue: 5, valueType: 'percent' },
  { value: 'slow_api', label: 'API latency', icon: Timer, group: 'Engineering', conditionKind: 'metric', type: 'metric', metric: 'api_avg_response_ms', needsValue: true, defaultOperator: 'gte', defaultValue: 2000, valueType: 'milliseconds' },
  { value: 'slow_start', label: 'Startup time', icon: Gauge, group: 'Engineering', conditionKind: 'metric', type: 'metric', metric: 'app_startup_time_ms', needsValue: true, defaultOperator: 'gte', defaultValue: 3000, valueType: 'milliseconds' },

  { value: 'platform', label: 'Platform', icon: ScanEye, group: 'Audience', conditionKind: 'attribute', type: 'attribute', attribute: 'platform', needsValue: true, defaultOperator: 'eq', defaultValue: 'web', valueType: 'text' },
  { value: 'bouncer', label: 'Bouncer', icon: Timer, group: 'Audience', conditionKind: 'signal', type: 'lifecycle', defaultValue: 10 },
  { value: 'new_user', label: 'New users', icon: UserCheck, group: 'Audience', conditionKind: 'signal', type: 'lifecycle', defaultMaxVisits: 3 },
  { value: 'loyal_user', label: 'Loyal user', icon: UserCheck, group: 'Audience', conditionKind: 'signal', type: 'lifecycle', defaultMinVisits: 5 },
  { value: 'engagement_score', label: 'Engagement score', icon: Gauge, group: 'Audience', conditionKind: 'metric', type: 'metric', metric: 'interaction_score', needsValue: true, defaultOperator: 'gte', defaultValue: 70, valueType: 'score' },
  { value: 'device_type', label: 'Device type', icon: Smartphone, group: 'Audience', conditionKind: 'attribute', type: 'attribute', attribute: 'device_type', needsValue: true, defaultOperator: 'eq', defaultValue: 'mobile', valueType: 'text' },
  { value: 'browser', label: 'Browser', icon: Monitor, group: 'Audience', conditionKind: 'attribute', type: 'attribute', attribute: 'browser', needsValue: true, defaultOperator: 'eq', defaultValue: 'Chrome', valueType: 'text' },
  { value: 'app_version', label: 'App version', icon: Code2, group: 'Audience', conditionKind: 'attribute', type: 'attribute', attribute: 'app_version', needsValue: true, defaultOperator: 'eq', defaultValue: '2.4.1', valueType: 'text' },
  { value: 'network_type', label: 'Network type', icon: Activity, group: 'Audience', conditionKind: 'attribute', type: 'attribute', attribute: 'network_type', needsValue: true, defaultOperator: 'eq', defaultValue: 'cellular', valueType: 'text' },
  { value: 'user_metadata', label: 'User metadata', icon: CreditCard, group: 'Audience', conditionKind: 'attribute', type: 'attribute', needsValue: true, defaultOperator: 'eq', defaultValue: '', valueType: 'text' },
];

const VISIBLE_RULE_OPTIONS = RULE_OPTIONS.filter((option) => !option.hidden);

const ATTRIBUTE_VALUE_KEYS: Partial<Record<RuleKind, string[]>> = {
  url_path: ['webLandingRoute', 'webEntryPath', 'webEntryUrl', 'route', 'path', 'url'],
  screen_name: ['screen', 'screenName', 'screen_name', 'routeName'],
  platform: ['platform'],
  device_type: ['deviceType', 'device_type', 'formFactor'],
  browser: ['browser', 'browserName', 'webBrowser'],
  country: ['country', 'countryCode', 'geoCountry', 'geoCountryCode'],
  plan_tier: ['planTier', 'plan_tier', 'plan', 'tier', 'subscriptionPlan', 'subscriptionTier'],
  utm_source: ['utm_source', 'webAttributionSource'],
  utm_campaign: ['utm_campaign', 'webAttributionCampaign'],
  app_version: ['appVersion', 'app_version'],
  network_type: ['networkType', 'effectiveConnectionType'],
};

const STATIC_ATTRIBUTE_VALUES: Partial<Record<RuleKind, string[]>> = {
  platform: ['web', 'ios', 'android', 'react-native'],
  device_type: ['desktop', 'mobile', 'tablet'],
  browser: ['Chrome', 'Safari', 'Firefox', 'Edge'],
  network_type: ['wifi', 'cellular', '4g', '3g', '2g', 'slow-2g'],
};

const BLANK_RULE_OPTION: RuleOption = {
  value: '',
  label: '',
  icon: ScanEye,
  group: 'Product',
  conditionKind: 'signal',
  type: '',
  valueType: 'none',
  hidden: true,
};

const NUMBER_OPERATORS = [
  { value: 'gte', label: '>=' },
  { value: 'gt', label: '>' },
  { value: 'lte', label: '<=' },
  { value: 'lt', label: '<' },
  { value: 'eq', label: '=' },
];

const TEXT_OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'does not equal' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'matches_regex', label: 'matches regex' },
];

const SCOPABLE_METRIC_NAMES = new Set(['rage_tap_count', 'dead_tap_count']);

const supportsScopedMetricOption = (option: RuleOption) => (
  option.conditionKind === 'metric' && SCOPABLE_METRIC_NAMES.has(option.metric ?? option.value)
);

const scopeForCondition = (condition?: Record<string, unknown>): Record<string, unknown> | null => (
  isRecord(condition?.scope) ? condition.scope : null
);

const scopeLabelForCondition = (condition?: Record<string, unknown>): string => {
  const scope = scopeForCondition(condition);
  const value = stringFromUnknown(scope?.value);
  return value?.trim() ? ` on ${value.trim()}` : '';
};

const hasEmptyScope = (condition?: Record<string, unknown>) => {
  const scope = scopeForCondition(condition);
  if (!scope) return false;
  return !stringFromUnknown(scope.value)?.trim();
};

const clampNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const optionFor = (signal?: string, type?: string, condition?: Record<string, unknown>): RuleOption => {
  const conditionMetric = typeof condition?.metric === 'string' ? condition.metric : undefined;
  const conditionAttribute = typeof condition?.attribute === 'string' ? condition.attribute : undefined;
  if (!signal?.trim() && !type?.trim() && !conditionMetric && !conditionAttribute) {
    return BLANK_RULE_OPTION;
  }
  if (signal === 'event_name') {
    return RULE_OPTIONS.find((option) => option.value === 'custom_event') ?? RULE_OPTIONS[0];
  }
  return RULE_OPTIONS.find((option) => option.value === signal)
    ?? RULE_OPTIONS.find((option) => option.metric === conditionMetric)
    ?? RULE_OPTIONS.find((option) => option.attribute === conditionAttribute)
    ?? RULE_OPTIONS.find((option) => option.type === type && option.conditionKind === 'signal')
    ?? RULE_OPTIONS[0];
};

const dynamicAttributeForRule = (rule: Pick<SmartCaptureRule, 'condition'>, fallback?: string) => (
  typeof rule.condition?.attribute === 'string' && rule.condition.attribute.trim()
    ? rule.condition.attribute
    : fallback
);

const valueSuffix = (valueType?: RuleValueType) => {
  switch (valueType) {
    case 'percent': return '%';
    case 'milliseconds': return 'ms';
    case 'seconds': return 'sec';
    case 'score': return '/100';
    default: return '';
  }
};

const unitForWindowHours = (hours: number): DecisionWindowUnit => hours % 24 === 0 ? 'days' : 'hours';

const amountForWindowUnit = (hours: number, unit: DecisionWindowUnit) => {
  if (unit === 'days') return clampNumber(hours / 24, 7, 1, 7);
  return clampNumber(hours, 168, 1, 168);
};

const hoursFromWindowAmount = (amount: number, unit: DecisionWindowUnit) => {
  if (unit === 'days') return clampNumber(amount, 7, 1, 7) * 24;
  return clampNumber(amount, 168, 1, 168);
};

const operatorLabel = (operator?: string, valueType?: RuleValueType) => {
  const pool = valueType === 'text' ? TEXT_OPERATORS : NUMBER_OPERATORS;
  return pool.find((item) => item.value === operator)?.label ?? operator ?? 'is';
};

const conditionFor = (
  option: RuleOption,
  operator?: string,
  value?: string | number | boolean,
  extras?: { minVisits?: number; maxVisits?: number; captureRate?: number },
) => {
  if (option.conditionKind === 'metric') {
    return { metric: option.metric ?? option.value, operator, value, captureRate: extras?.captureRate };
  }
  if (option.conditionKind === 'attribute') {
    return { attribute: option.attribute ?? option.value, operator, value, captureRate: extras?.captureRate };
  }
  return {
    signal: option.value,
    ...(['churn_risk', 'loyal_user'].includes(option.value) ? { minVisits: extras?.minVisits ?? option.defaultMinVisits ?? 1 } : {}),
    ...(option.value === 'new_user' ? { maxVisits: extras?.maxVisits ?? option.defaultMaxVisits ?? 3 } : {}),
    captureRate: extras?.captureRate,
  };
};

const primitiveConditionValue = (value: unknown): string | number | boolean | undefined => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return undefined;
};

const conditionForNormalizedRule = (
  option: RuleOption,
  rule: Pick<SmartCaptureRule, 'condition'>,
  operator?: string,
  value?: string | number | boolean,
  extras?: { minVisits?: number; maxVisits?: number; captureRate?: number },
) => {
  const valueIsEmpty = value === undefined || value === null || value === '';
  const normalizedOperator = option.value === 'user_metadata' && valueIsEmpty
    ? 'exists'
    : operator;
  const scope = supportsScopedMetricOption(option) ? scopeForCondition(rule.condition) : null;
  if (option.value === 'custom_event') {
    return { attribute: 'event_name', operator: normalizedOperator, value, captureRate: extras?.captureRate };
  }
  if (option.value === 'user_metadata') {
    return {
      attribute: dynamicAttributeForRule(rule, 'userId') ?? 'userId',
      operator: normalizedOperator,
      ...(valueIsEmpty ? {} : { value }),
      captureRate: extras?.captureRate,
    };
  }
  const condition = conditionFor(option, normalizedOperator, value, extras);
  return scope ? { ...condition, scope } : condition;
};

const labelForRule = (
  option: RuleOption,
  operator?: string,
  value?: unknown,
  windowHours?: number,
  minVisits?: number,
  condition?: Record<string, unknown>,
) => {
  const scopeLabel = supportsScopedMetricOption(option) ? scopeLabelForCondition(condition) : '';
  if (option.value === 'churn_risk') {
    return `Pre Churn after ${minVisits ?? option.defaultMinVisits ?? 1} visits and no return`;
  }
  if (option.value === 'loyal_user') {
    return `Loyal user with ${minVisits ?? option.defaultMinVisits ?? 5}+ sessions`;
  }
  if (option.value === 'new_user') {
    return `New user within first ${minVisits ?? option.defaultMaxVisits ?? 3} sessions`;
  }
  if (option.value === 'bouncer') {
    return `Bouncer session under ${String(value ?? option.defaultValue ?? 10)} seconds`;
  }
  if (option.needsValue) {
    const suffix = valueSuffix(option.valueType);
    const displayValue = String(value ?? option.defaultValue ?? '').trim();
    const formattedValue = option.valueType === 'score'
      ? `${displayValue}${suffix}`
      : `${displayValue}${suffix ? ` ${suffix}` : ''}`;
    return `${option.label} ${operatorLabel(operator, option.valueType)} ${formattedValue}${scopeLabel}`.slice(0, 120);
  }
  return `${option.label}${scopeLabel}`.slice(0, 120);
};

const smartCaptureConditionClauses = (rule: Pick<SmartCaptureRule, 'condition'>): Record<string, unknown>[] => {
  const rawClauses = isRecord(rule.condition) && Array.isArray(rule.condition.all)
    ? rule.condition.all
    : [];
  return rawClauses.filter(isRecord);
};

const conditionClauseFromRule = (rule: SmartCaptureRule): Record<string, unknown> | null => {
  const condition = isRecord(rule.condition) ? rule.condition : {};
  const clause: Record<string, unknown> = {};
  const type = stringFromUnknown(rule.type);
  const signal = stringFromUnknown(rule.signal ?? condition.signal);
  const metric = stringFromUnknown(condition.metric);
  const attribute = stringFromUnknown(condition.attribute);
  const operator = stringFromUnknown(rule.operator ?? condition.operator);
  const value = primitiveConditionValue(rule.value ?? condition.value);
  const minVisits = primitiveConditionValue(condition.minVisits ?? condition.visitCount ?? condition.minVisitCount);
  const maxVisits = primitiveConditionValue(condition.maxVisits ?? condition.sessionWindowSize ?? condition.maxVisitCount);
  const scope = scopeForCondition(condition);

  if (type) clause.type = type;
  if (signal) clause.signal = signal;
  if (metric) clause.metric = metric;
  if (attribute) clause.attribute = attribute;
  if (operator) clause.operator = operator;
  if (value !== undefined && operator !== 'exists') clause.value = value;
  if (minVisits !== undefined) clause.minVisits = minVisits;
  if (maxVisits !== undefined) clause.maxVisits = maxVisits;
  if (scope) clause.scope = scope;

  return Object.keys(clause).length > 0 ? clause : null;
};

const ruleFromConditionClause = (
  parentRule: SmartCaptureRule,
  clause: Record<string, unknown>,
  index: number,
): SmartCaptureRule => {
  const condition = isRecord(clause.condition)
    ? { ...clause.condition, ...(isRecord(clause.scope) ? { scope: clause.scope } : {}) }
    : clause;
  const metric = stringFromUnknown(condition.metric);
  const attribute = stringFromUnknown(condition.attribute);
  const signal = stringFromUnknown(clause.signal ?? condition.signal) ?? metric ?? attribute ?? '';
  const type = stringFromUnknown(clause.type ?? condition.type) ?? (metric ? 'metric' : attribute ? 'attribute' : '');
  const option = optionFor(signal, type, condition);
  const operator = stringFromUnknown(clause.operator ?? condition.operator) ?? option.defaultOperator;
  const value = operator === 'exists'
    ? undefined
    : primitiveConditionValue(clause.value ?? condition.value) ?? option.defaultValue;
  const minVisits = primitiveConditionValue(condition.minVisits ?? condition.visitCount ?? condition.minVisitCount);
  const maxVisits = primitiveConditionValue(condition.maxVisits ?? condition.sessionWindowSize ?? condition.maxVisitCount);
  const clauseCondition = option.value === ''
    ? condition
    : conditionForNormalizedRule(option, { condition }, operator, value, {
      minVisits: typeof minVisits === 'number' ? minVisits : undefined,
      maxVisits: typeof maxVisits === 'number' ? maxVisits : undefined,
      captureRate: undefined,
    });

  return {
    id: `${parentRule.id}_clause_${index}`,
    type: type || option.type,
    name: option.value ? option.label : '',
    label: option.value ? labelForRule(
      option,
      operator,
      value,
      parentRule.windowHours,
      typeof minVisits === 'number'
        ? minVisits
        : typeof maxVisits === 'number'
          ? maxVisits
          : undefined,
      clauseCondition,
    ) : '',
    color: parentRule.color,
    enabled: true,
    immediate: true,
    signal: option.value,
    operator,
    value,
    condition: clauseCondition,
  };
};

const conditionClauseLabel = (clause: Record<string, unknown>, parentRule: SmartCaptureRule, index: number): string => {
  const clauseRule = ruleFromConditionClause(parentRule, clause, index);
  const option = optionFor(clauseRule.signal, clauseRule.type, clauseRule.condition);
  const attribute = stringFromUnknown(clauseRule.condition?.attribute);
  const operator = stringFromUnknown(clauseRule.operator ?? clauseRule.condition?.operator);
  const value = primitiveConditionValue(clauseRule.value ?? clauseRule.condition?.value);
  const visitCount = option.value === 'new_user'
    ? Number(clauseRule.condition?.maxVisits) || undefined
    : Number(clauseRule.condition?.minVisits) || undefined;

  if (operator === 'exists' && attribute) {
    return `${option.label || 'Metadata'} has ${attribute}`;
  }
  return labelForRule(option, operator, value, clauseRule.windowHours, visitCount, clauseRule.condition);
};

const compoundRuleLabel = (clauses: Record<string, unknown>[], parentRule: SmartCaptureRule): string => (
  clauses
    .map((clause, index) => conditionClauseLabel(clause, parentRule, index))
    .filter(Boolean)
    .join(' AND ')
    .slice(0, 120)
);

const createRule = (kind: RuleKind): SmartCaptureRule => {
  const option = optionFor(kind);
  const operator = option.defaultOperator;
  const value = option.defaultValue;
  const captureRate = 100;
  const windowHours = option.defaultWindowHours;
  const minVisits = option.defaultMinVisits;
  const maxVisits = option.defaultMaxVisits;
  const condition = conditionForNormalizedRule(option, {}, operator, value, { minVisits, maxVisits, captureRate });
  return {
    id: `rule_${kind}_${Date.now()}_${Math.round(Math.random() * 1000)}`,
    type: option.type,
    name: option.label,
    signal: option.value,
    label: labelForRule(option, operator, value, windowHours, minVisits ?? maxVisits),
    color: GROUP_DEFAULT_COLOR[option.group],
    enabled: true,
    immediate: !option.delayedByDefault,
    operator,
    value,
    windowHours,
    captureRate,
    condition,
  };
};

const createBlankRule = (): SmartCaptureRule => ({
  id: `rule_blank_${Date.now()}_${Math.round(Math.random() * 1000)}`,
  type: '',
  name: '',
  signal: '',
  label: '',
  color: 'slate',
  enabled: true,
  immediate: true,
  condition: {},
});

const isBlankRule = (rule: SmartCaptureRule): boolean => {
  const clauses = smartCaptureConditionClauses(rule);
  if (clauses.length > 0) {
    return clauses.some((clause, index) => isBlankRule(ruleFromConditionClause(rule, clause, index)));
  }
  return optionFor(rule.signal, rule.type, rule.condition).value === '' || hasEmptyScope(rule.condition);
};

const normalizeRule = (rule: SmartCaptureRule): SmartCaptureRule => {
  const option = optionFor(rule.signal, rule.type, rule.condition);
  const operator = rule.operator ?? stringFromUnknown(rule.condition?.operator) ?? option.defaultOperator;
  const value = rule.value ?? primitiveConditionValue(rule.condition?.value) ?? option.defaultValue;
  const captureRate = clampNumber(rule.captureRate, 100, 0, 100);
  const color = normalizeRuleColor(rule.color, GROUP_DEFAULT_COLOR[option.group]);
  const compoundClauses = smartCaptureConditionClauses(rule);
  const windowHours = option.delayedByDefault || rule.immediate === false
    ? clampNumber(rule.windowHours, option.defaultWindowHours ?? 168, 1, 168)
    : rule.windowHours;
  const minVisits = clampNumber(rule.condition?.minVisits, option.defaultMinVisits ?? 1, 1, 100);
  const maxVisits = clampNumber(rule.condition?.maxVisits, option.defaultMaxVisits ?? 3, 1, 25);
  const condition = compoundClauses.length > 0
    ? { ...rule.condition, all: compoundClauses }
    : conditionForNormalizedRule(option, rule, operator, value, { minVisits, maxVisits, captureRate });

  return {
    ...rule,
    type: option.type,
    name: typeof rule.name === 'string' && rule.name.trim() ? rule.name.trim().slice(0, 80) : option.label,
    signal: option.value,
    label: compoundClauses.length > 0
      ? (compoundRuleLabel(compoundClauses, rule) || labelForRule(option, operator, value, windowHours, option.value === 'new_user' ? maxVisits : minVisits, condition))
      : labelForRule(option, operator, value, windowHours, option.value === 'new_user' ? maxVisits : minVisits, condition),
    color,
    enabled: rule.enabled !== false,
    immediate: rule.immediate === false ? false : !option.delayedByDefault,
    operator,
    value,
    windowHours,
    captureRate,
    condition,
  };
};

const uniqueRuleId = (prefix: string) => `${prefix}_${Date.now()}_${Math.round(Math.random() * 1000)}`;

const namedRule = (kind: RuleKind, label: string, patch: Partial<SmartCaptureRule> = {}): SmartCaptureRule => {
  const base = createRule(kind);
  const option = optionFor(patch.signal ?? base.signal, patch.type ?? base.type, patch.condition ?? base.condition);
  const operator = patch.operator ?? base.operator;
  const value = patch.value ?? base.value;
  const captureRate = clampNumber(patch.captureRate ?? base.captureRate, 100, 0, 100);
  const minVisits = clampNumber(patch.condition?.minVisits ?? base.condition?.minVisits, option.defaultMinVisits ?? 1, 1, 100);
  const maxVisits = clampNumber(patch.condition?.maxVisits ?? base.condition?.maxVisits, option.defaultMaxVisits ?? 3, 1, 25);
  const windowHours = patch.windowHours ?? base.windowHours;
  const condition = patch.condition ?? conditionForNormalizedRule(option, base, operator, value, { minVisits, maxVisits, captureRate });
  return {
    ...base,
    ...patch,
    id: patch.id ?? uniqueRuleId('ai'),
    name: label,
    label: labelForRule(option, operator, value, windowHours, option.value === 'new_user' ? maxVisits : minVisits, condition),
    operator,
    value,
    captureRate,
    condition,
  };
};

const firstNumber = (text: string): number | undefined => {
  const match = text.match(/\b(\d+(?:\.\d+)?)\b/);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
};

const promptMentionsCheckoutIntent = (prompt: string): boolean => (
  /\b(checkout|cart|basket|payment|purchase|order)\b/i.test(prompt)
);

const fallbackRuleFromPrompt = (prompt: string, label: string): SmartCaptureRule => {
  const normalized = prompt.toLowerCase();
  const captureRateMatch = normalized.match(/\b(save|keep|sample|capture)\s+(\d{1,3})\s*%/);
  const thresholdText = normalized.replace(/\b(save|keep|sample|capture)\s+\d{1,3}\s*%/g, '');
  const number = firstNumber(thresholdText);
  const captureRate = captureRateMatch
    ? clampNumber(Number(captureRateMatch[2]), 100, 0, 100)
    : undefined;
  const withCaptureRate = (rule: SmartCaptureRule) => captureRate === undefined ? rule : { ...rule, captureRate, condition: { ...rule.condition, captureRate } };

  if (/\b(cart|basket)\b.*\b(abandon|abandoned|drop|left|bounce|failed?)\b|\b(abandon|abandoned)\b.*\b(cart|basket)\b/.test(normalized)) {
    return withCaptureRate(namedRule('cart_abandonment', label));
  }
  if (/\b(checkout|payment|order|purchase)\b.*\b(fail|failed|failure|error|bounce|bounced|abandon|abandoned|decline|declined|drop|left|risk)\b|\b(fail|failed|failure|abandon|abandoned|decline|declined)\b.*\b(checkout|payment|order|purchase)\b/.test(normalized)) {
    return withCaptureRate(namedRule('checkout_risk', label));
  }
  if (/\b(onboarding|signup|sign up|activation|tutorial|first run)\b.*\b(fail|failed|friction|drop|dropped|bounce|bounced|abandon|abandoned|risk|stuck)\b|\b(fail|failed|drop|dropped|stuck)\b.*\b(onboarding|signup|sign up|activation|tutorial|first run)\b/.test(normalized)) {
    return withCaptureRate(namedRule('onboarding_risk', label));
  }
  if (/\b(new users?|first[-\s]?time users?|first session|first few sessions|first \d+ sessions|recent signups?|just joined)\b/.test(normalized)) {
    return withCaptureRate(namedRule('new_user', label, number ? { condition: { signal: 'new_user', maxVisits: number, captureRate } } : {}));
  }
  if (/\b(pre[-\s]?churn|churn risk|churn|churns|churned|churning|no return|not return|didn'?t return|never returned|came once)\b/.test(normalized)) {
    return withCaptureRate(namedRule('churn_risk', label));
  }
  if (/\b(rage|angry|rapid click|rage tap|rage click)\b/.test(normalized)) {
    return withCaptureRate(namedRule('rage_clicks', label, number ? { value: number, condition: { metric: 'rage_tap_count', operator: 'gte', value: number, captureRate } } : {}));
  }
  if (/\b(dead taps?|dead clicks?|unresponsive taps?|unresponsive clicks?)\b/.test(normalized)) {
    return withCaptureRate(namedRule('dead_taps', label, number ? { value: number, condition: { metric: 'dead_tap_count', operator: 'gte', value: number, captureRate } } : {}));
  }
  if (/\b(crash|crashes|crashed|crashy)\b/.test(normalized)) {
    return withCaptureRate(namedRule('crashes', label));
  }
  if (/\b(anr|hang|hung|freeze|frozen)\b/.test(normalized)) {
    return withCaptureRate(namedRule('anrs', label));
  }
  if (/\b(js error|javascript error|exception|frontend error|client error)\b/.test(normalized)) {
    return withCaptureRate(namedRule('js_error', label));
  }
  if (/\b(api error rate|error rate|failure rate)\b/.test(normalized)) {
    return withCaptureRate(namedRule('api_error_rate', label, number ? { value: number, condition: { metric: 'api_error_rate', operator: 'gte', value: number, captureRate } } : {}));
  }
  if (/\b(api|request|endpoint|network)\b.*\b(fail|failed|failure|error|500|4xx|5xx)\b/.test(normalized)) {
    return withCaptureRate(namedRule('api_error', label, number ? { value: number, condition: { metric: 'api_error_count', operator: 'gte', value: number, captureRate } } : {}));
  }
  if (/\b(slow|latency|laggy)\b.*\b(api|request|endpoint|network)\b|\b(api|request|endpoint|network)\b.*\b(slow|latency|laggy)\b/.test(normalized)) {
    const latencyMs = number ? (/\bsec|second/.test(normalized) ? number * 1000 : number) : undefined;
    return withCaptureRate(namedRule('slow_api', label, latencyMs ? { value: latencyMs, condition: { metric: 'api_avg_response_ms', operator: 'gte', value: latencyMs, captureRate } } : {}));
  }
  if (/\b(slow start|startup|launch time|app start)\b/.test(normalized)) {
    const startupMs = number ? (/\bsec|second/.test(normalized) ? number * 1000 : number) : undefined;
    return withCaptureRate(namedRule('slow_start', label, startupMs ? { value: startupMs, condition: { metric: 'app_startup_time_ms', operator: 'gte', value: startupMs, captureRate } } : {}));
  }
  if (/\b(duration|long session|stuck for|over \d+ (secs?|seconds?|mins?|minutes?)|more than \d+ (secs?|seconds?|mins?|minutes?)|longer than \d+ (secs?|seconds?|mins?|minutes?))\b/.test(normalized)) {
    const durationSeconds = number ? (/\bmin|minute/.test(normalized) ? number * 60 : number) : undefined;
    return withCaptureRate(namedRule('duration', label, durationSeconds ? { value: durationSeconds, condition: { metric: 'duration_seconds', operator: 'gte', value: durationSeconds, captureRate } } : {}));
  }
  if (/\b(screen|page|route|view)s?\b.*\b(\d+)\b|\b(\d+)\b.*\b(screen|page|route|view)s?\b/.test(normalized)) {
    return withCaptureRate(namedRule('screen_count', label, number ? { value: number, condition: { metric: 'screen_count', operator: 'gte', value: number, captureRate } } : {}));
  }
  if (/\b(loyal|power users?|returning|came back|repeat users?)\b/.test(normalized)) {
    return withCaptureRate(namedRule('loyal_user', label, number ? { condition: { signal: 'loyal_user', minVisits: number, captureRate } } : {}));
  }
  return withCaptureRate(namedRule('engagement_score', label, number ? { value: number, condition: { metric: 'interaction_score', operator: 'gte', value: number, captureRate } } : {}));
};

// Maps a QueryBuilder condition to a Smart Capture rule
export const mapQueryConditionToRule = (cond: QueryCondition, label: string, prompt?: string): SmartCaptureRule | null => {
  if (cond.type === 'issue') {
    if (cond.issueFilter === 'crashes') return namedRule('crashes', label);
    if (cond.issueFilter === 'anrs') return namedRule('anrs', label);
    if (cond.issueFilter === 'errors') return namedRule('js_error', label);
    if (cond.issueFilter === 'rage') return namedRule('rage_clicks', label);
    if (cond.issueFilter === 'dead_taps') return namedRule('dead_taps', label);
    if (cond.issueFilter === 'slow_start') return namedRule('slow_start', label);
    if (cond.issueFilter === 'slow_api') return namedRule('slow_api', label);
  }
  if (cond.type === 'screen') {
    const rule = createRule('screen_name');
    rule.operator = 'contains';
    rule.value = cond.screenName;
    rule.condition = { ...rule.condition, attribute: 'screen_name', operator: 'contains', value: cond.screenName };
    rule.name = label;
    return rule;
  }
  if (cond.type === 'event') {
    const rule = createRule('custom_event');
    rule.operator = 'contains';
    rule.value = cond.eventName;
    rule.condition = { ...rule.condition, attribute: 'event_name', operator: 'contains', value: cond.eventName };
    rule.name = label;
    return rule;
  }
  if (cond.type === 'metadata') {
    const rule = createRule('user_metadata');
    rule.operator = cond.metaValue ? 'eq' : 'exists';
    rule.value = cond.metaValue ?? undefined;
    rule.condition = cond.metaValue
      ? { ...rule.condition, attribute: cond.metaKey, operator: rule.operator, value: rule.value }
      : { ...rule.condition, attribute: cond.metaKey, operator: rule.operator };
    rule.name = label;
    return rule;
  }
  if (cond.type === 'platform') {
    const rule = createRule('platform');
    rule.operator = 'eq';
    rule.value = cond.platform;
    rule.condition = { ...rule.condition, attribute: 'platform', operator: 'eq', value: cond.platform };
    rule.name = label;
    return rule;
  }
  if (cond.type === 'referral') {
    const rule = namedRule('user_metadata', label, { value: cond.referralValue ?? '' });
    rule.condition = { ...rule.condition, attribute: 'webReferral', operator: cond.referralValue ? 'contains' : 'eq', value: cond.referralValue ?? '' };
    rule.operator = cond.referralValue ? 'contains' : 'eq';
    return rule;
  }
  if (cond.type === 'utm') {
    const rule = namedRule('user_metadata', label, { value: cond.value ?? '' });
    rule.condition = { ...rule.condition, attribute: UTM_FIELD_META_KEYS[cond.field], operator: cond.value ? 'contains' : 'eq', value: cond.value ?? '' };
    rule.operator = cond.value ? 'contains' : 'eq';
    return rule;
  }
  if (cond.type === 'journey' && cond.steps.length > 0) {
    const rule = createRule('screen_name');
    const screenName = cond.steps[cond.steps.length - 1];
    rule.operator = 'contains';
    rule.value = screenName;
    rule.condition = { ...rule.condition, attribute: 'screen_name', operator: 'contains', value: screenName };
    rule.name = label;
    return rule;
  }
  if (cond.type === 'lifecycle') {
    if (cond.preset === 'returning_user') return namedRule('loyal_user', label);
    if (cond.preset === 'early_user') {
      return namedRule('new_user', label, {
        condition: { signal: 'new_user', maxVisits: cond.sessionWindowSize ?? 3, captureRate: 100 },
      });
    }
  }
  if (cond.type === 'conversion' && prompt !== undefined && !promptMentionsCheckoutIntent(prompt)) {
    return null;
  }
  if (cond.type === 'conversion' && cond.preset === 'checkout_bounced') {
    return namedRule('checkout_risk', label);
  }
  if (cond.type === 'conversion' && cond.preset === 'checkout_success') {
    return namedRule('custom_event', label, {
      operator: 'contains',
      value: 'checkout_success',
      condition: { attribute: 'event_name', operator: 'contains', value: 'checkout_success', captureRate: 100 },
    });
  }
  return null;
};

const conditionCapturePriority = (cond: QueryCondition): number => {
  switch (cond.type) {
    case 'conversion': return 100;
    case 'issue': return 95;
    case 'event': return 85;
    case 'journey': return 80;
    case 'screen': return 75;
    case 'metadata':
    case 'utm':
    case 'referral': return 65;
    case 'lifecycle': return 60;
    case 'platform': return 25;
    case 'date': return 5;
    case 'smart_capture': return 0;
    default: return 0;
  }
};

type MappedRuleCandidate = {
  cond: QueryCondition;
  rule: SmartCaptureRule;
  priority: number;
  index: number;
};

const shouldScopePromptToScreen = (prompt: string, issueFilter: string): boolean => {
  const normalized = prompt.toLowerCase();
  const issuePattern = issueFilter === 'dead_taps'
    ? String.raw`(?:dead\s+(?:tap|taps|click|clicks)|unresponsive\s+(?:tap|taps|click|clicks))`
    : String.raw`(?:rage|angry|rapid\s+(?:tap|taps|click|clicks))`;
  const scopePreposition = String.raw`(?:on|at|in|inside|within|during|while\s+on|when\s+on)`;
  return new RegExp(`${issuePattern}.{0,80}\\b${scopePreposition}\\b`).test(normalized)
    || new RegExp(`\\b${scopePreposition}\\b.{0,80}${issuePattern}`).test(normalized);
};

const scopedMetricRuleFromCandidates = (candidates: MappedRuleCandidate[], label: string, prompt: string) => {
  const issueCandidate = candidates.find((candidate) => (
    candidate.cond.type === 'issue'
      && ['rage', 'dead_taps'].includes(candidate.cond.issueFilter)
      && shouldScopePromptToScreen(prompt, candidate.cond.issueFilter)
  ));
  const screenCandidate = candidates.find((candidate) => (
    candidate.index !== issueCandidate?.index
      && (candidate.cond.type === 'screen' || (candidate.cond.type === 'journey' && candidate.cond.steps.length > 0))
  ));

  if (!issueCandidate || !screenCandidate) return null;

  const scopeClause = conditionClauseFromRule(screenCandidate.rule);
  const scopeAttribute = stringFromUnknown(scopeClause?.attribute);
  const scopeValue = primitiveConditionValue(scopeClause?.value);
  if (!scopeAttribute || scopeValue === undefined) return null;

  const condition = {
    ...issueCandidate.rule.condition,
    scope: {
      attribute: scopeAttribute,
      operator: stringFromUnknown(scopeClause?.operator) ?? 'contains',
      value: scopeValue,
    },
  };
  const option = optionFor(issueCandidate.rule.signal, issueCandidate.rule.type, condition);
  const scopedLabel = labelForRule(
    option,
    issueCandidate.rule.operator,
    issueCandidate.rule.value,
    issueCandidate.rule.windowHours,
    Number(issueCandidate.rule.condition?.minVisits) || undefined,
    condition,
  );
  const scopedRule = {
    ...issueCandidate.rule,
    id: uniqueRuleId('ai'),
    name: scopedLabel || label,
    label: scopedLabel || label,
    condition,
  };

  return {
    rule: scopedRule,
    consumedIndexes: new Set([issueCandidate.index, screenCandidate.index]),
  };
};

const compoundRuleFromCandidates = (candidates: MappedRuleCandidate[], label: string, prompt = ''): SmartCaptureRule | null => {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].rule;

  const scopedMetric = scopedMetricRuleFromCandidates(candidates, label, prompt);
  if (scopedMetric) {
    const remainingCandidates = candidates.filter((candidate) => !scopedMetric.consumedIndexes.has(candidate.index));
    if (remainingCandidates.length === 0) return scopedMetric.rule;

    const clauses = [
      conditionClauseFromRule(scopedMetric.rule),
      ...remainingCandidates.map((candidate) => conditionClauseFromRule(candidate.rule)),
    ].filter((clause): clause is Record<string, unknown> => Boolean(clause));

    if (clauses.length <= 1) return scopedMetric.rule;

    const nextRule: SmartCaptureRule = {
      ...scopedMetric.rule,
      id: uniqueRuleId('ai'),
      name: label,
      label,
      enabled: true,
      immediate: scopedMetric.rule.immediate !== false,
      captureRate: scopedMetric.rule.captureRate ?? 100,
      condition: { all: clauses },
    };

    return {
      ...nextRule,
      label: compoundRuleLabel(clauses, nextRule) || label,
    };
  }

  const sortedCandidates = [...candidates].sort((a, b) => b.priority - a.priority);
  const primary = sortedCandidates[0].rule;
  const clauses = candidates
    .map((candidate) => conditionClauseFromRule(candidate.rule))
    .filter((clause): clause is Record<string, unknown> => Boolean(clause));

  if (clauses.length <= 1) return primary;

  const nextRule: SmartCaptureRule = {
    ...primary,
    id: uniqueRuleId('ai'),
    name: label,
    label,
    enabled: true,
    immediate: primary.immediate !== false,
    captureRate: primary.captureRate ?? 100,
    condition: { all: clauses },
  };

  return {
    ...nextRule,
    label: compoundRuleLabel(clauses, nextRule) || label,
  };
};

export const inferRulesFromConditions = (groups: QueryGroup[], prompt: string, explanation?: string): SmartCaptureRule[] => {
  const hasUsableConditions = groups.some((group) => group.conditions.length > 0);
  const fallbackLabelSource = hasUsableConditions
    ? explanation?.replace(/^Find sessions where\s+/i, '').replace(/\.$/, '')
    : prompt;
  const fallbackLabel = (fallbackLabelSource || prompt).slice(0, 120);

  const groupRules = groups
    .filter((group) => group.conditions.length > 0)
    .map((group) => {
      const candidates = group.conditions
        .map((cond, index) => ({ cond, rule: mapQueryConditionToRule(cond, fallbackLabel, prompt), priority: conditionCapturePriority(cond), index }))
        .filter((candidate): candidate is MappedRuleCandidate => Boolean(candidate.rule));
      return compoundRuleFromCandidates(candidates, fallbackLabel, prompt);
    })
    .filter((rule): rule is SmartCaptureRule => Boolean(rule));

  if (groupRules.length > 0) return groupRules;
  
  return [fallbackRuleFromPrompt(prompt, fallbackLabel)];
};

export const inferRuleFromConditions = (groups: QueryGroup[], prompt: string, explanation?: string): SmartCaptureRule => {
  return inferRulesFromConditions(groups, prompt, explanation)[0] ?? fallbackRuleFromPrompt(prompt, prompt.slice(0, 120));
};

interface SmartCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string;
  pathPrefix: string;
  config: SmartCaptureConfig | null;
  isLoading: boolean;
  availableFilters: AvailableFilters;
  isLoadingFilters: boolean;
  onConfigChange: (config: SmartCaptureConfig) => void;
}

export const SmartCaptureModal: React.FC<SmartCaptureModalProps> = ({
  isOpen,
  onClose,
  projectId,
  pathPrefix,
  config,
  isLoading,
  availableFilters,
  isLoadingFilters,
  onConfigChange,
}) => {
  const [captureMode, setCaptureMode] = useState<SmartCaptureMode>('record_all');
  const [decisionWindowHours, setDecisionWindowHours] = useState(168);
  const [decisionWindowUnits, setDecisionWindowUnits] = useState<Record<string, DecisionWindowUnit>>({});
  const [rules, setRules] = useState<SmartCaptureRule[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  
  const [prompt, setPrompt] = useState('');
  const [isParsingRule, setIsParsingRule] = useState(false);
  const [builderExplanation, setBuilderExplanation] = useState<string | null>(null);
  const [editingRuleNameId, setEditingRuleNameId] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    setCaptureMode(config.enabled ? config.mode : 'record_all');
    setDecisionWindowHours(clampNumber(config.decisionWindowHours, 168, 1, 168));
    const nextRules = (config.rules ?? []).map(normalizeRule);
    setRules(nextRules);
    setError(null);
    setBuilderExplanation(null);
    setDecisionWindowUnits({});
    setEditingRuleNameId(null);
    setDirty(false);
  }, [config]);

  const entitled = Boolean(config?.entitlement.smartCaptureEnabled);
  const locked = !entitled;
  const controlsDisabled = !projectId || locked || isLoading || isSaving;
  const smartCaptureEnabled = captureMode === 'smart_capture';

  const ruleOptionGroups = useMemo(() => Array.from(new Set(VISIBLE_RULE_OPTIONS.map((option) => option.group))), []);
  const customEventOptions = useMemo(() => uniqueStrings(availableFilters.events), [availableFilters.events]);
  const metadataKeyOptions = useMemo(() => uniqueStrings(Object.keys(availableFilters.metadata)), [availableFilters.metadata]);
  const metadataValuesForKeys = (keys: string[]) => (
    uniqueStrings(keys.flatMap((key) => availableFilters.metadata[key] ?? []))
  );
  const selectableValuesForAttribute = (attribute: string, currentValue?: string) => {
    const attributeKind = attribute as RuleKind;
    const metadataValues = metadataValuesForKeys(ATTRIBUTE_VALUE_KEYS[attributeKind] ?? [attribute]);
    const screenValues = ['screen_name', 'url_path'].includes(attribute) ? availableFilters.screens : [];
    return uniqueStrings([
      ...screenValues,
      ...metadataValues,
      ...(STATIC_ATTRIBUTE_VALUES[attributeKind] ?? []),
      currentValue,
    ]);
  };
  const selectableValuesForOption = (option: RuleOption, currentValue?: string) => {
    if (option.value === 'custom_event') return uniqueStrings([...customEventOptions, currentValue]);
    if (option.conditionKind !== 'attribute' || option.value === 'user_metadata') return [];
    return selectableValuesForAttribute(option.attribute ?? option.value, currentValue);
  };
  const defaultValueForOption = (option: RuleOption) => {
    const choices = selectableValuesForOption(option);
    return choices[0] ?? option.defaultValue;
  };
  const defaultScopeValueForAttribute = (attribute: string) => (
    selectableValuesForAttribute(attribute)[0] ?? ''
  );

  const markDraft = (options?: { keepBuilderExplanation?: boolean }) => {
    setDirty(true);
    setError(null);
    if (!options?.keepBuilderExplanation) {
      setBuilderExplanation(null);
    }
  };

  const setRuleWindowUnit = (rule: SmartCaptureRule, unit: DecisionWindowUnit, fallbackHours: number) => {
    setDecisionWindowUnits((current) => ({ ...current, [rule.id]: unit }));
    const currentHours = clampNumber(rule.windowHours, fallbackHours, 1, 168);
    updateRule(rule.id, { windowHours: hoursFromWindowAmount(amountForWindowUnit(currentHours, unit), unit) });
  };

  const addRule = () => {
    if (rules.length >= 20) {
      setError('Smart Capture supports up to 20 rules.');
      return;
    }
    setCaptureMode('smart_capture');
    const nextRule = createBlankRule();
    setRules((current) => [...current, nextRule]);
    markDraft();
  };

  const buildRuleWithPatch = (rule: SmartCaptureRule, patch: Partial<SmartCaptureRule> & { minVisits?: number; maxVisits?: number }): SmartCaptureRule => {
      const currentOption = optionFor(rule.signal, rule.type, rule.condition);
      const nextKind = (patch.signal ?? rule.signal ?? currentOption.value) as RuleKind;
      const nextOption = optionFor(nextKind);
      const signalChanged = patch.signal !== undefined && patch.signal !== rule.signal;
      const compoundClauses = smartCaptureConditionClauses(rule);
      const editsPredicate = patch.signal !== undefined
        || patch.type !== undefined
        || patch.operator !== undefined
        || patch.value !== undefined
        || patch.condition !== undefined
        || patch.minVisits !== undefined
        || patch.maxVisits !== undefined;
      const preserveCompound = compoundClauses.length > 0 && !editsPredicate;
      const existingOperator = rule.operator ?? stringFromUnknown(rule.condition?.operator);
      const existingValue = rule.value ?? primitiveConditionValue(rule.condition?.value);
      const operator = patch.operator ?? (signalChanged ? nextOption.defaultOperator : existingOperator ?? nextOption.defaultOperator);
      const rawValue = patch.value ?? (signalChanged ? nextOption.defaultValue : existingValue ?? nextOption.defaultValue);
      const value = nextOption.value === 'user_metadata' && rawValue === '' ? undefined : rawValue;
      const captureRate = nextOption.value === ''
        ? undefined
        : clampNumber(patch.captureRate ?? rule.captureRate, 100, 0, 100);
      const patchConditionProvided = patch.condition !== undefined;
      const patchCondition = isRecord(patch.condition) ? patch.condition : undefined;
      const existingScope = !signalChanged && !patchConditionProvided ? scopeForCondition(rule.condition) : null;
      const nextScope = supportsScopedMetricOption(nextOption)
        ? (scopeForCondition(patchCondition) ?? existingScope)
        : null;
      const color = normalizeRuleColor(patch.color ?? (signalChanged ? GROUP_DEFAULT_COLOR[nextOption.group] : rule.color), GROUP_DEFAULT_COLOR[nextOption.group]);
      const immediate = nextOption.delayedByDefault
        ? false
        : patch.immediate ?? (signalChanged ? true : rule.immediate ?? true);
      const windowHours = immediate === false
        ? clampNumber(patch.windowHours ?? rule.windowHours, nextOption.defaultWindowHours ?? decisionWindowHours, 1, 168)
        : patch.windowHours ?? rule.windowHours;
      const minVisits = clampNumber(
        patch.minVisits ?? rule.condition?.minVisits,
        nextOption.defaultMinVisits ?? 1,
        1,
        100,
      );
      const maxVisits = clampNumber(
        patch.maxVisits ?? rule.condition?.maxVisits,
        nextOption.defaultMaxVisits ?? 3,
        1,
        25,
      );
      const customAttribute = stringFromUnknown(patch.condition?.attribute)
        ?? (signalChanged ? undefined : stringFromUnknown(rule.condition?.attribute))
        ?? nextOption.attribute;
      const nextCondition = preserveCompound
        ? { ...rule.condition, all: compoundClauses }
        : nextOption.value === ''
        ? {}
        : nextOption.value === 'custom_event'
          ? { attribute: 'event_name', operator, value, captureRate }
          : nextOption.value === 'user_metadata'
            ? conditionForNormalizedRule(
              nextOption,
              { condition: { attribute: customAttribute ?? metadataKeyOptions[0] ?? 'userId' } },
              operator,
              value,
              { captureRate },
            )
            : conditionFor(nextOption, operator, value, { minVisits, maxVisits, captureRate });
      const scopedNextCondition = nextScope
        ? { ...nextCondition, scope: nextScope }
        : nextCondition;
      const normalizedOperator = stringFromUnknown((nextCondition as Record<string, unknown>).operator) ?? operator;
      const normalizedValue = primitiveConditionValue((nextCondition as Record<string, unknown>).value) ?? value;

      return {
        ...rule,
        ...patch,
        type: nextOption.type,
        name: typeof patch.name === 'string' ? patch.name.slice(0, 80) : signalChanged && !rule.name ? nextOption.label : rule.name,
        signal: nextOption.value,
        operator: normalizedOperator,
        value: normalizedValue,
        captureRate,
        color,
        immediate,
        windowHours,
        label: preserveCompound
          ? (compoundRuleLabel(compoundClauses, rule) || labelForRule(nextOption, normalizedOperator, normalizedValue, windowHours, minVisits))
          : labelForRule(nextOption, normalizedOperator, normalizedValue, windowHours, nextOption.value === 'new_user' ? maxVisits : minVisits, scopedNextCondition),
        condition: scopedNextCondition,
      };
  };

  const ruleWithCompoundClauses = (rule: SmartCaptureRule, clauses: Record<string, unknown>[]): SmartCaptureRule => {
    if (clauses.length <= 0) return rule;

    if (clauses.length === 1) {
      const singleRule = ruleFromConditionClause(rule, clauses[0], 0);
      return normalizeRule({
        ...rule,
        ...singleRule,
        id: rule.id,
        name: rule.name,
        color: rule.color,
        enabled: rule.enabled,
        captureRate: rule.captureRate,
        windowHours: rule.windowHours,
      });
    }

    const clauseRules = clauses.map((clause, index) => ruleFromConditionClause(rule, clause, index));
    const primaryRule = clauseRules.find((candidate) => !isBlankRule(candidate)) ?? clauseRules[0];
    const nextRule: SmartCaptureRule = {
      ...rule,
      type: primaryRule.type,
      signal: primaryRule.signal,
      operator: primaryRule.operator,
      value: primaryRule.value,
      condition: { ...rule.condition, all: clauses },
      label: compoundRuleLabel(clauses, rule) || rule.label,
    };
    return nextRule;
  };

  const updateRule = (ruleId: string, patch: Partial<SmartCaptureRule> & { minVisits?: number; maxVisits?: number }) => {
    setRules((current) => current.map((rule) => {
      if (rule.id !== ruleId) return rule;
      return buildRuleWithPatch(rule, patch);
    }));
    markDraft();
  };

  const updateRuleClause = (ruleId: string, clauseIndex: number, patch: Partial<SmartCaptureRule> & { minVisits?: number; maxVisits?: number }) => {
    setRules((current) => current.map((rule) => {
      if (rule.id !== ruleId) return rule;
      const clauses = smartCaptureConditionClauses(rule);
      if (!clauses[clauseIndex]) return rule;
      const clauseRule = ruleFromConditionClause(rule, clauses[clauseIndex], clauseIndex);
      const nextClauseRule = buildRuleWithPatch(clauseRule, patch);
      const nextClause = conditionClauseFromRule(nextClauseRule) ?? { type: '', signal: '' };
      const nextClauses = clauses.map((clause, index) => index === clauseIndex ? nextClause : clause);
      return ruleWithCompoundClauses(rule, nextClauses);
    }));
    markDraft();
  };

  const addRuleClause = (ruleId: string) => {
    setRules((current) => current.map((rule) => {
      if (rule.id !== ruleId) return rule;
      const existingClauses = smartCaptureConditionClauses(rule);
      const baseClause = conditionClauseFromRule(rule);
      const clauses = existingClauses.length > 0
        ? existingClauses
        : baseClause
          ? [baseClause]
          : [{ type: '', signal: '' }];
      return ruleWithCompoundClauses(rule, [...clauses, { type: '', signal: '' }]);
    }));
    markDraft();
  };

  const removeRuleClause = (ruleId: string, clauseIndex: number) => {
    setRules((current) => current.map((rule) => {
      if (rule.id !== ruleId) return rule;
      const clauses = smartCaptureConditionClauses(rule);
      if (clauses.length <= 1) return rule;
      return ruleWithCompoundClauses(rule, clauses.filter((_, index) => index !== clauseIndex));
    }));
    markDraft();
  };

  const removeRule = (ruleId: string) => {
    setRules((current) => current.filter((rule) => rule.id !== ruleId));
    markDraft();
  };

  const resetDraft = () => {
    if (!config) return;
    setCaptureMode(config.enabled ? config.mode : 'record_all');
    setDecisionWindowHours(clampNumber(config.decisionWindowHours, 168, 1, 168));
    const nextRules = (config.rules ?? []).map(normalizeRule);
    setRules(nextRules);
    setDecisionWindowUnits({});
    setEditingRuleNameId(null);
    setDirty(false);
    setError(null);
    setBuilderExplanation(null);
  };

  const saveConfig = async () => {
    if (!projectId) return;
    if (rules.some(isBlankRule)) {
      setError('Choose a rule type before saving.');
      return;
    }
    const normalizedRules = rules.map(normalizeRule);
    const payload: SmartCaptureConfigUpdate = {
      enabled: smartCaptureEnabled,
      mode: captureMode,
      preset: 'none',
      rules: normalizedRules,
      decisionWindowHours,
    };

    setIsSaving(true);
    setError(null);
    try {
      const updated = await updateProjectSmartCaptureConfig(projectId, payload);
      onConfigChange(updated);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Smart Capture settings');
    } finally {
      setIsSaving(false);
    }
  };

  const handlePromptSubmit = async () => {
    if (controlsDisabled || isParsingRule || !projectId || !prompt.trim()) return;
    if (rules.length >= 20) {
      setError('Smart Capture supports up to 20 rules.');
      return;
    }
    const trimmedPrompt = prompt.trim();
    setIsParsingRule(true);
    setError(null);
    setBuilderExplanation(null);
    try {
      const parsed = await buildSessionQueryFromPrompt(projectId, trimmedPrompt);
      const groups = (parsed.groups || []) as QueryGroup[];
      const explanation = parsed.explanation;
      const hasUsableConditions = groups.some((group) => group.conditions.length > 0);
      
      const nextRules = inferRulesFromConditions(groups, trimmedPrompt, explanation);
      
      setBuilderExplanation(hasUsableConditions ? (explanation || 'Created a rule based on your prompt.') : 'Created a Smart Capture rule from your prompt.');
      setCaptureMode('smart_capture');
      setRules((current) => [...current, ...nextRules].slice(0, 20));
      setPrompt('');
      markDraft({ keepBuilderExplanation: true });
    } catch (err) {
      const message = err instanceof Error && err.message.trim()
        ? err.message
        : 'Could not build that rule right now.';
      setError(`AI rule builder failed: ${message}`);
    } finally {
      setIsParsingRule(false);
    }
  };

  const handleClose = () => {
    if (dirty && typeof window !== 'undefined') {
      const confirmed = window.confirm('Discard unsaved Smart Capture changes?');
      if (!confirmed) return;
    }
    resetDraft();
    onClose();
  };

  const selectClass = 'smart-capture-select h-9 cursor-pointer appearance-none rounded-none border border-[#dadce0] bg-white pl-3 pr-8 text-base text-[#202124] outline-none transition-colors hover:bg-[#f8fafd] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20 disabled:cursor-not-allowed disabled:bg-[#f8fafd] disabled:text-[#80868b] sm:text-sm';
  const inputClass = 'h-9 rounded-none border border-[#dadce0] bg-white px-3 text-base text-[#202124] outline-none transition-colors placeholder:text-[#80868b] hover:bg-[#f8fafd] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20 disabled:cursor-not-allowed disabled:bg-[#f8fafd] disabled:text-[#80868b] sm:text-sm';
  const connectorClass = 'text-xs font-medium text-[#5f6368]';

  const renderConditionControls = (
    draftRule: SmartCaptureRule,
    option: RuleOption,
    onPatch: (patch: Partial<SmartCaptureRule> & { minVisits?: number; maxVisits?: number }) => void,
    options: { allowReturnWindow?: boolean } = {},
  ) => {
    const valueType = option.valueType ?? (option.conditionKind === 'attribute' ? 'text' : 'number');
    const operators = valueType === 'text' ? TEXT_OPERATORS : NUMBER_OPERATORS;
    const supportsReturnWindow = options.allowReturnWindow !== false && option.value === 'churn_risk';
    const minVisits = clampNumber(draftRule.condition?.minVisits, option.defaultMinVisits ?? 1, 1, 100);
    const maxVisits = clampNumber(draftRule.condition?.maxVisits, option.defaultMaxVisits ?? 3, 1, 25);
    const windowHours = clampNumber(draftRule.windowHours, option.defaultWindowHours ?? decisionWindowHours, 1, 168);
    const windowUnit = decisionWindowUnits[draftRule.id] ?? unitForWindowHours(windowHours);
    const windowAmount = amountForWindowUnit(windowHours, windowUnit);
    const currentEventName = stringFromUnknown(draftRule.value) ?? stringFromUnknown(draftRule.condition?.value) ?? '';
    const customEventChoices = uniqueStrings([...customEventOptions, currentEventName]);
    const currentTextValue = stringFromUnknown(draftRule.value) ?? stringFromUnknown(draftRule.condition?.value) ?? '';
    const textValueChoices = valueType === 'text' ? selectableValuesForOption(option, currentTextValue) : [];
    const metadataKey = dynamicAttributeForRule(draftRule, metadataKeyOptions[0] ?? 'userId') ?? 'userId';
    const metadataKeyChoices = uniqueStrings([...metadataKeyOptions, metadataKey]);
    const metadataValue = stringFromUnknown(draftRule.value) ?? stringFromUnknown(draftRule.condition?.value) ?? '';
    const metadataValueOptions = uniqueStrings([...(availableFilters.metadata[metadataKey] ?? []), metadataValue]);
    const scopedMetric = supportsScopedMetricOption(option);
    const scope = scopeForCondition(draftRule.condition);
    const scopeAttribute = stringFromUnknown(scope?.attribute) ?? '';
    const scopeValue = stringFromUnknown(scope?.value) ?? '';
    const scopeValueChoices = scopeAttribute ? selectableValuesForAttribute(scopeAttribute, scopeValue) : [];
    const patchScope = (attribute: string, value: string) => {
      const nextCondition = { ...(draftRule.condition ?? {}) };
      if (!attribute) {
        delete nextCondition.scope;
      } else {
        nextCondition.scope = { attribute, operator: 'contains', value };
      }
      onPatch({ condition: nextCondition });
    };

    return (
      <>
        <select
          value={option.value}
          disabled={controlsDisabled}
          onChange={(event) => {
            const nextKind = event.target.value as RuleKind;
            const nextOption = optionFor(nextKind);
            onPatch({
              type: nextOption.type,
              signal: nextKind,
              operator: nextOption.defaultOperator,
              value: defaultValueForOption(nextOption),
              immediate: !nextOption.delayedByDefault,
              windowHours: nextOption.defaultWindowHours,
              name: nextOption.label,
            });
          }}
          className={`${selectClass} w-full sm:w-48`}
        >
          <option value=""></option>
          {option.hidden && option.value && (
            <option value={option.value}>{option.label}</option>
          )}
          {ruleOptionGroups.map(groupName => (
            <optgroup key={groupName} label={groupName}>
              {VISIBLE_RULE_OPTIONS.filter(o => o.group === groupName).map(item => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        {option.value === 'custom_event' && customEventChoices.length > 0 && (
          <select
            value={currentEventName}
            disabled={controlsDisabled || isLoadingFilters}
            onChange={(event) => onPatch({ value: event.target.value })}
            className={`${selectClass} w-full sm:w-48`}
          >
            <option value="">Pick event...</option>
            {customEventChoices.map((eventName) => (
              <option key={eventName} value={eventName}>{eventName}</option>
            ))}
          </select>
        )}
        {option.value === 'custom_event' && customEventChoices.length <= 0 && (
          <input
            type="text"
            value={currentEventName}
            disabled={controlsDisabled}
            onChange={(event) => onPatch({ value: event.target.value })}
            className={`${inputClass} w-full sm:w-48`}
            placeholder="event name"
          />
        )}
        {option.value === 'user_metadata' && (
          <>
            <select
              value={metadataKey}
              disabled={controlsDisabled || isLoadingFilters}
              onChange={(event) => onPatch({
                condition: { ...draftRule.condition, attribute: event.target.value },
                value: '',
              })}
              className={`${selectClass} w-full sm:w-44`}
            >
              {metadataKeyChoices.map((key) => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
            <select
              value={metadataValue}
              disabled={controlsDisabled || isLoadingFilters}
              onChange={(event) => onPatch({ value: event.target.value })}
              className={`${selectClass} w-full sm:w-44`}
            >
              <option value="">any value</option>
              {metadataValueOptions.map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </>
        )}
        {option.needsValue && !['custom_event', 'user_metadata'].includes(option.value) && (
          <>
            <select
              value={draftRule.operator ?? option.defaultOperator ?? 'eq'}
              disabled={controlsDisabled}
              onChange={(event) => onPatch({ operator: event.target.value })}
              className={`${selectClass} w-full sm:w-24`}
            >
              {operators.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
            {valueType === 'text' && textValueChoices.length > 0 ? (
              <select
                value={currentTextValue}
                disabled={controlsDisabled || isLoadingFilters}
                onChange={(event) => onPatch({ value: event.target.value })}
                className={`${selectClass} w-full sm:w-44`}
              >
                <option value="">Pick value...</option>
                {textValueChoices.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            ) : (
              <input
                type={valueType === 'text' ? 'text' : 'number'}
                value={String(draftRule.value ?? option.defaultValue ?? '')}
                disabled={controlsDisabled}
                onChange={(event) => onPatch({ value: valueType === 'text' ? event.target.value : Number(event.target.value) })}
                className={`${inputClass} w-full sm:w-24`}
              />
            )}
            {valueSuffix(valueType) && (
              <span className={connectorClass}>{valueSuffix(valueType)}</span>
            )}
          </>
        )}
        {scopedMetric && (
          <>
            <span className={connectorClass}>on</span>
            <select
              value={scopeAttribute}
              disabled={controlsDisabled}
              onChange={(event) => {
                const nextAttribute = event.target.value;
                patchScope(nextAttribute, nextAttribute ? defaultScopeValueForAttribute(nextAttribute) : '');
              }}
              className={`${selectClass} w-full sm:w-36`}
              aria-label="Scope taps to a screen or route"
            >
              <option value="">any screen</option>
              <option value="screen_name">screen/page</option>
              <option value="url_path">route/path</option>
            </select>
            {scopeAttribute && (
              <>
                {scopeValueChoices.length > 0 ? (
                  <select
                    value={scopeValue}
                    disabled={controlsDisabled || isLoadingFilters}
                    onChange={(event) => patchScope(scopeAttribute, event.target.value)}
                    className={`${selectClass} w-full sm:w-44`}
                  >
                    <option value="">Pick screen or route...</option>
                    {scopeValueChoices.map((scopeChoice) => (
                      <option key={scopeChoice} value={scopeChoice}>{scopeChoice}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={scopeValue}
                    disabled={controlsDisabled || isLoadingFilters}
                    onChange={(event) => patchScope(scopeAttribute, event.target.value)}
                    className={`${inputClass} w-full sm:w-44`}
                    placeholder="screen or route"
                  />
                )}
              </>
            )}
          </>
        )}
        {option.value === 'new_user' && (
          <>
            <span className={connectorClass}>within first</span>
            <input
              type="number"
              min={1}
              max={25}
              value={maxVisits}
              disabled={controlsDisabled}
              onChange={(event) => onPatch({ maxVisits: Number(event.target.value) })}
              className={`${inputClass} w-full text-center sm:w-20`}
            />
            <span className={connectorClass}>sessions</span>
          </>
        )}
        {supportsReturnWindow && (
          <>
            <span className={connectorClass}>after at least</span>
            <input
              type="number"
              min={1}
              max={100}
              value={minVisits}
              disabled={controlsDisabled}
              onChange={(event) => onPatch({ minVisits: Number(event.target.value) })}
              className={`${inputClass} w-full text-center sm:w-20`}
            />
            <span className={connectorClass}>visits</span>
            <span className="basis-full" aria-hidden="true" />
            <span className={connectorClass}>and if no return in</span>
            <input
              type="number"
              min={1}
              max={windowUnit === 'days' ? 7 : 168}
              value={windowAmount}
              disabled={controlsDisabled}
              onChange={(event) => onPatch({ windowHours: hoursFromWindowAmount(Number(event.target.value), windowUnit) })}
              className={`${inputClass} w-full text-center sm:w-20`}
            />
            <select
              value={windowUnit}
              disabled={controlsDisabled}
              onChange={(event) => setRuleWindowUnit(draftRule, event.target.value as DecisionWindowUnit, option.defaultWindowHours ?? decisionWindowHours)}
              className={`${selectClass} w-full sm:w-28`}
            >
              <option value="days">days</option>
              <option value="hours">hours</option>
            </select>
          </>
        )}
      </>
    );
  };

  const renderCaptureRateControls = (rule: SmartCaptureRule, blankRule: boolean) => (
    <>
      <span className={`${connectorClass} sm:ml-2`}>Save</span>
      <input
        type="number"
        min={0}
        max={100}
        value={blankRule && rule.captureRate === undefined ? '' : clampNumber(rule.captureRate, 100, 0, 100)}
        disabled={controlsDisabled}
        onChange={(event) => updateRule(rule.id, { captureRate: event.target.value === '' ? undefined : Number(event.target.value) })}
        className={`${inputClass} w-full text-center sm:w-20`}
      />
      <span className={connectorClass}>% of occurrences</span>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title=""
      showCloseButton={false}
      size="xl"
      variant="modern"
      bodyClassName="!p-0"
      panelClassName="!h-[calc(100dvh-1rem)] !w-[calc(100vw-1rem)] !max-w-none sm:!h-auto sm:!w-[calc(100vw-2rem)] lg:!max-w-6xl"
    >
      <div className="flex h-full min-h-0 flex-col bg-white font-sans text-[#202124] sm:max-h-[90vh]">
        <div className="shrink-0 border-b border-[#e8eaed] bg-white px-4 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center bg-[#f1f3f4] text-[#5f6368]">
                <ScanEye className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-medium leading-6 text-[#202124]">Smart Capture</h2>
                <p className="mt-0.5 text-sm leading-5 text-[#5f6368]">Use the same rule style as replay search to decide which users are recorded.</p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex h-9 w-9 items-center justify-center rounded-none text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1a73e8]/40"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#f8fafd] px-3 py-3 sm:px-6 sm:py-5">
          {locked && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-none border border-[#d2e3fc] bg-[#e8f0fe] px-3 py-2 text-sm text-[#1967d2]">
              <Info className="h-4 w-4 shrink-0" />
              <span>Smart Capture rules are available on Scale. You can preview this setup, but editing is locked on your current plan.</span>
              <Link to={`${pathPrefix}/billing`} className="ml-auto font-medium underline underline-offset-2 hover:text-[#1a73e8]">
                View billing
              </Link>
            </div>
          )}
          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-none border border-[#f6aea9] bg-[#fce8e6] px-4 py-3 text-sm text-[#a50e0e]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="space-y-3">
            <div className={dashboardCardClass}>
              <div className="flex flex-col gap-3 p-3 sm:p-4 xl:flex-row xl:items-center">
                <div className="flex min-w-0 items-center gap-2 xl:w-64">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center bg-[#e8f0fe] text-[#1967d2]">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#202124]">AI rule builder</div>
                    <div className="text-[11px] tabular-nums text-[#5f6368]">{rules.length}/20 capture rules</div>
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row">
                  <textarea
                    id="smart-capture-prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        void handlePromptSubmit();
                      }
                    }}
                    maxLength={500}
                    rows={1}
                    disabled={controlsDisabled || isParsingRule}
                    placeholder="e.g. checkout sessions with API failures, rage taps, or slow payment screens"
                    className="min-h-[68px] flex-1 resize-none rounded-none border border-[#dadce0] bg-white px-3 py-2 text-base text-[#202124] outline-none transition-colors placeholder:text-[#80868b] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20 disabled:cursor-not-allowed disabled:bg-[#f8fafd] disabled:text-[#80868b] sm:min-h-10 sm:text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void handlePromptSubmit()}
                    disabled={controlsDisabled || !prompt.trim() || isParsingRule}
                    className={`${dashboardButtonClass('primary', 'lg')} sm:w-36`}
                  >
                    {isParsingRule && <Loader className="h-4 w-4 animate-spin" />}
                    Generate
                  </button>
                </div>
              </div>
              {builderExplanation && (
                <div className="mx-3 mb-3 flex items-start gap-2 rounded-none border border-[#ceead6] bg-[#e6f4ea] px-3 py-2 text-sm text-[#137333] sm:mx-4 sm:mb-4">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{builderExplanation}</span>
                </div>
              )}
            </div>

            <div className={`overflow-hidden ${dashboardCardClass}`}>
              <div className="flex flex-col gap-3 border-b border-[#e8eaed] bg-[#f8fafd] px-3 py-3 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex w-full min-w-0 flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="flex items-center gap-2">
                    <GitMerge className="h-4 w-4 shrink-0 text-[#5f6368]" />
                    <span className="text-[15px] font-medium text-[#202124]">Capture rules</span>
                  </div>
                  <div className="hidden h-4 w-px bg-[#dadce0] sm:mx-1 sm:block" />
                  <button
                    type="button"
                    disabled={controlsDisabled}
                    onClick={() => {
                      setCaptureMode(smartCaptureEnabled ? 'record_all' : 'smart_capture');
                      markDraft();
                    }}
                    className="inline-flex h-8 w-auto items-center justify-start gap-2 text-sm font-medium text-[#3c4043] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    role="switch"
                    aria-checked={smartCaptureEnabled}
                    aria-label="Toggle Smart Capture"
                  >
                    <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-none transition-colors duration-200 ${smartCaptureEnabled ? 'bg-[#1a73e8]' : 'bg-[#bdc1c6]'}`}>
                      <span className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-none bg-white transition-transform duration-200 ${smartCaptureEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </span>
                    {smartCaptureEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                  <span className="text-sm text-[#5f6368]">{smartCaptureEnabled ? 'Matching rule rows are saved.' : 'All replays are saved.'}</span>
                </div>
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    disabled={controlsDisabled}
                    onClick={() => addRule()}
                    className={`${dashboardButtonClass('secondary', 'md')} w-full sm:w-auto`}
                  >
                    <Plus className="h-4 w-4" />
                    Add rule
                  </button>
                </div>
              </div>

              <div className="p-3 sm:p-4">
                {rules.map((rule, ruleIndex) => {
                  const option = optionFor(rule.signal, rule.type, rule.condition);
                  const ruleColor = normalizeRuleColor(rule.color, GROUP_DEFAULT_COLOR[option.group]);
                  const ruleColorClass = RULE_COLOR_OPTIONS.find((color) => color.value === ruleColor)?.className ?? 'bg-[#80868b]';
                  const compoundClauses = smartCaptureConditionClauses(rule);
                  const hasCompoundClauses = compoundClauses.length > 0;
                  const blankRule = option.value === '' && !hasCompoundClauses;
                  const ruleDisplayName = (rule.name ?? '').trim() || (hasCompoundClauses ? rule.label : (blankRule ? '' : option.label));

                  return (
                    <React.Fragment key={rule.id}>
                      {ruleIndex > 0 && (
                        <div className="flex items-center gap-2 py-3">
                          <div className="h-px flex-1 bg-[#dadce0]" />
                          <span className="border border-[#dadce0] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#5f6368]">OR</span>
                          <div className="h-px flex-1 bg-[#dadce0]" />
                        </div>
                      )}
                      <div
                        className={`flex flex-col border border-[#dadce0] bg-white transition-opacity ${rule.enabled === false || !smartCaptureEnabled ? 'opacity-50' : ''}`}
                      >
                      <div className="flex flex-col gap-2 border-b border-[#e8eaed] bg-[#f8fafd] px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="group relative h-8 w-12 shrink-0 overflow-hidden rounded-none border border-[#dadce0] bg-white transition-colors hover:border-[#bdc1c6] focus-within:border-[#1a73e8] focus-within:ring-2 focus-within:ring-[#1a73e8]/20">
                            <select
                              value={ruleColor}
                              disabled={controlsDisabled}
                              onChange={(event) => updateRule(rule.id, { color: event.target.value })}
                              className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                              aria-label="Rule color"
                              title="Rule color"
                            >
                              {RULE_COLOR_OPTIONS.map((color) => (
                                <option key={color.value} value={color.value}>{color.label}</option>
                              ))}
                            </select>
                            <span className={`absolute left-1.5 top-1/2 h-4 w-5 -translate-y-1/2 rounded-none ${ruleColorClass}`} />
                            <ChevronDown className="pointer-events-none absolute right-1 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#5f6368] transition-colors group-hover:text-[#202124]" />
                          </div>
                          {editingRuleNameId === rule.id ? (
                            <input
                              type="text"
                              maxLength={80}
                              value={rule.name ?? ''}
                              disabled={controlsDisabled}
                              onChange={(event) => updateRule(rule.id, { name: event.target.value })}
                              onBlur={() => setEditingRuleNameId(null)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === 'Escape') {
                                  event.currentTarget.blur();
                                }
                              }}
                              className="h-8 min-w-0 max-w-sm rounded-none border border-[#dadce0] bg-white px-2 text-sm font-medium text-[#202124] outline-none placeholder:text-[#80868b] focus:border-[#1a73e8] focus:ring-2 focus:ring-[#1a73e8]/20 disabled:cursor-not-allowed"
                              placeholder={option.label}
                              autoFocus
                            />
                          ) : (
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-medium text-[#202124]">{ruleDisplayName}</span>
                              <button
                                type="button"
                                disabled={controlsDisabled}
                                onClick={() => setEditingRuleNameId(rule.id)}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-none text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124] disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label={ruleDisplayName ? `Edit ${ruleDisplayName} rule name` : 'Edit rule name'}
                                title="Edit rule name"
                              >
                                <Pencil className="h-4 w-4" />
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:w-auto sm:justify-end">
                          <button
                            type="button"
                            disabled={controlsDisabled}
                            onClick={() => updateRule(rule.id, { enabled: rule.enabled === false })}
                            className={`relative inline-flex h-8 w-14 shrink-0 rounded-none transition-colors disabled:cursor-not-allowed sm:h-5 sm:w-9 ${rule.enabled !== false ? 'bg-[#1a73e8]' : 'bg-[#bdc1c6]'}`}
                            aria-label={rule.enabled !== false ? 'Pause rule' : 'Enable rule'}
                          >
                            <span className={`pointer-events-none absolute left-1 top-1 h-6 w-6 rounded-none bg-white transition-transform sm:left-0.5 sm:top-0.5 sm:h-4 sm:w-4 ${rule.enabled !== false ? 'translate-x-6 sm:translate-x-4' : 'translate-x-0'}`} />
                          </button>
                          <button
                            type="button"
                            disabled={controlsDisabled}
                            onClick={() => removeRule(rule.id)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-none text-[#5f6368] transition-colors hover:bg-[#fce8e6] hover:text-[#d93025] disabled:cursor-not-allowed disabled:opacity-40 sm:h-8 sm:w-8"
                            aria-label="Delete rule"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="bg-white px-3 py-3 sm:px-4 sm:py-4">
                        {hasCompoundClauses ? (
                          <div className="space-y-2 bg-[#f8fafd] px-3 py-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                              <span className={connectorClass}>Save replay when all clauses match</span>
                              <button
                                type="button"
                                disabled={controlsDisabled}
                                onClick={() => addRuleClause(rule.id)}
                                className={dashboardButtonClass('secondary', 'sm')}
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add clause
                              </button>
                            </div>
                            {compoundClauses.map((clause, clauseIndex) => {
                              const clauseRule = ruleFromConditionClause(rule, clause, clauseIndex);
                              const clauseOption = optionFor(clauseRule.signal, clauseRule.type, clauseRule.condition);

                              return (
                                <React.Fragment key={`${rule.id}-clause-${clauseIndex}`}>
                                  <div className="flex flex-wrap items-stretch gap-x-2 gap-y-3 rounded-none border border-[#e8eaed] bg-white px-3 py-3 sm:items-center">
                                    <span className={connectorClass}>Clause {clauseIndex + 1}</span>
                                    {renderConditionControls(
                                      clauseRule,
                                      clauseOption,
                                      (patch) => updateRuleClause(rule.id, clauseIndex, patch),
                                      { allowReturnWindow: false },
                                    )}
                                    <button
                                      type="button"
                                      disabled={controlsDisabled || compoundClauses.length <= 1}
                                      onClick={() => removeRuleClause(rule.id, clauseIndex)}
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-none text-[#5f6368] transition-colors hover:bg-[#f1f3f4] hover:text-[#202124] disabled:cursor-not-allowed disabled:opacity-30"
                                      aria-label={`Remove clause ${clauseIndex + 1}`}
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>
                                  {clauseIndex < compoundClauses.length - 1 && (
                                    <div className="flex items-center gap-2 px-4">
                                      <div className="h-px flex-1 bg-[#dadce0]" />
                                      <span className="border border-[#dadce0] bg-white px-2 py-0.5 text-[11px] font-medium text-[#5f6368]">AND</span>
                                      <div className="h-px flex-1 bg-[#dadce0]" />
                                    </div>
                                  )}
                                </React.Fragment>
                              );
                            })}
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-3 pt-1">
                              {renderCaptureRateControls(rule, false)}
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-stretch gap-x-2 gap-y-3 bg-[#f8fafd] px-3 py-3 sm:items-center">
                            <span className={connectorClass}>Save replay when</span>
                            {renderConditionControls(
                              rule,
                              option,
                              (patch) => updateRule(rule.id, patch),
                            )}
                            {renderCaptureRateControls(rule, blankRule)}
                            <button
                              type="button"
                              disabled={controlsDisabled}
                              onClick={() => addRuleClause(rule.id)}
                              className={dashboardButtonClass('secondary', 'md')}
                            >
                              <Plus className="h-3.5 w-3.5" />
                              Add clause
                            </button>
                          </div>
                        )}
                      </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-t border-[#e8eaed] bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            {dirty ? (
              <span className="inline-flex w-full items-center gap-1.5 rounded-none bg-[#fef7e0] px-2.5 py-1 text-xs font-medium text-[#b06000] sm:w-auto">
                <AlertTriangle className="h-3.5 w-3.5" />
                Unsaved project changes
              </span>
            ) : (
              <span className="inline-flex w-full items-center gap-1.5 rounded-none bg-[#e6f4ea] px-2.5 py-1 text-xs font-medium text-[#137333] sm:w-auto">
                <Check className="h-3.5 w-3.5" />
                Saved to project
              </span>
            )}
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSaving}
              className={`${dashboardButtonClass('secondary', 'md')} w-full sm:w-auto`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveConfig()}
              disabled={isSaving || locked || !dirty}
              className={`${dashboardButtonClass('primary', 'md')} w-full sm:w-auto`}
            >
              <Save className="h-4 w-4" />
              {isSaving ? 'Saving…' : 'Save rules'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
