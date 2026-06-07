import { closeSlate } from '../dayclose';
import fixture from './fixtures/group_match.json';
import { Bet, LeagueConfig, ManagerState } from '@/types/db';

const { config } = fixture as { config: LeagueConfig };

const SLATE = '2026-06-15';
const M1 = 'match-1';
const M2 = 'match-2';

function bet(matchId: string, type: Bet['bet_type'], status: Bet['status']): Bet {
  return {
    id: `${matchId}-${type}`,
    manager_id: 'mgr-1',
    match_id: matchId,
    bet_type: type,
    selection: type === 'outcome' ? { result: 'home' } : { home: 1, away: 0 },
    stake_coins: 0,
    stake_mult: 1.0,
    status,
    glory_awarded: null,
    created_at: '2026-06-15T10:00:00Z',
    locked_at: '2026-06-15T17:00:00Z',
  };
}

// A complete, all-won two-match slip.
const cleanSlip = (): Bet[] => [
  bet(M1, 'outcome', 'won'),
  bet(M1, 'exact_score', 'lost'),
  bet(M2, 'outcome', 'won'),
  bet(M2, 'exact_score', 'won'),
];

const base = {
  managerId: 'mgr-1',
  slateKey: SLATE,
  slateMatchIds: [M1, M2],
  config,
  priorState: {} as ManagerState,
};

describe('participation', () => {
  test('a complete core slip for every match grants participation', () => {
    const { deltas } = closeSlate({ ...base, bets: cleanSlip() });
    const p = deltas.find(d => d.reason === 'participation');
    expect(p?.amount).toBe(10); // coins.participation
    expect(p?.refType).toBe('slate');
    expect(p?.refId).toBe(SLATE);
  });

  test('missing a match’s core bet → no participation', () => {
    const bets = [bet(M1, 'outcome', 'won'), bet(M1, 'exact_score', 'won')]; // M2 unbet
    const { deltas } = closeSlate({ ...base, bets });
    expect(deltas.find(d => d.reason === 'participation')).toBeUndefined();
  });

  test('missing the exact_score half of a match’s core → no participation', () => {
    const bets = [
      bet(M1, 'outcome', 'won'),
      bet(M1, 'exact_score', 'won'),
      bet(M2, 'outcome', 'won'), // no exact for M2
    ];
    const { deltas } = closeSlate({ ...base, bets });
    expect(deltas.find(d => d.reason === 'participation')).toBeUndefined();
  });
});

describe('clean slate', () => {
  test('every outcome correct grants the clean-slate bonus', () => {
    const { deltas } = closeSlate({ ...base, bets: cleanSlip() });
    expect(deltas.find(d => d.reason === 'clean_slate')?.amount).toBe(15);
  });

  test('one wrong outcome → no clean-slate bonus (participation still paid)', () => {
    const bets = cleanSlip();
    bets[2] = bet(M2, 'outcome', 'lost');
    const { deltas } = closeSlate({ ...base, bets });
    expect(deltas.find(d => d.reason === 'clean_slate')).toBeUndefined();
    expect(deltas.find(d => d.reason === 'participation')?.amount).toBe(10);
  });
});

describe('streak counter', () => {
  test('all-correct increments the streak', () => {
    const { newState } = closeSlate({
      ...base,
      bets: cleanSlip(),
      priorState: { outcome_streak: 2, last_closed_slate: '2026-06-14' },
    });
    expect(newState.outcome_streak).toBe(3);
    expect(newState.last_closed_slate).toBe(SLATE);
  });

  test('a wrong outcome resets the streak to 0', () => {
    const bets = cleanSlip();
    bets[0] = bet(M1, 'outcome', 'lost');
    const { newState } = closeSlate({
      ...base,
      bets,
      priorState: { outcome_streak: 5, last_closed_slate: '2026-06-14' },
    });
    expect(newState.outcome_streak).toBe(0);
  });
});

describe('idempotency', () => {
  test('re-closing the same slate does not mutate the streak', () => {
    const { newState, alreadyClosed } = closeSlate({
      ...base,
      bets: cleanSlip(),
      priorState: { outcome_streak: 4, last_closed_slate: SLATE },
    });
    expect(alreadyClosed).toBe(true);
    expect(newState.outcome_streak).toBe(4); // unchanged
  });
});
