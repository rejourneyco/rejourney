import { describe, expect, it } from 'vitest';
import { findUnsafeSmartCaptureRegex, normalizeSmartCaptureRules } from '../services/smartCapture.js';

const BYPASS = '(a|a){24}b';

describe('findUnsafeSmartCaptureRegex', () => {
    it('accepts simple regex rules and rules without the regex operator', () => {
        const rules = normalizeSmartCaptureRules([
            { type: 'attribute', signal: 'url_path', operator: 'matches_regex', value: '^/checkout/(cart|pay)' },
            { type: 'attribute', signal: 'url_path', operator: 'matches_regex', value: '.*/checkout/.*/confirm.*' },
            { type: 'attribute', signal: 'screen_name', operator: 'contains', value: BYPASS },
            { type: 'duration', signal: 'minimum_signal', operator: 'gte', value: 45 },
        ]);
        expect(findUnsafeSmartCaptureRegex(rules)).toBeNull();
    });

    it('rejects a catastrophic pattern on the rule itself', () => {
        const rules = normalizeSmartCaptureRules([
            { id: 'r1', type: 'attribute', signal: 'url_path', operator: 'matches_regex', value: BYPASS },
        ]);
        expect(findUnsafeSmartCaptureRegex(rules)).toMatchObject({ ruleId: 'r1', reason: 'quantified_alternation' });

        const conditionOperator = normalizeSmartCaptureRules([
            { id: 'r1b', type: 'attribute', condition: { attribute: 'url_path', operator: 'matches_regex', value: '(a+)+(?=b)' } },
        ]);
        expect(findUnsafeSmartCaptureRegex(conditionOperator)).toMatchObject({ ruleId: 'r1b', reason: 'nested_quantifier' });
    });

    it('rejects catastrophic patterns hidden in clauses and scopes', () => {
        const clauseRules = normalizeSmartCaptureRules([{
            id: 'r2',
            type: 'composite',
            condition: { all: [{ attribute: 'event_name', operator: 'MATCHES_REGEX', value: BYPASS }] },
        }]);
        expect(findUnsafeSmartCaptureRegex(clauseRules)).toMatchObject({ ruleId: 'r2', reason: 'quantified_alternation' });

        const scopeRules = normalizeSmartCaptureRules([{
            id: 'r3',
            type: 'metric',
            operator: 'matches_regex',
            condition: { scope: { attribute: 'screen_name', value: '(a)\\1' } },
        }]);
        expect(findUnsafeSmartCaptureRegex(scopeRules)).toMatchObject({ ruleId: 'r3', reason: 'backreference' });

        const ownScopeOperator = normalizeSmartCaptureRules([{
            id: 'r4',
            type: 'metric',
            condition: { metric: 'rage', scope: { attribute: 'screen_name', operator: 'matches_regex', value: BYPASS } },
        }]);
        expect(findUnsafeSmartCaptureRegex(ownScopeOperator)).toMatchObject({ ruleId: 'r4', reason: 'quantified_alternation' });
    });

    it('ignores plain-text values whose effective operator is not matches_regex', () => {
        const rules = normalizeSmartCaptureRules([
            {
                // A regex clause next to a plain "contains" clause.
                id: 'mixed',
                type: 'composite',
                condition: {
                    all: [
                        { attribute: 'url_path', operator: 'matches_regex', value: '^/checkout' },
                        { attribute: 'screen_name', operator: 'contains', value: BYPASS },
                    ],
                },
            },
            {
                // Clauses do not inherit the parent rule's operator at runtime.
                id: 'parent-operator',
                type: 'composite',
                operator: 'matches_regex',
                condition: { any: [{ attribute: 'screen_name', value: BYPASS }] },
            },
            {
                // A scope with its own operator does not use the rule's.
                id: 'scope-operator',
                type: 'metric',
                operator: 'matches_regex',
                condition: { metric: 'rage', value: 1, scope: { attribute: 'screen_name', operator: 'contains', value: BYPASS } },
            },
            {
                // A compound rule's own value is never compared.
                id: 'compound-value',
                type: 'composite',
                condition: {
                    operator: 'matches_regex',
                    value: BYPASS,
                    all: [{ attribute: 'url_path', operator: 'eq', value: '/home' }],
                },
            },
        ]);
        expect(findUnsafeSmartCaptureRegex(rules)).toBeNull();
    });

    it('keeps accepting syntactically invalid patterns, which simply never match', () => {
        const rules = normalizeSmartCaptureRules([
            { type: 'attribute', signal: 'url_path', operator: 'matches_regex', value: '(unclosed' },
        ]);
        expect(findUnsafeSmartCaptureRegex(rules)).toBeNull();
    });
});
