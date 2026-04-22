import { describe, expect, it } from 'vitest';
import { migratePersisted } from '../../src/state/store';

/**
 * v14 → v15 migration regression. Phase 3 of the map-mode work gates on
 * "existing persisted tabs keep working" — an older state hitting the
 * new store must come out valid.
 *
 * We don't run the full ladder from v2: the earlier hops are historical
 * and already in production. This file only guards the hop that Phase 3
 * introduces, plus a handful of edge cases a real user could hit.
 */
describe('migratePersisted — v14 → v15', () => {
  it("preserves a 'single' page value from v14", () => {
    const before = { page: 'single' };
    const after = migratePersisted(before, 14);
    expect(after.page).toBe('single');
  });

  it("preserves a 'team' page value from v14", () => {
    const before = { page: 'team' };
    const after = migratePersisted(before, 14);
    expect(after.page).toBe('team');
  });

  it("accepts 'map' as a future-proof value", () => {
    // A user on a branch with v16 that already wrote 'map' should not get
    // bounced back to 'single' by the v15 migration running second.
    const before = { page: 'map' };
    const after = migratePersisted(before, 14);
    expect(after.page).toBe('map');
  });

  it('coerces unknown page values back to single', () => {
    const before = { page: 'mapOverview' }; // typo / stale
    const after = migratePersisted(before, 14);
    expect(after.page).toBe('single');
  });

  it("leaves missing `page` alone (handled by v12 hop when fromVersion<12)", () => {
    // Fresh v14 users always have `page`, but if the field somehow went
    // missing in transit the v15 check short-circuits to 'single'
    // because `undefined !== 'single' && ...` is true.
    const before: { page?: string } = {};
    const after = migratePersisted(before, 14);
    expect(after.page).toBe('single');
  });

  it('returns null input untouched (no crash)', () => {
    expect(migratePersisted(null, 14)).toBe(null);
    expect(migratePersisted(undefined, 14)).toBe(undefined);
  });

  it('leaves team-member overrides and team composition alone', () => {
    const before = {
      page: 'team',
      team: { members: [], turns: [] },
      teamMemberOverrides: { slot0: { rank: 5 } },
    };
    const after = migratePersisted(before, 14);
    expect(after.team).toBe(before.team);
    expect(after.teamMemberOverrides).toBe(before.teamMemberOverrides);
  });
});
