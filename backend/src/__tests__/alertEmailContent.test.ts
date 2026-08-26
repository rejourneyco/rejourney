import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    sendLeakScanEmail,
    sendStabilityDigestEmail,
} from '../services/email.js';

const { sentMails } = vi.hoisted(() => ({
    sentMails: [] as any[],
}));

vi.mock('nodemailer', () => ({
    default: {
        createTransport: () => ({
            sendMail: async (mailOptions: any) => {
                sentMails.push(mailOptions);
            },
        }),
    },
}));

vi.mock('../config', () => ({
    config: {
        SMTP_FROM: 'test@rejourney.co',
        SMTP_HOST: 'mock',
    },
    isDevelopment: true,
    isTest: true,
}));

vi.mock('../logger', () => ({
    logger: {
        info: () => { },
        warn: () => { },
        error: () => { },
    },
}));

describe('alert email content', () => {
    beforeEach(() => {
        sentMails.length = 0;
    });

    it('sends grouped emerging-stability digests instead of occurrence emails', async () => {
        await sendStabilityDigestEmail([
            { email: 'hebron@example.com', timeZone: 'Asia/Hebron' },
            { email: 'ny@example.com', timeZone: 'America/New_York' },
        ], {
            projectId: 'p_123',
            projectName: 'Mobile App',
            detectedAt: new Date('2026-07-29T12:00:00.000Z'),
            trends: [
                {
                    signalKey: 'issue:issue_789',
                    kind: 'crash',
                    title: 'GraphicsDevice initialization failure',
                    subtitle: 'FlutterError while creating the graphics device',
                    shortId: 'ERR-123',
                    issueId: 'issue_789',
                    dashboardPath: '/general/issue_789',
                    currentValue: 7,
                    baselineValue: 1,
                    growthPercent: 600,
                    occurrences: 7,
                    affectedUsers: 2,
                    affectedSessions: 3,
                    appVersion: '6.0.4',
                },
                {
                    signalKey: 'api:error-rate',
                    kind: 'api_error_rate',
                    title: 'API error rate is rising quickly',
                    subtitle: 'Error responses rose from 2.0% to 8.0%.',
                    dashboardPath: '/api',
                    currentValue: 8,
                    baselineValue: 2,
                    growthPercent: 300,
                    occurrences: 20,
                    affectedSessions: 30,
                },
            ],
        });

        expect(sentMails).toHaveLength(2);
        expect(sentMails[0].to).toBe('hebron@example.com');
        expect(sentMails[1].to).toBe('ny@example.com');
        expect(sentMails[0].subject).toContain('Mobile App: 2 issues rising fast');
        expect(sentMails[0].html).toContain('Emerging issues');
        expect(sentMails[0].html).toContain('GraphicsDevice initialization failure');
        expect(sentMails[0].html).toContain('v6.0.4');
        expect(sentMails[0].html).toContain('7 crashes');
        expect(sentMails[0].html).toContain('2</div>');
        expect(sentMails[0].html).toContain('http://localhost:8080/dashboard/general/issue_789');
        expect(sentMails[0].html).toContain('at most three stability digests');
        expect(sentMails[0].html).toContain('Times shown in Asia/Hebron');
        expect(sentMails[1].html).toContain('Times shown in America/New_York');
    });

    it('sends leak scan digests ordered by estimated affected users', async () => {
        await sendLeakScanEmail([
            { email: 'marlin@example.com', timeZone: 'UTC' },
        ], {
            projectId: 'p_123',
            projectName: 'Checkout',
            dashboardUrl: 'http://localhost:8080/dashboard/leaks',
            completedAt: new Date('2026-06-18T09:00:00.000Z'),
            issues: [
                {
                    id: '00000000-0000-0000-0000-000000000002',
                    shortId: 'IDM-2',
                    title: 'Coupon modal traps users',
                    issueType: 'sp_confusion',
                    severity: 'medium',
                    status: 'ready',
                    whyItMatters: 'Users rage tap the coupon modal and abandon checkout before payment.',
                    estimatedAffectedUsers: 3,
                    affectedSessions: 5,
                    firstSeen: new Date('2026-06-18T07:00:00.000Z'),
                    lastSeen: new Date('2026-06-18T08:30:00.000Z'),
                    topSignals: ['rage_tap', 'abandonment'],
                },
                {
                    id: '00000000-0000-0000-0000-000000000001',
                    shortId: 'IDM-1',
                    title: 'Checkout button never enables',
                    issueType: 'sp_failure',
                    severity: 'high',
                    status: 'ready',
                    whyItMatters: 'Users complete the form but cannot continue to payment.',
                    estimatedAffectedUsers: 12,
                    affectedSessions: 14,
                    firstSeen: new Date('2026-06-18T06:30:00.000Z'),
                    lastSeen: new Date('2026-06-18T08:45:00.000Z'),
                    contextStatus: 'ready',
                    topSignals: ['dead_tap', 'session_replay', 'checkout_abandonment'],
                },
            ],
        });

        expect(sentMails).toHaveLength(1);
        expect(sentMails[0].subject).toContain('Checkout: 2 leaks affecting');
        expect(sentMails[0].text).toContain('Checkout leak scan summary');
        expect(sentMails[0].html).toContain('http://localhost:8080/dashboard/leaks');
        expect(sentMails[0].html).toContain('Why it matters');
        expect(sentMails[0].html).not.toContain('Revenue risk');
        expect(sentMails[0].html.indexOf('Checkout button never enables')).toBeLessThan(
            sentMails[0].html.indexOf('Coupon modal traps users'),
        );
    });
});
