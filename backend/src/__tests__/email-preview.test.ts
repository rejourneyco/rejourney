
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, vi } from 'vitest';
import {
    sendLeakScanEmail,
    sendOtpEmail,
    sendBillingWarningEmail,
    sendDeveloperSetupEmail,
    sendPaymentActionRequiredEmail,
    sendPlanChangeEmail,
    sendSubscriptionExpiredEmail,
    sendTeamInviteEmail,
    sendStabilityDigestEmail,
} from '../services/email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Go up two levels from src/__tests__ to backend root, then to email-previews
const OUT_DIR = path.join(__dirname, '../../email-previews');

if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
}

// Mock nodemailer
const mockSendMail = async (mailOptions: any) => {
    const filename = `${mailOptions.subject.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`;
    const filepath = path.join(OUT_DIR, filename);
    fs.writeFileSync(filepath, mailOptions.html);
    console.log(`Generated preview: ${filepath}`);
};

// Mock the entire nodemailer module
vi.mock('nodemailer', () => ({
    default: {
        createTransport: () => ({
            sendMail: mockSendMail
        })
    }
}));

// Mock config
vi.mock('../config', () => ({
    config: {
        SMTP_FROM: 'test@rejourney.co',
        SMTP_HOST: 'mock' // validation passes
    },
    isDevelopment: true,
    isTest: true
}));

// Mock logger
vi.mock('../logger', () => ({
    logger: {
        info: () => { },
        warn: () => { },
        error: () => { },
    }
}));

describe('Email Previews', () => {
    it('generates OTP email', async () => {
        await sendOtpEmail('test@example.com', '123456');
    });

    it('generates Billing Warning email', async () => {
        await sendBillingWarningEmail('admin@example.com', 'ACME Corp', 85, 850, 1000);
        await sendBillingWarningEmail('admin@example.com', 'Startup Inc', 98, 980, 1000); // Critical
    });

    it('generates Plan Change email', async () => {
        await sendPlanChangeEmail(
            'admin@example.com',
            'ACME Corp',
            'upgrade',
            'Free',
            'Growth',
            new Date('2026-07-01T00:00:00.000Z'),
            false
        );
    });

    it('generates Subscription Expired email', async () => {
        await sendSubscriptionExpiredEmail('admin@example.com', 'ACME Corp', 'Growth');
    });

    it('generates Payment Action Required email', async () => {
        await sendPaymentActionRequiredEmail('admin@example.com', {
            teamName: 'ACME Corp',
            planName: 'Growth',
            amountDueCents: 1500,
            currency: 'usd',
            invoiceUrl: 'https://invoice.stripe.com/example',
        });
    });

    it('generates Developer Setup email', async () => {
        await sendDeveloperSetupEmail({
            email: 'developer@example.com',
            requesterName: 'Sam',
            teamName: 'Rocket Ship',
            project: {
                id: 'p_123',
                name: 'Mobile App',
                publicKey: 'rj_public_demo',
                platforms: ['ios', 'android', 'react-native'],
                bundleId: 'co.rejourney.mobile',
                packageName: 'co.rejourney.mobile',
            },
            aiPrompt: 'Install @rejourney/react-native and initialize it with rj_public_demo in the app bootstrap.',
        });
    });

    it('generates Invite email', async () => {
        await sendTeamInviteEmail(
            'new@example.com',
            'Rocket Ship',
            'Sam',
            'admin',
            'mock-token-123'
        );
    });

    it('generates Stability Trends email', async () => {
        await sendStabilityDigestEmail(['dev@example.com'], {
            projectId: 'p_123',
            projectName: 'Mobile App',
            detectedAt: new Date('2026-07-29T12:00:00.000Z'),
            trends: [
                {
                    signalKey: 'issue:issue_crash_123',
                    kind: 'crash',
                    title: 'GraphicsDevice initialization failure',
                    subtitle: 'FlutterError while creating the graphics device',
                    shortId: 'MOBILE-42',
                    issueId: 'issue_crash_123',
                    dashboardPath: '/general/issue_crash_123',
                    currentValue: 7,
                    baselineValue: 1,
                    growthPercent: 600,
                    occurrences: 7,
                    affectedUsers: 2,
                    affectedSessions: 3,
                    appVersion: '6.0.4',
                },
                {
                    signalKey: 'issue:issue_anr_123',
                    kind: 'anr',
                    title: 'Checkout main thread blocked',
                    subtitle: 'Payment confirmation blocked the main thread for 11 seconds',
                    shortId: 'MOBILE-57',
                    issueId: 'issue_anr_123',
                    dashboardPath: '/general/issue_anr_123',
                    currentValue: 12,
                    baselineValue: 3,
                    growthPercent: 300,
                    occurrences: 12,
                    affectedUsers: 5,
                    affectedSessions: 6,
                    appVersion: '6.0.4',
                },
                {
                    signalKey: 'api:error-rate',
                    kind: 'api_error_rate',
                    title: 'API error rate is rising quickly',
                    subtitle: 'Error responses rose from 2.1% to 8.4% in the latest six-hour window.',
                    dashboardPath: '/api',
                    currentValue: 8.4,
                    baselineValue: 2.1,
                    growthPercent: 300,
                    occurrences: 28,
                    affectedSessions: 41,
                },
            ],
        });
    });

    it('generates Leak Scan email', async () => {
        await sendLeakScanEmail(['product@example.com'], {
            projectId: 'p_123',
            projectName: 'Mobile App',
            dashboardUrl: 'http://localhost:5173/dashboard/leaks',
            completedAt: new Date(),
            admittedSessions: 32,
            issues: [
                {
                    id: '00000000-0000-0000-0000-000000000001',
                    shortId: 'LEAK-101',
                    title: 'Users are giving up zooming into the product image',
                    issueType: 'ux_friction',
                    severity: 'high',
                    status: 'ready',
                    whyItMatters: 'Leak Detected: Opportunity +$179. Affecting 15 users across all platforms.',
                    estimatedAffectedUsers: 15,
                    affectedSessions: 22,
                    firstSeen: new Date('2026-06-18T06:00:00.000Z'),
                    lastSeen: new Date(),
                    contextStatus: 'ready',
                    topSignals: ['session_replay', 'dead_tap', 'abandonment'],
                },
                {
                    id: '00000000-0000-0000-0000-000000000002',
                    shortId: 'LEAK-102',
                    title: 'Onboarding tour waits for missing element',
                    issueType: 'dead_tap',
                    severity: 'medium',
                    status: 'ready',
                    whyItMatters: 'New users repeatedly tap the disabled next step and leave before activation.',
                    estimatedAffectedUsers: 8,
                    affectedSessions: 11,
                    lastSeen: new Date(),
                    topSignals: ['dead_tap', 'abandonment'],
                },
            ],
        });
    });
});
