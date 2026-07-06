import {
  gbMultiplier,
  gbSlotPoints,
  resolvePlacements,
  topScorers,
  goldenBracketDeltas,
  GoldenBracketPick,
  GbScorerEvent,
} from '../golden-bracket';
import { LadderMatch } from '../favorites';
import { GoldenBracketConfig } from '@/types/db';

const cfg: GoldenBracketConfig = {
  base_odds: 2.75,
  min_mult: 1.0,
  max_mult: 5.0,
  slots: { champion: 100, runner_up: 60, third: 40, fourth: 30 },
  consolation: 15,
  scorer_player: 75,
  scorer_exact: 50,
  scorer_close: 20,
};

// ─── odds → multiplier (the real 12-team post-R16 table) ─────────────────────────

describe('gbMultiplier', () => {
  test('the seeded odds land on the intended multipliers', () => {
    const table: [number, number][] = [
      [2.75, 1.0], // France (favorite = base)
      [5.4, 1.5], // Argentina
      [6.5, 1.5], // England
      [7.5, 1.5], // Spain
      [20, 2.5], // Portugal
      [21, 3.0], // Colombia
      [30, 3.5], // Morocco
      [31, 3.5], // USA
      [34, 3.5], // Norway
      [56, 4.5], // Belgium
      [76, 5.0], // Switzerland (√27.6 ≈ 5.26 → clamped)
      [251, 5.0], // Egypt (clamped)
    ];
    for (const [odds, mult] of table) {
      expect(gbMultiplier(odds, cfg)).toBe(mult);
    }
  });

  test('missing odds fall back to min_mult', () => {
    expect(gbMultiplier(null, cfg)).toBe(1.0);
    expect(gbMultiplier(undefined, cfg)).toBe(1.0);
  });
});

// ─── slot points (UI + settlement share this) ────────────────────────────────────

describe('gbSlotPoints', () => {
  test('×1.0 equals the base config', () => {
    expect(gbSlotPoints(cfg, 1.0)).toEqual({
      champion: 100,
      runner_up: 60,
      third: 40,
      fourth: 30,
      consolation: 15,
    });
  });

  test('multiplies and rounds each slot', () => {
    expect(gbSlotPoints(cfg, 3.5)).toEqual({
      champion: 350,
      runner_up: 210,
      third: 140,
      fourth: 105,
      consolation: 53, // 15 × 3.5 = 52.5 → 53
    });
  });
});

// ─── placements ──────────────────────────────────────────────────────────────────

const FRA = 'team-fra';
const ENG = 'team-eng';
const MAR = 'team-mar';
const NOR = 'team-nor';

function match(
  stage: LadderMatch['stage'],
  home: string,
  away: string,
  winner: string | null = null,
  status: LadderMatch['status'] = winner ? 'finished' : 'scheduled',
): LadderMatch {
  return { stage, status, home_team_id: home, away_team_id: away, winner_team_id: winner };
}

describe('resolvePlacements', () => {
  test('nothing resolved before the semis exist', () => {
    const p = resolvePlacements([match('qf', FRA, MAR, FRA)]);
    expect(p).toMatchObject({ champion: null, runnerUp: null, third: null, fourth: null });
    expect(p.top4.size).toBe(0);
  });

  test('top4 fills from SF fixtures before any of them finish', () => {
    const p = resolvePlacements([match('sf', FRA, NOR), match('sf', ENG, MAR)]);
    expect([...p.top4].sort()).toEqual([FRA, ENG, MAR, NOR].sort());
    expect(p.champion).toBeNull();
  });

  test('final + third-place playoff resolve all four slots', () => {
    const p = resolvePlacements([
      match('sf', FRA, NOR, FRA),
      match('sf', ENG, MAR, ENG),
      match('third', NOR, MAR, MAR),
      match('final', FRA, ENG, FRA),
    ]);
    expect(p).toMatchObject({ champion: FRA, runnerUp: ENG, third: MAR, fourth: NOR });
  });

  test('a shootout final reads winner_team_id, never the scoreline', () => {
    // Away side wins the final on penalties.
    const p = resolvePlacements([match('final', FRA, ENG, ENG)]);
    expect(p.champion).toBe(ENG);
    expect(p.runnerUp).toBe(FRA);
  });

  test('void third-place playoff leaves third/fourth null but keeps top4', () => {
    const p = resolvePlacements([
      match('sf', FRA, NOR, FRA),
      match('sf', ENG, MAR, ENG),
      { ...match('third', NOR, MAR), status: 'void' },
      match('final', FRA, ENG, FRA),
    ]);
    expect(p.third).toBeNull();
    expect(p.fourth).toBeNull();
    expect([...p.top4].sort()).toEqual([FRA, ENG, MAR, NOR].sort());
  });

  test('an unfinished final resolves nothing', () => {
    const p = resolvePlacements([match('final', FRA, ENG, null, 'live')]);
    expect(p.champion).toBeNull();
    expect(p.runnerUp).toBeNull();
  });
});

// ─── top scorers ─────────────────────────────────────────────────────────────────

function goal(footballerId: string | null, type: GbScorerEvent['type'] = 'goal', own = false): GbScorerEvent {
  return { footballer_id: footballerId, type, is_own_goal: own };
}

describe('topScorers', () => {
  test('penalties count, own goals and cards do not', () => {
    const { leaders, topGoals } = topScorers([
      goal('mbappe'),
      goal('mbappe', 'penalty'),
      goal('kane', 'own_goal', true),
      goal('kane', 'yellow' as GbScorerEvent['type']),
      goal('kane'),
    ]);
    expect(topGoals).toBe(2);
    expect([...leaders]).toEqual(['mbappe']);
  });

  test('unmapped scorers (null footballer) are ignored', () => {
    const { leaders, topGoals } = topScorers([goal(null), goal('kane')]);
    expect(topGoals).toBe(1);
    expect([...leaders]).toEqual(['kane']);
  });

  test('a dead heat returns every leader', () => {
    const { leaders, topGoals } = topScorers([
      goal('mbappe'),
      goal('messi'),
      goal('haaland'),
    ]);
    expect(topGoals).toBe(1);
    expect(leaders.size).toBe(3);
  });

  test('no goals at all → no leaders', () => {
    const { leaders, topGoals } = topScorers([]);
    expect(topGoals).toBe(0);
    expect(leaders.size).toBe(0);
  });
});

// ─── deltas ─────────────────────────────────────────────────────────────────────

const mults = new Map<string, number>([
  [FRA, 1.0],
  [ENG, 1.5],
  [MAR, 3.5],
  [NOR, 3.5],
]);

const fullPlacements = resolvePlacements([
  match('sf', FRA, NOR, FRA),
  match('sf', ENG, MAR, ENG),
  match('third', NOR, MAR, MAR),
  match('final', FRA, ENG, FRA),
]);
// champion FRA, runner-up ENG, third MAR, fourth NOR

function pick(overrides: Partial<GoldenBracketPick>): GoldenBracketPick {
  return {
    managerId: 'mgr-1',
    champion: FRA,
    runnerUp: ENG,
    third: MAR,
    fourth: NOR,
    scorerId: 'mbappe',
    scorerGoals: 9,
    ...overrides,
  };
}

function run(p: GoldenBracketPick, scorer = topScorers([]), placements = fullPlacements) {
  return goldenBracketDeltas({
    picks: [p],
    placements,
    multByTeam: mults,
    scorer,
    cfg,
    seasonKey: 'WC2026',
  });
}

describe('goldenBracketDeltas', () => {
  test('a perfect bracket pays every slot at its own multiplier', () => {
    const deltas = run(pick({}));
    const byReason = Object.fromEntries(deltas.map(d => [d.reason, d.amount]));
    expect(byReason).toEqual({
      gb_champion: 100, // FRA ×1.0
      gb_runner_up: 90, // ENG 60 ×1.5
      gb_third: 140, // MAR 40 ×3.5
      gb_fourth: 105, // NOR 30 ×3.5
    });
  });

  test('every delta is season-keyed glory for the picking manager', () => {
    for (const d of run(pick({}))) {
      expect(d).toMatchObject({
        managerId: 'mgr-1',
        currency: 'glory',
        refType: 'season',
        refId: 'WC2026',
      });
    }
  });

  test('right team, wrong slot pays the consolation at that team\'s multiplier', () => {
    // Everything rotated one slot: all four in the top 4, none exactly placed.
    const deltas = run(pick({ champion: ENG, runnerUp: MAR, third: NOR, fourth: FRA }));
    const byReason = Object.fromEntries(deltas.map(d => [d.reason, d.amount]));
    expect(byReason).toEqual({
      gb_top4_champion: 23, // ENG 15 ×1.5 = 22.5 → 23
      gb_top4_runner_up: 53, // MAR 15 ×3.5 = 52.5 → 53
      gb_top4_third: 53, // NOR
      gb_top4_fourth: 15, // FRA ×1.0
    });
  });

  test('an exact hit never also pays its consolation', () => {
    const reasons = run(pick({})).map(d => d.reason);
    expect(reasons.filter(r => r.startsWith('gb_top4'))).toHaveLength(0);
  });

  test('a team outside the top 4 pays nothing', () => {
    const OTHER = 'team-other';
    const deltas = run(pick({ champion: OTHER, runnerUp: OTHER, third: OTHER, fourth: OTHER }));
    expect(deltas).toHaveLength(0);
  });

  test('void third-place playoff degrades exact third/fourth picks to consolation', () => {
    const placements = resolvePlacements([
      match('sf', FRA, NOR, FRA),
      match('sf', ENG, MAR, ENG),
      { ...match('third', NOR, MAR), status: 'void' },
      match('final', FRA, ENG, FRA),
    ]);
    const deltas = run(pick({}), topScorers([]), placements);
    const byReason = Object.fromEntries(deltas.map(d => [d.reason, d.amount]));
    expect(byReason).toEqual({
      gb_champion: 100,
      gb_runner_up: 90,
      gb_top4_third: 53, // MAR consolation — exact unresolvable
      gb_top4_fourth: 53, // NOR consolation
    });
  });

  test('correct scorer pays flat, exact tally adds the exact bonus', () => {
    const scorer = { leaders: new Set(['mbappe']), topGoals: 9 };
    const byReason = Object.fromEntries(run(pick({}), scorer).map(d => [d.reason, d.amount]));
    expect(byReason.gb_scorer).toBe(75);
    expect(byReason.gb_scorer_goals).toBe(50);
  });

  test('tied scorer still pays; a tally one off pays the close bonus', () => {
    const scorer = { leaders: new Set(['mbappe', 'haaland']), topGoals: 10 };
    const byReason = Object.fromEntries(run(pick({ scorerGoals: 9 }), scorer).map(d => [d.reason, d.amount]));
    expect(byReason.gb_scorer).toBe(75);
    expect(byReason.gb_scorer_goals).toBe(20);
  });

  test('a tally two or more off pays no tally bonus', () => {
    const scorer = { leaders: new Set(['mbappe']), topGoals: 12 };
    const reasons = run(pick({ scorerGoals: 9 }), scorer).map(d => d.reason);
    expect(reasons).toContain('gb_scorer');
    expect(reasons).not.toContain('gb_scorer_goals');
  });

  test('right tally on the wrong player pays nothing', () => {
    const scorer = { leaders: new Set(['haaland']), topGoals: 9 };
    const reasons = run(pick({ scorerId: 'mbappe', scorerGoals: 9 }), scorer).map(d => d.reason);
    expect(reasons).not.toContain('gb_scorer');
    expect(reasons).not.toContain('gb_scorer_goals');
  });

  test('a picked team missing from the odds map falls back to min_mult', () => {
    const GHOST = 'team-ghost';
    const placements = resolvePlacements([match('final', GHOST, ENG, GHOST)]);
    const deltas = run(pick({ champion: GHOST }), topScorers([]), placements);
    const champion = deltas.find(d => d.reason === 'gb_champion');
    expect(champion?.amount).toBe(100); // 100 × min_mult 1.0
  });
});
