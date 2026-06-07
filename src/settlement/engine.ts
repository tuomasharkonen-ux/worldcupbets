// Settlement engine — pure functions only.
// No DB calls, no fetch, no Date.now(). Caller fetches inputs and writes results.

import {
  Bet,
  ExactScoreSelection,
  FootballerSelection,
  LeagueConfig,
  MatchEvent,
  OutcomeSelection,
} from '@/types/db';
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

    const points = update.pointsAwarded;

    if (points > 0) {
      deltas.push({
        managerId: bet.manager_id,
        currency: 'glory',
        amount: points,
        reason: 'bet_win',
        refType: 'bet',
        refId: bet.id,
      });
    }

    // Participation Points — awarded per slip (one per manager per match), not per bet.
    // Handled by the caller to avoid double-counting across bets.
  }

  // Participation Points: one entry per unique manager who had ≥1 pending bet.
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
  const { match, config, events, appearances } = input;
  const home = match.home_score!;
  const away = match.away_score!;
  const mult = match.glory_multiplier;

  switch (bet.bet_type) {
    case 'outcome':
      return settleOutcome(bet, home, away, mult, config);
    case 'exact_score':
      return settleExactScore(bet, home, away, mult, config);
    case 'first_scorer':
      return settleScorerProp(bet, events, mult, config, appearances, 'first');
    case 'anytime_scorer':
      return settleScorerProp(bet, events, mult, config, appearances, 'anytime');
    case 'carded':
      return settleCarded(bet, events, mult, config, appearances);
    default:
      // stat_leader is settled in Phase 4 (Sofascore)
      return { betId: bet.id, status: 'void', pointsAwarded: 0 };
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
    pointsAwarded: won ? Math.round(config.glory.outcome_correct * mult * bet.stake_mult) : 0,
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

  let points = 0;
  if (won) {
    const basePoints = config.glory.outcome_correct + config.glory.exact_score_bonus;
    points = Math.round(basePoints * mult * bet.stake_mult);
  }

  return {
    betId: bet.id,
    status: won ? 'won' : 'lost',
    pointsAwarded: points,
  };
}

// ─── player props (Phase 2) ──────────────────────────────────────────────────

// A "scoring" event for prop purposes: an open-play goal or a penalty, never an
// own goal. First/Anytime Goalscorer markets always exclude own goals.
function isScoringEvent(e: MatchEvent): boolean {
  return (e.type === 'goal' || e.type === 'penalty') && !e.is_own_goal;
}

// The scorer of the match's first (earliest-minute) non-own goal, or null if the
// only goals were own goals / there were no goals.
function firstScorerId(events: MatchEvent[]): string | null {
  const goals = events.filter(isScoringEvent).filter(e => e.footballer_id != null);
  if (goals.length === 0) return null;
  // Stable sort by minute; nulls (unknown minute) sort last.
  const sorted = [...goals].sort(
    (a, b) => (a.minute ?? Number.MAX_SAFE_INTEGER) - (b.minute ?? Number.MAX_SAFE_INTEGER),
  );
  return sorted[0].footballer_id;
}

// Did we appear? `won` short-circuits appearance checks (you can't score without
// playing). Otherwise: void if we have lineup data and the pick isn't in it,
// else lost. Empty/absent appearances = no data → never void.
function propResult(
  bet: Bet,
  pickId: string,
  won: boolean,
  points: number,
  appearances: string[] | undefined,
): BetUpdate {
  if (won) return { betId: bet.id, status: 'won', pointsAwarded: points };
  const haveLineups = appearances != null && appearances.length > 0;
  if (haveLineups && !appearances!.includes(pickId)) {
    return { betId: bet.id, status: 'void', pointsAwarded: 0 };
  }
  return { betId: bet.id, status: 'lost', pointsAwarded: 0 };
}

function settleScorerProp(
  bet: Bet,
  events: MatchEvent[],
  mult: number,
  config: LeagueConfig,
  appearances: string[] | undefined,
  kind: 'first' | 'anytime',
): BetUpdate {
  const pickId = (bet.selection as FootballerSelection).footballer_id;

  const won =
    kind === 'first'
      ? firstScorerId(events) === pickId
      : events.some(e => isScoringEvent(e) && e.footballer_id === pickId);

  const basePoints = (kind === 'first' ? config.glory.first_goalscorer : config.glory.anytime_scorer) ?? 0;
  const points = won ? Math.round(basePoints * mult * bet.stake_mult) : 0;

  return propResult(bet, pickId, won, points, appearances);
}

function settleCarded(
  bet: Bet,
  events: MatchEvent[],
  mult: number,
  config: LeagueConfig,
  appearances: string[] | undefined,
): BetUpdate {
  const pickId = (bet.selection as FootballerSelection).footballer_id;

  const won = events.some(
    e => (e.type === 'yellow' || e.type === 'red') && e.footballer_id === pickId,
  );

  const basePoints = config.glory.carded ?? 0;
  const points = won ? Math.round(basePoints * mult * bet.stake_mult) : 0;

  return propResult(bet, pickId, won, points, appearances);
}

// Re-export types so callers only need to import from engine.ts
export type { SettleInput, SettleResult, CurrencyDelta, BetUpdate };
