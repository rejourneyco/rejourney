/**
 * Browser Fingerprint Utility
 * 
 * Collects browser fingerprint data for duplicate account detection.
 * Uses canvas fingerprinting and other browser attributes.
 */

export interface FingerprintData {
    timezone: string;
    browserFingerprint: string;
    screenResolution: string;
    language: string;
    platform: string;
}

/**
 * Generate a SHA-256 hash from a string
 */
async function sha256(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate canvas fingerprint
 * Uses canvas API to render text and shapes, then creates a hash of the result
 */
function getCanvasFingerprint(): string {
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return '';

        canvas.width = 200;
        canvas.height = 50;

        // Draw text with various styles
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillStyle = '#f60';
        ctx.fillRect(125, 1, 62, 20);
        ctx.fillStyle = '#069';
        ctx.fillText('Fingerprint', 2, 15);
        ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
        ctx.fillText('Canvas', 4, 17);

        // Draw a shape
        ctx.beginPath();
        ctx.arc(50, 25, 20, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fill();

        return canvas.toDataURL();
    } catch {
        return '';
    }
}

/**
 * Get WebGL renderer info for fingerprinting
 */
function getWebGLInfo(): string {
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return '';

        const debugInfo = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
        if (!debugInfo) return '';

        const vendor = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        const renderer = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);

        return `${vendor}|${renderer}`;
    } catch {
        return '';
    }
}

/**
 * Collect all fingerprint data
 */
export async function collectFingerprint(): Promise<FingerprintData> {
    // Get timezone
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';

    // Get screen resolution
    const screenResolution = `${window.screen.width}x${window.screen.height}`;

    // Get browser language
    const language = navigator.language || '';

    // Get platform
    const platform = navigator.platform || navigator.userAgent.split('(')[1]?.split(')')[0] || '';

    // Generate browser fingerprint hash
    const fingerprintComponents = [
        getCanvasFingerprint(),
        getWebGLInfo(),
        navigator.userAgent,
        navigator.language,
        new Date().getTimezoneOffset().toString(),
        window.screen.colorDepth?.toString() || '',
        (navigator.hardwareConcurrency || '').toString(),
        // @ts-expect-error deviceMemory may not exist on all browsers
        (navigator.deviceMemory || '').toString(),
        window.screen.width.toString(),
        window.screen.height.toString(),
    ].join('|');

    const browserFingerprint = await sha256(fingerprintComponents);

    return {
        timezone,
        browserFingerprint,
        screenResolution,
        language,
        platform,
    };
}

/**
 * Collect fingerprint with caching
 * Returns cached fingerprint if available, otherwise collects new one
 */
let cachedFingerprint: FingerprintData | null = null;

export async function getFingerprint(): Promise<FingerprintData> {
    if (cachedFingerprint) {
        return cachedFingerprint;
    }

    cachedFingerprint = await collectFingerprint();
    return cachedFingerprint;
}
