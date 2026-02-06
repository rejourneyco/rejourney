/**
 * Rejourney Backend API Server
 * 
 * Copyright (c) 2026 Rejourney
 * 
 * Licensed under the Server Side Public License 1.0 (the "License");
 * you may not use this file except in compliance with the License.
 * See LICENSE-SSPL for full terms.
 */

import { createRequire } from 'module';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { v4 as uuidv4 } from 'uuid';

import { config, isDevelopment } from './config.js';
import { logger } from './logger.js';
import { pool } from './db/client.js';
import { getRedis, closeRedis, initRedis } from './db/redis.js';
import routes from './routes/index.js';
import { csrfProtection, originValidation, errorHandler, notFoundHandler } from './middleware/index.js';
import { startStatsAggregationJob, stopStatsAggregationJob } from './jobs/statsAggregator.js';
import { startAlertWorker, stopAlertWorker } from './worker/alertWorker.js';
import stripeWebhooksRoutes from './routes/stripeWebhooks.js';
import { getBaseDomain } from './utils/domain.js';

// Use createRequire for CJS modules
const require = createRequire(import.meta.url);
const pinoHttp = require('pino-http');

const app = express();

app.set('trust proxy', 1);
// Disable X-Powered-By header (security best practice)
app.disable('x-powered-by');

app.use(helmet({
    contentSecurityPolicy: isDevelopment ? false : undefined,
}));

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps or curl)
        if (!origin) return callback(null, true);

        // Always allow localhost for development
        const localhostPatterns = [
            'http://localhost:3000',
            'http://localhost:8080',
            'http://localhost:3456',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:8080',
            'http://127.0.0.1:3456',
        ];
        if (localhostPatterns.includes(origin)) {
            return callback(null, true);
        }

        // Allow configured dashboard URL and related domains
        if (config.PUBLIC_DASHBOARD_URL) {
            // Allow exact match
            if (origin === config.PUBLIC_DASHBOARD_URL) {
                return callback(null, true);
            }

            try {
                const dashboardUrl = new URL(config.PUBLIC_DASHBOARD_URL);
                const originUrl = new URL(origin);

                const dashboardBase = getBaseDomain(dashboardUrl.hostname);
                const originBase = getBaseDomain(originUrl.hostname);

                // Allow same base domain (e.g., rejourney.co, www.rejourney.co)
                if (dashboardBase === originBase) {
                    return callback(null, true);
                }
            } catch (e) {
                // Invalid URL, fall through to deny
            }
        }

        // Allow local network IPs (192.168.x.x, 10.x.x.x, etc.)
        if (/^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(origin)) {
            return callback(null, true);
        }

        // In development, allow all
        if (isDevelopment) {
            return callback(null, true);
        }

        // Otherwise deny
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Rejourney-Key', 'X-API-Key', 'X-CSRF-Token', 'X-Device-Id', 'X-Upload-Token', 'X-Ingest-Token', 'Idempotency-Key', 'X-Session-Id'],
}));


// Stripe webhooks (must be before body parsing middleware to preserve raw body)
app.use('/api/webhooks', stripeWebhooksRoutes);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

app.use((req, res, next) => {
    req.headers['x-request-id'] = req.headers['x-request-id'] || uuidv4();
    res.setHeader('X-Request-ID', req.headers['x-request-id'] as string);
    next();
});

app.use(pinoHttp({
    logger,
    genReqId: (req: Request) => req.headers['x-request-id'] as string,
    customLogLevel: (_req: Request, res: Response, error: Error | undefined) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    },
    customSuccessMessage: (req: Request, res: Response) => {
        return `${req.method} ${req.url} ${res.statusCode}`;
    },
    customErrorMessage: (req: Request, res: Response) => {
        return `${req.method} ${req.url} ${res.statusCode}`;
    },
    autoLogging: {
        ignore: (req: Request) => req.url === '/health' || req.url === '/health/live' || req.url === '/health/ready' || req.url === '/ready',
    },
}));

app.use(originValidation);
app.use(csrfProtection);

// =============================================================================
// Health Check Endpoints
// =============================================================================

/**
 * Liveness probe - indicates the service is running
 * Kubernetes uses this to know when to restart the container
 */
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Ingest-specific health check for Uptime Kuma HTTP monitor
 * Returns 200 if ingest is functional (DB + Redis)
 */
app.get('/health/ingest', async (_req, res) => {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();

        const redisClient = getRedis();
        await redisClient.ping();

        res.json({
            status: 'ok',
            service: 'ingest',
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        logger.warn({ error }, 'Ingest health check failed');
        res.status(503).json({
            status: 'error',
            service: 'ingest',
            error: String(error),
            timestamp: new Date().toISOString(),
        });
    }
});

/**
 * Ingest queue health check for Uptime Kuma HTTP JSON monitor
 * Returns 200 if queue is healthy, 503 if backlogged/critical
 * Use with Uptime Kuma JSON Query: $.status == "healthy"
 * 
 * Thresholds:
 * - healthy: < 500 pending jobs, oldest job < 5 min
 * - degraded: < 2000 pending jobs, oldest job < 15 min  
 * - critical: >= 2000 pending jobs OR oldest job >= 15 min
 */
app.get('/health/queue', async (_req, res) => {
    try {
        const { checkQueueHealth } = await import('./services/monitoring.js');
        const queueHealth = await checkQueueHealth();

        const statusCode = queueHealth.status === 'critical' ? 503 : 200;

        res.status(statusCode).json({
            status: queueHealth.status,
            service: 'ingest-queue',
            pendingJobs: queueHealth.pendingJobs,
            processingJobs: queueHealth.processingJobs,
            dlqJobs: queueHealth.dlqJobs,
            oldestPendingSeconds: queueHealth.oldestPendingAge,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        logger.warn({ error }, 'Queue health check failed');
        res.status(503).json({
            status: 'error',
            service: 'ingest-queue',
            error: String(error),
            timestamp: new Date().toISOString(),
        });
    }
});

/**
 * Readiness probe - indicates the service can handle requests
 * Kubernetes uses this to know when to route traffic to the container
 * Checks all critical dependencies: database, Redis, and S3
 */
app.get('/health/ready', async (_req, res) => {
    const checks: Record<string, boolean | string> = {};
    let allHealthy = true;

    // Check database
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        checks.database = true;
    } catch (error) {
        checks.database = false;
        allHealthy = false;
        logger.warn({ error }, 'Database health check failed');
    }

    // Check Redis
    try {
        const redisClient = getRedis();
        await redisClient.ping();
        checks.redis = true;
    } catch (error) {
        checks.redis = false;
        allHealthy = false;
        logger.warn({ error }, 'Redis health check failed');
    }

    // Check S3 (optional, don't fail readiness if S3 check fails)
    try {
        const { checkS3Connection } = await import('./db/s3.js');
        const s3Healthy = await checkS3Connection();
        checks.s3 = s3Healthy;
        if (!s3Healthy) {
            logger.warn('S3 health check returned unhealthy');
        }
    } catch (error) {
        checks.s3 = 'unknown';
        logger.warn({ error }, 'S3 health check failed (non-critical)');
    }

    const status = allHealthy ? 'ready' : 'degraded';
    res.status(allHealthy ? 200 : 503).json({
        status,
        checks,
        timestamp: new Date().toISOString(),
    });
});

/**
 * Debug health endpoint - detailed internal metrics
 * IMPORTANT: This endpoint should only be accessible internally
 * Use in k8s: restrict via NetworkPolicy or internal-only service
 */
app.get('/health/debug', async (req, res) => {
    // Only allow from internal IPs or with debug header
    const debugToken = req.headers['x-debug-token'];
    const isInternal = req.ip?.startsWith('10.') ||
        req.ip?.startsWith('172.') ||
        req.ip?.startsWith('192.168.') ||
        req.ip === '127.0.0.1' ||
        req.ip === '::1';

    if (!isInternal && debugToken !== process.env.DEBUG_HEALTH_TOKEN) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }

    const metrics: Record<string, any> = {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
    };

    // Database pool stats
    try {
        metrics.database = {
            totalConnections: pool.totalCount,
            idleConnections: pool.idleCount,
            waitingClients: pool.waitingCount,
        };
    } catch (error) {
        metrics.database = { error: String(error) };
    }

    // Redis health
    try {
        const redisClient = getRedis();
        const pingStart = Date.now();
        await redisClient.ping();
        metrics.redis = {
            status: 'connected',
            pingMs: Date.now() - pingStart,
        };
    } catch (error) {
        metrics.redis = { status: 'error', error: String(error) };
    }

    // Queue health
    try {
        const { checkQueueHealth } = await import('./services/monitoring.js');
        metrics.queue = await checkQueueHealth();
    } catch (error) {
        metrics.queue = { error: String(error) };
    }

    // SMTP health (verify transporter)
    try {
        const { getTransporter } = await import('./services/email.js');
        if (config.SMTP_HOST) {
            const transporter = getTransporter();
            if (transporter) {
                await transporter.verify();
                metrics.smtp = { status: 'connected', host: config.SMTP_HOST };
            } else {
                metrics.smtp = { status: 'not_configured' };
            }
        } else {
            metrics.smtp = { status: 'not_configured' };
        }
    } catch (error) {
        metrics.smtp = { status: 'error', error: String(error) };
    }

    // Worker statuses from Redis
    try {
        const redisClient = getRedis();
        const workerKeys = [
            'alerts:worker:last_run',
            'ingestWorker:last_run',
            'retentionWorker:last_run',
            'statsAggregator:last_run',
        ];

        metrics.workers = {};
        for (const key of workerKeys) {
            const lastRun = await redisClient.get(key);
            const workerName = key.split(':')[0];
            metrics.workers[workerName] = {
                lastRun: lastRun || null,
                stale: lastRun ? (Date.now() - new Date(lastRun).getTime()) > 30 * 60 * 1000 : true,
            };
        }
    } catch (error) {
        metrics.workers = { error: String(error) };
    }

    res.json(metrics);
});

// Legacy /ready endpoint for backwards compatibility
app.get('/ready', async (_req, res) => {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();
        const redisClient = getRedis();
        await redisClient.ping();

        res.json({
            status: 'ready',
            database: 'connected',
            redis: 'connected',
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(503).json({
            status: 'not ready',
            error: String(error),
            timestamp: new Date().toISOString(),
        });
    }
});

app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);

let isShuttingDown = false;

async function shutdown(signal: string) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, 'Shutting down gracefully...');
    stopStatsAggregationJob();
    stopAlertWorker();
    await closeRedis();
    await pool.end();
    logger.info('Shutdown complete');
    process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

const PORT = config.PORT;

// Initialize Redis connection on startup
initRedis().catch((err: unknown) => {
    logger.error({ err }, 'Failed to initialize Redis connection');
});

// Start API monitoring heartbeat
let lastApiHeartbeatAt = 0;
const API_HEARTBEAT_INTERVAL_MS = 60_000; // 1 minute

async function sendApiHeartbeat(): Promise<void> {
    const now = Date.now();
    if (now - lastApiHeartbeatAt < API_HEARTBEAT_INTERVAL_MS) return;
    lastApiHeartbeatAt = now;

    try {
        const { pingWorker } = await import('./services/monitoring.js');
        await pingWorker('api', 'up');
    } catch (err) {
        // Don't let monitoring failures affect API operation
        logger.debug({ err }, 'Failed to send API heartbeat');
    }
}

// Send heartbeat every minute
setInterval(sendApiHeartbeat, API_HEARTBEAT_INTERVAL_MS);
// Send initial heartbeat after 10 seconds
setTimeout(sendApiHeartbeat, 10_000);

app.listen(PORT, () => {
    logger.info({ port: PORT, env: config.NODE_ENV }, '🚀 Rejourney API server started');
    // Start the stats aggregation cron job
    startStatsAggregationJob();
    // Start the alert worker for faster spike detection
    startAlertWorker();
});

export default app;
