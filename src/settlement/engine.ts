// Settlement engine — pure functions only.
// No DB calls, no fetch, no Date.now(). Caller fetches inputs and writes results.

import {
  Bet,
  ExactScoreSelection,
  FootballerSelection,
  LeagueConfig,
  Match,
  MatchEvent,
  OutcomeSelection,
} from '@/types/db';
import { BetUpdate, CurrencyDelta, SettleInput, SettleResult } from './types';

export function settle(input: SettleInput): SettleResult {
  const { match, bets } = input;

  if (match.home_score == null || match.away_score == null) {
    throw new Error(`settle called on match ${match.id} without a final score`);
  }

  const deltas: CurrencyDelta[] = [];
  const betUpdates: BetUpdate[] = [];

  // A single Coin stake rides the whole match slip (GAME_DESIGN §5). It's recorded
  // on the bets at submission; settle charges it once per manager+match here. Sum
  // per manager so a multi-manager batch each pays their own stake exactly once.
  const stakeByManager = new Map<string, number>();

  for (const bet of bets) {
    if (bet.status !== 'pending') continue;

    if (bet.stake_coins > 0) {
      stakeByManager.set(bet.manager_id, (stakeByManager.get(bet.manager_id) ?? 0) + bet.stake_coins);
    }

    const update = settleBet(bet, input);
    betUpdates.push(update);

    if (update.status === 'void') continue;

    if (update.pointsAwarded > 0) {
      deltas.push({
        managerId: bet.manager_id,
        currency: 'glory',
        amount: update.pointsAwarded,
        reason: 'bet_win',
        refType: 'bet',
        refId: bet.id,
      });
    }

    // Flat Coin income for a correct bet (GAME_DESIGN §4). Slate-scoped coins
    // (daily participation, clean-slate, streak, interest) are granted at day-close
    // in a later Phase 3 slice, not here.
    if (update.coinsAwarded > 0) {
      deltas.push({
        managerId: bet.manager_id,
        currency: 'coins',
        amount: update.coinsAwarded,
        reason: 'bet_coin',
        refType: 'bet',
        refId: bet.id,
      });
    }
  }

  // Staking (GAME_DESIGN §5): the match stake is a deliberate investment — the Coins
  // are spent **either way**, win or lose. We emit one negative `stake_spend` per
  // manager+match regardless of how the picks landed; the upside is the amplified
  // Glory each winning pick already earned above (via stake_mult), plus the flat
  // Coin income on correct picks, which wins some of the stake back. Idempotent via
  // the ledger's (reason, ref_type, ref_id, manager_id) unique index.
  for (const [managerId, staked] of stakeByManager) {
    deltas.push({
      managerId,
      currency: 'coins',
      amount: -staked,
      reason: 'stake_spend',
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
      return settleScorerProp(bet, match, events, mult, config, appearances, 'first');
    case 'anytime_scorer':
      return settleScorerProp(bet, match, events, mult, config, appearances, 'anytime');
    case 'carded':
      return settleCarded(bet, events, mult, config, appearances);
    default:
      // Unknown/retired bet type — settle as a no-op void rather than throw.
      return { betId: bet.id, status: 'void', pointsAwarded: 0, coinsAwarded: 0 };
  }
}

function outcomeOf(home: number, away: number): 'home' | 'draw' | 'away' {
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'draw';
}

// The Glory multiplier applied to a winning bet: the knockout-stage multiplier
// times the Coin stake multiplier, uncapped (GAME_DESIGN §5). The match stake is
// paid either way (see `settle`); this multiplier is its upside, applied to every
// *winning* pick.
function effMult(stageMult: number, stakeMult: number): number {
  return stageMult * stakeMult;
}

function settleOutcome(
  bet: Bet,
  home: number,
  away: number,
  mult: number,
  config: LeagueConfig,
): BetUpdate {
  const { result } = bet.selection as OutcomeSelection;
  const won = result === outcomeOf(home, away);
  return {
    betId: bet.id,
    status: won ? 'won' : 'lost',
    pointsAwarded: won
      ? Math.round(config.glory.outcome_correct * effMult(mult, bet.stake_mult))
      : 0,
    coinsAwarded: won ? config.coins.outcome : 0,
  };
}

// The exact-score bet is all-or-nothing (GAME_DESIGN §3): the exact scoreline scores
// outcome + the exact bonus; anything else scores nothing. The separate outcome bet
// independently scores the +10 for a correct result.
function settleExactScore(
  bet: Bet,
  home: number,
  away: number,
  mult: number,
  config: LeagueConfig,
): BetUpdate {
  const sel = bet.selection as ExactScoreSelection;
  const exact = sel.home === home && sel.away === away;

  if (exact) {
    const basePoints = config.glory.outcome_correct + config.glory.exact_score_bonus;
    return {
      betId: bet.id,
      status: 'won',
      pointsAwarded: Math.round(basePoints * effMult(mult, bet.stake_mult)),
      coinsAwarded: config.coins.exact,
    };
  }

  return { betId: bet.id, status: 'lost', pointsAwarded: 0, coinsAwarded: 0 };
}

// ─── player props (Phase 2) ──────────────────────────────────────────────────

// A "scoring" event for prop purposes: an open-play goal or a penalty, never an
// own goal. First/Anytime Goalscorer markets always exclude own goals.
function isScoringEvent(e: MatchEvent): boolean {
  return (e.type === 'goal' || e.type === 'penalty') && !e.is_own_goal;
}

// Any goal-type event (incl. own goals) — used to tell "the goal feed is here" from
// "the goal feed hasn't landed". football-data's free tier can publish the final
// score before (or without) the scorers, leaving goals on the board but zero goal
// events. Settling first/anytime-scorer props off that empty list would wrongly mark
// correct picks as *lost*, so we VOID those props instead (refund, no Glory). We only
// guard the all-or-nothing gap the feed actually produces: a *partial* scorer list is
// indistinguishable from a legitimate loss, so it settles normally.
function scorerFeedMissing(match: Match, events: MatchEvent[]): boolean {
  const totalGoals = (match.home_score ?? 0) + (match.away_score ?? 0);
  if (totalGoals === 0) return false; // a goalless match can't be missing a scorer
  return !events.some(e => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal');
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
  coins: number,
  appearances: string[] | undefined,
): BetUpdate {
  if (won) return { betId: bet.id, status: 'won', pointsAwarded: points, coinsAwarded: coins };
  const haveLineups = appearances != null && appearances.length > 0;
  if (haveLineups && !appearances!.includes(pickId)) {
    return { betId: bet.id, status: 'void', pointsAwarded: 0, coinsAwarded: 0 };
  }
  return { betId: bet.id, status: 'lost', pointsAwarded: 0, coinsAwarded: 0 };
}

function settleScorerProp(
  bet: Bet,
  match: Match,
  events: MatchEvent[],
  mult: number,
  config: LeagueConfig,
  appearances: string[] | undefined,
  kind: 'first' | 'anytime',
): BetUpdate {
  const pickId = (bet.selection as FootballerSelection).footballer_id;

  // No scorers from the feed despite goals on the board → we can't tell who scored.
  // Void rather than wrongly mark a correct pick as lost (the settle cron defers these
  // within a grace window first, so a slow feed still pays out the win on retry).
  if (scorerFeedMissing(match, events)) {
    return { betId: bet.id, status: 'void', pointsAwarded: 0, coinsAwarded: 0 };
  }

  const won =
    kind === 'first'
      ? firstScorerId(events) === pickId
      : events.some(e => isScoringEvent(e) && e.footballer_id === pickId);

  const basePoints = (kind === 'first' ? config.glory.first_goalscorer : config.glory.anytime_scorer) ?? 0;
  const points = won ? Math.round(basePoints * effMult(mult, bet.stake_mult)) : 0;

  return propResult(bet, pickId, won, points, config.coins.prop, appearances);
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
  const points = won ? Math.round(basePoints * effMult(mult, bet.stake_mult)) : 0;

  return propResult(bet, pickId, won, points, config.coins.prop, appearances);
}

// Re-export types so callers only need to import from engine.ts
export type { SettleInput, SettleResult, CurrencyDelta, BetUpdate };
