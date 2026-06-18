// Settlement engine — pure functions only.
// No DB calls, no fetch, no Date.now(). Caller fetches inputs and writes results.

import {
  Bet,
  CleanSheetSelection,
  ExactScoreSelection,
  FootballerSelection,
  LeagueConfig,
  Match,
  MatchEvent,
  OutcomeSelection,
  OverUnderSelection,
} from '@/types/db';
import { BetUpdate, CurrencyDelta, SettleInput, SettleResult } from './types';

// Player-based props: bets that can only be settled from the granular match feed
// (goals/assists/cards + lineups), so the caller must ingest that feed before
// settling them. Score-derived bets (outcome, exact_score, over_under, clean_sheet)
// need only the final score and are deliberately absent. A prop missing from this
// list is never ingested → the engine sees an empty feed and voids the pick, which
// is exactly how anytime_assist / score_2plus picks were silently lost.
export const PLAYER_PROP_BET_TYPES: readonly Bet['bet_type'][] = [
  'first_scorer',
  'anytime_scorer',
  'score_2plus',
  'anytime_assist',
  'carded',
];

// The subset of props settled off the goal/assist feed (guarded by scorerFeedMissing):
// the scorer markets plus assists, all of which the feed can publish after the final
// score. The caller defers these within a grace window so a slow feed pays the win on
// retry rather than voiding it. `carded` is intentionally excluded — it has its own
// all-or-nothing absence guard, not scorerFeedMissing.
export const SCORER_FEED_BET_TYPES: readonly Bet['bet_type'][] = [
  'first_scorer',
  'anytime_scorer',
  'score_2plus',
  'anytime_assist',
];

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

// Exported so the props-backfill can re-evaluate a single already-settled bet
// without re-running the whole match (which would also re-charge stakes / day-close).
export function settleBet(bet: Bet, input: SettleInput): BetUpdate {
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
      return settleScorerProp(bet, match, events, mult, config, 'first');
    case 'anytime_scorer':
      return settleScorerProp(bet, match, events, mult, config, 'anytime');
    case 'score_2plus':
      return settleScorerProp(bet, match, events, mult, config, 'brace');
    case 'anytime_assist':
      return settleAssistProp(bet, match, events, mult, config);
    case 'carded':
      return settleCarded(bet, events, mult, config, appearances);
    case 'over_under':
      return settleOverUnder(bet, home, away, mult, config);
    case 'clean_sheet':
      return settleCleanSheet(bet, home, away, mult, config);
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

// The exact-score bet is all-or-nothing (GAME_DESIGN §3): nailing the exact scoreline
// scores the exact bonus on its own; anything else scores nothing. The +10 for a
// correct result is scored once, by the separate outcome bet — so a nailed score pays
// outcome (+10) + exact bonus (+25) = 35, not double-counting the result.
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
    const basePoints = config.glory.exact_score_bonus;
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

// A prop that didn't win settles as lost — including when the pick never made the
// lineup. We deliberately do NOT void on a missing appearance: a non-appearing pick
// is treated as a miss. That leaves the only remaining prop voids as genuine data
// gaps (scorerFeedMissing / no-feed carded), so a stray `void` is a reliable signal
// of a bugged bet rather than a routine "didn't start".
function propResult(bet: Bet, won: boolean, points: number, coins: number): BetUpdate {
  if (won) return { betId: bet.id, status: 'won', pointsAwarded: points, coinsAwarded: coins };
  return { betId: bet.id, status: 'lost', pointsAwarded: 0, coinsAwarded: 0 };
}

function settleScorerProp(
  bet: Bet,
  match: Match,
  events: MatchEvent[],
  mult: number,
  config: LeagueConfig,
  kind: 'first' | 'anytime' | 'brace',
): BetUpdate {
  const pickId = (bet.selection as FootballerSelection).footballer_id;

  // No scorers from the feed despite goals on the board → we can't tell who scored.
  // Void rather than wrongly mark a correct pick as lost (the settle cron defers these
  // within a grace window first, so a slow feed still pays out the win on retry).
  if (scorerFeedMissing(match, events)) {
    return { betId: bet.id, status: 'void', pointsAwarded: 0, coinsAwarded: 0 };
  }

  const goalsByPick = events.filter(e => isScoringEvent(e) && e.footballer_id === pickId).length;
  const won =
    kind === 'first'
      ? firstScorerId(events) === pickId
      : kind === 'brace'
        ? goalsByPick >= 2
        : goalsByPick >= 1;

  const basePoints =
    (kind === 'first'
      ? config.glory.first_goalscorer
      : kind === 'brace'
        ? config.glory.score_2plus
        : config.glory.anytime_scorer) ?? 0;
  const points = won ? Math.round(basePoints * effMult(mult, bet.stake_mult)) : 0;

  return propResult(bet, won, points, config.coins.prop);
}

// Anytime assist: the chosen player is credited with an assist on any goal. Assist
// events are only carried by the granular (api-football) feed; the same "scorers
// haven't landed" gap that voids scorer props also hides assists, so we reuse that
// guard rather than wrongly settle a correct pick as lost.
function settleAssistProp(
  bet: Bet,
  match: Match,
  events: MatchEvent[],
  mult: number,
  config: LeagueConfig,
): BetUpdate {
  const pickId = (bet.selection as FootballerSelection).footballer_id;

  if (scorerFeedMissing(match, events)) {
    return { betId: bet.id, status: 'void', pointsAwarded: 0, coinsAwarded: 0 };
  }

  const won = events.some(e => e.type === 'assist' && e.footballer_id === pickId);
  const basePoints = config.glory.anytime_assist ?? 0;
  const points = won ? Math.round(basePoints * effMult(mult, bet.stake_mult)) : 0;

  return propResult(bet, won, points, config.coins.prop);
}

// ─── score-derived bonus bets (not player-based) ──────────────────────────────

// Over/Under total match goals. The line is fixed at 2.5 (never a push), so this is a
// clean binary on the final score — no feed-completeness concerns like the props have.
function settleOverUnder(
  bet: Bet,
  home: number,
  away: number,
  mult: number,
  config: LeagueConfig,
): BetUpdate {
  const { line, direction } = bet.selection as OverUnderSelection;
  const total = home + away;
  const won = direction === 'over' ? total > line : total < line;
  const basePoints = config.glory.over_under ?? 0;
  return {
    betId: bet.id,
    status: won ? 'won' : 'lost',
    pointsAwarded: won ? Math.round(basePoints * effMult(mult, bet.stake_mult)) : 0,
    coinsAwarded: won ? config.coins.prop : 0,
  };
}

// Clean sheet: the chosen team concedes zero. A 0–0 is a clean sheet for both sides,
// so both picks win — that falls out naturally from reading the opponent's score.
function settleCleanSheet(
  bet: Bet,
  home: number,
  away: number,
  mult: number,
  config: LeagueConfig,
): BetUpdate {
  const { team } = bet.selection as CleanSheetSelection;
  const conceded = team === 'home' ? away : home;
  const won = conceded === 0;
  const basePoints = config.glory.clean_sheet ?? 0;
  return {
    betId: bet.id,
    status: won ? 'won' : 'lost',
    pointsAwarded: won ? Math.round(basePoints * effMult(mult, bet.stake_mult)) : 0,
    coinsAwarded: won ? config.coins.prop : 0,
  };
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

  // No match-detail feed at all (no events AND no lineups) → we can't tell whether
  // the pick was booked, so void rather than falsely mark it lost. Same free-tier gap
  // as scorerFeedMissing, but cards have no "should there have been one" signal, so we
  // can only act on the all-or-nothing absence. A real match with lineups but no card
  // for the pick still settles as lost (the player demonstrably wasn't booked).
  if (!won && events.length === 0 && (appearances == null || appearances.length === 0)) {
    return { betId: bet.id, status: 'void', pointsAwarded: 0, coinsAwarded: 0 };
  }

  const basePoints = config.glory.carded ?? 0;
  const points = won ? Math.round(basePoints * effMult(mult, bet.stake_mult)) : 0;

  return propResult(bet, won, points, config.coins.prop);
}

// Re-export types so callers only need to import from engine.ts
export type { SettleInput, SettleResult, CurrencyDelta, BetUpdate };
