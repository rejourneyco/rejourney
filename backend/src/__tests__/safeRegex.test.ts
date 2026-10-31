import { describe, expect, it } from 'vitest';
import {
    USER_REGEX_MAX_INPUT_LENGTH,
    USER_REGEX_MAX_TEXT_LENGTH,
    analyzeUserRegex,
    testUserRegex,
} from '../utils/safeRegex.js';

function timed(fn: () => unknown): number {
    const started = performance.now();
    fn();
    return performance.now() - started;
}

describe('analyzeUserRegex', () => {
    it.each([
        ['(a+)+$', 'nested_quantifier'],
        ['(\\w+\\s?)*$', 'nested_quantifier'],
        ['(a|aa)*c', 'quantified_alternation'],
        ['(a|a){24}b', 'quantified_alternation'],
        ['(?:a|aa){24}c', 'quantified_alternation'],
        ['(a?){30}a{30}', 'nested_quantifier'],
        ['(a)\\1', 'backreference'],
        ['(?<x>a)\\k<x>', 'backreference'],
        ['x'.repeat(257), 'too_long'],
        ['(', 'invalid'],
    ])('rejects %s (%s)', (pattern, reason) => {
        expect(analyzeUserRegex(pattern)).toEqual({ safe: false, reason });
    });

    it.each([
        '^/checkout',
        'checkout$',
        '/product/[a-z0-9-]+/reviews',
        'Screen\\s*\\d+',
        '(\\d{1,3}\\.){3}\\d{1,3}',
        '^(home|settings|profile)$',
        '.*/checkout/.*/confirm.*',
    ])('accepts %s', (pattern) => {
        expect(analyzeUserRegex(pattern)).toMatchObject({ safe: true });
    });

    it('bounds the tested input by the worst-case backtracking cost', () => {
        const one = analyzeUserRegex('error.*timeout');
        const three = analyzeUserRegex('a.*b.*c.*d');
        expect(one.safe && three.safe && one.maxInputLength > three.maxInputLength).toBe(true);
        expect(analyzeUserRegex('^/checkout$')).toEqual({ safe: true, maxInputLength: USER_REGEX_MAX_TEXT_LENGTH });
    });
});

describe('testUserRegex', () => {
    it('matches case-insensitively like the original RegExp', () => {
        expect(testUserRegex('^/CHECKOUT/\\d+$', '/checkout/42')).toBe(true);
        expect(testUserRegex('cart', '/Shop/CART/items')).toBe(true);
        expect(testUserRegex('^/checkout$', '/checkout/42')).toBe(false);
    });

    it('matches a typical long URL rule', () => {
        const url = '/en-us/store/category/electronics/subcategory/laptops/checkout/7f3c9a2e-1b4d-4e8a-9c3f-123456789abc/confirm';
        expect(testUserRegex('/checkout/[0-9a-f-]+/confirm', url)).toBe(true);
    });

    it('tests single values in full up to the input cap', () => {
        const value = `${'x'.repeat(USER_REGEX_MAX_INPUT_LENGTH - 10)}needle`;
        expect(testUserRegex('needle', value)).toBe(true);
        expect(testUserRegex('needle', `${'x'.repeat(USER_REGEX_MAX_INPUT_LENGTH)}needle`)).toBe(false);
    });

    it('never matches unsafe patterns and stays fast on adversarial input', () => {
        expect(testUserRegex('(a|a){24}b', 'a'.repeat(30))).toBe(false);
        expect(timed(() => testUserRegex('(a|a){24}b', 'a'.repeat(30)))).toBeLessThan(250);
        expect(timed(() => testUserRegex('a.*b.*c.*d', 'a'.repeat(3000) + 'b'.repeat(3000) + 'c'.repeat(3000), USER_REGEX_MAX_TEXT_LENGTH))).toBeLessThan(1000);
        expect(timed(() => testUserRegex('error.*timeout', 'error'.repeat(20000), USER_REGEX_MAX_TEXT_LENGTH))).toBeLessThan(1000);
    });
});
