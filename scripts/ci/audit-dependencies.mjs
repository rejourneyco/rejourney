import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Temporary exception approved by the release owner on 2026-10-06. No patched
// braces release exists as of that date. Build tooling uses trusted repository patterns; the
// dashboard proxy uses the default '/' filter and accepts no user glob patterns.
const BRACES_EXCEPTION = {
  name: 'braces',
  url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',
  range: '<=3.0.3',
  expiresAt: '2026-10-20T00:00:00Z',
};

export function evaluateAudit(report, now = Date.now()) {
  if (!report || report.error || !report.vulnerabilities || typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities)) {
    throw new Error('Dependency audit failed to produce a valid vulnerability report.');
  }
  const blocked = new Map();
  const exceptions = new Map();
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    if (!vulnerability || !Array.isArray(vulnerability.via)
      || (['high', 'critical'].includes(vulnerability.severity) && !vulnerability.via.length)) {
      throw new Error('Dependency audit returned incomplete advisory details.');
    }
    for (const advisory of vulnerability.via) {
      // npm repeats inherited vulnerabilities on dependents. Their original
      // advisory is checked on the affected package, so it is reported once.
      if (typeof advisory === 'string') {
        if (!report.vulnerabilities[advisory]) throw new Error(`Missing advisory details for ${advisory}.`);
        continue;
      }
      if (!advisory || !['info', 'low', 'moderate', 'high', 'critical'].includes(advisory.severity)
        || typeof advisory.name !== 'string' || typeof advisory.url !== 'string' || typeof advisory.range !== 'string') {
        throw new Error('Dependency audit returned invalid advisory details.');
      }
      if (!['high', 'critical'].includes(advisory.severity)) continue;
      const key = advisory.source ?? advisory.url;
      const hasApprovedException = advisory.name === BRACES_EXCEPTION.name
        && advisory.severity === 'high'
        && advisory.url === BRACES_EXCEPTION.url
        && advisory.range === BRACES_EXCEPTION.range
        && now < Date.parse(BRACES_EXCEPTION.expiresAt);
      (hasApprovedException ? exceptions : blocked).set(key, advisory);
    }
  }
  return { blocked: [...blocked.values()], exceptions: [...exceptions.values()] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const audit = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  try {
    if (audit.error) throw audit.error;
    if (audit.status !== 0 && audit.status !== 1) throw new Error(`npm audit exited with ${audit.status}.`);
    const { blocked, exceptions } = evaluateAudit(JSON.parse(audit.stdout));
    for (const advisory of exceptions) {
      console.warn(`Temporary exception until ${BRACES_EXCEPTION.expiresAt}: ${advisory.name} ${advisory.url}`);
    }
    for (const advisory of blocked) console.error(`${advisory.severity}: ${advisory.name} ${advisory.url}`);
    if (blocked.length) process.exitCode = 1;
    else console.log('No high or critical dependency advisories outside the reviewed exception.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
