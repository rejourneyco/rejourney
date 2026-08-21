import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { ApiError } from './errorHandler.js';
import { verifyInternalServiceRequest } from '../services/internalServiceAuth.js';

export async function requireIssueDetectionInternalAuth(req: Request, _res: Response, next: NextFunction) {
    try {
        const result = await verifyInternalServiceRequest({
            req,
            allowedServices: {
                'issue-detection': config.REJOURNEY_INTERNAL_SERVICE_SECRET,
            },
        });

        if (!result.ok) {
            throw ApiError.unauthorized('Invalid internal service signature');
        }

        next();
    } catch (error) {
        next(error);
    }
}

export async function requireAnalyticsRollupInternalAuth(req: Request, res: Response, next: NextFunction) {
    try {
        const result = await verifyInternalServiceRequest({
            req,
            // `analytics-rollup` is an auditable service label. It intentionally
            // uses the existing shared internal secret, so every holder of that
            // secret remains part of the same trusted server-side boundary.
            allowedServices: {
                'analytics-rollup': config.REJOURNEY_INTERNAL_SERVICE_SECRET,
            },
        });

        if (!result.ok) {
            throw ApiError.unauthorized('Invalid internal service signature');
        }

        res.locals.internalService = result.service;
        next();
    } catch (error) {
        next(error);
    }
}
