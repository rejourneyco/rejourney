import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAudit } from './audit-dependencies.mjs';

const now = Date.parse('2026-10-06T15:00:00Z');
const braces = { source: 1, name: 'braces', severity: 'high', range: '<=3.0.3', url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' };
const report = (...advisories) => ({ vulnerabilities: { braces: { via: advisories }, dependent: { via: ['braces'] } } });

test('allows only the exact, unexpired advisory exception', () => {
  assert.equal(evaluateAudit(report(braces), now).exceptions.length, 1);
  assert.equal(evaluateAudit(report(braces), now).blocked.length, 0);
  assert.equal(evaluateAudit(report(braces), Date.parse('2026-10-20T00:00:00Z')).blocked.length, 1);
  assert.equal(evaluateAudit(report({ ...braces, range: '<=3.0.4' }), now).blocked.length, 1);
  assert.equal(evaluateAudit(report({ ...braces, severity: 'critical' }), now).blocked.length, 1);
});

test('blocks additional high and critical advisories', () => {
  for (const severity of ['high', 'critical']) {
    const result = evaluateAudit(report(braces, { ...braces, source: 2, severity, url: 'https://github.com/advisories/new-advisory' }), now);
    assert.equal(result.blocked.length, 1);
    assert.equal(result.exceptions.length, 1);
  }
});

test('fails closed when the audit fails or advisory details are missing', () => {
  assert.throws(() => evaluateAudit({ error: { message: 'Registry unavailable' } }, now));
  assert.throws(() => evaluateAudit({}, now));
  assert.throws(() => evaluateAudit(null, now));
  assert.throws(() => evaluateAudit({ vulnerabilities: { braces: { severity: 'high', via: [] } } }, now));
  assert.throws(() => evaluateAudit(report({ ...braces, severity: undefined }), now));
  assert.throws(() => evaluateAudit({ vulnerabilities: { dependent: { via: ['missing'] } } }, now));
});
