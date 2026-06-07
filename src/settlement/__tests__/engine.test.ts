import { settle } from '../engine';
import fixture from './fixtures/group_match.json';
import { Bet, Match, LeagueConfig, MatchEvent } from '@/types/db';

const { match, config } = fixture as { match: Match; config: LeagueConfig };

function makeBet(overrides: Partial<Bet>): Bet {
  return {
    id: 'bet-001',
    manager_id: 'mgr-001',
    match_id: match.id,
    bet_type: 'outcome',
    selection: { result: 'home' },
    stake_coins: 0,
    stake_mult: 1.0,
    status: 'pending',
    glory_awarded: null,
    created_at: '2026-06-15T10:00:00Z',
    locked_at: '2026-06-15T17:00:00Z',
    ...overrides,
  };
}

const noEvents: MatchEvent[] = [];

describe('outcome bet', () => {
  test('correct home prediction wins points', () => {
    const bet = makeBet({ selection: { result: 'home' } });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    const winUpdate = result.betUpdates.find(u => u.betId === 'bet-001');
    expect(winUpdate?.status).toBe('won');
    expect(winUpdate?.pointsAwarded).toBe(10); // outcome_correct * mult 1.0 * stake_mult 1.0
  });

  test('wrong prediction loses', () => {
    const bet = makeBet({ selection: { result: 'away' } });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    const update = result.betUpdates.find(u => u.betId === 'bet-001');
    expect(update?.status).toBe('lost');
    expect(update?.pointsAwarded).toBe(0);
  });

  test('draw prediction when score is not a draw loses', () => {
    const bet = makeBet({ selection: { result: 'draw' } });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].status).toBe('lost');
  });
});

describe('exact score bet', () => {
  test('correct exact score wins outcome + bonus points', () => {
    const bet = makeBet({
      id: 'bet-002',
      bet_type: 'exact_score',
      selection: { home: 2, away: 1 },
    });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    const update = result.betUpdates.find(u => u.betId === 'bet-002');
    expect(update?.status).toBe('won');
    expect(update?.pointsAwarded).toBe(25); // 10 + 15
  });

  test('wrong exact score loses', () => {
    const bet = makeBet({
      id: 'bet-003',
      bet_type: 'exact_score',
      selection: { home: 1, away: 0 },
    });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].status).toBe('lost');
  });
});

describe('points multipliers', () => {
  const finalMatch: Match = { ...match, stage: 'final', glory_multiplier: 2.0 };

  test('final match doubles points', () => {
    const bet = makeBet({ selection: { result: 'home' } });
    const result = settle({ match: finalMatch, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].pointsAwarded).toBe(20); // 10 * 2.0
  });
});

describe('stake multiplier', () => {
  test('stake_mult amplifies points', () => {
    const bet = makeBet({ selection: { result: 'home' }, stake_mult: 1.5, stake_coins: 20 });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].pointsAwarded).toBe(15); // 10 * 1.0 * 1.5 (stake_mult amplifies points)
  });
});

describe('participation points', () => {
  test('each manager with a pending bet receives participation points', () => {
    const bets = [
      makeBet({ id: 'bet-a', manager_id: 'mgr-001' }),
      makeBet({ id: 'bet-b', manager_id: 'mgr-002' }),
    ];
    const result = settle({ match, bets, events: noEvents, config });

    const participationDeltas = result.deltas.filter(d => d.reason === 'participation');
    expect(participationDeltas).toHaveLength(2);
    expect(participationDeltas.every(d => d.amount === config.glory.participation)).toBe(true);
  });

  test('manager with multiple bets gets participation only once', () => {
    const bets = [
      makeBet({ id: 'bet-a', manager_id: 'mgr-001' }),
      makeBet({ id: 'bet-b', manager_id: 'mgr-001', bet_type: 'exact_score', selection: { home: 2, away: 1 } }),
    ];
    const result = settle({ match, bets, events: noEvents, config });

    const participationDeltas = result.deltas.filter(d => d.reason === 'participation');
    expect(participationDeltas).toHaveLength(1);
  });
});

// Config including Phase 2 prop values (the v1 fixture predates them).
const propConfig: LeagueConfig = {
  ...config,
  glory: { ...config.glory, first_goalscorer: 20, anytime_scorer: 8, carded: 6, stat_leader: 15 },
};

function makeEvent(overrides: Partial<MatchEvent>): MatchEvent {
  return {
    id: 'evt-x',
    match_id: match.id,
    footballer_id: 'plr-1',
    type: 'goal',
    minute: 20,
    is_own_goal: false,
    ...overrides,
  };
}

describe('first goalscorer prop', () => {
  test('pick scores the first goal → won', () => {
    const events = [
      makeEvent({ id: 'e1', footballer_id: 'plr-1', minute: 20 }),
      makeEvent({ id: 'e2', footballer_id: 'plr-2', minute: 35 }),
    ];
    const bet = makeBet({ bet_type: 'first_scorer', selection: { footballer_id: 'plr-1' } });
    const result = settle({ match, bets: [bet], events, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won');
    expect(result.betUpdates[0].pointsAwarded).toBe(20); // 20 * 1.0 * 1.0
  });

  test('pick scores but not first → lost', () => {
    const events = [
      makeEvent({ id: 'e1', footballer_id: 'plr-1', minute: 20 }),
      makeEvent({ id: 'e2', footballer_id: 'plr-2', minute: 35 }),
    ];
    const bet = makeBet({ bet_type: 'first_scorer', selection: { footballer_id: 'plr-2' } });
    const result = settle({ match, bets: [bet], events, config: propConfig });

    expect(result.betUpdates[0].status).toBe('lost');
    expect(result.betUpdates[0].pointsAwarded).toBe(0);
  });

  test('own goal is excluded — first real scorer wins', () => {
    const events = [
      makeEvent({ id: 'e0', footballer_id: 'plr-9', type: 'own_goal', minute: 10, is_own_goal: true }),
      makeEvent({ id: 'e1', footballer_id: 'plr-1', minute: 20 }),
    ];
    const bet = makeBet({ bet_type: 'first_scorer', selection: { footballer_id: 'plr-1' } });
    const result = settle({ match, bets: [bet], events, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won');
  });

  test('a penalty counts as a goal', () => {
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-1', type: 'penalty', minute: 12 })];
    const bet = makeBet({ bet_type: 'first_scorer', selection: { footballer_id: 'plr-1' } });
    const result = settle({ match, bets: [bet], events, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won');
  });
});

describe('anytime goalscorer prop', () => {
  test('pick scores at any point → won', () => {
    const events = [
      makeEvent({ id: 'e1', footballer_id: 'plr-1', minute: 5 }),
      makeEvent({ id: 'e2', footballer_id: 'plr-2', minute: 80 }),
    ];
    const bet = makeBet({ bet_type: 'anytime_scorer', selection: { footballer_id: 'plr-2' } });
    const result = settle({ match, bets: [bet], events, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won');
    expect(result.betUpdates[0].pointsAwarded).toBe(8);
  });

  test('own goal does not count as scoring for the player', () => {
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-1', type: 'own_goal', is_own_goal: true })];
    const bet = makeBet({
      bet_type: 'anytime_scorer',
      selection: { footballer_id: 'plr-1' },
      // appeared, so this is a loss, not a void
    });
    const result = settle({ match, bets: [bet], events, config: propConfig, appearances: ['plr-1'] });

    expect(result.betUpdates[0].status).toBe('lost');
  });
});

describe('carded prop', () => {
  test('pick gets a yellow → won', () => {
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-3', type: 'yellow', minute: 55 })];
    const bet = makeBet({ bet_type: 'carded', selection: { footballer_id: 'plr-3' } });
    const result = settle({ match, bets: [bet], events, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won');
    expect(result.betUpdates[0].pointsAwarded).toBe(6);
  });

  test('red card also counts, and knockout multiplier applies', () => {
    const finalMatch: Match = { ...match, stage: 'final', glory_multiplier: 2.0 };
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-3', type: 'red', minute: 70 })];
    const bet = makeBet({ bet_type: 'carded', selection: { footballer_id: 'plr-3' } });
    const result = settle({ match: finalMatch, bets: [bet], events, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won');
    expect(result.betUpdates[0].pointsAwarded).toBe(12); // 6 * 2.0
  });
});

describe('prop void logic (non-appearance)', () => {
  test('pick did not appear → void', () => {
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-1' })];
    const bet = makeBet({ bet_type: 'anytime_scorer', selection: { footballer_id: 'plr-99' } });
    const result = settle({
      match,
      bets: [bet],
      events,
      config: propConfig,
      appearances: ['plr-1', 'plr-2'], // plr-99 not listed
    });

    expect(result.betUpdates[0].status).toBe('void');
    expect(result.betUpdates[0].pointsAwarded).toBe(0);
  });

  test('void bets earn no Glory delta (but still get participation)', () => {
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-1' })];
    const bet = makeBet({ bet_type: 'anytime_scorer', selection: { footballer_id: 'plr-99' } });
    const result = settle({ match, bets: [bet], events, config: propConfig, appearances: ['plr-1'] });

    expect(result.deltas.filter(d => d.reason === 'bet_win')).toHaveLength(0);
    expect(result.deltas.filter(d => d.reason === 'participation')).toHaveLength(1);
  });

  test('no lineup data → unmatched pick settles as lost, not void', () => {
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-1' })];
    const bet = makeBet({ bet_type: 'anytime_scorer', selection: { footballer_id: 'plr-99' } });
    const result = settle({ match, bets: [bet], events, config: propConfig }); // no appearances

    expect(result.betUpdates[0].status).toBe('lost');
  });
});

describe('idempotency', () => {
  test('already-settled bets are skipped', () => {
    const bet = makeBet({ status: 'won', glory_awarded: 10 });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates).toHaveLength(0);
  });
});
