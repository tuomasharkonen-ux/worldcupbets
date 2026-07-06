// Favorite team + player scoring — pure functions only (migration 009).
//
// Two season-long mechanics, both keyed off a manager's first-login picks:
//   • favorite TEAM: an odds-weighted advancement ladder. Each milestone the team
//     reaches pays base Points × the team's underdog multiplier, so backing a
//     longshot pays more at every stage it survives. Settles incrementally as the
//     bracket resolves (reach-stage rungs on qualifying; champion/third on winning).
//   • favorite PLAYER: a flat per-goal bonus and a one-off per-match booking penalty.
//
// No DB, no fetch, no Date — the cron fetches inputs and writes the deltas, exactly
// like engine.ts / dayclose.ts. The same helpers power the onboarding picker so the
// bonuses shown at pick time and the bonuses actually paid can never drift.

import { FavoritesConfig, MatchEvent, MatchStage, MatchStatus } from '@/types/db';
import { CurrencyDelta } from './types';

// ─── odds → underdog multiplier ────────────────────────────────────────────────

// √(odds / base_odds), rounded to the nearest 0.5 and clamped. The square root
// dampens the spread (a 100× longshot pays ~10×, not 100×) and the clamp caps the
// jackpot so a true minnow can't break the leaderboard. The top favorite (odds ==
// base_odds) lands on min_mult, i.e. 1.0.
// The param is structural (just the odds→mult knobs) so the Golden Bracket config
// (migration 016) can reuse the exact same formula against teams.gb_odds.
export type OddsMultiplierConfig = Pick<FavoritesConfig, 'base_odds' | 'min_mult' | 'max_mult'>;
export function teamMultiplier(odds: number | null | undefined, fav: OddsMultiplierConfig): number {
  if (odds == null || odds <= 0) return fav.min_mult;
  const raw = Math.sqrt(odds / fav.base_odds);
  const rounded = Math.round(raw * 2) / 2;
  return Math.min(fav.max_mult, Math.max(fav.min_mult, rounded));
}

// ─── advancement ladder ──────────────────────────────────────────────────────

// The reach-a-stage rungs, in bracket order. Champion and third place are won, not
// reached, so they're handled separately below.
const REACH_RUNGS: { stage: MatchStage; key: keyof FavoritesConfig['ladder']; label: string }[] = [
  { stage: 'r32', key: 'r32', label: 'Out of the group' },
  { stage: 'r16', key: 'r16', label: 'Round of 16' },
  { stage: 'qf', key: 'qf', label: 'Quarter-final' },
  { stage: 'sf', key: 'sf', label: 'Semi-final' },
  { stage: 'final', key: 'final', label: 'Final' },
];

export interface LadderRung {
  // ledger reason suffix / stable key (e.g. 'qf', 'champion')
  key: string;
  label: string;
  points: number; // base × multiplier, rounded
}

export interface LadderBreakdown {
  multiplier: number;
  rungs: LadderRung[]; // qualify → champion, in display order
  // Total a champion banks (every rung on the title path, excluding 3rd place).
  championTotal: number;
}

// The full ladder for a team's odds — used by the onboarding picker and the profile
// to show exactly what each milestone is worth for this pick.
export function ladderBreakdown(
  odds: number | null | undefined,
  fav: FavoritesConfig,
): LadderBreakdown {
  const mult = teamMultiplier(odds, fav);
  const pts = (base: number) => Math.round(base * mult);

  const rungs: LadderRung[] = REACH_RUNGS.map(r => ({
    key: r.key,
    label: r.label,
    points: pts(fav.ladder[r.key]),
  }));
  // 3rd place sits between SF and Final conceptually, but it's an alternate branch
  // (only SF losers play it), so list it after the title path for clarity.
  rungs.push({ key: 'third', label: '3rd-place playoff', points: pts(fav.ladder.third) });
  rungs.push({ key: 'champion', label: 'Champion 🏆', points: pts(fav.ladder.champion) });

  // Title path: every reach rung + champion (a champion never plays for 3rd).
  const championTotal =
    REACH_RUNGS.reduce((s, r) => s + pts(fav.ladder[r.key]), 0) + pts(fav.ladder.champion);

  return { multiplier: mult, rungs, championTotal };
}

// ─── settlement: favorite team ──────────────────────────────────────────────────

// Just the match fields the ladder needs. The caller passes the favorite team's
// non-void matches (any status). "Out of the group" (r32) fires on the round-of-32 fixture
// merely existing (the feed only assigns knockout teams once they've qualified); the deeper
// reach rungs (r16/qf/sf/final) fire on WINNING the previous round, and champion/third on
// winning that game.
export interface LadderMatch {
  stage: MatchStage;
  status: MatchStatus;
  home_team_id: string;
  away_team_id: string;
  winner_team_id: string | null;
}

export interface TeamLadderInput {
  managerId: string;
  teamId: string;
  multiplier: number;
  // The favorite team's matches (non-void). Pass all matches — we filter to the team.
  matches: LadderMatch[];
  fav: FavoritesConfig;
  // Season key for the idempotency ref (e.g. 'WC2026') — one award per milestone.
  seasonKey: string;
}

export function teamLadderDeltas(input: TeamLadderInput): CurrencyDelta[] {
  const { managerId, teamId, multiplier, matches, fav, seasonKey } = input;
  const mine = matches.filter(
    m => m.status !== 'void' && (m.home_team_id === teamId || m.away_team_id === teamId),
  );
  if (mine.length === 0) return [];

  const deltas: CurrencyDelta[] = [];
  const award = (key: string, base: number) => {
    const amount = Math.round(base * multiplier);
    if (amount === 0) return;
    deltas.push({
      managerId,
      currency: 'glory',
      amount,
      reason: `team_${key}`,
      refType: 'season',
      refId: seasonKey,
    });
  };

  // "Out of the group" (r32): the round-of-32 fixture existing means the team qualified —
  // the feed only assigns knockout teams once they're through, so there's no earlier hook.
  if (mine.some(m => m.stage === 'r32')) award('r32', fav.ladder.r32);

  // Reaching R16 / QF / SF / the final is EARNED by winning the previous knockout round —
  // not by the next fixture merely existing. Keying off the win (winner_team_id, which
  // reflects extra time / a shootout) pays the milestone the morning after the match that
  // secured it, instead of days later once the bracket is redrawn and the next fixture
  // appears. WON_ADVANCES maps the round played → the round its winner reaches.
  const WON_ADVANCES: Record<string, keyof FavoritesConfig['ladder']> = {
    r32: 'r16',
    r16: 'qf',
    qf: 'sf',
    sf: 'final',
  };
  for (const m of mine) {
    if (m.status === 'finished' && m.winner_team_id === teamId) {
      const reached = WON_ADVANCES[m.stage];
      if (reached) award(reached, fav.ladder[reached]);
    }
  }

  // Won the final / the third-place playoff.
  if (mine.some(m => m.stage === 'final' && m.status === 'finished' && m.winner_team_id === teamId)) {
    award('champion', fav.ladder.champion);
  }
  if (mine.some(m => m.stage === 'third' && m.status === 'finished' && m.winner_team_id === teamId)) {
    award('third', fav.ladder.third);
  }
  return deltas;
}

// ─── settlement: favorite player ──────────────────────────────────────────────

// A goal that counts for the favorite-player bonus: an open-play goal or penalty,
// never an own goal (mirrors the goalscorer-prop rule in engine.ts).
function isPlayerGoal(e: MatchEvent, footballerId: string): boolean {
  return (
    e.footballer_id === footballerId &&
    (e.type === 'goal' || e.type === 'penalty') &&
    !e.is_own_goal
  );
}

function wasBooked(events: MatchEvent[], footballerId: string): boolean {
  return events.some(
    e => e.footballer_id === footballerId && (e.type === 'yellow' || e.type === 'red'),
  );
}

export interface FavoritePlayerInput {
  matchId: string;
  events: MatchEvent[];
  // Managers whose favorite player is in this match, with that player's id.
  favorites: { managerId: string; footballerId: string }[];
  fav: FavoritesConfig;
}

// One aggregated Point delta per manager: goals × player_goal, minus a single
// per-match booking penalty. Skips managers whose player neither scored nor was
// booked (net 0). Idempotent via the (reason, ref_type, ref_id, manager_id) index.
export function favoritePlayerDeltas(input: FavoritePlayerInput): CurrencyDelta[] {
  const { matchId, events, favorites, fav } = input;
  const deltas: CurrencyDelta[] = [];

  for (const { managerId, footballerId } of favorites) {
    const goals = events.filter(e => isPlayerGoal(e, footballerId)).length;
    const booked = wasBooked(events, footballerId);
    const net = goals * fav.player_goal + (booked ? fav.player_card : 0);
    if (net === 0) continue;
    deltas.push({
      managerId,
      currency: 'glory',
      amount: net,
      reason: 'fav_player',
      refType: 'match',
      refId: matchId,
    });
  }
  return deltas;
}
