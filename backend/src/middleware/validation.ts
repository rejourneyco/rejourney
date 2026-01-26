/**
 * Validation Middleware
 * 
 * Zod-based request validation
 */

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

type RequestPart = 'body' | 'query' | 'params';

/**
 * Create validation middleware for a Zod schema
 */
export function validate<T>(schema: ZodSchema<T>, part: RequestPart = 'body') {
    return (req: Request, res: Response, next: NextFunction): void => {
        try {
            const data = req[part];
            const result = schema.safeParse(data);

            if (!result.success) {
                const errors = formatZodErrors(result.error);
                res.status(400).json({
                    error: 'Validation Error',
                    message: 'Invalid request data',
                    details: errors,
                });
                return;
            }

            // Replace with parsed/transformed data - cast through unknown first
            (req as unknown as Record<string, unknown>)[part] = result.data;
            next();
        } catch {
            res.status(500).json({ error: 'Validation error' });
        }
    };
}

/**
 * Validate multiple parts of the request
 */
export function validateAll<
    TBody = unknown,
    TQuery = unknown,
    TParams = unknown
>(schemas: {
    body?: ZodSchema<TBody>;
    query?: ZodSchema<TQuery>;
    params?: ZodSchema<TParams>;
}) {
    return (req: Request, res: Response, next: NextFunction): void => {
        const errors: Record<string, unknown[]> = {};

        // Validate each part
        for (const [part, schema] of Object.entries(schemas)) {
            if (schema) {
                const data = req[part as RequestPart];
                const result = schema.safeParse(data);

                if (!result.success) {
                    errors[part] = formatZodErrors(result.error);
                } else {
                    // Cast through unknown first to avoid type error
                    (req as unknown as Record<string, unknown>)[part] = result.data;
                }
            }
        }

        if (Object.keys(errors).length > 0) {
            res.status(400).json({
                error: 'Validation Error',
                message: 'Invalid request data',
                details: errors,
            });
            return;
        }

        next();
    };
}

/**
 * Format Zod errors into a more readable format
 */
function formatZodErrors(error: ZodError): Array<{ path: string; message: string }> {
    return error.errors.map((err) => ({
        path: err.path.join('.'),
        message: err.message,
    }));
}
