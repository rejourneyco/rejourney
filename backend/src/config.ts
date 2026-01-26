/**
 * Rejourney Backend Configuration
 * 
 * Type-safe environment variable loader
 * 
 * Copyright (c) 2026 Rejourney
 * 
 * Licensed under the Server Side Public License 1.0 (the "License");
 * you may not use this file except in compliance with the License.
 * See LICENSE-SSPL for full terms.
 */

import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// =============================================================================
// Environment Variable Loading
// =============================================================================

/**
 * Load environment variables based on environment and priority:
 * 1. Process environment (already set - includes Docker Compose env vars)
 * 2. .env.local (if exists, prioritized in development)
 * 3. .env (if exists)
 */
function initializeEnv() {
    // Skip file loading if running in Docker (environment vars passed via Docker Compose)
    if (process.env.DOCKER_ENV === 'true') {
        return;
    }

    // Current directory is backend root (where package.json is)
    const envLocalPath = path.resolve(process.cwd(), '.env.local');
    const envPath = path.resolve(process.cwd(), '.env');

    // Parent directory (repo root)
    const parentEnvLocalPath = path.resolve(process.cwd(), '../.env.local');

    // In development, try .env.local first (prioritize local backend -> root .env.local)
    if (process.env.NODE_ENV !== 'production') {
        if (fs.existsSync(envLocalPath)) {
            dotenv.config({ path: envLocalPath });
        } else if (fs.existsSync(parentEnvLocalPath)) {
            dotenv.config({ path: parentEnvLocalPath });
        }
    }

    // Load .env if it exists
    if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
    } else {
        // Fallback to standard dotenv.config() which looks for .env in cwd
        dotenv.config();
    }
}

// Initialize environment variables before schema parsing
initializeEnv();

const envSchema = z.object({
    // Server
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().transform(Number).default('3000'),

    // Database
    DATABASE_URL: z.string(),

    // Redis
    REDIS_URL: z.string().default('redis://localhost:6379/0'),

    // S3/MinIO (Self-Hosted fallback or Initial Seed only)
    // In Production (SELF_HOSTED_MODE=false), these are ignored after the initial db:seed.
    // In Self-Hosted (SELF_HOSTED_MODE=true), these act as a "virtual" default if the database is empty.
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_PUBLIC_ENDPOINT: z.string().optional(),

    // Auth
    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().optional(),
    INGEST_HMAC_SECRET: z.string().min(32),

    // SMTP (optional in dev)
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().transform(Number).optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().optional(),
    SMTP_SECURE: z.string().transform(v => v === 'true').optional(),

    // Turnstile (optional)
    TURNSTILE_SITE_KEY: z.string().optional(),
    TURNSTILE_SECRET_KEY: z.string().optional(),

    // GitHub OAuth (optional)
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    OAUTH_REDIRECT_BASE: z.string().optional(),

    // Self-hosted mode
    SELF_HOSTED_MODE: z.string().transform(v => v === 'true').default('true'),

    // Stripe (optional for hosted)
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    // URLs
    PUBLIC_DASHBOARD_URL: z.string().optional(),
    PUBLIC_API_URL: z.string().optional(),
    PUBLIC_INGEST_URL: z.string().optional(),

    // Limits
    MAX_RECORDING_MINUTES: z.string().transform(Number).default('10'),

    // Storage encryption
    STORAGE_ENCRYPTION_KEY: z.string().length(64).optional(), // 32-byte hex key

    // Logging
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

type Env = z.infer<typeof envSchema>;

function loadConfig(): Env {
    const result = envSchema.safeParse(process.env);

    if (!result.success) {
        console.error('❌ Invalid environment variables:');
        console.error(result.error.format());
        process.exit(1);
    }

    return result.data;
}

export const config = loadConfig();

// Derived config values
export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
export const isSelfHosted = config.SELF_HOSTED_MODE;

// Rate limit defaults (increased for dashboard with many parallel requests)
export const rateLimits = {
    // Ingest uploads: per-project
    ingest: {
        perProject: { windowMs: 60_000, max: 600 },
        perDevice: { windowMs: 60_000, max: 120 },
        maxBodyBytes: 5 * 1024 * 1024, // 5 MB
    },
    // Dashboard APIs (high limits needed for frames, heatmaps, etc.)
    dashboard: {
        perUser: { windowMs: 60_000, max: 1200 },
        perProject: { windowMs: 60_000, max: 2400 },
        stats: { windowMs: 60_000, max: 300 },
    },
    // Auth/OTP
    auth: {
        otpSend: { windowMs: 15 * 60_000, max: 10 },
        otpVerify: { windowMs: 60_000, max: 30 },
    },
    // API key traffic
    apiKey: {
        perProject: { windowMs: 60_000, max: 1000 },
        safeMode: { windowMs: 60_000, max: 300 },
    },
    // Signed URLs
    signedUrl: { windowMs: 60_000, max: 300 },
    // Network endpoints
    network: { windowMs: 60_000, max: 300 },
    // Admin/billing
    admin: { windowMs: 60_000, max: 120 },
};

// Retention tiers
export const retentionTiers = [
    { tier: 1, days: 7 },  // Free
    { tier: 2, days: 30 },
    { tier: 3, days: 90 },
    { tier: 4, days: 365 },
    { tier: 5, days: null }, // Unlimited
];
