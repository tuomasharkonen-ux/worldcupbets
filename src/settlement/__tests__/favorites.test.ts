import {
  teamMultiplier,
  ladderBreakdown,
  favoritePlayerDeltas,
  teamLadderDeltas,
  LadderMatch,
} from '../favorites';
import { FavoritesConfig, MatchEvent } from '@/types/db';

const fav: FavoritesConfig = {
  base_odds: 5.5,
  min_mult: 1.0,
  max_mult: 5.0,
  ladder: { r32: 10, r16: 20, qf: 35, sf: 55, third: 40, final: 75, champion: 90 },
  player_goal: 15,
  player_card: -5,
};

// ─── odds → multiplier ──────────────────────────────────────────────────────────

describe('teamMultiplier', () => {
  test('top favorite (odds == base) is 1.0', () => {
    expect(teamMultiplier(5.5, fav)).toBe(1.0);
  });

  test('mid favorites round down toward 1.0', () => {
    expect(teamMultiplier(8, fav)).toBe(1.0); // √1.45 ≈ 1.21 → 1.0
    expect(teamMultiplier(11, fav)).toBe(1.5); // √2.0 ≈ 1.41 → 1.5
  });

  test('dark horse scales up', () => {
    expect(teamMultiplier(67, fav)).toBe(3.5); // √12.2 ≈ 3.49 → 3.5
  });

  test('long shots clamp at max_mult', () => {
    expect(teamMultiplier(1001, fav)).toBe(5.0);
    expect(teamMultiplier(99999, fav)).toBe(5.0);
  });

  test('missing / non-positive odds fall back to min_mult', () => {
    expect(teamMultiplier(null, fav)).toBe(1.0);
    expect(teamMultiplier(0, fav)).toBe(1.0);
  });
});

// ─── ladder breakdown (UI + settlement share this) ───────────────────────────────

describe('ladderBreakdown', () => {
  test('favorite: rungs equal the base ladder at ×1.0', () => {
    const b = ladderBreakdown(5.5, fav);
    expect(b.multiplier).toBe(1.0);
    const byKey = Object.fromEntries(b.rungs.map(r => [r.key, r.points]));
    expect(byKey).toMatchObject({ r32: 10, r16: 20, qf: 35, sf: 55, final: 75, third: 40, champion: 90 });
    // 10+20+35+55+75+90 (no 3rd place on the title path)
    expect(b.championTotal).toBe(285);
  });

  test('dark horse: every rung scales by the multiplier', () => {
    const b = ladderBreakdown(67, fav); // ×3.5
    const byKey = Object.fromEntries(b.rungs.map(r => [r.key, r.points]));
    expect(byKey.qf).toBe(Math.round(35 * 3.5)); // 123
    expect(byKey.champion).toBe(Math.round(90 * 3.5)); // 315
    expect(b.championTotal).toBe(
      Math.round(10 * 3.5) + Math.round(20 * 3.5) + Math.round(35 * 3.5) + Math.round(55 * 3.5) + Math.round(75 * 3.5) + Math.round(90 * 3.5),
    );
  });
});

// ─── favorite player ──────────────────────────────────────────────────────────

function ev(overrides: Partial<MatchEvent>): MatchEvent {
  return {
    id: 'e1',
    match_id: 'm1',
    footballer_id: 'p1',
    type: 'goal',
    minute: 10,
    is_own_goal: false,
    ...overrides,
  };
}

describe('favoritePlayerDeltas', () => {
  const base = { matchId: 'm1', favorites: [{ managerId: 'mgr1', footballerId: 'p1' }], fav };

  test('each goal pays player_goal', () => {
    const events = [ev({ id: 'a' }), ev({ id: 'b', type: 'penalty', minute: 40 })];
    const [d] = favoritePlayerDeltas({ ...base, events });
    expect(d.amount).toBe(30); // 2 × 15
    expect(d.reason).toBe('fav_player');
    expect(d.refId).toBe('m1');
  });

  test('booking applies a single penalty regardless of how many cards', () => {
    const events = [ev({ id: 'y1', type: 'yellow' }), ev({ id: 'r1', type: 'red', minute: 80 })];
    const [d] = favoritePlayerDeltas({ ...base, events });
    expect(d.amount).toBe(-5); // one −5, not −10
  });

  test('goal then booking nets out', () => {
    const events = [ev({ id: 'g' }), ev({ id: 'y', type: 'yellow', minute: 60 })];
    const [d] = favoritePlayerDeltas({ ...base, events });
    expect(d.amount).toBe(10); // 15 − 5
  });

  test('own goals never count', () => {
    const events = [ev({ id: 'og', type: 'own_goal', is_own_goal: true })];
    expect(favoritePlayerDeltas({ ...base, events })).toHaveLength(0);
  });

  test('no goal and no card → no delta', () => {
    const events = [ev({ id: 'x', footballer_id: 'someone-else' })];
    expect(favoritePlayerDeltas({ ...base, events })).toHaveLength(0);
  });
});

// ─── favorite team ladder ──────────────────────────────────────────────────────

function lm(overrides: Partial<LadderMatch>): LadderMatch {
  return {
    stage: 'group',
    status: 'finished',
    home_team_id: 'T',
    away_team_id: 'X',
    winner_team_id: null,
    ...overrides,
  };
}

describe('teamLadderDeltas', () => {
  const base = { managerId: 'mgr1', teamId: 'T', multiplier: 1.0, fav, seasonKey: 'WC2026' };

  test('"out of the group" fires once the R32 fixture exists — but NOT R16 yet', () => {
    // A pending R32 fixture means the team qualified (out of the group). Reaching R16 is a
    // separate milestone earned by WINNING that R32 match, which hasn't happened yet.
    const matches = [lm({ stage: 'r32', status: 'scheduled' })];
    const reasons = teamLadderDeltas({ ...base, matches }).map(d => d.reason).sort();
    expect(reasons).toEqual(['team_r32']);
  });

  test('winning the R32 reaches R16 (paid on the win, not when the R16 fixture appears)', () => {
    const matches = [lm({ stage: 'r32', status: 'finished', winner_team_id: 'T' })];
    const reasons = teamLadderDeltas({ ...base, matches }).map(d => d.reason).sort();
    expect(reasons).toEqual(['team_r16', 'team_r32']);
  });

  test('losing the R32 reaches nothing beyond the group exit', () => {
    const matches = [lm({ stage: 'r32', status: 'finished', winner_team_id: 'X' })];
    const reasons = teamLadderDeltas({ ...base, matches }).map(d => d.reason).sort();
    expect(reasons).toEqual(['team_r32']); // out of the group, but did not reach R16
  });

  test('a full title run awards every reach rung plus champion', () => {
    const matches = [
      lm({ stage: 'r32', status: 'finished', winner_team_id: 'T' }),
      lm({ stage: 'r16', status: 'finished', winner_team_id: 'T' }),
      lm({ stage: 'qf', status: 'finished', winner_team_id: 'T' }),
      lm({ stage: 'sf', status: 'finished', winner_team_id: 'T' }),
      lm({ stage: 'final', status: 'finished', winner_team_id: 'T' }),
    ];
    const reasons = teamLadderDeltas({ ...base, matches }).map(d => d.reason).sort();
    expect(reasons).toEqual([
      'team_champion',
      'team_final',
      'team_qf',
      'team_r16',
      'team_r32',
      'team_sf',
    ]);
  });

  test('champion + reached-final: winning the SF pays the final rung, winning the final pays champion', () => {
    const matches = [
      lm({ stage: 'sf', status: 'finished', winner_team_id: 'T' }), // won SF → reached final
      lm({ stage: 'final', status: 'finished', winner_team_id: 'T' }), // won final → champion
    ];
    const ds = teamLadderDeltas({ ...base, matches });
    expect(ds.find(d => d.reason === 'team_final')?.amount).toBe(75);
    expect(ds.find(d => d.reason === 'team_champion')?.amount).toBe(90);
  });

  test('penalty-decided final: winner read from winner_team_id, not the level score', () => {
    // Winner T: won their SF (reached final) and won the final on pens (champion).
    const winnerMatches = [
      lm({ stage: 'sf', status: 'finished', winner_team_id: 'T' }),
      lm({ stage: 'final', status: 'finished', winner_team_id: 'T', away_team_id: 'X' }),
    ];
    expect(teamLadderDeltas({ ...base, matches: winnerMatches }).some(d => d.reason === 'team_champion')).toBe(true);
    // Runner-up X: won their own SF (reached the final) but lost the final — final rung, no champion.
    const loserMatches = [
      lm({ stage: 'sf', status: 'finished', winner_team_id: 'X', home_team_id: 'X' }),
      lm({ stage: 'final', status: 'finished', winner_team_id: 'T', home_team_id: 'T', away_team_id: 'X' }),
    ];
    const loser = teamLadderDeltas({ ...base, teamId: 'X', matches: loserMatches });
    expect(loser.some(d => d.reason === 'team_final')).toBe(true);
    expect(loser.some(d => d.reason === 'team_champion')).toBe(false);
  });

  test('third-place playoff winner gets the third rung', () => {
    const matches = [lm({ stage: 'third', status: 'finished', winner_team_id: 'T' })];
    expect(teamLadderDeltas({ ...base, matches }).find(d => d.reason === 'team_third')?.amount).toBe(40);
  });

  test('multiplier scales the rung amount', () => {
    // Won the R32 → reached R16 (+20 base). ×3.5 → 70.
    const matches = [lm({ stage: 'r32', status: 'finished', winner_team_id: 'T' })];
    const ds = teamLadderDeltas({ ...base, multiplier: 3.5, matches });
    expect(ds.find(d => d.reason === 'team_r16')?.amount).toBe(Math.round(20 * 3.5));
  });

  test('void matches are ignored', () => {
    const matches = [lm({ stage: 'r32', status: 'void' })];
    expect(teamLadderDeltas({ ...base, matches })).toHaveLength(0);
  });

  test('team not in any match → no deltas', () => {
    const matches = [lm({ stage: 'r32', home_team_id: 'A', away_team_id: 'B' })];
    expect(teamLadderDeltas({ ...base, matches })).toHaveLength(0);
  });
});
