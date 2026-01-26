/**
 * Rejourney Backend Logger
 * 
 * Pino-based structured logging with request ID support
 * 
 * Copyright (c) 2026 Rejourney
 * 
 * Licensed under the Server Side Public License 1.0 (the "License");
 * you may not use this file except in compliance with the License.
 * See LICENSE-SSPL for full terms.
 */

import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
    level: config.LOG_LEVEL,
    transport: config.NODE_ENV === 'development'
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
            },
        }
        : undefined,
    formatters: {
        level: (label) => ({ level: label }),
    },
    base: {
        env: config.NODE_ENV,
    },
    redact: {
        paths: [
            'password',
            'secret',
            'token',
            'authorization',
            'apiKey',
            'accessToken',
            'refreshToken',
            '*.password',
            '*.secret',
            '*.token',
        ],
        censor: '[REDACTED]',
    },
});

// Request-scoped logger creator
export function createRequestLogger(requestId: string) {
    return logger.child({ requestId });
}

export type Logger = typeof logger;
