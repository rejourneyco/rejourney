/**
 * Pieces shared by the context tools (get_session_context, get_issue_context,
 * get_crash_context): output fragments, lead-up windows and the markdown
 * helpers. Markdown is always rendered from the scrubbed result.
 */

import { z } from 'zod';
import type { SessionTimelineSource } from '../data/types.js';
import { out } from '../output/fields.js';
import { TIMELINE_EVENT_TYPES, condenseTimeline } from '../timeline/condense.js';
import type { CondensedTimelineEvent } from '../timeline/condense.js';
import { leadUpWindow } from '../timeline/moments.js';

export const FRAMES_UNAVAILABLE_REASON = 'Replay frames are not available from this server yet.';
export const LEAD_UP_SECONDS = 30;
export const MAX_LEAD_UP_EVENTS = 120;

export const timelineEventOutput = z.strictObject({
    /** Seconds since session start. */
    t: z.number(),
    type: z.enum(TIMELINE_EVENT_TYPES),
    name: out.text(200),
    detail: out.text(300).optional(),
    screen: out.text(120).optional(),
    /** Consecutive identical events this row stands for. */
    count: z.number(),
    /** Seconds since session start of the last one, when count is above 1. */
    tEnd: z.number().optional(),
    /** Crash, ANR or error id, usable with get_crash_context. */
    faultId: out.id().optional(),
});

export type TimelineEventOutput = z.infer<typeof timelineEventOutput>;

export const deviceOutput = z.strictObject({
    platform: out.text(20).nullable(),
    model: out.text(100).nullable(),
    osVersion: out.text(50).nullable(),
    appVersion: out.text(50).nullable(),
    sdkVersion: out.text(50).nullable(),
});

export interface LeadUp {
    /** Seconds from session start to the moment. */
    atSeconds: number;
    events: CondensedTimelineEvent[];
    /** True when the window held more events than are returned; the ones closest to the moment are kept. */
    dropped: boolean;
}

/** The condensed timeline for the `windowSeconds` before (and including) an instant. */
export function leadUpBefore(source: SessionTimelineSource, atEpochMs: number, windowSeconds = LEAD_UP_SECONDS, maxEvents = MAX_LEAD_UP_EVENTS): LeadUp {
    const atSeconds = Math.round(((atEpochMs - source.sessionStartMs) / 1000) * 10) / 10;
    const all = condenseTimeline(source.events, { sessionStartMs: source.sessionStartMs });
    const window = leadUpWindow(all, atSeconds, windowSeconds, maxEvents);
    return { atSeconds, events: window.events, dropped: window.dropped };
}

// --- Markdown ----------------------------------------------------------------------

/** One line of inline text: no line breaks, no backticks, no table or heading syntax at the start. */
export function mdText(value: unknown, maxLength = 200): string {
    if (value === null || value === undefined) return '';
    const text = String(value).replace(/\s+/g, ' ').replace(/`/g, "'").replace(/^(?:#+|>+|\|+)\s*|^[*+-]\s+/, '').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/** `95.4` -> `1:35`. */
export function mdTime(seconds: number): string {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

export function mdEventLine(event: TimelineEventOutput): string {
    const parts = [`\`${mdTime(event.t)}\``, event.type, mdText(event.name)];
    if (event.detail) parts.push(`(${mdText(event.detail)})`);
    if (event.count > 1) parts.push(`×${event.count}`);
    if (event.screen) parts.push(`on ${mdText(event.screen, 80)}`);
    return `- ${parts.join(' ')}`;
}

export function mdStack(frames: readonly string[], limit = 30): string[] {
    if (frames.length === 0) return ['(no stack stored)'];
    const shown = frames.slice(0, limit).map((frame) => `    ${mdText(frame, 300)}`);
    if (frames.length > limit) shown.push(`    … ${frames.length - limit} more frames in the structured result`);
    return shown;
}

export function mdList(items: readonly string[], empty: string): string[] {
    return items.length > 0 ? [...items] : [empty];
}
