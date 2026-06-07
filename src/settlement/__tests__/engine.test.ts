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
  test('correct home prediction wins glory', () => {
    const bet = makeBet({ selection: { result: 'home' } });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    const winUpdate = result.betUpdates.find(u => u.betId === 'bet-001');
    expect(winUpdate?.status).toBe('won');
    expect(winUpdate?.gloryAwarded).toBe(10); // outcome_correct * mult 1.0 * stake_mult 1.0
  });

  test('wrong prediction loses', () => {
    const bet = makeBet({ selection: { result: 'away' } });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    const update = result.betUpdates.find(u => u.betId === 'bet-001');
    expect(update?.status).toBe('lost');
    expect(update?.gloryAwarded).toBe(0);
  });

  test('draw prediction when score is not a draw loses', () => {
    const bet = makeBet({ selection: { result: 'draw' } });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].status).toBe('lost');
  });
});

describe('exact score bet', () => {
  test('correct exact score wins outcome + bonus glory', () => {
    const bet = makeBet({
      id: 'bet-002',
      bet_type: 'exact_score',
      selection: { home: 2, away: 1 },
    });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    const update = result.betUpdates.find(u => u.betId === 'bet-002');
    expect(update?.status).toBe('won');
    expect(update?.gloryAwarded).toBe(25); // 10 + 15
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

describe('glory multipliers', () => {
  const finalMatch: Match = { ...match, stage: 'final', glory_multiplier: 2.0 };

  test('final match doubles glory', () => {
    const bet = makeBet({ selection: { result: 'home' } });
    const result = settle({ match: finalMatch, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].gloryAwarded).toBe(20); // 10 * 2.0
  });
});

describe('stake multiplier', () => {
  test('stake_mult amplifies glory', () => {
    const bet = makeBet({ selection: { result: 'home' }, stake_mult: 1.5, stake_coins: 20 });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].gloryAwarded).toBe(15); // 10 * 1.0 * 1.5
  });
});

describe('participation glory', () => {
  test('each manager with a pending bet receives participation glory', () => {
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

describe('idempotency', () => {
  test('already-settled bets are skipped', () => {
    const bet = makeBet({ status: 'won', glory_awarded: 10 });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates).toHaveLength(0);
  });
});
