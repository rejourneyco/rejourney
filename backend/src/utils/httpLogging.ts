import type { Request } from 'express';

export function getSafeRequestLogPath(req: Pick<Request, 'originalUrl' | 'url'>): string {
    const url = req.originalUrl || req.url || '/';
    const queryIndex = url.indexOf('?');
    return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

export function serializeRequestForLogs(req: Request & { id?: string | number }) {
    return {
        id: req.id,
        method: req.method,
        url: getSafeRequestLogPath(req),
        remoteAddress: req.socket?.remoteAddress,
        remotePort: req.socket?.remotePort,
    };
}
