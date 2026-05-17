import { describe, expect, it } from 'vitest';
import { referrerDomain, scrubUrl } from '../sdk/urlScrubber.js';

describe('url scrubber', () => {
  it('redacts sensitive query params and preserves allowed attribution params', () => {
    const scrubbed = scrubUrl('https://example.com/pricing?utm_source=ad&token=secret&email=a@example.com&x=1', {
      allowedQueryParams: ['utm_source'],
    });

    expect(scrubbed).toBe('https://example.com/pricing?utm_source=ad&token=%5BREDACTED%5D&email=%5BREDACTED%5D');
  });

  it('can produce path-only URLs', () => {
    expect(scrubUrl('https://example.com/a?utm_source=newsletter&code=abc', {
      allowedQueryParams: ['utm_source'],
      pathOnly: true,
    })).toBe('/a?utm_source=newsletter&code=%5BREDACTED%5D');
  });

  it('redacts sensitive path values and URL fragments', () => {
    expect(scrubUrl('https://example.com/reset/abc123def456ghi789jkl012mno345?utm_source=ad#access_token=secret', {
      allowedQueryParams: ['utm_source'],
    })).toBe('https://example.com/reset/[REDACTED]?utm_source=ad');
    expect(scrubUrl('https://example.com/users/alice@example.com/profile')).toBe('https://example.com/users/[REDACTED]/profile');
  });

  it('extracts referrer domains', () => {
    expect(referrerDomain('https://news.example/path')).toBe('news.example');
    expect(referrerDomain('not a url')).toBeNull();
  });
});
