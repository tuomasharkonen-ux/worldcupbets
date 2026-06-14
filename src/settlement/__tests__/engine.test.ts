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
  // Fixture final score is 2–1 (home by 1).
  test('correct exact score wins the exact bonus on its own', () => {
    const bet = makeBet({
      id: 'bet-002',
      bet_type: 'exact_score',
      selection: { home: 2, away: 1 },
    });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    const update = result.betUpdates.find(u => u.betId === 'bet-002');
    expect(update?.status).toBe('won');
    // The exact bet pays only the +25 bonus; the +10 result is scored by the
    // separate outcome bet (a nailed score over both bets = 35).
    expect(update?.pointsAwarded).toBe(25);
  });

  test('right outcome + right margin but wrong score → nothing (goal-difference removed)', () => {
    const bet = makeBet({
      id: 'bet-gd',
      bet_type: 'exact_score',
      selection: { home: 3, away: 2 }, // home by 1, matches the 2–1 margin, not exact
    });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    const update = result.betUpdates.find(u => u.betId === 'bet-gd');
    expect(update?.status).toBe('lost');
    expect(update?.pointsAwarded).toBe(0); // no consolation — exact score is all-or-nothing
  });

  test('right outcome, wrong margin → nothing from the exact bet', () => {
    const bet = makeBet({
      id: 'bet-om',
      bet_type: 'exact_score',
      selection: { home: 3, away: 1 }, // home win but by 2, not 1
    });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].status).toBe('lost');
    expect(result.betUpdates[0].pointsAwarded).toBe(0);
  });

  test('wrong outcome loses outright', () => {
    const bet = makeBet({
      id: 'bet-003',
      bet_type: 'exact_score',
      selection: { home: 0, away: 1 },
    });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].status).toBe('lost');
    expect(result.betUpdates[0].pointsAwarded).toBe(0);
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

describe('staking (GAME_DESIGN §5) — one stake per match, spent either way', () => {
  test('combined stage × stake multiplier is uncapped', () => {
    // final stage ×2.0 and a ×2.0 stake compound to ×4.0 — no cap.
    const finalMatch: Match = { ...match, stage: 'final', glory_multiplier: 2.0 };
    const bet = makeBet({ selection: { result: 'home' }, stake_coins: 50, stake_mult: 2.0 });
    const result = settle({ match: finalMatch, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].status).toBe('won');
    expect(result.betUpdates[0].pointsAwarded).toBe(40); // 10 * (2.0 * 2.0)
  });

  test('a staked miss still spends the Coins (negative stake_spend), no Glory penalty', () => {
    const bet = makeBet({ selection: { result: 'away' }, stake_coins: 25, stake_mult: 1.5 });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].status).toBe('lost');
    const spend = result.deltas.find(d => d.reason === 'stake_spend');
    expect(spend?.currency).toBe('coins');
    expect(spend?.amount).toBe(-25);
    expect(spend?.refType).toBe('match');
    expect(spend?.refId).toBe(match.id);
    // No Glory movement on a miss.
    expect(result.deltas.filter(d => d.currency === 'glory')).toHaveLength(0);
  });

  test('a staked win also spends the Coins — amplified Glory + flat income, minus the stake', () => {
    const bet = makeBet({ selection: { result: 'home' }, stake_coins: 25, stake_mult: 1.5 });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].pointsAwarded).toBe(15); // 10 * 1.5
    expect(result.deltas.find(d => d.reason === 'stake_spend')?.amount).toBe(-25); // spent either way
    expect(result.deltas.find(d => d.reason === 'bet_coin')?.amount).toBe(5); // flat income unchanged
  });

  test('the match stake is charged once per manager+match, not per pick', () => {
    // A full slip: stake recorded on the outcome bet, every pick carries the mult.
    const outcome = makeBet({ id: 'b-out', bet_type: 'outcome', selection: { result: 'home' }, stake_coins: 25, stake_mult: 1.5 });
    const exact = makeBet({ id: 'b-exact', bet_type: 'exact_score', selection: { home: 2, away: 1 }, stake_coins: 0, stake_mult: 1.5 });
    const result = settle({ match, bets: [outcome, exact], events: noEvents, config });

    const spends = result.deltas.filter(d => d.reason === 'stake_spend');
    expect(spends).toHaveLength(1);
    expect(spends[0].amount).toBe(-25);
    expect(spends[0].refId).toBe(match.id);
    // Both picks won and were amplified ×1.5.
    expect(result.betUpdates.find(u => u.betId === 'b-out')?.pointsAwarded).toBe(15); // 10 * 1.5
    expect(result.betUpdates.find(u => u.betId === 'b-exact')?.pointsAwarded).toBe(38); // round(25 * 1.5)
  });

  test('props never hold the match stake — an unstaked void emits nothing', () => {
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-1' })];
    const bet = makeBet({
      bet_type: 'anytime_scorer',
      selection: { footballer_id: 'plr-99' }, // did not appear → void
      stake_coins: 0,
      stake_mult: 1.5,
    });
    const result = settle({ match, bets: [bet], events, config: propConfig, appearances: ['plr-1'] });

    expect(result.betUpdates[0].status).toBe('void');
    expect(result.deltas).toHaveLength(0); // no stake_spend (prop holds no coins), no income
  });

  test('a near-miss exact score earns nothing but the stake is still spent', () => {
    // 3–2 matches the 2–1 margin but isn't exact → status lost, no Glory (gd removed).
    const bet = makeBet({
      id: 'bet-gd-stake',
      bet_type: 'exact_score',
      selection: { home: 3, away: 2 },
      stake_coins: 50,
      stake_mult: 2.0,
    });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates[0].status).toBe('lost');
    expect(result.betUpdates[0].pointsAwarded).toBe(0);
    expect(result.deltas.find(d => d.reason === 'stake_spend')?.amount).toBe(-50);
  });
});

describe('coin income (per-bet)', () => {
  test('correct outcome bet pays a flat coin reward', () => {
    const bet = makeBet({ selection: { result: 'home' } });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    const coin = result.deltas.find(d => d.currency === 'coins' && d.reason === 'bet_coin');
    expect(coin?.amount).toBe(5); // coins.outcome
    expect(coin?.refId).toBe('bet-001');
  });

  test('exact score pays the exact coin reward (flat, not multiplied)', () => {
    const finalMatch: Match = { ...match, stage: 'final', glory_multiplier: 2.0 };
    const bet = makeBet({ id: 'bet-x', bet_type: 'exact_score', selection: { home: 2, away: 1 } });
    const result = settle({ match: finalMatch, bets: [bet], events: noEvents, config });

    const coin = result.deltas.find(d => d.currency === 'coins');
    expect(coin?.amount).toBe(10); // coins.exact — stage multiplier does NOT apply to coins
  });

  test('a near-miss exact bet pays no coins (goal-difference removed)', () => {
    const bet = makeBet({ id: 'bet-gd2', bet_type: 'exact_score', selection: { home: 3, away: 2 } });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.deltas.filter(d => d.currency === 'coins')).toHaveLength(0);
  });

  test('losing bet earns no coins', () => {
    const bet = makeBet({ selection: { result: 'away' } });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.deltas.filter(d => d.currency === 'coins')).toHaveLength(0);
  });

  test('no participation reward is emitted (participation is slate-scoped, granted at day-close)', () => {
    const bets = [
      makeBet({ id: 'bet-a', manager_id: 'mgr-001' }),
      makeBet({ id: 'bet-b', manager_id: 'mgr-002' }),
    ];
    const result = settle({ match, bets, events: noEvents, config });

    expect(result.deltas.filter(d => d.reason === 'participation')).toHaveLength(0);
  });
});

// Config including Phase 2 prop values + bonus bets (the v1 fixture predates them).
const propConfig: LeagueConfig = {
  ...config,
  glory: {
    ...config.glory,
    first_goalscorer: 20,
    anytime_scorer: 10,
    carded: 10,
    score_2plus: 30,
    anytime_assist: 15,
    clean_sheet: 8,
    over_under: 6,
  },
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
    expect(result.betUpdates[0].pointsAwarded).toBe(10);
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
    expect(result.betUpdates[0].pointsAwarded).toBe(10);
    expect(result.betUpdates[0].coinsAwarded).toBe(4); // coins.prop
    expect(result.deltas.find(d => d.currency === 'coins')?.amount).toBe(4);
  });

  test('red card also counts, and knockout multiplier applies', () => {
    const finalMatch: Match = { ...match, stage: 'final', glory_multiplier: 2.0 };
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-3', type: 'red', minute: 70 })];
    const bet = makeBet({ bet_type: 'carded', selection: { footballer_id: 'plr-3' } });
    const result = settle({ match: finalMatch, bets: [bet], events, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won');
    expect(result.betUpdates[0].pointsAwarded).toBe(20); // 10 * 2.0
  });

  test('no booking/lineup feed at all → void, not lost', () => {
    const bet = makeBet({ bet_type: 'carded', selection: { footballer_id: 'plr-3' } });
    const result = settle({ match, bets: [bet], events: noEvents, config: propConfig });

    expect(result.betUpdates[0].status).toBe('void');
  });

  test('lineup present but pick not booked → lost (demonstrably not carded)', () => {
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-1', type: 'yellow', minute: 30 })];
    const bet = makeBet({ bet_type: 'carded', selection: { footballer_id: 'plr-3' } });
    const result = settle({ match, bets: [bet], events, config: propConfig, appearances: ['plr-3'] });

    expect(result.betUpdates[0].status).toBe('lost');
  });
});

describe('missing scorer feed (score present, no goal events)', () => {
  // The fixture match is 2–1: three goals on the board. If football-data reports the
  // score but no scorers, settling scorer props as "lost" would rob correct picks.
  test('anytime-scorer pick is voided, not lost, when no goals were ingested', () => {
    const bet = makeBet({ bet_type: 'anytime_scorer', selection: { footballer_id: 'plr-1' } });
    const result = settle({ match, bets: [bet], events: noEvents, config: propConfig });

    expect(result.betUpdates[0].status).toBe('void');
    expect(result.betUpdates[0].pointsAwarded).toBe(0);
    expect(result.deltas).toHaveLength(0); // void earns nothing (unstaked)
  });

  test('first-scorer pick is voided, not lost, when no goals were ingested', () => {
    const bet = makeBet({ bet_type: 'first_scorer', selection: { footballer_id: 'plr-1' } });
    const result = settle({ match, bets: [bet], events: noEvents, config: propConfig });

    expect(result.betUpdates[0].status).toBe('void');
  });

  test('a goalless match still settles scorer picks as lost (nothing to miss)', () => {
    const goalless: Match = { ...match, home_score: 0, away_score: 0 };
    const bet = makeBet({ bet_type: 'anytime_scorer', selection: { footballer_id: 'plr-1' } });
    const result = settle({ match: goalless, bets: [bet], events: noEvents, config: propConfig });

    expect(result.betUpdates[0].status).toBe('lost');
  });

  test('once any goal event is present the feed is trusted — unmatched pick loses', () => {
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-1' })];
    const bet = makeBet({ bet_type: 'anytime_scorer', selection: { footballer_id: 'plr-2' } });
    const result = settle({ match, bets: [bet], events, config: propConfig, appearances: ['plr-2'] });

    expect(result.betUpdates[0].status).toBe('lost');
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

  test('void bets earn no Glory or Coin delta', () => {
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-1' })];
    const bet = makeBet({ bet_type: 'anytime_scorer', selection: { footballer_id: 'plr-99' } });
    const result = settle({ match, bets: [bet], events, config: propConfig, appearances: ['plr-1'] });

    expect(result.deltas).toHaveLength(0);
  });

  test('no lineup data → unmatched pick settles as lost, not void', () => {
    const events = [makeEvent({ id: 'e1', footballer_id: 'plr-1' })];
    const bet = makeBet({ bet_type: 'anytime_scorer', selection: { footballer_id: 'plr-99' } });
    const result = settle({ match, bets: [bet], events, config: propConfig }); // no appearances

    expect(result.betUpdates[0].status).toBe('lost');
  });
});

describe('player to score 2+ (brace) prop', () => {
  test('two goals by the pick → won', () => {
    const events = [
      makeEvent({ id: 'e1', footballer_id: 'plr-1', minute: 20 }),
      makeEvent({ id: 'e2', footballer_id: 'plr-1', minute: 70 }),
    ];
    const bet = makeBet({ bet_type: 'score_2plus', selection: { footballer_id: 'plr-1' } });
    const result = settle({ match, bets: [bet], events, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won');
    expect(result.betUpdates[0].pointsAwarded).toBe(30); // score_2plus base
  });

  test('a single goal by the pick → lost', () => {
    const events = [
      makeEvent({ id: 'e1', footballer_id: 'plr-1', minute: 20 }),
      makeEvent({ id: 'e2', footballer_id: 'plr-2', minute: 70 }),
    ];
    const bet = makeBet({ bet_type: 'score_2plus', selection: { footballer_id: 'plr-1' } });
    const result = settle({ match, bets: [bet], events, config: propConfig, appearances: ['plr-1'] });

    expect(result.betUpdates[0].status).toBe('lost');
  });

  test('a brace including a penalty counts; own goals do not', () => {
    const events = [
      makeEvent({ id: 'e1', footballer_id: 'plr-1', type: 'penalty', minute: 12 }),
      makeEvent({ id: 'e2', footballer_id: 'plr-1', minute: 60 }),
      makeEvent({ id: 'e3', footballer_id: 'plr-1', type: 'own_goal', is_own_goal: true, minute: 80 }),
    ];
    const bet = makeBet({ bet_type: 'score_2plus', selection: { footballer_id: 'plr-1' } });
    const result = settle({ match, bets: [bet], events, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won'); // penalty + open-play goal = 2
  });
});

describe('anytime assist prop', () => {
  test('pick records an assist → won', () => {
    const events = [
      makeEvent({ id: 'e1', footballer_id: 'plr-1', type: 'goal', minute: 20 }),
      makeEvent({ id: 'e2', footballer_id: 'plr-7', type: 'assist', minute: 20 }),
    ];
    const bet = makeBet({ bet_type: 'anytime_assist', selection: { footballer_id: 'plr-7' } });
    const result = settle({ match, bets: [bet], events, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won');
    expect(result.betUpdates[0].pointsAwarded).toBe(15); // anytime_assist base
  });

  test('pick appeared but did not assist → lost', () => {
    const events = [
      makeEvent({ id: 'e1', footballer_id: 'plr-1', type: 'goal', minute: 20 }),
      makeEvent({ id: 'e2', footballer_id: 'plr-2', type: 'assist', minute: 20 }),
    ];
    const bet = makeBet({ bet_type: 'anytime_assist', selection: { footballer_id: 'plr-7' } });
    const result = settle({ match, bets: [bet], events, config: propConfig, appearances: ['plr-7'] });

    expect(result.betUpdates[0].status).toBe('lost');
  });

  test('voids (not lost) when the scorer/assist feed has not landed', () => {
    // 2–1 on the board but no goal events → the assist feed is missing too.
    const bet = makeBet({ bet_type: 'anytime_assist', selection: { footballer_id: 'plr-7' } });
    const result = settle({ match, bets: [bet], events: noEvents, config: propConfig });

    expect(result.betUpdates[0].status).toBe('void');
  });
});

describe('over/under total goals', () => {
  // Fixture is 2–1: three goals, so over 2.5 wins and under 2.5 loses.
  test('over 2.5 wins when the match has 3 goals', () => {
    const bet = makeBet({ bet_type: 'over_under', selection: { line: 2.5, direction: 'over' } });
    const result = settle({ match, bets: [bet], events: noEvents, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won');
    expect(result.betUpdates[0].pointsAwarded).toBe(6); // over_under base
  });

  test('under 2.5 loses when the match has 3 goals', () => {
    const bet = makeBet({ bet_type: 'over_under', selection: { line: 2.5, direction: 'under' } });
    const result = settle({ match, bets: [bet], events: noEvents, config: propConfig });

    expect(result.betUpdates[0].status).toBe('lost');
  });

  test('under 2.5 wins on a low-scoring match', () => {
    const lowScore: Match = { ...match, home_score: 1, away_score: 0 };
    const bet = makeBet({ bet_type: 'over_under', selection: { line: 2.5, direction: 'under' } });
    const result = settle({ match: lowScore, bets: [bet], events: noEvents, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won');
  });
});

describe('clean sheet', () => {
  test('away team conceding loses the home clean-sheet pick (fixture 2–1)', () => {
    const bet = makeBet({ bet_type: 'clean_sheet', selection: { team: 'home' } });
    const result = settle({ match, bets: [bet], events: noEvents, config: propConfig });

    expect(result.betUpdates[0].status).toBe('lost'); // away scored 1
  });

  test('home clean sheet wins when the opponent fails to score', () => {
    const shutout: Match = { ...match, home_score: 2, away_score: 0 };
    const bet = makeBet({ bet_type: 'clean_sheet', selection: { team: 'home' } });
    const result = settle({ match: shutout, bets: [bet], events: noEvents, config: propConfig });

    expect(result.betUpdates[0].status).toBe('won');
    expect(result.betUpdates[0].pointsAwarded).toBe(8); // clean_sheet base
  });

  test('a 0–0 is a clean sheet for both teams', () => {
    const goalless: Match = { ...match, home_score: 0, away_score: 0 };
    const home = makeBet({ id: 'cs-h', bet_type: 'clean_sheet', selection: { team: 'home' } });
    const away = makeBet({ id: 'cs-a', bet_type: 'clean_sheet', selection: { team: 'away' } });
    const result = settle({ match: goalless, bets: [home, away], events: noEvents, config: propConfig });

    expect(result.betUpdates.find(u => u.betId === 'cs-h')?.status).toBe('won');
    expect(result.betUpdates.find(u => u.betId === 'cs-a')?.status).toBe('won');
  });
});

describe('idempotency', () => {
  test('already-settled bets are skipped', () => {
    const bet = makeBet({ status: 'won', glory_awarded: 10 });
    const result = settle({ match, bets: [bet], events: noEvents, config });

    expect(result.betUpdates).toHaveLength(0);
  });
});
