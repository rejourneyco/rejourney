import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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
        expect(sentMails[0].html).toContain('emerging issues');
        expect(sentMails[0].html).toContain('GraphicsDevice initialization failure');
        expect(sentMails[0].html).toContain('v6.0.4');
        expect(sentMails[0].html).toContain('7 crashes');
        expect(sentMails[0].html).toContain('2</strong>');
        expect(sentMails[0].html).toContain('http://localhost:8080/dashboard/general/issue_789');
        expect(sentMails[0].html).toContain('at most three stability digests');
        expect(sentMails[0].html).toContain('Times shown in Asia/Hebron');
        expect(sentMails[1].html).toContain('Times shown in America/New_York');
    });
});
