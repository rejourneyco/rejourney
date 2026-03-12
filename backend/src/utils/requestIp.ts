import type { Request } from 'express';

function firstHeaderValue(value: string | string[] | undefined): string {
    if (Array.isArray(value)) {
        return value[0]?.trim() || '';
    }
    return value?.trim() || '';
}

function firstForwardedIp(value: string | string[] | undefined): string {
    const normalized = firstHeaderValue(value);
    if (!normalized) {
        return '';
    }

    return normalized
        .split(',')
        .map(ip => ip.trim())
        .find(Boolean) || '';
}

export function getRequestIp(req: Pick<Request, 'headers' | 'socket' | 'ip'>): string {
    const cfConnectingIp = firstHeaderValue(req.headers['cf-connecting-ip']);
    if (cfConnectingIp) {
        return cfConnectingIp;
    }

    const xForwardedFor = firstForwardedIp(req.headers['x-forwarded-for']);
    if (xForwardedFor) {
        return xForwardedFor;
    }

    const xRealIp = firstHeaderValue(req.headers['x-real-ip']);
    if (xRealIp) {
        return xRealIp;
    }

    return req.socket?.remoteAddress || req.ip || '';
}
