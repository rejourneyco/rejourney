
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, it, vi } from 'vitest';
import {
    sendOtpEmail,
    sendBillingWarningEmail,
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
        PUBLIC_DASHBOARD_URL: 'http://localhost:8080',
        SMTP_FROM: 'test@rejourney.co',
        SMTP_HOST: 'mock' // validation passes
    },
    isDevelopment: true
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
            stackTrace: `java.lang.NullPointerException: Attempt to invoke virtual method 'java.lang.String java.lang.Object.toString()' on a null object reference
    at com.example.app.MainActivity.onCreate(MainActivity.java:42)
    at android.app.Activity.performCreate(Activity.java:8000)
    at android.app.Instrumentation.callActivityOnCreate(Instrumentation.java:1300)`,
            affectedVersions: { '1.0.0': 100, '1.1.0': 50 },
            screenName: 'CheckoutScreen'
        });
    });
});
