import assert from 'node:assert/strict';
import test from 'node:test';
import { contextCanBeCopied, measuredAffectedPercent } from '../app/features/app/automations/leaks/presentation.ts';

test('ready context remains copyable regardless of triage status', () => {
    for (const status of ['queued', 'researching', 'ready', 'resolved', 'ignored', 'budget_exhausted']) {
        assert.equal(contextCanBeCopied({ status, contextStatus: 'ready' }), true);
    }
    assert.equal(contextCanBeCopied({ contextStatus: 'failed', contextMarkdown: '# Previous usable context' }), true);
    assert.equal(contextCanBeCopied({ contextStatus: 'running', contextMarkdown: null }), false);
    assert.equal(contextCanBeCopied(null), false);
});

test('affected observations never imply a population percentage', () => {
    assert.equal(measuredAffectedPercent({ affectedUsersCount: 2, affectedSessionsCount: 2 }), null);
    assert.equal(measuredAffectedPercent({ affectedEstimateBasis: 'observed_only', estimatedAffectedUsersPercent: 100 }), null);
    assert.equal(measuredAffectedPercent({ estimatedAffectedUsersPercent: NaN }), null);
    assert.equal(measuredAffectedPercent({ estimatedAffectedUsersPercent: 110 }), null);
    assert.equal(measuredAffectedPercent({ estimatedAffectedUsersPercent: 0 }), 0);
    assert.equal(measuredAffectedPercent({ estimatedAffectedUsersPercent: 25 }), 25);
});
