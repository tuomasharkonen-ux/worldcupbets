// Day-close — pure functions only.
//
// After every match on a slate is settled, the day-close step grants the
// slate-scoped Coin bonuses (GAME_DESIGN §4) and updates per-manager scratch state.
// Like the match settlement engine this is pure: the caller fetches the slate's bets
// and writes the resulting ledger deltas + manager_state.

import { Bet, LeagueConfig, ManagerState } from '@/types/db';
import { CurrencyDelta } from './types';

export interface DayCloseInput {
  managerId: string;
  slateKey: string; // YYYY-MM-DD
  // Non-void match ids that make up the slate.
  slateMatchIds: string[];
  // This manager's bets across the slate (any status).
  bets: Bet[];
  config: LeagueConfig;
  priorState: ManagerState;
}

export interface DayCloseResult {
  deltas: CurrencyDelta[];
  newState: ManagerState;
  // True when this slate was already day-closed for the manager — the caller skips
  // the state write (the ledger upsert is idempotent regardless).
  alreadyClosed: boolean;
}

// A manager "participated" in a match when they placed both core bets (outcome +
// exact_score) for it. Props are optional and don't affect participation.
function hasCompleteCore(bets: Bet[], matchId: string): boolean {
  const forMatch = bets.filter(b => b.match_id === matchId);
  return (
    forMatch.some(b => b.bet_type === 'outcome') &&
    forMatch.some(b => b.bet_type === 'exact_score')
  );
}

export function closeSlate(input: DayCloseInput): DayCloseResult {
  const { managerId, slateKey, slateMatchIds, bets, config, priorState } = input;

  const alreadyClosed = priorState.last_closed_slate === slateKey;

  // Participation: a complete core slip for *every* match on the slate.
  const participated =
    slateMatchIds.length > 0 && slateMatchIds.every(id => hasCompleteCore(bets, id));

  // Clean slate: participated *and* every outcome bet on the slate won.
  const outcomeBets = bets.filter(b => b.bet_type === 'outcome');
  const allOutcomesCorrect =
    participated &&
    slateMatchIds.every(id =>
      outcomeBets.some(b => b.match_id === id && b.status === 'won'),
    );

  const deltas: CurrencyDelta[] = [];

  const participation = config.coins.participation ?? 0;
  if (participated && participation > 0) {
    deltas.push({
      managerId,
      currency: 'coins',
      amount: participation,
      reason: 'participation',
      refType: 'slate',
      refId: slateKey,
    });
  }

  const cleanSlate = config.coins.clean_slate ?? 0;
  if (allOutcomesCorrect && cleanSlate > 0) {
    deltas.push({
      managerId,
      currency: 'coins',
      amount: cleanSlate,
      reason: 'clean_slate',
      refType: 'slate',
      refId: slateKey,
    });
  }

  // Streak: consecutive slates with every outcome correct. We maintain the counter
  // here every day-close; the *payout* (Hot Hand) reads it in slice 4. Don't mutate
  // when the slate was already closed, or a re-run would corrupt the count.
  const priorStreak = priorState.outcome_streak ?? 0;
  const newStreak = alreadyClosed
    ? priorStreak
    : allOutcomesCorrect
      ? priorStreak + 1
      : 0;

  const newState: ManagerState = {
    ...priorState,
    outcome_streak: newStreak,
    last_closed_slate: slateKey,
  };

  return { deltas, newState, alreadyClosed };
}
