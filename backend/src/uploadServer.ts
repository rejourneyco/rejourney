import { createRequire } from 'module';
import express, { Request, Response } from 'express';
import helmet from 'helmet';
import { v4 as uuidv4 } from 'uuid';
import { config, isDevelopment } from './config.js';
import { logger } from './logger.js';
import { pool } from './db/client.js';
import { getRedis, initRedis, closeRedis } from './db/redis.js';
import { errorHandler, notFoundHandler } from './middleware/index.js';
import ingestUploadRelayRouter from './routes/ingestUploadRelay.js';

const require = createRequire(import.meta.url);
const pinoHttp = require('pino-http');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
    contentSecurityPolicy: isDevelopment ? false : undefined,
}));

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
    customSuccessMessage: (req: Request, res: Response) => `${req.method} ${req.url} ${res.statusCode}`,
    customErrorMessage: (req: Request, res: Response) => `${req.method} ${req.url} ${res.statusCode}`,
    autoLogging: {
        ignore: (req: Request) => req.url === '/health',
    },
}));

app.get('/health', async (_req, res) => {
    try {
        const client = await pool.connect();
        await client.query('SELECT 1');
        client.release();

        const redisClient = getRedis();
        await redisClient.ping();

        res.json({ status: 'ok', service: 'ingest-upload', timestamp: new Date().toISOString() });
    } catch (error) {
        logger.warn({ error }, 'Ingest upload health check failed');
        res.status(503).json({
            status: 'error',
            service: 'ingest-upload',
            error: String(error),
            timestamp: new Date().toISOString(),
        });
    }
});

app.use('/upload', ingestUploadRelayRouter);
app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
    try {
        await initRedis();
        const server = app.listen(config.PORT, '0.0.0.0', () => {
            logger.info({ port: config.PORT }, 'Ingest upload relay listening');
        });

        const shutdown = async (signal: string) => {
            logger.info({ signal }, 'Ingest upload relay shutting down');
            server.close(async () => {
                await closeRedis();
                await pool.end();
                process.exit(0);
            });
        };

        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGINT', () => shutdown('SIGINT'));
    } catch (err) {
        logger.error({ err }, 'Failed to start ingest upload relay');
        process.exit(1);
    }
}

start();
