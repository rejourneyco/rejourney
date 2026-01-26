/**
 * Error Handler Middleware
 * 
 * Global error handling with consistent JSON responses
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../logger.js';
import { config } from '../config.js';

/**
 * Custom API error class
 */
export class ApiError extends Error {
    statusCode: number;
    code?: string;
    details?: unknown;

    constructor(
        message: string,
        statusCode: number = 500,
        code?: string,
        details?: unknown
    ) {
        super(message);
        this.name = 'ApiError';
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }

    static badRequest(message: string, details?: unknown) {
        return new ApiError(message, 400, 'BAD_REQUEST', details);
    }

    static unauthorized(message: string = 'Unauthorized') {
        return new ApiError(message, 401, 'UNAUTHORIZED');
    }

    static forbidden(message: string = 'Forbidden') {
        return new ApiError(message, 403, 'FORBIDDEN');
    }

    static paymentRequired(message: string = 'Payment required') {
        return new ApiError(message, 402, 'PAYMENT_REQUIRED');
    }

    static notFound(message: string = 'Not found') {
        return new ApiError(message, 404, 'NOT_FOUND');
    }

    static conflict(message: string, details?: unknown) {
        return new ApiError(message, 409, 'CONFLICT', details);
    }

    static tooManyRequests(message: string = 'Too many requests', retryAfter?: number) {
        return new ApiError(message, 429, 'RATE_LIMIT', { retryAfter });
    }

    static internal(message: string = 'Internal server error') {
        return new ApiError(message, 500, 'INTERNAL_ERROR');
    }

    static serviceUnavailable(message: string = 'Service unavailable') {
        return new ApiError(message, 503, 'SERVICE_UNAVAILABLE');
    }
}

/**
 * Not found handler for unmatched routes
 */
export function notFoundHandler(
    req: Request,
    res: Response,
    _next: NextFunction
): void {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`,
    });
}

/**
 * Global error handler
 */
export function errorHandler(
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction
): void {
    // Log the error
    const requestId = req.headers['x-request-id'] || 'unknown';

    if (err instanceof ApiError) {
        if (err.statusCode >= 500) {
            logger.error({ err, requestId, path: req.path }, err.message);
        } else {
            logger.warn({ err, requestId, path: req.path }, err.message);
        }
    } else if (err instanceof ZodError) {
        logger.warn({ requestId, path: req.path, errors: err.errors }, 'Validation error');
    } else {
        logger.error({ err, requestId, path: req.path }, 'Unhandled error');
    }

    // Handle specific error types
    if (err instanceof ApiError) {
        res.status(err.statusCode).json({
            error: err.code || 'Error',
            message: err.message,
            details: err.details,
        });
        return;
    }

    if (err instanceof ZodError) {
        res.status(400).json({
            error: 'Validation Error',
            message: 'Invalid request data',
            details: err.errors.map((e) => ({
                path: e.path.join('.'),
                message: e.message,
            })),
        });
        return;
    }

    // Prisma unique constraint error
    if ((err as any).code === 'P2002') {
        res.status(409).json({
            error: 'Conflict',
            message: 'A record with this value already exists',
        });
        return;
    }

    // Prisma not found error
    if ((err as any).code === 'P2025') {
        res.status(404).json({
            error: 'Not Found',
            message: 'Record not found',
        });
        return;
    }

    // Generic error response
    res.status(500).json({
        error: 'Internal Server Error',
        message: config.NODE_ENV === 'production'
            ? 'An unexpected error occurred'
            : err.message,
        ...(config.NODE_ENV !== 'production' && { stack: err.stack }),
    });
}

/**
 * Async handler wrapper to catch async errors
 */
export function asyncHandler<T>(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<T>
) {
    return (req: Request, res: Response, next: NextFunction): void => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
