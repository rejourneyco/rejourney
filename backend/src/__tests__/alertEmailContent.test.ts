import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    sendApiDegradationAlertEmail,
    sendCrashAlertEmail,
    sendLeakScanEmail,
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

    it('sends crash alerts grouped by recipient time zone with issue context', async () => {
        await sendCrashAlertEmail([
            { email: 'hebron@example.com', timeZone: 'Asia/Hebron' },
            { email: 'ny@example.com', timeZone: 'America/New_York' },
        ], {
            projectId: 'p_123',
            projectName: 'Mobile App',
            crashTitle: 'NullPointerException: Attempt to invoke virtual method',
            subtitle: 'MainActivity.onCreate(MainActivity.java:42)',
            affectedUsers: 3,
            eventCount: 12,
            issueId: 'issue_789',
            issueUrl: 'http://localhost:8080/dashboard/general/issue_789',
            shortId: 'ERR-123',
            environment: 'production',
            firstSeen: new Date('2026-01-15T10:00:00.000Z'),
            lastSeen: new Date('2026-01-15T12:00:00.000Z'),
            isHandled: false,
            stackTrace: 'java.lang.NullPointerException\n    at MainActivity.onCreate(MainActivity.java:42)',
            affectedVersions: { '1.0.0': 8, '1.1.0': 4 },
            affectedDevices: { 'Pixel 9': 2, 'iPhone 16': 1 },
            screenName: 'CheckoutScreen',
            sampleAppVersion: '1.1.0',
            sampleOsVersion: 'Android 16',
            sampleDeviceModel: 'Pixel 9',
        });

        expect(sentMails).toHaveLength(2);
        expect(sentMails[0].to).toBe('hebron@example.com');
        expect(sentMails[1].to).toBe('ny@example.com');
        expect(sentMails[0].subject).toContain('Unhandled Crash in Mobile App');
        expect(sentMails[0].html).toContain('Triage Context');
        expect(sentMails[0].html).toContain('Affected Versions');
        expect(sentMails[0].html).toContain('Affected Devices');
        expect(sentMails[0].html).toContain('http://localhost:8080/dashboard/general/issue_789');
        expect(sentMails[0].html).toContain('Times shown in Asia/Hebron');
        expect(sentMails[1].html).toContain('Times shown in America/New_York');
    });

    it('links API degradation alerts to API insights by default', async () => {
        await sendApiDegradationAlertEmail([
            { email: 'dev@example.com', timeZone: 'UTC' },
        ], {
            projectId: 'p_123',
            projectName: 'Mobile App',
            currentLatencyMs: 1200,
            previousLatencyMs: 400,
            percentIncrease: 200,
            detectedAt: new Date('2026-01-15T12:00:00.000Z'),
            slowestEndpoints: [{ method: 'GET', path: '/api/search', latency: 1200 }],
        });

        expect(sentMails).toHaveLength(1);
        expect(sentMails[0].subject).toContain('API latency degradation in Mobile App');
        expect(sentMails[0].html).toContain('http://localhost:8080/dashboard/api');
        expect(sentMails[0].html).toContain('Slowest Endpoints');
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
                    estimatedAffectedUsers: 3,
                    affectedSessions: 5,
                    lastSeen: new Date('2026-06-18T08:30:00.000Z'),
                },
                {
                    id: '00000000-0000-0000-0000-000000000001',
                    shortId: 'IDM-1',
                    title: 'Checkout button never enables',
                    issueType: 'sp_failure',
                    severity: 'high',
                    estimatedAffectedUsers: 12,
                    affectedSessions: 14,
                    lastSeen: new Date('2026-06-18T08:45:00.000Z'),
                },
            ],
        });

        expect(sentMails).toHaveLength(1);
        expect(sentMails[0].subject).toBe('Leak Scan Today');
        expect(sentMails[0].text).toContain('Rejourney Marlin has watched your session replays');
        expect(sentMails[0].html).toContain('http://localhost:8080/dashboard/leaks');
        expect(sentMails[0].html.indexOf('Checkout button never enables')).toBeLessThan(
            sentMails[0].html.indexOf('Coupon modal traps users'),
        );
    });
});
