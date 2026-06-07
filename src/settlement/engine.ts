// Settlement engine — pure functions only.
// No DB calls, no fetch, no Date.now(). Caller fetches inputs and writes results.

import { Bet, ExactScoreSelection, LeagueConfig, OutcomeSelection } from '@/types/db';
import { BetUpdate, CurrencyDelta, SettleInput, SettleResult } from './types';

export function settle(input: SettleInput): SettleResult {
  const { match, bets, config } = input;

  if (match.home_score == null || match.away_score == null) {
    throw new Error(`settle called on match ${match.id} without a final score`);
  }

  const deltas: CurrencyDelta[] = [];
  const betUpdates: BetUpdate[] = [];

  for (const bet of bets) {
    if (bet.status !== 'pending') continue;

    const update = settleBet(bet, input);
    betUpdates.push(update);

    if (update.status === 'void') continue;

    const glory = update.gloryAwarded;

    if (glory > 0) {
      deltas.push({
        managerId: bet.manager_id,
        currency: 'glory',
        amount: glory,
        reason: 'bet_win',
        refType: 'bet',
        refId: bet.id,
      });
    }

    // Participation Glory — awarded per slip (one per manager per match), not per bet.
    // Handled by the caller to avoid double-counting across bets.
  }

  // Participation Glory: one entry per unique manager who had ≥1 pending bet.
  const participatingManagers = new Set(bets.filter(b => b.status === 'pending').map(b => b.manager_id));
  for (const managerId of participatingManagers) {
    deltas.push({
      managerId,
      currency: 'glory',
      amount: config.glory.participation,
      reason: 'participation',
      refType: 'match',
      refId: match.id,
    });
  }

  return { deltas, betUpdates };
}

function settleBet(bet: Bet, input: SettleInput): BetUpdate {
  const { match, config } = input;
  const home = match.home_score!;
  const away = match.away_score!;
  const mult = match.glory_multiplier;

  switch (bet.bet_type) {
    case 'outcome':
      return settleOutcome(bet, home, away, mult, config);
    case 'exact_score':
      return settleExactScore(bet, home, away, mult, config);
    default:
      // Props are settled in later phases
      return { betId: bet.id, status: 'void', gloryAwarded: 0 };
  }
}

function settleOutcome(
  bet: Bet,
  home: number,
  away: number,
  mult: number,
  config: LeagueConfig,
): BetUpdate {
  const { result } = bet.selection as OutcomeSelection;

  let actualResult: 'home' | 'draw' | 'away';
  if (home > away) actualResult = 'home';
  else if (home < away) actualResult = 'away';
  else actualResult = 'draw';

  const won = result === actualResult;
  return {
    betId: bet.id,
    status: won ? 'won' : 'lost',
    gloryAwarded: won ? Math.round(config.glory.outcome_correct * mult * bet.stake_mult) : 0,
  };
}

function settleExactScore(
  bet: Bet,
  home: number,
  away: number,
  mult: number,
  config: LeagueConfig,
): BetUpdate {
  const sel = bet.selection as ExactScoreSelection;
  const won = sel.home === home && sel.away === away;

  let glory = 0;
  if (won) {
    const baseGlory = config.glory.outcome_correct + config.glory.exact_score_bonus;
    glory = Math.round(baseGlory * mult * bet.stake_mult);
  }

  return {
    betId: bet.id,
    status: won ? 'won' : 'lost',
    gloryAwarded: glory,
  };
}

// Re-export types so callers only need to import from engine.ts
export type { SettleInput, SettleResult, CurrencyDelta, BetUpdate };
