const PLACEHOLDER_ANR_THREAD_STATES = new Set(['blocked']);

function normalizeText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function normalizeFrames(value: unknown): string | null {
    if (Array.isArray(value)) {
        const lines = value
            .map((frame) => normalizeText(frame))
            .filter((frame): frame is string => Boolean(frame));
        return lines.length > 0 ? lines.join('\n') : null;
    }
    return normalizeText(value);
}

function isPlaceholderAnrThreadState(value: unknown): boolean {
    const normalized = normalizeText(value);
    return normalized != null && PLACEHOLDER_ANR_THREAD_STATES.has(normalized.toLowerCase());
}

export function resolveAnrStackTrace(params: {
    threadState?: unknown;
    stack?: unknown;
    frames?: unknown;
    deviceMetadata?: unknown;
}): string | null {
    const directStack = normalizeText(params.stack) ?? normalizeFrames(params.frames);
    if (directStack) {
        return directStack;
    }

    const threadState = normalizeText(params.threadState);
    if (threadState && !isPlaceholderAnrThreadState(threadState)) {
        return threadState;
    }

    const deviceMetadata = params.deviceMetadata && typeof params.deviceMetadata === 'object' && !Array.isArray(params.deviceMetadata)
        ? params.deviceMetadata as Record<string, any>
        : null;
    const metadataStack = normalizeText(deviceMetadata?.stack) ?? normalizeFrames(deviceMetadata?.frames);
    if (metadataStack) {
        return metadataStack;
    }

    return threadState ?? null;
}

export function mergeAnrDeviceMetadata(
    deviceMetadata: unknown,
    stackTrace: string | null,
    rawThreadState?: unknown
): Record<string, any> | null {
    const base = deviceMetadata && typeof deviceMetadata === 'object' && !Array.isArray(deviceMetadata)
        ? { ...(deviceMetadata as Record<string, any>) }
        : {};

    if (stackTrace) {
        base.stack = stackTrace;
    }

    const label = normalizeText(rawThreadState);
    if (label && isPlaceholderAnrThreadState(label)) {
        base.threadStateLabel = label;
    }

    return Object.keys(base).length > 0 ? base : null;
}

function extractAnrFrameSignature(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed || isPlaceholderAnrThreadState(trimmed)) {
        return null;
    }

    const javaOrKotlinMatch = trimmed.match(/\bat\s+((?:[\w$]+\.)+[\w$<>]+)\(/);
    if (javaOrKotlinMatch?.[1]) {
        return javaOrKotlinMatch[1];
    }

    const objcMatch = trimmed.match(/-\[[^\]]+\]/);
    if (objcMatch?.[0]) {
        return objcMatch[0];
    }

    const swiftMangledMatch = trimmed.match(/\$s[\w.]+/);
    if (swiftMangledMatch?.[0]) {
        return swiftMangledMatch[0];
    }

    const nativeMatch = trimmed.match(/\b[\w$]+::[\w$:<>~]+\b/);
    if (nativeMatch?.[0]) {
        return nativeMatch[0];
    }

    const dottedSymbolMatch = trimmed.match(/\b(?:[\w$]+\.)+[\w$<>]+\b/);
    if (dottedSymbolMatch?.[0]) {
        return dottedSymbolMatch[0];
    }

    return null;
}

function isNoiseFrame(signature: string): boolean {
    const lower = signature.toLowerCase();
    return (
        lower.startsWith('java.')
        || lower.startsWith('javax.')
        || lower.startsWith('android.')
        || lower.startsWith('androidx.')
        || lower.startsWith('kotlin.')
        || lower.startsWith('kotlinx.')
        || lower.startsWith('sun.')
        || lower.startsWith('libcore.')
    );
}

export function generateANRFingerprintFromStackTrace(stackTrace: string): string {
    if (!stackTrace) {
        return 'anr:ANR:unknown';
    }

    const meaningfulFrames: string[] = [];

    for (const line of stackTrace.split('\n')) {
        if (
            line.includes('Thread Stack')
            || line.includes('PC:')
            || line.includes('LR:')
            || line.includes('SP:')
        ) {
            continue;
        }

        const signature = extractAnrFrameSignature(line);
        if (signature && !isNoiseFrame(signature)) {
            meaningfulFrames.push(signature);
        }
    }

    if (meaningfulFrames.length > 0) {
        return `anr:ANR:${meaningfulFrames.slice(0, 3).join(':')}`;
    }

    return 'anr:ANR:main_thread_blocked';
}
