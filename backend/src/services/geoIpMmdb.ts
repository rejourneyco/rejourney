import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { logger } from '../logger.js';

const execFileAsync = promisify(execFile);

const DEFAULT_MMDB_URL = 'https://cdn.jsdelivr.net/npm/geolite2-city/GeoLite2-City.mmdb.gz';
const DEFAULT_MMDB_PATH = path.join(os.tmpdir(), 'rejourney', 'GeoLite2-City.mmdb');

const MMDB_URL = process.env.GEOIP_MMDB_URL || DEFAULT_MMDB_URL;
const MMDB_PATH = process.env.GEOIP_MMDB_PATH || DEFAULT_MMDB_PATH;
const PREFER_MMDB = process.env.GEOIP_PREFER_MMDB !== 'false';
const AUTO_DOWNLOAD_MMDB = process.env.GEOIP_MMDB_AUTO_DOWNLOAD !== 'false';

let mmdbLookupAvailable: boolean | null = null;
let mmdbInitPromise: Promise<boolean> | null = null;
let mmdbDisabledLogged = false;

export type MmdbGeoData = {
    city: string | null;
    region: string | null;
    countryCode: string | null;
    latitude: number | null;
    longitude: number | null;
    timezone: string | null;
};

function logMmdbDisabled(reason: string, extra?: Record<string, unknown>): void {
    if (mmdbDisabledLogged) return;
    mmdbDisabledLogged = true;
    logger.warn({
        reason,
        mmdbPath: MMDB_PATH,
        mmdbUrl: MMDB_URL,
        ...extra,
    }, 'GeoIP MMDB disabled');
}

async function hasUsableFile(filePath: string): Promise<boolean> {
    try {
        const stats = await fs.stat(filePath);
        return stats.isFile() && stats.size > 0;
    } catch {
        return false;
    }
}

async function hasMmdbLookupBinary(): Promise<boolean> {
    if (mmdbLookupAvailable !== null) {
        return mmdbLookupAvailable;
    }

    try {
        await execFileAsync('mmdblookup', ['--help'], { timeout: 2000, maxBuffer: 64 * 1024 });
        mmdbLookupAvailable = true;
        return true;
    } catch (error: any) {
        // ENOENT means the command isn't installed.
        mmdbLookupAvailable = error?.code !== 'ENOENT';
        return mmdbLookupAvailable;
    }
}

async function downloadMmdb(): Promise<void> {
    await fs.mkdir(path.dirname(MMDB_PATH), { recursive: true });

    const tempPath = `${MMDB_PATH}.download`;

    try {
        const response = await fetch(MMDB_URL);
        if (!response.ok || !response.body) {
            throw new Error(`Failed to download MMDB (${response.status} ${response.statusText})`);
        }

        const rawBuffer = Buffer.from(await response.arrayBuffer());
        const isGzip = rawBuffer.length >= 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b;
        const mmdbBuffer = isGzip ? gunzipSync(rawBuffer) : rawBuffer;
        await fs.writeFile(tempPath, mmdbBuffer);

        await fs.rename(tempPath, MMDB_PATH);
        const stats = await fs.stat(MMDB_PATH);
        logger.info({
            mmdbPath: MMDB_PATH,
            bytes: stats.size,
        }, 'GeoLite2-City MMDB downloaded');
    } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
    }
}

async function initMmdb(): Promise<boolean> {
    if (!PREFER_MMDB) {
        return false;
    }

    const hasLookupBinary = await hasMmdbLookupBinary();
    if (!hasLookupBinary) {
        logMmdbDisabled('mmdblookup_missing');
        return false;
    }

    const filePresent = await hasUsableFile(MMDB_PATH);
    if (filePresent) {
        return true;
    }

    if (!AUTO_DOWNLOAD_MMDB) {
        logMmdbDisabled('mmdb_file_missing_auto_download_disabled');
        return false;
    }

    try {
        await downloadMmdb();
        return true;
    } catch (error: any) {
        logMmdbDisabled('mmdb_download_failed', {
            error: error?.message || String(error),
        });
        return false;
    }
}

async function ensureMmdbReady(): Promise<boolean> {
    if (!mmdbInitPromise) {
        mmdbInitPromise = initMmdb();
    }
    return mmdbInitPromise;
}

async function runMmdbLookup(ip: string, ...pathParts: string[]): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync(
            'mmdblookup',
            ['--file', MMDB_PATH, '--ip', ip, ...pathParts],
            { timeout: 2500, maxBuffer: 128 * 1024 }
        );

        if (!stdout || stdout.includes('<nil>')) {
            return null;
        }

        return stdout;
    } catch (error: any) {
        // Normal misses (no data for a path or for an IP) are treated as null.
        const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
        const message = `${error?.message || ''} ${stderr}`.toLowerCase();

        if (
            message.includes('could not find an entry') ||
            message.includes('not found') ||
            message.includes('no data') ||
            message.includes('lookup path does not match')
        ) {
            return null;
        }

        logger.debug({
            ip,
            pathParts,
            error: error?.message || String(error),
        }, 'MMDB lookup path failed');
        return null;
    }
}

function extractStringValue(output: string | null): string | null {
    if (!output) return null;
    const match = output.match(/"([^"]*)"/);
    if (!match) return null;
    const value = match[1].trim();
    return value.length > 0 ? value : null;
}

function extractNumberValue(output: string | null): number | null {
    if (!output) return null;
    const match = output.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
}

export async function lookupGeoIpFromMmdb(ip: string): Promise<MmdbGeoData | null> {
    const ready = await ensureMmdbReady();
    if (!ready) {
        return null;
    }

    const [countryCodeOut, cityOut, regionOut, timezoneOut, latitudeOut, longitudeOut] = await Promise.all([
        runMmdbLookup(ip, 'country', 'iso_code'),
        runMmdbLookup(ip, 'city', 'names', 'en'),
        runMmdbLookup(ip, 'subdivisions', '0', 'iso_code'),
        runMmdbLookup(ip, 'location', 'time_zone'),
        runMmdbLookup(ip, 'location', 'latitude'),
        runMmdbLookup(ip, 'location', 'longitude'),
    ]);

    const countryCode = extractStringValue(countryCodeOut);
    const city = extractStringValue(cityOut);
    const region = extractStringValue(regionOut);
    const timezone = extractStringValue(timezoneOut);
    const latitude = extractNumberValue(latitudeOut);
    const longitude = extractNumberValue(longitudeOut);

    if (!countryCode && !city && !region && !timezone && latitude === null && longitude === null) {
        return null;
    }

    return {
        city,
        region,
        countryCode,
        latitude,
        longitude,
        timezone,
    };
}
