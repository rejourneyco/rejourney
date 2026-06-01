export type MobileTapPoint = {
    x: number;
    y: number;
    timestamp: number;
};

export const MOBILE_RAGE_TAP_THRESHOLD = 3;
export const MOBILE_RAGE_TAP_WINDOW_MS = 1000;
export const MOBILE_RAGE_TAP_RADIUS_PX = 50;
export const MOBILE_FRUSTRATION_COUNTS_VERSION = 2;

// Cross-version SDK compatibility:
// Swift SDK 0.2.x and React Native SDK 1.2.x packages are already shipped and
// cannot be forced to upgrade. They can upload ordinary tap events whose target
// label comes from UIKit keyboard classes. Keep this recognizer narrow to UIKit
// system tokens so app UI like "Keyboard shortcuts" still counts normally.
export function isKeyboardAreaTelemetryEvent(event: any): boolean {
    const labelText = [
        event?.label,
        event?.targetLabel,
        event?.name,
        event?.payload?.label,
        event?.payload?.targetLabel,
        event?.payload?.target,
        event?.properties?.label,
        event?.properties?.targetLabel,
        event?.properties?.target,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return labelText.includes('uikeyboard') ||
        labelText.includes('uiinputset') ||
        labelText.includes('uitexteffects') ||
        labelText.includes('uiremotekeyboard');
}

// Accept all historical frustration tap shapes. Older web/RN payloads may use
// top-level `type`, while native iOS artifacts commonly use `type: "gesture"`
// plus `gestureType`/`frustrationKind`. New backend releases must continue to
// ingest both because customers may keep older app binaries installed.
export function getFrustrationTapKind(event: any): 'rage_tap' | 'dead_tap' | null {
    const type = (event?.type || '').toString().toLowerCase();
    const gestureType = (event?.gestureType || event?.properties?.gestureType || event?.payload?.gestureType || '').toString().toLowerCase();
    const frustrationKind = (event?.frustrationKind || event?.properties?.frustrationKind || event?.payload?.frustrationKind || '').toString().toLowerCase();

    if (type === 'dead_tap' || type === 'dead_click' || gestureType === 'dead_tap' || frustrationKind === 'dead_tap') {
        return 'dead_tap';
    }
    if (type === 'rage_tap' || type === 'rage_click' || gestureType === 'rage_tap' || frustrationKind === 'rage_tap') {
        return 'rage_tap';
    }
    return null;
}

export function getFirstTouchPointFromTelemetryEvent(event: any): MobileTapPoint | null {
    const rawTouches = event?.touches || event?.properties?.touches || event?.payload?.touches || [];
    const touches = Array.isArray(rawTouches) ? rawTouches : [];
    const firstTouch = touches[0];
    const x = Number(firstTouch?.x ?? event?.x ?? event?.properties?.x ?? event?.payload?.x);
    const y = Number(firstTouch?.y ?? event?.y ?? event?.properties?.y ?? event?.payload?.y);
    const timestamp = Number(firstTouch?.timestamp ?? event?.timestamp ?? event?.properties?.timestamp ?? event?.payload?.timestamp);

    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(timestamp)) return null;
    return { x, y, timestamp };
}

export function isTapLikeTelemetryEvent(event: any): boolean {
    const type = (event?.type || '').toString().toLowerCase();
    const gestureType = (event?.gestureType || event?.properties?.gestureType || event?.payload?.gestureType || '').toString().toLowerCase();

    return type === 'touch' ||
        type === 'tap' ||
        type === 'click' ||
        gestureType === 'tap' ||
        gestureType === 'single_tap' ||
        gestureType === 'double_tap' ||
        gestureType === 'long_press' ||
        gestureType.includes('tap');
}

export function registerTapForMobileRageInference(recentTaps: MobileTapPoint[], tap: MobileTapPoint): boolean {
    while (
        recentTaps.length > 0 &&
        tap.timestamp - recentTaps[0].timestamp > MOBILE_RAGE_TAP_WINDOW_MS
    ) {
        recentTaps.shift();
    }

    recentTaps.push(tap);
    const nearbyTaps = recentTaps.filter((candidate) => {
        const dx = candidate.x - tap.x;
        const dy = candidate.y - tap.y;
        return Math.hypot(dx, dy) <= MOBILE_RAGE_TAP_RADIUS_PX;
    });
    const isRageTap = nearbyTaps.length >= MOBILE_RAGE_TAP_THRESHOLD;
    if (isRageTap) {
        recentTaps.length = 0;
    }
    return isRageTap;
}

export function computeMobileFrustrationCounts(events: any[]): { rageTapCount: number; deadTapCount: number } {
    const sortedEvents = [...events].sort((a, b) => {
        const aTimestamp = Number(a?.timestamp ?? a?.properties?.timestamp ?? a?.payload?.timestamp ?? 0);
        const bTimestamp = Number(b?.timestamp ?? b?.properties?.timestamp ?? b?.payload?.timestamp ?? 0);
        return aTimestamp - bTimestamp;
    });
    const recentTaps: MobileTapPoint[] = [];
    let rageTapCount = 0;
    let deadTapCount = 0;

    for (const event of sortedEvents) {
        const keyboardAreaEvent = isKeyboardAreaTelemetryEvent(event);
        const frustrationKind = getFrustrationTapKind(event);

        if (keyboardAreaEvent) {
            // Keyboard typing must not seed a rage cluster, and old Swift/RN
            // packages cannot be upgraded in installed apps. Resetting the
            // cluster here keeps old keyboard streams compatible with new
            // backends while preserving non-keyboard rage/dead tap detection.
            recentTaps.length = 0;
            continue;
        }

        if (frustrationKind === 'rage_tap') {
            rageTapCount++;
            recentTaps.length = 0;
            continue;
        }
        if (frustrationKind === 'dead_tap') {
            deadTapCount++;
            recentTaps.length = 0;
            continue;
        }

        if (!isTapLikeTelemetryEvent(event)) continue;
        const tap = getFirstTouchPointFromTelemetryEvent(event);
        if (!tap) continue;
        if (registerTapForMobileRageInference(recentTaps, tap)) {
            rageTapCount++;
        }
    }

    return { rageTapCount, deadTapCount };
}
