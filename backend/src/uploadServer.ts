import { createRequire } from 'module';
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { v4 as uuidv4 } from 'uuid';
import { config, isDevelopment } from './config.js';
import { logger } from './logger.js';
import { getSafeRequestLogPath, serializeRequestForLogs } from './utils/httpLogging.js';
import { pool } from './db/client.js';
import { getRedisDiagnosticsForLog, initRedis, closeRedis } from './db/redis.js';
import { errorHandler, notFoundHandler } from './middleware/index.js';
import ingestUploadRelayRouter from './routes/ingestUploadRelay.js';
import { isAbortLikeError } from './utils/abortLikeError.js';
import { checkUploadDependencies } from './services/uploadHealth.js';

const require = createRequire(import.meta.url);
const pinoHttp = require('pino-http');

const app = express();
let isShuttingDown = false;

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
    contentSecurityPolicy: isDevelopment ? false : undefined,
}));

app.use(cors({
    origin: true,
    methods: ['GET', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Content-Encoding'],
    credentials: false,
}));

app.use((req, res, next) => {
    req.headers['x-request-id'] = req.headers['x-request-id'] || uuidv4();
    res.setHeader('X-Request-ID', req.headers['x-request-id'] as string);
    next();
});

app.use(pinoHttp({
    logger,
    serializers: { req: serializeRequestForLogs },
    genReqId: (req: Request) => req.headers['x-request-id'] as string,
    customLogLevel: (_req: Request, res: Response, error: Error | undefined) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    },
    customSuccessMessage: (req: Request, res: Response) => `${req.method} ${getSafeRequestLogPath(req)} ${res.statusCode}`,
    customErrorMessage: (req: Request, res: Response) => `${req.method} ${getSafeRequestLogPath(req)} ${res.statusCode}`,
    autoLogging: {
        ignore: (req: Request) => ['/health', '/health/live', '/health/ready'].includes(getSafeRequestLogPath(req)),
    },
}));

app.get('/health/live', (_req, res) => {
    if (isShuttingDown) {
        res.status(503).json({
            status: 'draining',
            service: 'ingest-upload',
            timestamp: new Date().toISOString(),
        });
        return;
    }

    res.json({ status: 'ok', service: 'ingest-upload', timestamp: new Date().toISOString() });
});

const uploadReadinessHandler = async (_req: Request, res: Response) => {
    if (isShuttingDown) {
        res.status(503).json({
            status: 'draining',
            service: 'ingest-upload',
            timestamp: new Date().toISOString(),
        });
        return;
    }

    try {
        await checkUploadDependencies();

        res.json({ status: 'ok', service: 'ingest-upload', timestamp: new Date().toISOString() });
    } catch (error) {
        logger.warn(
            {
                error,
                event: 'upload_service.health_check_failed',
                ...getRedisDiagnosticsForLog(),
            },
            'upload_service.health_check_failed',
        );
        res.status(503).json({
            status: 'error',
            service: 'ingest-upload',
            error: String(error),
            timestamp: new Date().toISOString(),
        });
    }
};

// Keep /health as a backwards-compatible readiness alias for self-hosted
// deployments and external monitors.
app.get('/health', uploadReadinessHandler);
app.get('/health/ready', uploadReadinessHandler);

app.use('/upload', ingestUploadRelayRouter);
app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
    try {
        await initRedis();
        const server = app.listen(config.PORT, '0.0.0.0', () => {
            logger.info({ port: config.PORT }, 'Ingest upload relay listening');
        });

        const shutdown = async (signal: string, exitCode = 0) => {
            if (isShuttingDown) return;
            isShuttingDown = true;
            logger.info({ signal }, 'Ingest upload relay shutting down');
            const forceExitTimer = setTimeout(() => {
                process.exit(exitCode);
            }, 25_000);

            server.close(async () => {
                try {
                    await closeRedis();
                    await pool.end();
                } finally {
                    clearTimeout(forceExitTimer);
                    process.exit(exitCode);
                }
            });
        };

        process.on('SIGTERM', () => {
            void shutdown('SIGTERM');
        });
        process.on('SIGINT', () => {
            void shutdown('SIGINT');
        });
        process.on('unhandledRejection', (reason) => {
            if (isAbortLikeError(reason)) {
                logger.warn({ err: reason }, 'Ignoring abort-like unhandled rejection in ingest upload relay');
                return;
            }
            logger.error({ err: reason }, 'Unhandled rejection in ingest upload relay');
            void shutdown('unhandledRejection', 1);
        });
        process.on('uncaughtExceptionMonitor', (err, origin) => {
            logger.error({ err, origin }, 'Uncaught exception monitor in ingest upload relay');
        });
        process.on('uncaughtException', (err, origin) => {
            logger.error({ err, origin }, 'Fatal uncaught exception in ingest upload relay');
            void shutdown('uncaughtException', 1);
        });
    } catch (err) {
        logger.error({ err }, 'Failed to start ingest upload relay');
        process.exit(1);
    }
}

start();
