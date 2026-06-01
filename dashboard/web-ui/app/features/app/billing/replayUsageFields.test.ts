import { describe, expect, it } from 'vitest';

import { demoTeamUsage } from '~/shared/data/demoApiData';

describe('billing replay usage fields', () => {
  it('keeps legacy session fields as replay aliases while exposing captured sessions', () => {
    expect(demoTeamUsage.sessionReplaysUsed).toBe(demoTeamUsage.sessionsUsed);
    expect(demoTeamUsage.sessionReplayLimit).toBe(demoTeamUsage.sessionLimit);
    expect(demoTeamUsage.sessionReplaysRemaining).toBe(demoTeamUsage.sessionsRemaining);
    expect(demoTeamUsage.sessionReplayPercentUsed).toBe(demoTeamUsage.percentUsed);

    expect(demoTeamUsage.sessionsCaptured).toBeGreaterThan(demoTeamUsage.sessionReplaysUsed ?? 0);
  });
});
