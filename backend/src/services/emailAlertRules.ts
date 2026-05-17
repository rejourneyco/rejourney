import type { EmailAlertRule, EmailAlertRuleAlertType } from '../db/schema.js';

const DEFAULT_RULE_TIMESTAMP = '2026-01-01T00:00:00.000Z';

interface AlertSettingsLike {
    crashAlertsEnabled?: boolean | null;
    anrAlertsEnabled?: boolean | null;
    errorSpikeAlertsEnabled?: boolean | null;
    apiDegradationAlertsEnabled?: boolean | null;
    errorSpikeThresholdPercent?: number | null;
    apiDegradationThresholdPercent?: number | null;
    apiLatencyThresholdMs?: number | null;
    emailRules?: EmailAlertRule[] | null;
}

interface RuleEvaluationContext {
    affectedUsers?: number;
    durationMs?: number;
    percentIncrease?: number;
    latencyMs?: number;
}

export function buildDefaultEmailAlertRules(settings: AlertSettingsLike = {}): EmailAlertRule[] {
    const crashEnabled = settings.crashAlertsEnabled ?? true;
    const anrEnabled = settings.anrAlertsEnabled ?? true;
    const errorSpikeEnabled = settings.errorSpikeAlertsEnabled ?? true;
    const apiEnabled = settings.apiDegradationAlertsEnabled ?? true;

    return [
        {
            id: 'default-crash-impact',
            name: 'Crash impact',
            description: 'New crash groups affecting at least one user.',
            alertType: 'crash',
            metric: 'affected_users',
            operator: 'gte',
            threshold: 1,
            windowMinutes: 60,
            severity: 'critical',
            enabled: crashEnabled,
            source: 'default',
            updatedAt: DEFAULT_RULE_TIMESTAMP,
        },
        {
            id: 'default-anr-freeze',
            name: 'ANR freeze',
            description: 'Application-not-responding freezes lasting two seconds or longer.',
            alertType: 'anr',
            metric: 'duration_ms',
            operator: 'gte',
            threshold: 2000,
            windowMinutes: 60,
            severity: 'high',
            enabled: anrEnabled,
            source: 'default',
            updatedAt: DEFAULT_RULE_TIMESTAMP,
        },
        {
            id: 'default-error-spike',
            name: 'Error spike',
            description: 'Error rate increases beyond the project threshold.',
            alertType: 'error_spike',
            metric: 'percent_increase',
            operator: 'gte',
            threshold: settings.errorSpikeThresholdPercent ?? 50,
            windowMinutes: 60,
            severity: 'high',
            enabled: errorSpikeEnabled,
            source: 'default',
            updatedAt: DEFAULT_RULE_TIMESTAMP,
        },
        {
            id: 'default-api-degradation',
            name: 'API degradation',
            description: 'Endpoint latency is at least twice the recent baseline.',
            alertType: 'api_degradation',
            metric: 'percent_increase',
            operator: 'gte',
            threshold: settings.apiDegradationThresholdPercent ?? 100,
            windowMinutes: 60,
            severity: 'high',
            enabled: apiEnabled,
            source: 'default',
            updatedAt: DEFAULT_RULE_TIMESTAMP,
        },
        {
            id: 'default-api-latency',
            name: 'Slow API ceiling',
            description: 'Current endpoint latency exceeds the absolute ceiling.',
            alertType: 'api_degradation',
            metric: 'latency_ms',
            operator: 'gte',
            threshold: settings.apiLatencyThresholdMs ?? 3000,
            windowMinutes: 60,
            severity: 'watch',
            enabled: apiEnabled,
            source: 'default',
            updatedAt: DEFAULT_RULE_TIMESTAMP,
        },
    ];
}

export function getEmailAlertRules(settings: AlertSettingsLike = {}): EmailAlertRule[] {
    if (Array.isArray(settings.emailRules) && settings.emailRules.length > 0) {
        return settings.emailRules;
    }

    return buildDefaultEmailAlertRules(settings);
}

function metricValue(rule: EmailAlertRule, context: RuleEvaluationContext): number | null {
    switch (rule.metric) {
        case 'affected_users':
            return context.affectedUsers ?? null;
        case 'duration_ms':
            return context.durationMs ?? null;
        case 'percent_increase':
            return context.percentIncrease ?? null;
        case 'latency_ms':
            return context.latencyMs ?? null;
        default:
            return null;
    }
}

function rulePasses(rule: EmailAlertRule, context: RuleEvaluationContext): boolean {
    const value = metricValue(rule, context);
    if (value === null || !Number.isFinite(value)) return false;

    switch (rule.operator) {
        case 'gt':
            return value > rule.threshold;
        case 'gte':
            return value >= rule.threshold;
        case 'lt':
            return value < rule.threshold;
        case 'lte':
            return value <= rule.threshold;
        default:
            return false;
    }
}

export function shouldSendForEmailRules(
    settings: AlertSettingsLike,
    alertType: EmailAlertRuleAlertType,
    context: RuleEvaluationContext,
): boolean {
    const matchingRules = getEmailAlertRules(settings)
        .filter((rule) => rule.enabled && rule.alertType === alertType);

    if (matchingRules.length === 0) return false;

    return matchingRules.some((rule) => rulePasses(rule, context));
}
