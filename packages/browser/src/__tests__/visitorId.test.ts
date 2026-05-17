import { describe, expect, it } from 'vitest';
import { createSessionId, createVisitorId } from '../sdk/visitorId.js';

describe('visitor ids', () => {
  it('uses web-prefixed anonymous visitor ids', () => {
    expect(createVisitorId()).toMatch(/^web_anon_/);
  });

  it('uses server-compatible session ids', () => {
    expect(createSessionId()).toMatch(/^session_\d+_[a-f0-9a-z]+/);
  });
});
