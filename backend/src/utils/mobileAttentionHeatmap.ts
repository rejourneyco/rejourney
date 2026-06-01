import { gunzipSync } from 'zlib';
import { normalizeHeatmapScreenName } from './heatmapScreens.js';

const FIXATION_MIN_MS = 150;
const ENGAGED_DWELL_CAP_MS = 5_000;
const IDLE_ABANDON_MS = 20_000;
const IDLE_RESIDUAL_FACTOR = 0.35;

const GRID_COLUMNS = 64;
const GRID_ROWS = 128;
const GRID_SIZE = GRID_COLUMNS * GRID_ROWS;
const DWELL_DEPTH_BUCKETS = 100;
const MODEL_VERSION = 'mobile-attention-v1';
const SOFTMAX_TEMPERATURE = 0.75;
const TOUCH_LOOKAHEAD_MS = 337;
const TOUCH_TEMPORAL_SIGMA_MS = 300;
const TOUCH_LOOKAHEAD_WINDOW_MS = 1_200;
const TOUCH_RADIUS_LOGICAL_UNITS = 44;
const DEFAULT_VIEWPORT_WIDTH = 393;
const DEFAULT_VIEWPORT_HEIGHT = 852;
const MAX_HOTSPOTS = 1200;
const TOP_HOTSPOT_LIMIT = 720;
const HOTSPOT_STRATA_COLUMNS = 16;
const HOTSPOT_STRATA_ROWS = 32;
const TOUCH_PRIOR_BUCKET_LIMIT = 300;
const VISIBLE_SCREEN_BASE_EXPOSURE = 0.22;
const VISIBLE_SCREEN_SAMPLE_STEP = 4;

export type MobileAttentionHotspot = {
    x: number;
    y: number;
    intensity: number;
    isRageTap: boolean;
    kind: 'attention' | 'touch' | 'rage';
    dwellMs: number;
    confidence?: number;
};

export type MobileAttentionHeatmapDimensions = {
    pageWidth: number | null;
    pageHeight: number | null;
    viewportWidth: number | null;
    viewportHeight: number | null;
};

export type MobileAttentionTouchPrior = {
    touchBuckets?: Record<string, number> | null;
    rageTapBuckets?: Record<string, number> | null;
    totalTouches?: number | null;
    totalRageTaps?: number | null;
};

export type MobileHierarchySnapshot = {
    timestamp: number;
    screenName?: string | null;
    screen?: Record<string, unknown> | null;
    rootElement: Record<string, unknown>;
};

export type MobileAttentionSessionInput = {
    events: any[];
    hierarchySnapshots?: MobileHierarchySnapshot[];
    screenshotTimestamps?: number[];
    dimensions?: Partial<MobileAttentionHeatmapDimensions>;
    durationMs?: number | null;
    platform?: string | null;
    deviceInfo?: Record<string, unknown> | null;
};

export type MobileAttentionHeatmapResult = MobileAttentionHeatmapDimensions & {
    hotspots: MobileAttentionHotspot[];
    sampledSessions: number;
    avgSessionDurationMs: number | null;
    dwellByDepth: number[];
    eventCount: number;
    generatedAt: string;
    confidence: 'high' | 'medium' | 'low';
    confidenceScore: number;
    modelVersion: typeof MODEL_VERSION;
    signalsUsed: string[];
};

type TileFeatures = {
    exposure: Float64Array;
    aoiExposure: Float64Array;
    saliency: Float64Array;
    suppression: Float64Array;
    candidates: Set<number>;
    scrollOffsetY: number | null;
};

type TouchPoint = {
    timestamp: number;
    x: number;
    y: number;
    weight: number;
    kind: 'touch' | 'rage';
    screenName: string | null;
};

type AttentionAccumulator = {
    raw: Float64Array;
    dwell: Float64Array;
    touch: Float64Array;
    rage: Float64Array;
};

type SubtreeStats = {
    textLength: number;
    textNodeCount: number;
    imageCount: number;
    interactiveCount: number;
    inputCount: number;
    mediaCount: number;
};

type NodeSemanticScore = {
    saliency: number;
    meaningful: boolean;
    spreadXMultiplier: number;
    spreadYMultiplier: number;
    haloStrength: number;
    exposureHalo: number;
};

type AoiOptions = {
    spreadXMultiplier?: number;
    spreadYMultiplier?: number;
    haloStrength?: number;
    exposureHalo?: number;
};

function parseMaybeGzippedJson(data: Buffer, s3ObjectKey?: string | null): any {
    const isGzipped = (data.length > 2 && data[0] === 0x1f && data[1] === 0x8b) ||
        Boolean(s3ObjectKey?.endsWith('.gz'));

    if (!isGzipped) return JSON.parse(data.toString('utf8'));

    try {
        return JSON.parse(gunzipSync(data).toString('utf8'));
    } catch {
        return JSON.parse(data.toString('utf8'));
    }
}

export function extractMobileEventsFromArtifact(data: Buffer, s3ObjectKey?: string | null): {
    events: any[];
    deviceInfo: Record<string, unknown> | null;
} {
    const parsed = parseMaybeGzippedJson(data, s3ObjectKey);
    if (Array.isArray(parsed)) return { events: parsed, deviceInfo: null };

    const events = Array.isArray(parsed?.events) ? parsed.events : [];
    const deviceInfo = parsed?.deviceInfo && typeof parsed.deviceInfo === 'object'
        ? parsed.deviceInfo as Record<string, unknown>
        : null;
    return { events, deviceInfo };
}

export function extractMobileHierarchySnapshotsFromArtifact(
    data: Buffer,
    s3ObjectKey?: string | null,
    fallbackTimestamp?: number | null,
): MobileHierarchySnapshot[] {
    const parsed = parseMaybeGzippedJson(data, s3ObjectKey);
    const snapshots: unknown[] = Array.isArray(parsed?.snapshots)
        ? parsed.snapshots
        : Array.isArray(parsed)
            ? parsed
            : [parsed];

    return snapshots
        .map((snapshot): MobileHierarchySnapshot | null => {
            if (!snapshot || typeof snapshot !== 'object') return null;
            const record = snapshot as Record<string, unknown>;
            const root = record.rootElement || record.root || record;
            if (!root || typeof root !== 'object') return null;
            const timestamp = positiveNumber(record.timestamp) ?? positiveNumber(fallbackTimestamp) ?? 0;
            return {
                timestamp,
                screenName: typeof record.screenName === 'string' ? record.screenName : null,
                screen: record.screen && typeof record.screen === 'object'
                    ? record.screen as Record<string, unknown>
                    : null,
                rootElement: root as Record<string, unknown>,
            };
        })
        .filter((snapshot): snapshot is MobileHierarchySnapshot => snapshot !== null);
}

function positiveNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function finiteNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function clampUnit(value: number): number {
    return clamp(value, 0.004, 0.996);
}

function engagedDwellMs(gapMs: number): number {
    if (!Number.isFinite(gapMs) || gapMs < FIXATION_MIN_MS) return 0;
    if (gapMs <= ENGAGED_DWELL_CAP_MS) return gapMs;
    if (gapMs <= IDLE_ABANDON_MS) return ENGAGED_DWELL_CAP_MS;
    return ENGAGED_DWELL_CAP_MS * IDLE_RESIDUAL_FACTOR;
}

function eventTimestamp(event: any): number | null {
    return positiveNumber(event?.timestamp);
}

function durationMsFromEvents(events: any[]): number | null {
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (const event of events) {
        const timestamp = eventTimestamp(event);
        if (!timestamp) continue;
        first = Math.min(first, timestamp);
        last = Math.max(last, timestamp);
    }
    return Number.isFinite(first) && Number.isFinite(last) && last > first ? last - first : null;
}

function durationMsFromTimestamps(timestamps: number[]): number | null {
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (const timestamp of timestamps) {
        if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
        first = Math.min(first, timestamp);
        last = Math.max(last, timestamp);
    }
    return Number.isFinite(first) && Number.isFinite(last) && last > first ? last - first : null;
}

function screenHintFromEvent(event: any): string | null {
    const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
    const candidates = [
        event?.screenName,
        event?.screen,
        event?.viewId,
        event?.viewLabel,
        payload.screenName,
        payload.screen,
        payload.name,
        payload.route,
    ];

    for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        const normalized = normalizeHeatmapScreenName(candidate);
        if (normalized) return normalized;
    }
    return null;
}

function screenHintFromSnapshot(snapshot: MobileHierarchySnapshot): string | null {
    return normalizeHeatmapScreenName(snapshot.screenName || '');
}

function hasMatchingScreenHint(
    events: any[],
    snapshots: MobileHierarchySnapshot[],
    normalizedScreenName: string | null,
): boolean {
    if (!normalizedScreenName) return false;
    return events.some((event) => screenHintFromEvent(event) === normalizedScreenName) ||
        snapshots.some((snapshot) => screenHintFromSnapshot(snapshot) === normalizedScreenName);
}

function isBackgroundEvent(event: any): boolean | null {
    const type = String(event?.type ?? '').toLowerCase();
    const state = String(
        event?.state ??
        event?.appState ??
        event?.payload?.state ??
        event?.payload?.appState ??
        event?.visibilityState ??
        '',
    ).toLowerCase();
    const combined = `${type}:${state}`;
    if (combined.includes('background') || combined.includes('inactive') || combined.includes('hidden')) return true;
    if (combined.includes('foreground') || combined.includes('active') || combined.includes('visible')) return false;
    return null;
}

function isScrollLikeEvent(event: any): boolean {
    const type = String(event?.type ?? '').toLowerCase();
    const gestureType = String(event?.gestureType ?? event?.payload?.gestureType ?? '').toLowerCase();
    return type === 'scroll' ||
        type === 'scroll_motion' ||
        type === 'pan_motion' ||
        gestureType.includes('scroll') ||
        gestureType.includes('swipe') ||
        gestureType.includes('pan');
}

function touchWeightForEvent(event: any): { weight: number; kind: 'touch' | 'rage' } | null {
    const type = String(event?.type ?? '').toLowerCase();
    const gestureType = String(event?.gestureType ?? event?.payload?.gestureType ?? '').toLowerCase();
    const combined = `${type}:${gestureType}`;

    if (combined.includes('rage')) return { weight: 1.8, kind: 'rage' };
    if (combined.includes('dead_tap')) return { weight: 1.5, kind: 'touch' };
    if (combined.includes('long_press')) return { weight: 1.25, kind: 'touch' };
    if (
        type === 'touch' ||
        type === 'tap' ||
        type === 'click' ||
        type === 'gesture' && (gestureType.includes('tap') || gestureType === 'single_tap' || gestureType === 'double_tap')
    ) {
        return { weight: 1.0, kind: 'touch' };
    }
    return null;
}

function dimensionsFromDeviceInfo(deviceInfo?: Record<string, unknown> | null): Partial<MobileAttentionHeatmapDimensions> {
    if (!deviceInfo) return {};
    const viewportWidth = positiveNumber(deviceInfo.viewportWidth) ??
        positiveNumber(deviceInfo.screenWidth) ??
        positiveNumber(deviceInfo.width);
    const viewportHeight = positiveNumber(deviceInfo.viewportHeight) ??
        positiveNumber(deviceInfo.screenHeight) ??
        positiveNumber(deviceInfo.height);
    return {
        viewportWidth,
        viewportHeight,
        pageWidth: viewportWidth,
        pageHeight: viewportHeight,
    };
}

function dimensionsFromSnapshot(snapshot?: MobileHierarchySnapshot | null): Partial<MobileAttentionHeatmapDimensions> {
    const screen = snapshot?.screen;
    const viewportWidth = positiveNumber(screen?.width);
    const viewportHeight = positiveNumber(screen?.height);
    return {
        viewportWidth,
        viewportHeight,
        pageWidth: viewportWidth,
        pageHeight: viewportHeight,
    };
}

function mergeDimensions(
    current: MobileAttentionHeatmapDimensions,
    incoming?: Partial<MobileAttentionHeatmapDimensions> | null,
): MobileAttentionHeatmapDimensions {
    if (!incoming) return current;
    const viewportWidth = positiveNumber(incoming.viewportWidth) ?? positiveNumber(incoming.pageWidth);
    const viewportHeight = positiveNumber(incoming.viewportHeight) ?? positiveNumber(incoming.pageHeight);
    return {
        viewportWidth: Math.max(current.viewportWidth ?? 0, viewportWidth ?? 0) || current.viewportWidth,
        viewportHeight: Math.max(current.viewportHeight ?? 0, viewportHeight ?? 0) || current.viewportHeight,
        pageWidth: Math.max(current.pageWidth ?? 0, positiveNumber(incoming.pageWidth) ?? viewportWidth ?? 0) || current.pageWidth,
        pageHeight: Math.max(current.pageHeight ?? 0, positiveNumber(incoming.pageHeight) ?? viewportHeight ?? 0) || current.pageHeight,
    };
}

function resolvedDimensions(dimensions: MobileAttentionHeatmapDimensions): { width: number; height: number } {
    return {
        width: dimensions.viewportWidth ?? dimensions.pageWidth ?? DEFAULT_VIEWPORT_WIDTH,
        height: dimensions.viewportHeight ?? dimensions.pageHeight ?? DEFAULT_VIEWPORT_HEIGHT,
    };
}

function tileIndex(column: number, row: number): number {
    return row * GRID_COLUMNS + column;
}

function tileCenter(index: number): { x: number; y: number; column: number; row: number } {
    const row = Math.floor(index / GRID_COLUMNS);
    const column = index % GRID_COLUMNS;
    return {
        x: (column + 0.5) / GRID_COLUMNS,
        y: (row + 0.5) / GRID_ROWS,
        column,
        row,
    };
}

function bucketIndexFromUnit(x: number, y: number): number {
    const column = Math.max(0, Math.min(GRID_COLUMNS - 1, Math.floor(clampUnit(x) * GRID_COLUMNS)));
    const row = Math.max(0, Math.min(GRID_ROWS - 1, Math.floor(clampUnit(y) * GRID_ROWS)));
    return tileIndex(column, row);
}

function positionPriorForTile(index: number): number {
    const { x, y } = tileCenter(index);
    const topHalfBias = y <= 0.5
        ? 1 - y * 0.55
        : clamp(0.72 - (y - 0.5) * 1.05, 0.08, 0.72);
    const centerColumnBias = 1 - Math.min(1, Math.abs(x - 0.5) / 0.5);
    // LTR is the safest default for unknown locale. It is deliberately weak: hierarchy/text
    // saliency should decide where the content actually is, while this keeps list/text scans from
    // looking like exact tap dots.
    const languageSideBias = 1 - x * 0.72;
    const bottomControlBias = y > 0.84 ? clamp((y - 0.84) / 0.14, 0, 1) : 0;
    return clamp(
        0.48 * topHalfBias +
        0.24 * centerColumnBias +
        0.18 * languageSideBias +
        0.10 * bottomControlBias,
        0,
        1,
    );
}

function frameFromNode(node: Record<string, unknown>): { x: number; y: number; w: number; h: number } | null {
    const frame = node.frame && typeof node.frame === 'object' ? node.frame as Record<string, unknown> : null;
    if (!frame) return null;
    const x = finiteNumber(frame.x);
    const y = finiteNumber(frame.y);
    const w = positiveNumber(frame.w ?? frame.width);
    const h = positiveNumber(frame.h ?? frame.height);
    if (x === null || y === null || w === null || h === null) return null;
    return { x, y, w, h };
}

function nodeChildren(node: Record<string, unknown>): Record<string, unknown>[] {
    return Array.isArray(node.children)
        ? node.children.filter((child): child is Record<string, unknown> => child && typeof child === 'object')
        : [];
}

function isSystemOrKeyboardNode(node: Record<string, unknown>): boolean {
    const type = String(node.type ?? '').toLowerCase();
    return type.includes('keyboard') ||
        type.includes('inputset') ||
        type.includes('textinputhost') ||
        type.includes('systemui') ||
        type.includes('statusbar');
}

function stringField(node: Record<string, unknown>, key: string): string {
    const value = node[key];
    return typeof value === 'string' ? value : '';
}

function nodeSemanticText(node: Record<string, unknown>): string {
    return [
        stringField(node, 'type'),
        stringField(node, 'label'),
        stringField(node, 'testID'),
        stringField(node, 'text'),
        stringField(node, 'placeholder'),
        stringField(node, 'buttonTitle'),
    ].filter(Boolean).join(' ').toLowerCase();
}

function isInputLikeNode(node: Record<string, unknown>, semanticText = nodeSemanticText(node)): boolean {
    return semanticText.includes('textfield') ||
        semanticText.includes('edittext') ||
        semanticText.includes('textinput') ||
        semanticText.includes('searchbar') ||
        semanticText.includes('searchfield') ||
        Boolean(node.focused);
}

function isMediaLikeNode(node: Record<string, unknown>, semanticText = nodeSemanticText(node)): boolean {
    return semanticText.includes('video') ||
        semanticText.includes('movie') ||
        semanticText.includes('player') ||
        semanticText.includes('avplayer') ||
        semanticText.includes('camera') ||
        semanticText.includes('mapview') ||
        semanticText.includes('webview') ||
        semanticText.includes('lottie') ||
        semanticText.includes('animation');
}

function subtreeStats(
    node: Record<string, unknown>,
    cache: WeakMap<Record<string, unknown>, SubtreeStats>,
): SubtreeStats {
    const cached = cache.get(node);
    if (cached) return cached;

    const semanticText = nodeSemanticText(node);
    const stats: SubtreeStats = {
        textLength: positiveNumber(node.textLength) ?? 0,
        textNodeCount: positiveNumber(node.textLength) ? 1 : 0,
        imageCount: Boolean(node.hasImage) || semanticText.includes('image') || semanticText.includes('icon') ? 1 : 0,
        interactiveCount: node.interactive ? 1 : 0,
        inputCount: isInputLikeNode(node, semanticText) ? 1 : 0,
        mediaCount: isMediaLikeNode(node, semanticText) ? 1 : 0,
    };

    for (const child of nodeChildren(node)) {
        const childStats = subtreeStats(child, cache);
        stats.textLength += childStats.textLength;
        stats.textNodeCount += childStats.textNodeCount;
        stats.imageCount += childStats.imageCount;
        stats.interactiveCount += childStats.interactiveCount;
        stats.inputCount += childStats.inputCount;
        stats.mediaCount += childStats.mediaCount;
    }

    cache.set(node, stats);
    return stats;
}

function nodeSemanticScore(
    node: Record<string, unknown>,
    frame: { x: number; y: number; w: number; h: number },
    dimensions: { width: number; height: number },
    depth: number,
    statsCache: WeakMap<Record<string, unknown>, SubtreeStats>,
): NodeSemanticScore {
    const stats = subtreeStats(node, statsCache);
    const textLength = positiveNumber(node.textLength) ?? 0;
    const semanticText = nodeSemanticText(node);
    const type = String(node.type ?? '').toLowerCase();
    const hasText = textLength > 0;
    const hasDescendantText = stats.textLength > textLength;
    const hasImage = Boolean(node.hasImage) || type.includes('image');
    const hasDescendantImage = stats.imageCount > Number(hasImage);
    const isInteractive = Boolean(node.interactive) ||
        type.includes('button') ||
        type.includes('touchable') ||
        type.includes('pressable') ||
        type.includes('control');
    const isInput = isInputLikeNode(node, semanticText);
    const hasDescendantInput = stats.inputCount > Number(isInput);
    const isMedia = isMediaLikeNode(node, semanticText);
    const hasDescendantMedia = stats.mediaCount > Number(isMedia);
    const centerY = (frame.y + frame.h / 2) / Math.max(1, dimensions.height);
    const widthRatio = frame.w / Math.max(1, dimensions.width);
    const heightRatio = frame.h / Math.max(1, dimensions.height);
    const compactWide = widthRatio >= 0.45 && heightRatio <= 0.12;
    const topRegion = centerY < 0.22;
    const bottomRegion = centerY > 0.78;
    const inChromeRegion = topRegion || bottomRegion;
    const selected = Boolean(node.selected) || Boolean(node.checked) || semanticText.includes('selected') || semanticText.includes('active');
    const enabled = node.enabled === false ? 0 : 1;
    const headingLike = (
        (hasText || semanticText.includes('title') || semanticText.includes('header')) &&
        (textLength <= 96 || semanticText.includes('title') || semanticText.includes('header')) &&
        frame.h <= Math.max(96, dimensions.height * 0.14)
    );
    const textDensity = hasText ? clamp(textLength / 80, 0.15, 1) : 0;
    const descendantTextDensity = hasDescendantText ? clamp(stats.textLength / 180, 0.10, 0.85) : 0;
    const searchLike = semanticText.includes('search') ||
        semanticText.includes('find') ||
        semanticText.includes('filter') ||
        semanticText.includes('query');
    const searchBarLike = searchLike && (isInput || hasDescendantInput || compactWide || inChromeRegion);
    const topSearchBar = searchBarLike && topRegion;
    const bottomSearchBar = searchBarLike && bottomRegion;
    const topAppBar = topRegion && compactWide && (
        semanticText.includes('navbar') ||
        semanticText.includes('navigation') ||
        semanticText.includes('toolbar') ||
        semanticText.includes('appbar') ||
        semanticText.includes('header') ||
        semanticText.includes('actionbar') ||
        headingLike
    );
    const bottomAppBar = bottomRegion && (
        semanticText.includes('tabbar') ||
        semanticText.includes('tab bar') ||
        semanticText.includes('bottom') ||
        semanticText.includes('bottomnavigation') ||
        semanticText.includes('bottombar') ||
        semanticText.includes('toolbar') ||
        semanticText.includes('appbar') ||
        semanticText.includes('navigation') ||
        (compactWide && stats.interactiveCount >= 2)
    );
    const tabLike = semanticText.includes('tab') ||
        semanticText.includes('segmented') ||
        semanticText.includes('pager') ||
        semanticText.includes('toggle') ||
        semanticText.includes('chip');
    const cardLike = semanticText.includes('card') ||
        semanticText.includes('cell') ||
        semanticText.includes('row') ||
        semanticText.includes('item') ||
        semanticText.includes('list') ||
        semanticText.includes('collection') ||
        semanticText.includes('tableview') ||
        semanticText.includes('recyclerview') ||
        (
            widthRatio > 0.58 &&
            heightRatio >= 0.045 &&
            heightRatio <= 0.22 &&
            depth > 1 &&
            (hasDescendantText || hasDescendantImage || stats.interactiveCount > Number(isInteractive))
        );
    const ctaLike = isInteractive && (
        semanticText.includes('continue') ||
        semanticText.includes('next') ||
        semanticText.includes('done') ||
        semanticText.includes('save') ||
        semanticText.includes('submit') ||
        semanticText.includes('start') ||
        semanticText.includes('buy') ||
        semanticText.includes('pay') ||
        semanticText.includes('login') ||
        semanticText.includes('sign in') ||
        semanticText.includes('push') ||
        semanticText.includes('allow') ||
        (widthRatio > 0.28 && frame.h >= 36 && textLength > 0)
    );
    const iconLike = (semanticText.includes('icon') || semanticText.includes('symbol') || hasImage) &&
        frame.w <= 72 &&
        frame.h <= 72;
    const modalLike = semanticText.includes('modal') ||
        semanticText.includes('dialog') ||
        semanticText.includes('alert') ||
        semanticText.includes('sheet') ||
        semanticText.includes('popup');
    const motionLike = isMedia || hasDescendantMedia || semanticText.includes('animation') || semanticText.includes('progress');
    const masked = Boolean(node.masked);
    const system = isSystemOrKeyboardNode(node);
    const keyboardOrSystem = system || semanticText.includes('keyboard') || semanticText.includes('ime');

    let saliency =
        0.40 * textDensity +
        0.22 * descendantTextDensity +
        0.40 * Number(hasImage) +
        0.28 * Number(hasDescendantImage) +
        0.36 * Number(isMedia) +
        0.24 * Number(hasDescendantMedia) +
        0.34 * Number(isInteractive) * enabled +
        0.34 * Number(isInput) +
        0.46 * Number(headingLike) +
        0.78 * Number(searchBarLike) +
        0.20 * Number(topSearchBar) +
        0.15 * Number(bottomSearchBar) +
        0.54 * Number(topAppBar) +
        0.58 * Number(bottomAppBar) +
        0.42 * Number(tabLike) +
        0.46 * Number(cardLike) +
        0.55 * Number(ctaLike) * enabled +
        0.18 * Number(iconLike) +
        0.34 * Number(modalLike) +
        0.24 * Number(motionLike) +
        0.20 * Number(selected) -
        0.60 * Number(masked) -
        0.48 * Number(keyboardOrSystem);

    if (!enabled && isInteractive) saliency -= 0.16;
    if (widthRatio > 0.92 && heightRatio > 0.64 && !modalLike && !hasText && !hasImage && stats.textNodeCount === 0) {
        saliency *= 0.25;
    }

    const meaningful = saliency > 0.045 ||
        saliency < -0.05 ||
        searchBarLike ||
        topAppBar ||
        bottomAppBar ||
        tabLike ||
        cardLike ||
        ctaLike ||
        motionLike;
    let spreadXMultiplier = 1;
    let spreadYMultiplier = 1;
    let haloStrength = 0.42;
    let exposureHalo = 0.24;

    if (searchBarLike || topAppBar || bottomAppBar || tabLike) {
        spreadXMultiplier = 1.25;
        spreadYMultiplier = 1.75;
        haloStrength = 0.52;
        exposureHalo = 0.30;
    } else if (cardLike) {
        spreadXMultiplier = 0.88;
        spreadYMultiplier = 1.28;
        haloStrength = 0.36;
        exposureHalo = 0.22;
    } else if (hasImage || isMedia || hasDescendantImage || hasDescendantMedia) {
        spreadXMultiplier = 0.76;
        spreadYMultiplier = 0.88;
        haloStrength = 0.32;
        exposureHalo = 0.20;
    } else if (headingLike || ctaLike) {
        spreadXMultiplier = 0.82;
        spreadYMultiplier = 1.18;
        haloStrength = 0.38;
        exposureHalo = 0.23;
    }

    if (keyboardOrSystem || masked) {
        spreadXMultiplier = 0.75;
        spreadYMultiplier = 0.75;
        haloStrength = 0.28;
        exposureHalo = 0.12;
    }

    return {
        saliency,
        meaningful,
        spreadXMultiplier,
        spreadYMultiplier,
        haloStrength,
        exposureHalo,
    };
}

function intersectRect(
    rect: { x: number; y: number; w: number; h: number },
    bounds: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } | null {
    const x1 = Math.max(rect.x, bounds.x);
    const y1 = Math.max(rect.y, bounds.y);
    const x2 = Math.min(rect.x + rect.w, bounds.x + bounds.w);
    const y2 = Math.min(rect.y + rect.h, bounds.y + bounds.h);
    if (x2 <= x1 || y2 <= y1) return null;
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function addAoiToFeatures(
    features: TileFeatures,
    rect: { x: number; y: number; w: number; h: number },
    saliency: number,
    dimensions: { width: number; height: number },
    options: AoiOptions = {},
): void {
    const tileWidth = dimensions.width / GRID_COLUMNS;
    const tileHeight = dimensions.height / GRID_ROWS;
    const spreadX = Math.max(
        32,
        Math.min(
            dimensions.width * 0.24,
            Math.max(rect.w * 0.55, 56) * (options.spreadXMultiplier ?? 1),
        ),
    );
    const spreadY = Math.max(
        28,
        Math.min(
            dimensions.height * 0.12,
            Math.max(rect.h * 1.45, 40) * (options.spreadYMultiplier ?? 1),
        ),
    );
    const minColumn = Math.max(0, Math.floor((rect.x - spreadX) / tileWidth));
    const maxColumn = Math.min(GRID_COLUMNS - 1, Math.floor((rect.x + rect.w + spreadX) / tileWidth));
    const minRow = Math.max(0, Math.floor((rect.y - spreadY) / tileHeight));
    const maxRow = Math.min(GRID_ROWS - 1, Math.floor((rect.y + rect.h + spreadY) / tileHeight));
    const tileArea = tileWidth * tileHeight;
    const saliencyMagnitude = Math.abs(saliency);

    for (let row = minRow; row <= maxRow; row += 1) {
        for (let column = minColumn; column <= maxColumn; column += 1) {
            const tileRect = {
                x: column * tileWidth,
                y: row * tileHeight,
                w: tileWidth,
                h: tileHeight,
            };
            const overlap = intersectRect(rect, tileRect);
            const coverage = overlap ? clamp((overlap.w * overlap.h) / tileArea, 0, 1) : 0;
            const tileCenterX = tileRect.x + tileRect.w / 2;
            const tileCenterY = tileRect.y + tileRect.h / 2;
            const dx = tileCenterX < rect.x
                ? rect.x - tileCenterX
                : tileCenterX > rect.x + rect.w
                    ? tileCenterX - (rect.x + rect.w)
                    : 0;
            const dy = tileCenterY < rect.y
                ? rect.y - tileCenterY
                : tileCenterY > rect.y + rect.h
                    ? tileCenterY - (rect.y + rect.h)
                    : 0;
            const halo = coverage > 0
                ? coverage
                : Math.exp(-0.5 * ((dx / spreadX) ** 2 + (dy / spreadY) ** 2)) * (options.haloStrength ?? 0.42);
            const signal = Math.max(coverage, halo);
            if (signal <= 0.025) continue;
            const index = tileIndex(column, row);
            if (coverage > 0.01) {
                features.aoiExposure[index] = Math.max(features.aoiExposure[index], coverage);
            }
            features.exposure[index] = Math.max(
                features.exposure[index],
                coverage > 0 ? coverage : VISIBLE_SCREEN_BASE_EXPOSURE + signal * (options.exposureHalo ?? 0.24),
            );
            if (saliency >= 0) {
                features.saliency[index] += saliencyMagnitude * signal;
            } else {
                features.suppression[index] += saliencyMagnitude * signal;
            }
            features.candidates.add(index);
        }
    }
}

function largestScrollOffsetY(node: Record<string, unknown>): number | null {
    let largest: number | null = null;
    const visit = (current: Record<string, unknown>) => {
        const contentOffset = current.contentOffset && typeof current.contentOffset === 'object'
            ? current.contentOffset as Record<string, unknown>
            : null;
        const y = finiteNumber(contentOffset?.y);
        if (y !== null && Math.abs(y) > Math.abs(largest ?? 0)) largest = y;
        for (const child of nodeChildren(current)) visit(child);
    };
    visit(node);
    return largest;
}

function buildTileFeatures(
    snapshot: MobileHierarchySnapshot | null,
    dimensions: { width: number; height: number },
    platform?: string | null,
): TileFeatures {
    const features: TileFeatures = {
        exposure: new Float64Array(GRID_SIZE),
        aoiExposure: new Float64Array(GRID_SIZE),
        saliency: new Float64Array(GRID_SIZE),
        suppression: new Float64Array(GRID_SIZE),
        candidates: new Set<number>(),
        scrollOffsetY: snapshot ? largestScrollOffsetY(snapshot.rootElement) : null,
    };

    const seedVisibleScreen = (exposure: number) => {
        for (let index = 0; index < GRID_SIZE; index += 1) {
            features.exposure[index] = exposure;
            const row = Math.floor(index / GRID_COLUMNS);
            const column = index % GRID_COLUMNS;
            if (row % VISIBLE_SCREEN_SAMPLE_STEP === 1 && column % VISIBLE_SCREEN_SAMPLE_STEP === 1) {
                features.candidates.add(index);
            }
        }
    };

    if (!snapshot) {
        seedVisibleScreen(1);
        return features;
    }

    seedVisibleScreen(VISIBLE_SCREEN_BASE_EXPOSURE);

    const screenBounds = { x: 0, y: 0, w: dimensions.width, h: dimensions.height };
    const platformLower = String(platform ?? '').toLowerCase();
    const usesAbsoluteFrames = platformLower === 'android';
    const statsCache = new WeakMap<Record<string, unknown>, SubtreeStats>();

    const visit = (
        node: Record<string, unknown>,
        depth: number,
        parentOrigin: { x: number; y: number },
    ) => {
        if (node.hidden || node.bailout) return;
        const alpha = finiteNumber(node.alpha);
        if (alpha !== null && alpha <= 0.01) return;

        const frame = frameFromNode(node);
        let absoluteFrame: { x: number; y: number; w: number; h: number } | null = null;
        if (frame) {
            absoluteFrame = usesAbsoluteFrames || depth === 0
                ? frame
                : { ...frame, x: parentOrigin.x + frame.x, y: parentOrigin.y + frame.y };
            const clipped = intersectRect(absoluteFrame, screenBounds);
            if (clipped) {
                const semantic = nodeSemanticScore(node, clipped, dimensions, depth, statsCache);
                if (semantic.meaningful) {
                    addAoiToFeatures(
                        features,
                        clipped,
                        semantic.saliency > 0 ? Math.max(0.04, semantic.saliency) : semantic.saliency,
                        dimensions,
                        semantic,
                    );
                }
            }
        }

        const nextOrigin = absoluteFrame
            ? { x: absoluteFrame.x, y: absoluteFrame.y }
            : parentOrigin;
        for (const child of nodeChildren(node)) {
            visit(child, depth + 1, nextOrigin);
        }
    };

    visit(snapshot.rootElement, 0, { x: 0, y: 0 });

    if (features.candidates.size === 0) {
        for (let index = 0; index < GRID_SIZE; index += 1) {
            features.exposure[index] = 1;
            features.candidates.add(index);
        }
    }

    let maxSaliency = 0;
    let maxSuppression = 0;
    for (const index of features.candidates) {
        maxSaliency = Math.max(maxSaliency, features.saliency[index]);
        maxSuppression = Math.max(maxSuppression, features.suppression[index]);
    }
    if (maxSaliency > 0) {
        for (const index of features.candidates) {
            features.saliency[index] = clamp(features.saliency[index] / maxSaliency, 0, 1);
        }
    }
    if (maxSuppression > 0) {
        for (const index of features.candidates) {
            features.suppression[index] = clamp(features.suppression[index] / maxSuppression, 0, 1);
        }
    }

    return features;
}

function collectTouchPoints(
    events: any[],
    normalizedScreenName: string | null,
    dimensions: { width: number; height: number },
): TouchPoint[] {
    const shouldScope = normalizedScreenName
        ? events.some((event) => screenHintFromEvent(event) === normalizedScreenName)
        : false;
    let currentScreen: string | null = null;
    const points: TouchPoint[] = [];

    for (const event of events) {
        const hint = screenHintFromEvent(event);
        if (hint) currentScreen = hint;
        const weight = touchWeightForEvent(event);
        const timestamp = eventTimestamp(event);
        if (!weight || !timestamp) continue;
        const screenName = hint || currentScreen;
        if (shouldScope && screenName !== normalizedScreenName) continue;

        const touches = Array.isArray(event?.touches) && event.touches.length > 0
            ? event.touches
            : [{ x: event?.x ?? event?.payload?.x, y: event?.y ?? event?.payload?.y }];
        for (const touch of touches) {
            const x = finiteNumber(touch?.x);
            const y = finiteNumber(touch?.y);
            if (x === null || y === null || x < 0 || y < 0) continue;
            points.push({
                timestamp: positiveNumber(touch?.timestamp) ?? timestamp,
                x: clamp(x / Math.max(1, dimensions.width), 0, 1),
                y: clamp(y / Math.max(1, dimensions.height), 0, 1),
                weight: weight.weight,
                kind: weight.kind,
                screenName,
            });
        }
    }

    return points;
}

function relevantTouchesForInterval(touches: TouchPoint[], intervalMid: number): TouchPoint[] {
    return touches.filter((touch) => Math.abs(touch.timestamp - intervalMid - TOUCH_LOOKAHEAD_MS) <= TOUCH_LOOKAHEAD_WINDOW_MS);
}

function addTouchCandidateTiles(candidates: Set<number>, touches: TouchPoint[], dimensions: { width: number; height: number }): void {
    const radiusColumns = Math.ceil((TOUCH_RADIUS_LOGICAL_UNITS * 3 / Math.max(1, dimensions.width)) * GRID_COLUMNS);
    const radiusRows = Math.ceil((TOUCH_RADIUS_LOGICAL_UNITS * 3 / Math.max(1, dimensions.height)) * GRID_ROWS);
    for (const touch of touches) {
        const centerColumn = Math.floor(clampUnit(touch.x) * GRID_COLUMNS);
        const centerRow = Math.floor(clampUnit(touch.y) * GRID_ROWS);
        for (let row = Math.max(0, centerRow - radiusRows); row <= Math.min(GRID_ROWS - 1, centerRow + radiusRows); row += 1) {
            for (let column = Math.max(0, centerColumn - radiusColumns); column <= Math.min(GRID_COLUMNS - 1, centerColumn + radiusColumns); column += 1) {
                candidates.add(tileIndex(column, row));
            }
        }
    }
}

function touchLookaheadForTile(index: number, touches: TouchPoint[], intervalMid: number, dimensions: { width: number; height: number }): number {
    if (touches.length === 0) return 0;
    const center = tileCenter(index);
    let value = 0;
    for (const touch of touches) {
        const dx = (center.x - touch.x) * dimensions.width;
        const dy = (center.y - touch.y) * dimensions.height;
        const spatial = Math.exp(-(dx * dx + dy * dy) / (2 * TOUCH_RADIUS_LOGICAL_UNITS * TOUCH_RADIUS_LOGICAL_UNITS));
        const temporalDelta = touch.timestamp - intervalMid - TOUCH_LOOKAHEAD_MS;
        const temporal = Math.exp(-(temporalDelta * temporalDelta) / (2 * TOUCH_TEMPORAL_SIGMA_MS * TOUCH_TEMPORAL_SIGMA_MS));
        value += spatial * temporal * touch.weight;
    }
    return clamp(value, 0, 2);
}

function continuityForTile(index: number, previousProbabilities: Float64Array, previousMax: number): number {
    if (previousMax <= 0) return 0;
    const { column, row } = tileCenter(index);
    let value = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
            const nextColumn = column + dx;
            const nextRow = row + dy;
            if (nextColumn < 0 || nextColumn >= GRID_COLUMNS || nextRow < 0 || nextRow >= GRID_ROWS) continue;
            const weight = dx === 0 && dy === 0 ? 1 : 0.35;
            value = Math.max(value, previousProbabilities[tileIndex(nextColumn, nextRow)] * weight);
        }
    }
    return clamp(value / previousMax, 0, 1);
}

function scrollStability(velocity: number): number {
    return clamp(Math.exp(-Math.abs(velocity) / 1_200), 0.15, 1);
}

function scoreInterval(params: {
    accumulator: AttentionAccumulator;
    features: TileFeatures;
    touches: TouchPoint[];
    intervalMid: number;
    engagedMs: number;
    dimensions: { width: number; height: number };
    scrollVelocity: number;
    previousProbabilities: Float64Array;
    lastExposedAt: Float64Array;
}): Float64Array {
    const candidates = new Set(params.features.candidates);
    const relevantTouches = relevantTouchesForInterval(params.touches, params.intervalMid);
    addTouchCandidateTiles(candidates, relevantTouches, params.dimensions);

    let previousMax = 0;
    for (let index = 0; index < params.previousProbabilities.length; index += 1) {
        if (params.previousProbabilities[index] > previousMax) previousMax = params.previousProbabilities[index];
    }
    if (previousMax > 0) {
        for (let index = 0; index < params.previousProbabilities.length; index += 1) {
            if (params.previousProbabilities[index] > previousMax * 0.12) candidates.add(index);
        }
    }

    const entries: Array<{ index: number; z: number; touchLookahead: number; returnDwell: number }> = [];
    let maxZ = Number.NEGATIVE_INFINITY;

    for (const index of candidates) {
        const exposure = params.features.exposure[index];
        const touchLookahead = touchLookaheadForTile(index, relevantTouches, params.intervalMid, params.dimensions);
        const continuity = continuityForTile(index, params.previousProbabilities, previousMax);
        if (exposure <= 0 && touchLookahead <= 0.01 && continuity <= 0.01) continue;

        const awayForMs = params.lastExposedAt[index] > 0 ? params.intervalMid - params.lastExposedAt[index] : 0;
        const returnDwell = params.features.aoiExposure[index] > 0.05 && awayForMs > 1_500 && awayForMs < 60_000
            ? clamp(awayForMs / 5_000, 0, 1)
            : 0;
        const z =
            1.7 * Math.log(exposure + 0.01) +
            1.85 * params.features.saliency[index] +
            0.72 * positionPriorForTile(index) +
            1.05 * touchLookahead +
            0.55 * continuity +
            0.45 * returnDwell -
            1.05 * params.features.suppression[index];
        maxZ = Math.max(maxZ, z);
        entries.push({ index, z, touchLookahead, returnDwell });
    }

    if (entries.length === 0 || !Number.isFinite(maxZ)) return params.previousProbabilities;

    let denominator = 0;
    const expValues = entries.map((entry) => {
        const value = Math.exp((entry.z - maxZ) / SOFTMAX_TEMPERATURE);
        denominator += value;
        return value;
    });

    if (denominator <= 0) return params.previousProbabilities;

    const nextProbabilities = new Float64Array(GRID_SIZE);
    const stability = scrollStability(params.scrollVelocity);
    for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const probability = expValues[i] / denominator;
        const contribution = params.engagedMs * stability * probability;
        nextProbabilities[entry.index] = probability;
        params.accumulator.raw[entry.index] += contribution;
        params.accumulator.dwell[entry.index] += contribution;
        if (entry.touchLookahead > 0.05) {
            params.accumulator.touch[entry.index] += contribution * Math.min(1, entry.touchLookahead);
        }
        if (entry.returnDwell > 0 && contribution > 0) {
            params.accumulator.raw[entry.index] += contribution * 0.08 * entry.returnDwell;
        }
    }

    for (const index of params.features.candidates) {
        if (params.features.aoiExposure[index] > 0.05) params.lastExposedAt[index] = params.intervalMid;
    }

    return nextProbabilities;
}

function parsePriorBucket(bucket: string): { x: number; y: number } | null {
    const [xStr, yStr] = bucket.includes(',') ? bucket.split(',') : bucket.split(':');
    const x = Number(xStr);
    const y = Number(yStr);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}

function readPositiveBucketEntries(buckets?: Record<string, number> | null): Array<[string, number]> {
    if (!buckets || typeof buckets !== 'object') return [];
    return Object.entries(buckets)
        .map(([bucket, value]) => [bucket, Number(value)] as [string, number])
        .filter(([, value]) => Number.isFinite(value) && value > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOUCH_PRIOR_BUCKET_LIMIT);
}

function addTouchPrior(
    accumulator: AttentionAccumulator,
    prior: MobileAttentionTouchPrior | null | undefined,
    hasReplaySignals: boolean,
): number {
    if (!prior) return 0;
    const touchEntries = readPositiveBucketEntries(prior.touchBuckets);
    const rageEntries = readPositiveBucketEntries(prior.rageTapBuckets);
    const maxTouch = Math.max(1, ...touchEntries.map(([, count]) => count));
    const maxRage = Math.max(1, ...rageEntries.map(([, count]) => count));
    const touchBase = hasReplaySignals ? 250 : 1_400;
    const rageBase = hasReplaySignals ? 650 : 2_800;
    let signalCount = 0;

    for (const [bucket, count] of touchEntries) {
        const point = parsePriorBucket(bucket);
        if (!point) continue;
        const index = bucketIndexFromUnit(point.x, point.y);
        const relative = Math.sqrt(count / maxTouch);
        const value = touchBase * (0.45 + relative * 0.55);
        accumulator.raw[index] += value;
        accumulator.touch[index] += value;
        signalCount += count;
    }

    for (const [bucket, count] of rageEntries) {
        const point = parsePriorBucket(bucket);
        if (!point) continue;
        const index = bucketIndexFromUnit(point.x, point.y);
        const relative = Math.sqrt(count / maxRage);
        const value = rageBase * (0.5 + relative * 0.5);
        accumulator.raw[index] += value;
        accumulator.rage[index] += value;
        signalCount += count;
    }

    return Math.max(signalCount, Number(prior.totalTouches ?? 0) + Number(prior.totalRageTaps ?? 0));
}

function aggregateHotspots(accumulator: AttentionAccumulator): MobileAttentionHotspot[] {
    let maxRaw = 0;
    for (let index = 0; index < GRID_SIZE; index += 1) {
        maxRaw = Math.max(maxRaw, accumulator.raw[index]);
    }
    if (maxRaw <= 0) return [];

    const hotspots: Array<MobileAttentionHotspot & { index: number }> = [];
    for (let index = 0; index < GRID_SIZE; index += 1) {
        const raw = accumulator.raw[index];
        if (raw <= 0) continue;
        const center = tileCenter(index);
        const rageShare = accumulator.rage[index] / Math.max(raw, 1);
        const touchShare = accumulator.touch[index] / Math.max(raw, 1);
        const kind = rageShare > 0.25 ? 'rage' : touchShare > 0.45 ? 'touch' : 'attention';
        hotspots.push({
            index,
            x: Number(center.x.toFixed(4)),
            y: Number(center.y.toFixed(4)),
            intensity: Number(Math.min(1, Math.pow(raw / maxRaw, 0.72)).toFixed(3)),
            isRageTap: kind === 'rage',
            kind,
            dwellMs: Math.round(accumulator.dwell[index]),
        });
    }

    const sorted = hotspots.sort((a, b) => b.intensity - a.intensity);
    const selected = new Map<number, MobileAttentionHotspot & { index: number }>();
    const add = (hotspot: MobileAttentionHotspot & { index: number }) => {
        if (selected.size < MAX_HOTSPOTS) selected.set(hotspot.index, hotspot);
    };

    for (const hotspot of sorted.slice(0, TOP_HOTSPOT_LIMIT)) add(hotspot);

    const bestByStratum = new Map<number, MobileAttentionHotspot & { index: number }>();
    for (const hotspot of sorted) {
        const column = Math.min(HOTSPOT_STRATA_COLUMNS - 1, Math.floor(hotspot.x * HOTSPOT_STRATA_COLUMNS));
        const row = Math.min(HOTSPOT_STRATA_ROWS - 1, Math.floor(hotspot.y * HOTSPOT_STRATA_ROWS));
        const key = row * HOTSPOT_STRATA_COLUMNS + column;
        const current = bestByStratum.get(key);
        if (!current || hotspot.intensity > current.intensity) {
            bestByStratum.set(key, hotspot);
        }
    }

    for (const hotspot of [...bestByStratum.values()].sort((a, b) => b.intensity - a.intensity)) {
        if (selected.size >= MAX_HOTSPOTS) break;
        add(hotspot);
    }

    return [...selected.values()]
        .sort((a, b) => b.intensity - a.intensity)
        .map(({ index: _index, ...hotspot }) => hotspot);
}

function buildDwellDepthProfile(accumulator: AttentionAccumulator): number[] {
    const profile = new Array<number>(DWELL_DEPTH_BUCKETS).fill(0);
    for (let index = 0; index < GRID_SIZE; index += 1) {
        const dwell = accumulator.dwell[index];
        if (dwell <= 0) continue;
        const row = Math.floor(index / GRID_COLUMNS);
        const depth = Math.min(DWELL_DEPTH_BUCKETS - 1, Math.floor((row / GRID_ROWS) * DWELL_DEPTH_BUCKETS));
        profile[depth] += dwell;
    }
    return profile.map((value) => Math.round(value));
}

function confidenceLabel(score: number): 'high' | 'medium' | 'low' {
    if (score >= 0.72) return 'high';
    if (score >= 0.42) return 'medium';
    return 'low';
}

function downsampleTimestamps(timestamps: number[], minGapMs = 350, limit = 300): number[] {
    const sorted = [...new Set(timestamps.filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0))]
        .sort((a, b) => a - b);
    const result: number[] = [];
    for (const timestamp of sorted) {
        if (result.length >= limit) break;
        if (result.length === 0 || timestamp - result[result.length - 1] >= minGapMs) {
            result.push(timestamp);
        }
    }
    return result;
}

export function buildMobileAttentionHeatmap(
    sessions: MobileAttentionSessionInput[],
    fallbackDimensions: Partial<MobileAttentionHeatmapDimensions> = {},
    touchPrior?: MobileAttentionTouchPrior | null,
    screenName?: string | null,
): MobileAttentionHeatmapResult {
    let dimensions: MobileAttentionHeatmapDimensions = mergeDimensions({
        pageWidth: null,
        pageHeight: null,
        viewportWidth: null,
        viewportHeight: null,
    }, fallbackDimensions);
    const normalizedScreenName = normalizeHeatmapScreenName(screenName || '');
    const accumulator: AttentionAccumulator = {
        raw: new Float64Array(GRID_SIZE),
        dwell: new Float64Array(GRID_SIZE),
        touch: new Float64Array(GRID_SIZE),
        rage: new Float64Array(GRID_SIZE),
    };

    let sampledSessions = 0;
    let eventCount = 0;
    let sessionDurationSumMs = 0;
    let sessionDurationCount = 0;
    let hierarchySnapshotCount = 0;
    let screenshotTimestampCount = 0;
    let scrollSignalCount = 0;
    let touchSignalCount = 0;

    for (const session of sessions) {
        const events = [...(session.events || [])]
            .filter((event) => event && typeof event === 'object')
            .sort((a, b) => (eventTimestamp(a) ?? 0) - (eventTimestamp(b) ?? 0));
        const snapshots = [...(session.hierarchySnapshots || [])]
            .filter((snapshot) => snapshot && snapshot.rootElement)
            .sort((a, b) => a.timestamp - b.timestamp);
        const screenshotTimestamps = downsampleTimestamps(session.screenshotTimestamps || []);

        if (events.length === 0 && snapshots.length === 0 && screenshotTimestamps.length === 0) continue;

        sampledSessions += 1;
        eventCount += events.length;
        hierarchySnapshotCount += snapshots.length;
        screenshotTimestampCount += screenshotTimestamps.length;
        dimensions = mergeDimensions(dimensions, session.dimensions);
        dimensions = mergeDimensions(dimensions, dimensionsFromDeviceInfo(session.deviceInfo));
        for (const snapshot of snapshots) {
            dimensions = mergeDimensions(dimensions, dimensionsFromSnapshot(snapshot));
        }

        const dims = resolvedDimensions(dimensions);
        const touches = collectTouchPoints(events, normalizedScreenName, dims);
        touchSignalCount += touches.length;

        const shouldScope = hasMatchingScreenHint(events, snapshots, normalizedScreenName);
        let routeActive = !shouldScope;
        let appActive = true;
        let currentFeatures = snapshots.length > 0
            ? buildTileFeatures(snapshots[0], dims, session.platform)
            : buildTileFeatures(null, dims, session.platform);
        let previousProbabilities: Float64Array<ArrayBufferLike> = new Float64Array(GRID_SIZE);
        const lastExposedAt = new Float64Array(GRID_SIZE);
        let lastSnapshotOffsetY: number | null = currentFeatures.scrollOffsetY;
        let lastSnapshotAt: number | null = snapshots[0]?.timestamp ?? null;
        let measuredScrollVelocity = 0;
        let gestureVelocityUntil = 0;

        const timeline: Array<{ timestamp: number; kind: 'event' | 'snapshot' | 'screenshot'; event?: any; snapshot?: MobileHierarchySnapshot }> = [];
        for (const event of events) {
            const timestamp = eventTimestamp(event);
            if (timestamp) timeline.push({ timestamp, kind: 'event', event });
        }
        for (const snapshot of snapshots) {
            if (snapshot.timestamp > 0) timeline.push({ timestamp: snapshot.timestamp, kind: 'snapshot', snapshot });
        }
        for (const timestamp of screenshotTimestamps) {
            timeline.push({ timestamp, kind: 'screenshot' });
        }
        timeline.sort((a, b) => a.timestamp - b.timestamp);
        if (timeline.length === 0) continue;

        const durationMs = positiveNumber(session.durationMs) ??
            durationMsFromEvents(events) ??
            durationMsFromTimestamps(timeline.map((item) => item.timestamp));
        if (durationMs) {
            sessionDurationSumMs += durationMs;
            sessionDurationCount += 1;
        }

        let lastAt = timeline[0].timestamp;
        for (const item of timeline) {
            const timestamp = item.timestamp;
            const engaged = engagedDwellMs(timestamp - lastAt);
            if (engaged > 0 && routeActive && appActive) {
                const mid = lastAt + (timestamp - lastAt) / 2;
                const velocity = mid <= gestureVelocityUntil
                    ? Math.max(measuredScrollVelocity, 1_800)
                    : measuredScrollVelocity;
                previousProbabilities = scoreInterval({
                    accumulator,
                    features: currentFeatures,
                    touches,
                    intervalMid: mid,
                    engagedMs: engaged,
                    dimensions: dims,
                    scrollVelocity: velocity,
                    previousProbabilities,
                    lastExposedAt,
                });
            }
            lastAt = timestamp;

            if (item.kind === 'event' && item.event) {
                const background = isBackgroundEvent(item.event);
                if (background !== null) appActive = !background;
                const hint = screenHintFromEvent(item.event);
                if (hint && shouldScope) routeActive = hint === normalizedScreenName;
                if (isScrollLikeEvent(item.event)) {
                    scrollSignalCount += 1;
                    gestureVelocityUntil = Math.max(gestureVelocityUntil, timestamp + 450);
                }
            } else if (item.kind === 'snapshot' && item.snapshot) {
                const hint = screenHintFromSnapshot(item.snapshot);
                if (hint && shouldScope) routeActive = hint === normalizedScreenName;
                currentFeatures = buildTileFeatures(item.snapshot, dims, session.platform);
                if (currentFeatures.scrollOffsetY !== null && lastSnapshotOffsetY !== null && lastSnapshotAt !== null && timestamp > lastSnapshotAt) {
                    const delta = Math.abs(currentFeatures.scrollOffsetY - lastSnapshotOffsetY);
                    const seconds = Math.max(0.001, (timestamp - lastSnapshotAt) / 1000);
                    measuredScrollVelocity = delta / seconds;
                    if (delta > 1) scrollSignalCount += 1;
                } else {
                    measuredScrollVelocity = 0;
                }
                lastSnapshotOffsetY = currentFeatures.scrollOffsetY;
                lastSnapshotAt = timestamp;
            }
        }
    }

    const hasReplaySignals = sampledSessions > 0 && (eventCount > 0 || hierarchySnapshotCount > 0 || screenshotTimestampCount > 0);
    const priorSignalCount = addTouchPrior(accumulator, touchPrior, hasReplaySignals);
    const hotspots = aggregateHotspots(accumulator);
    const dwellByDepth = buildDwellDepthProfile(accumulator);
    const signalsUsed = [
        eventCount > 0 ? 'events' : null,
        hierarchySnapshotCount > 0 ? 'hierarchy' : null,
        screenshotTimestampCount > 0 ? 'screenshots' : null,
        scrollSignalCount > 0 ? 'scroll' : null,
        touchSignalCount > 0 ? 'touch' : null,
        priorSignalCount > 0 ? 'touchPrior' : null,
    ].filter((signal): signal is string => Boolean(signal));

    const hierarchyCoverage = sampledSessions > 0 ? clamp(hierarchySnapshotCount / sampledSessions / 2, 0, 1) : 0;
    const replayCoverage = sampledSessions > 0 ? clamp((eventCount > 0 ? 0.45 : 0) + (screenshotTimestampCount > 0 ? 0.55 : 0), 0, 1) : 0;
    const scrollSignalCoverage = sampledSessions > 0 ? clamp(scrollSignalCount / sampledSessions / 3, 0, 1) : 0;
    const sessionVolumeScore = clamp(sampledSessions / 8, 0, 1);
    const touchCoverage = clamp((touchSignalCount + priorSignalCount) / Math.max(sampledSessions, 1) / 4, 0, 1);
    const confidenceScore = clamp(
        0.30 * hierarchyCoverage +
        0.25 * replayCoverage +
        0.20 * scrollSignalCoverage +
        0.15 * sessionVolumeScore +
        0.10 * touchCoverage,
        0,
        1,
    );

    return {
        hotspots,
        sampledSessions,
        avgSessionDurationMs: sessionDurationCount > 0 ? Math.round(sessionDurationSumMs / sessionDurationCount) : null,
        dwellByDepth,
        eventCount,
        generatedAt: new Date().toISOString(),
        confidence: confidenceLabel(confidenceScore),
        confidenceScore: Number(confidenceScore.toFixed(3)),
        modelVersion: MODEL_VERSION,
        signalsUsed,
        pageWidth: dimensions.pageWidth ?? dimensions.viewportWidth ?? DEFAULT_VIEWPORT_WIDTH,
        pageHeight: dimensions.pageHeight ?? dimensions.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT,
        viewportWidth: dimensions.viewportWidth ?? DEFAULT_VIEWPORT_WIDTH,
        viewportHeight: dimensions.viewportHeight ?? DEFAULT_VIEWPORT_HEIGHT,
    };
}
