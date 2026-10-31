/**
 * Guards for member-supplied regular expressions (Smart Capture "matches regex").
 *
 * The patterns run on the shared ingest workers against SDK-supplied data, so a
 * catastrophic-backtracking pattern would stall decisions for every tenant. They
 * are limited to a conservative subset: no backreferences, no repeated group that
 * contains a quantifier or an alternation ((a+)+, (a|a){24}), and an input prefix
 * sized so the worst-case number of backtracking paths stays bounded.
 */

export const USER_REGEX_MAX_PATTERN_LENGTH = 256;
/** Input tested for a single value (URL path, screen name, event name, ...). */
export const USER_REGEX_MAX_INPUT_LENGTH = 8192;
/** Input tested for the whole-session text fallback. */
export const USER_REGEX_MAX_TEXT_LENGTH = 65536;

/** Worst-case backtracking paths times input length allowed per test (~25ms). */
const BACKTRACKING_COST_BUDGET = 2 ** 25;
/** Below this tested prefix a pattern is rejected rather than truncated. */
const BACKTRACKING_MIN_INPUT_LENGTH = 64;
const COMPILED_CACHE_LIMIT = 256;

export type UserRegexRejection = 'too_long' | 'backreference' | 'nested_quantifier' | 'quantified_alternation' | 'too_complex' | 'invalid';

export type UserRegexAnalysis =
    | { safe: true; maxInputLength: number }
    | { safe: false; reason: UserRegexRejection };

// ---------------------------------------------------------------------------
// Structural analysis
// ---------------------------------------------------------------------------

type GroupFrame = {
    hasQuantifier: boolean;
    hasUnbounded: boolean;
    alternatives: number;
    /** Ways one pass through the group can match, from bounded choices inside it. */
    paths: number;
};

/** Largest repeat count allowed on a group that can match in several bounded ways. */
const MAX_CHOICE_GROUP_REPEAT = 4;

/** Reads a `{n}`, `{n,}` or `{n,m}` quantifier at `index`. */
function readBraceQuantifier(pattern: string, index: number): { end: number; min: number; max: number } | null {
    const match = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(index));
    if (!match) return null;
    const min = Number(match[1]);
    const max = match[2] === undefined ? min : match[3] === '' ? Infinity : Number(match[3]);
    return { end: index + match[0].length, min, max };
}

type StructureScan = {
    /** Why the backtracking engine cannot run the pattern safely, if it cannot. */
    backtrackingRejection: 'nested_quantifier' | 'quantified_alternation' | null;
    /** Choices a backtracking match can make, excluding unbounded quantifiers. */
    boundedPaths: number;
    unboundedQuantifiers: number;
};

/**
 * Walks the pattern for backreferences, repeated groups that can match in
 * several ways ((a+)+, (a|a){24}) and the number of choices a backtracking match
 * can make.
 */
function scanStructure(pattern: string): StructureScan | { reason: 'backreference' | 'invalid' } {
    const newFrame = (): GroupFrame => ({ hasQuantifier: false, hasUnbounded: false, alternatives: 1, paths: 1 });
    const stack: GroupFrame[] = [newFrame()];
    let backtrackingRejection: StructureScan['backtrackingRejection'] = null;
    let boundedPaths = 1;
    let unboundedQuantifiers = 0;
    // The most recently closed group, so a quantifier right after ")" can inspect it.
    let justClosed: GroupFrame | null = null;
    let inClass = false;

    for (let i = 0; i < pattern.length; i += 1) {
        const ch = pattern[i];
        const closedBefore = justClosed;
        justClosed = null;
        const frame = stack[stack.length - 1];

        if (ch === '\\') {
            const next = pattern[i + 1] ?? '';
            if (!inClass && (/[1-9]/.test(next) || next === 'k')) return { reason: 'backreference' };
            i += 1;
            continue;
        }
        if (inClass) {
            if (ch === ']') inClass = false;
            continue;
        }
        if (ch === '[') {
            inClass = true;
            continue;
        }
        if (ch === '(') {
            stack.push(newFrame());
            // Skip group modifiers such as (?:, (?=, (?!, (?<=, (?<!, (?<name>.
            if (pattern[i + 1] === '?') {
                i += 1;
                if (pattern[i + 1] === '<' && pattern[i + 2] !== '=' && pattern[i + 2] !== '!') {
                    const close = pattern.indexOf('>', i);
                    if (close > i) i = close;
                } else {
                    i += 1;
                }
            }
            continue;
        }
        if (ch === ')') {
            const closed = stack.length > 1 ? stack.pop()! : null;
            if (!closed) return { reason: 'invalid' };
            const parent = stack[stack.length - 1];
            if (closed.hasQuantifier) parent.hasQuantifier = true;
            if (closed.hasUnbounded) parent.hasUnbounded = true;
            closed.paths *= closed.alternatives;
            parent.paths *= closed.paths;
            boundedPaths *= closed.alternatives;
            justClosed = closed;
            continue;
        }
        if (ch === '|') {
            frame.alternatives += 1;
            continue;
        }

        let min = 0;
        let max = 0;
        if (ch === '*' || ch === '+') {
            min = ch === '+' ? 1 : 0;
            max = Infinity;
        } else if (ch === '?') {
            max = 1;
        } else if (ch === '{' && readBraceQuantifier(pattern, i)) {
            const brace = readBraceQuantifier(pattern, i)!;
            ({ min, max } = brace);
            i = brace.end - 1;
        } else {
            continue;
        }

        // A lazy marker after a quantifier is not a second quantifier.
        if (pattern[i + 1] === '?') i += 1;

        // Repeating a group that can itself match in several ways backtracks
        // exponentially, whether the repeat count is bounded ((a|a){24}) or not.
        // Small bounded repeats of a group with only bounded choices, such as
        // (\d{1,3}\.){3}, are charged to the path count instead.
        const choiceGroup = closedBefore && (closedBefore.hasQuantifier || closedBefore.alternatives > 1);
        if (closedBefore && choiceGroup && max > 1 && !backtrackingRejection) {
            if (closedBefore.hasUnbounded || max === Infinity || max > MAX_CHOICE_GROUP_REPEAT) {
                backtrackingRejection = closedBefore.hasQuantifier ? 'nested_quantifier' : 'quantified_alternation';
            } else {
                boundedPaths *= closedBefore.paths ** (max - 1);
            }
        }
        if (max === Infinity) unboundedQuantifiers += 1;
        else if (max > min) boundedPaths *= max - min + 1;
        if (max === Infinity) frame.hasUnbounded = true;
        else if (max > min) frame.paths *= max - min + 1;
        frame.hasQuantifier = true;
    }

    boundedPaths *= stack[0].alternatives;
    return {
        backtrackingRejection,
        boundedPaths,
        unboundedQuantifiers,
    };
}

/** Worst case for the backtracking engine: every start position times every combination of choices. */
function backtrackingCost(scan: StructureScan, inputLength: number): number {
    if (scan.backtrackingRejection) return Infinity;
    return inputLength * scan.boundedPaths * (inputLength + 1) ** scan.unboundedQuantifiers;
}

/** Longest input the backtracking engine may examine, or 0 when not even a short prefix is cheap. */
function backtrackingInputLength(scan: StructureScan): number {
    let n = USER_REGEX_MAX_TEXT_LENGTH;
    while (n >= BACKTRACKING_MIN_INPUT_LENGTH && backtrackingCost(scan, n) > BACKTRACKING_COST_BUDGET) n = Math.floor(n / 2);
    return n >= BACKTRACKING_MIN_INPUT_LENGTH ? n : 0;
}

export function analyzeUserRegex(pattern: string): UserRegexAnalysis {
    if (pattern.length > USER_REGEX_MAX_PATTERN_LENGTH) return { safe: false, reason: 'too_long' };
    try {
        new RegExp(pattern, 'i');
    } catch {
        return { safe: false, reason: 'invalid' };
    }

    const scan = scanStructure(pattern);
    if ('reason' in scan) return { safe: false, reason: scan.reason };
    if (scan.backtrackingRejection) return { safe: false, reason: scan.backtrackingRejection };
    const maxInputLength = backtrackingInputLength(scan);
    if (maxInputLength === 0) return { safe: false, reason: 'too_complex' };
    return { safe: true, maxInputLength };
}

type CompiledUserRegex = { regex: RegExp; maxInputLength: number } | null;

const compiledCache = new Map<string, CompiledUserRegex>();

function compileUserRegex(pattern: string): CompiledUserRegex {
    const cached = compiledCache.get(pattern);
    if (cached !== undefined) {
        // Refresh recency.
        compiledCache.delete(pattern);
        compiledCache.set(pattern, cached);
        return cached;
    }
    const analysis = analyzeUserRegex(pattern);
    const compiled: CompiledUserRegex = analysis.safe ? { regex: new RegExp(pattern, 'i'), maxInputLength: analysis.maxInputLength } : null;
    compiledCache.set(pattern, compiled);
    if (compiledCache.size > COMPILED_CACHE_LIMIT) compiledCache.delete(compiledCache.keys().next().value!);
    return compiled;
}

/**
 * Case-insensitive test of a member-supplied pattern. Unsafe or invalid patterns
 * never match. At most `maxInputLength` characters are examined, fewer for
 * patterns whose worst case on that much input is too costly.
 */
export function testUserRegex(pattern: string, input: string, maxInputLength = USER_REGEX_MAX_INPUT_LENGTH): boolean {
    const compiled = compileUserRegex(pattern);
    if (!compiled) return false;
    const length = Math.min(input.length, maxInputLength, compiled.maxInputLength);
    return compiled.regex.test(input.length > length ? input.slice(0, length) : input);
}
