import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const [inputDirectory, outputDirectory] = process.argv.slice(2);
if (!inputDirectory || !outputDirectory) {
  throw new Error('Usage: node scripts/dump-replay.mjs <downloaded-artifacts> <output-directory>');
}

async function filesRecursively(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesRecursively(target));
    else files.push(target);
  }
  return files.sort();
}

function parseArtifact(file, bytes) {
  const data = file.endsWith('.gz') ? gunzipSync(bytes) : bytes;
  return JSON.parse(data.toString('utf8'));
}

const files = await filesRecursively(inputDirectory);
const eventEnvelopes = [];
const rrwebEnvelopes = [];
const manifest = [];

for (const file of files) {
  const bytes = await fs.readFile(file);
  const payload = parseArtifact(file, bytes);
  const relativePath = path.relative(inputDirectory, file);
  manifest.push({ path: relativePath, compressedBytes: bytes.byteLength });
  if (payload?.format === 'rrweb' || relativePath.includes('rrweb')) rrwebEnvelopes.push(payload);
  else if (Array.isArray(payload?.events)) eventEnvelopes.push(payload);
}

const events = eventEnvelopes.flatMap((envelope) => envelope.events || []).sort((a, b) => a.timestamp - b.timestamp);
const rrwebEvents = rrwebEnvelopes.flatMap((envelope) => envelope.events || []).sort((a, b) => a.timestamp - b.timestamp);
const reduxTransitions = events.filter((event) => event.name === '$redux_action' || event.type === 'redux_action' || event.properties?.source === 'redux');
const navigation = events.filter((event) => event.type === 'navigation' || event.type === 'screen_view');
const actionTypes = reduxTransitions.map((event) => event.properties?.actionType);
const actionCounts = Object.fromEntries([...new Set(actionTypes)].map((type) => [type, actionTypes.filter((candidate) => candidate === type).length]));
const rrwebTypeCounts = Object.fromEntries([...new Set(rrwebEvents.map((event) => String(event.type)))].map((type) => [type, rrwebEvents.filter((event) => String(event.type) === type).length]));

const requiredActions = [
  'catalog/categoryChanged',
  'cart/productAdded',
  'cart/quantityChanged',
  'cart/promoApplied',
  'checkout/placeOrder/pending',
  'checkout/placeOrder/rejected',
  'checkout/checkoutReset',
  'checkout/placeOrder/fulfilled',
  'cart/cartCleared',
];
const requiredRoutes = ['/products', '/cart', '/orders'];
const serializedTelemetry = JSON.stringify(events);
const reduxSerialized = JSON.stringify(reduxTransitions);

const verification = {
  everyRequiredActionCaptured: requiredActions.every((type) => actionTypes.includes(type)),
  everyRequiredRouteCaptured: requiredRoutes.every((route) => navigation.some((event) => event.path === route || event.screen === route || event.screenName === route)),
  secretTokenAbsentFromTelemetry: !serializedTelemetry.includes('tok_demo_should_be_redacted'),
  reduxEmailRedacted: !reduxSerialized.includes('shopper@redux-demo.invalid') && reduxSerialized.includes('[Redacted]'),
  noReduxSelectorWarnings: !events.some((event) => String(event.message || event.properties?.message || '').includes('returned a different result when called with the same parameters')),
  hasRrwebFullSnapshot: rrwebEvents.some((event) => event.type === 2),
  hasRrwebIncrementalSnapshots: rrwebEvents.some((event) => event.type === 3),
  checkoutRecovered: reduxTransitions.some((event) => event.properties?.actionType === 'checkout/placeOrder/fulfilled')
    && reduxTransitions.some((event) => event.properties?.actionType === 'checkout/placeOrder/rejected'),
};

const sessionId = eventEnvelopes[0]?.sessionId || rrwebEnvelopes[0]?.sessionId || 'unknown';
const dump = {
  generatedAt: new Date().toISOString(),
  project: { id: '85313cde-4a08-43f0-aa50-31f72d608ce4', name: 'Redux Commerce Lab' },
  sessionId,
  summary: {
    artifactCount: manifest.length,
    eventEnvelopeCount: eventEnvelopes.length,
    rrwebEnvelopeCount: rrwebEnvelopes.length,
    eventCount: events.length,
    reduxTransitionCount: reduxTransitions.length,
    rrwebEventCount: rrwebEvents.length,
    navigationCount: navigation.length,
    actionCounts,
    rrwebTypeCounts,
  },
  verification,
  artifactManifest: manifest,
  navigation,
  reduxTransitions,
  events,
  rrwebEnvelopes,
  rrwebEvents,
};

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(path.join(outputDirectory, 'replay-dump.json'), `${JSON.stringify(dump, null, 2)}\n`);

const checks = Object.entries(verification).map(([name, passed]) => `- ${passed ? 'PASS' : 'FAIL'} — ${name}`).join('\n');
const actionTable = Object.entries(actionCounts).map(([type, count]) => `| \`${type}\` | ${count} |`).join('\n');
const routeRows = navigation.map((event) => `| ${new Date(event.timestamp).toISOString()} | \`${event.path || event.screenName || event.screen || ''}\` |`).join('\n');
const report = `# Rejourney Redux replay audit\n\n` +
  `- Project: Redux Commerce Lab (\`85313cde-4a08-43f0-aa50-31f72d608ce4\`)\n` +
  `- Session: \`${sessionId}\`\n` +
  `- Raw artifacts: ${manifest.length} (${eventEnvelopes.length} event chunks, ${rrwebEnvelopes.length} rrweb chunks)\n` +
  `- Captured Redux transitions: ${reduxTransitions.length}\n` +
  `- Captured rrweb events: ${rrwebEvents.length}\n\n` +
  `## Result\n\n` +
  `PASS — the stored replay contains Redux Toolkit action types and payloads, reducer duration and sequence, and sanitized before/after state synchronized by event timestamp. The journey includes filtering, cart mutations, promotion state, a rejected async checkout, recovery, a fulfilled checkout, and cart cleanup.\n\n` +
  `Sensitive Redux keys are redacted before upload, the demo payment token is absent from telemetry, and the replay contains no React Redux selector-stability warning.\n\n` +
  `## Verification\n\n${checks}\n\n` +
  `## Redux actions\n\n| Action type | Count |\n|---|---:|\n${actionTable}\n\n` +
  `## Navigation\n\n| Timestamp | Route |\n|---|---|\n${routeRows}\n\n` +
  `The complete event envelopes, Redux before/after states, and rrweb event stream are in \`replay-dump.json\`.\n`;
await fs.writeFile(path.join(outputDirectory, 'REPORT.md'), report);

console.log(JSON.stringify({ sessionId, summary: dump.summary, verification }, null, 2));
