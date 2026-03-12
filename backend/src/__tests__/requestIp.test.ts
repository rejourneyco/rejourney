import { describe, expect, it } from 'vitest';
import { getRequestIp } from '../utils/requestIp.js';

describe('getRequestIp', () => {
    it('prefers cf-connecting-ip when present', () => {
        const ip = getRequestIp({
            headers: {
                'cf-connecting-ip': '176.29.167.216',
                'x-forwarded-for': '10.42.0.1, 203.0.113.9',
                'x-real-ip': '10.42.0.1',
            },
            socket: { remoteAddress: '::ffff:10.42.0.154' } as never,
            ip: '10.42.0.1',
        });

        expect(ip).toBe('176.29.167.216');
    });

    it('uses the first x-forwarded-for address when cloudflare is absent', () => {
        const ip = getRequestIp({
            headers: {
                'x-forwarded-for': '198.51.100.42, 10.42.0.1',
                'x-real-ip': '10.42.0.1',
            },
            socket: { remoteAddress: '::ffff:10.42.0.154' } as never,
            ip: '10.42.0.1',
        });

        expect(ip).toBe('198.51.100.42');
    });

    it('falls back to x-real-ip and then socket/request ip', () => {
        expect(getRequestIp({
            headers: {
                'x-real-ip': '192.0.2.10',
            },
            socket: { remoteAddress: '::ffff:10.42.0.154' } as never,
            ip: '10.42.0.1',
        })).toBe('192.0.2.10');

        expect(getRequestIp({
            headers: {},
            socket: { remoteAddress: '::ffff:10.42.0.154' } as never,
            ip: '10.42.0.1',
        })).toBe('::ffff:10.42.0.154');

        expect(getRequestIp({
            headers: {},
            socket: {} as never,
            ip: '10.42.0.1',
        })).toBe('10.42.0.1');
    });
});
