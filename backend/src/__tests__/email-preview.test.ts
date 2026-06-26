
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, vi } from 'vitest';
import {
    sendAnrAlertEmail,
    sendApiDegradationAlertEmail,
    sendErrorSpikeAlertEmail,
    sendLeakScanEmail,
    sendOtpEmail,
    sendBillingWarningEmail,
    sendDeveloperSetupEmail,
    sendPaymentActionRequiredEmail,
    sendPlanChangeEmail,
    sendSubscriptionExpiredEmail,
    sendTeamInviteEmail,
    sendCrashAlertEmail
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

    it('generates Crash Alert email', async () => {
        await sendCrashAlertEmail(['dev@example.com'], {
            projectId: 'p_123',
            projectName: 'Mobile App',
            crashTitle: 'NullPointerException: Attempt to invoke virtual method',
            subtitle: 'com.example.app.MainActivity.onCreate(MainActivity.java:42)',
            affectedUsers: 150,
            issueId: 'issue_789',
            issueUrl: 'http://localhost:5173/dashboard/general/issue_789',
            shortId: 'ERR-123',
            environment: 'production',
            lastSeen: new Date(),
            isHandled: false,
            priority: 'high',
            status: 'ongoing',
            events24h: 35,
            events90d: 150,
            sampleSessionId: 'session_preview_123',
            culprit: 'MainActivity.onCreate',
            stackTrace: `java.lang.NullPointerException: Attempt to invoke virtual method 'java.lang.String java.lang.Object.toString()' on a null object reference
    at com.example.app.MainActivity.onCreate(MainActivity.java:42)
    at android.app.Activity.performCreate(Activity.java:8000)
    at android.app.Instrumentation.callActivityOnCreate(Instrumentation.java:1300)`,
            affectedVersions: { '1.0.0': 100, '1.1.0': 50 },
            screenName: 'CheckoutScreen'
        });
    });

    it('generates ANR Alert email', async () => {
        await sendAnrAlertEmail(['dev@example.com'], {
            projectId: 'p_123',
            projectName: 'Mobile App',
            durationMs: 12500,
            affectedUsers: 42,
            eventCount: 60,
            events24h: 18,
            events90d: 60,
            issueId: 'issue_anr_123',
            issueUrl: 'http://localhost:5173/dashboard/general/issue_anr_123',
            shortId: 'ANR-42',
            environment: 'production',
            priority: 'high',
            status: 'ongoing',
            lastSeen: new Date(),
            sampleSessionId: 'session_anr_preview_123',
            stackTrace: `main thread blocked
    at com.example.app.CheckoutRepository.waitForPayment(CheckoutRepository.kt:88)
    at com.example.app.CheckoutViewModel.submit(CheckoutViewModel.kt:51)`,
            affectedVersions: { '1.2.0': 40, '1.1.0': 20 },
            affectedDevices: { 'Pixel 9': 22, 'Galaxy S25': 18 },
            screenName: 'CheckoutScreen',
            culprit: 'CheckoutRepository.waitForPayment',
        });
    });

    it('generates API Error Spike email', async () => {
        await sendErrorSpikeAlertEmail(['dev@example.com'], {
            projectId: 'p_123',
            projectName: 'Mobile App',
            currentRate: 12.4,
            previousRate: 3.1,
            percentIncrease: 300,
            issueUrl: 'http://localhost:5173/dashboard/sessions',
            detectedAt: new Date(),
            topErrors: [
                { name: 'POST /checkout returned 500', count: 81 },
                { name: 'GET /inventory returned 503', count: 34 },
            ],
        });
    });

    it('generates API Degradation email', async () => {
        await sendApiDegradationAlertEmail(['dev@example.com'], {
            projectId: 'p_123',
            projectName: 'Mobile App',
            currentLatencyMs: 1430,
            previousLatencyMs: 420,
            percentIncrease: 240,
            issueUrl: 'http://localhost:5173/dashboard/api',
            detectedAt: new Date(),
            slowestEndpoints: [
                { method: 'POST', path: '/api/checkout', latency: 1430 },
                { method: 'GET', path: '/api/products/:id', latency: 980 },
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
                    title: 'Checkout button never enables after coupon failure',
                    issueType: 'abandon_after_api_error',
                    severity: 'high',
                    status: 'ready',
                    whyItMatters: 'Users complete checkout details, hit a coupon validation failure, then cannot continue to payment.',
                    estimatedAffectedUsers: 19,
                    affectedSessions: 27,
                    firstSeen: new Date('2026-06-18T06:00:00.000Z'),
                    lastSeen: new Date(),
                    contextStatus: 'ready',
                    topSignals: ['session_replay', 'api_error_cluster', 'rage_tap'],
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
