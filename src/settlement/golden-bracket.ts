// Golden Bracket special bet — pure functions only (migration 016).
//
// One free bet per manager, placed between the QF field being known and the first
// QF kickoff: the top-4 countries with exact placements (champion / runner-up /
// third / fourth) plus the tournament top scorer and his exact final goal tally.
// Settled once at tournament end (every match finished), through the ledger.
//
// No DB, no fetch, no Date — the cron fetches inputs and writes the deltas, exactly
// like favorites.ts. The same helpers power the /golden-bracket wizard so the points
// shown at pick time and the points actually paid can never drift.

import { GoldenBracketConfig, MatchEvent } from '@/types/db';
import { CurrencyDelta } from './types';
import { teamMultiplier, type LadderMatch } from './favorites';

// ─── odds → underdog multiplier ────────────────────────────────────────────────

// Same √(odds/base) formula as the favorites ladder, fed by teams.gb_odds (the
// fresh post-R16 outright odds) instead of the pre-tournament champion_odds.
export function gbMultiplier(odds: number | null | undefined, cfg: GoldenBracketConfig): number {
  return teamMultiplier(odds, cfg);
}

// ─── per-team slip values ───────────────────────────────────────────────────────

export type GbSlot = 'champion' | 'runner_up' | 'third' | 'fourth';
export const GB_SLOTS: GbSlot[] = ['champion', 'runner_up', 'third', 'fourth'];

// What each slot (and the wrong-slot consolation) pays for a team at this
// multiplier. The single source for the wizard, the promo, and settlement.
export interface GbSlotPoints {
  champion: number;
  runner_up: number;
  third: number;
  fourth: number;
  consolation: number;
}

export function gbSlotPoints(cfg: GoldenBracketConfig, mult: number): GbSlotPoints {
  const pts = (base: number) => Math.round(base * mult);
  return {
    champion: pts(cfg.slots.champion),
    runner_up: pts(cfg.slots.runner_up),
    third: pts(cfg.slots.third),
    fourth: pts(cfg.slots.fourth),
    consolation: pts(cfg.consolation),
  };
}

// ─── final placements from the bracket ──────────────────────────────────────────

// Resolved top-4 placements. Slots stay null until their deciding match finishes;
// top4 (the semi-final participants) is knowable earlier and independently — it
// backs the consolation award, including when the third-place playoff is void.
export interface GbPlacements {
  champion: string | null;
  runnerUp: string | null;
  third: string | null;
  fourth: string | null;
  top4: Set<string>;
}

export function resolvePlacements(matches: LadderMatch[]): GbPlacements {
  const placements: GbPlacements = {
    champion: null,
    runnerUp: null,
    third: null,
    fourth: null,
    top4: new Set<string>(),
  };

  for (const m of matches) {
    if (m.status === 'void') continue;
    if (m.stage === 'sf') {
      placements.top4.add(m.home_team_id);
      placements.top4.add(m.away_team_id);
    }
    // winner_team_id reflects extra time / a shootout — never read the scoreline here.
    if (m.status !== 'finished' || m.winner_team_id == null) continue;
    const loser = m.winner_team_id === m.home_team_id ? m.away_team_id : m.home_team_id;
    if (m.stage === 'final') {
      placements.champion = m.winner_team_id;
      placements.runnerUp = loser;
    } else if (m.stage === 'third') {
      placements.third = m.winner_team_id;
      placements.fourth = loser;
    }
  }

  // Belt-and-suspenders: the finalists and third-place players are SF participants
  // by construction, but a sparse fixture list (e.g. unit inputs) shouldn't break
  // the consolation rule.
  for (const id of [placements.champion, placements.runnerUp, placements.third, placements.fourth]) {
    if (id != null) placements.top4.add(id);
  }
  return placements;
}

// ─── tournament top scorers ─────────────────────────────────────────────────────

// Tied-or-sole leaders by goals across the WHOLE tournament: open-play goals and
// penalties count, own goals never do (mirrors the goalscorer-prop rule in
// engine.ts / player-form.ts). No assist/minutes tiebreak — a dead heat pays every
// leader (documented in GAME_DESIGN).
export type GbScorerEvent = Pick<MatchEvent, 'footballer_id' | 'type' | 'is_own_goal'>;

export function topScorers(events: GbScorerEvent[]): { leaders: Set<string>; topGoals: number } {
  const goals = new Map<string, number>();
  for (const e of events) {
    if (e.footballer_id == null) continue;
    if ((e.type !== 'goal' && e.type !== 'penalty') || e.is_own_goal) continue;
    goals.set(e.footballer_id, (goals.get(e.footballer_id) ?? 0) + 1);
  }
  let topGoals = 0;
  for (const n of goals.values()) topGoals = Math.max(topGoals, n);
  const leaders = new Set<string>();
  if (topGoals > 0) {
    for (const [id, n] of goals) if (n === topGoals) leaders.add(id);
  }
  return { leaders, topGoals };
}

// ─── settlement ─────────────────────────────────────────────────────────────────

export interface GoldenBracketPick {
  managerId: string;
  champion: string;
  runnerUp: string;
  third: string;
  fourth: string;
  scorerId: string;
  scorerGoals: number;
}

export interface GoldenBracketInput {
  picks: GoldenBracketPick[];
  // Caller only settles once the final is decided (placements.champion != null).
  placements: GbPlacements;
  // teams.gb_odds → gbMultiplier, for every picked team.
  multByTeam: Map<string, number>;
  scorer: { leaders: Set<string>; topGoals: number };
  cfg: GoldenBracketConfig;
  // Season key for the idempotency ref (e.g. 'WC2026') — one award per line.
  seasonKey: string;
}

// Placement slot → the pick/placement field carrying it.
const SLOT_FIELDS: { slot: GbSlot; pick: keyof GoldenBracketPick; placed: keyof GbPlacements }[] = [
  { slot: 'champion', pick: 'champion', placed: 'champion' },
  { slot: 'runner_up', pick: 'runnerUp', placed: 'runnerUp' },
  { slot: 'third', pick: 'third', placed: 'third' },
  { slot: 'fourth', pick: 'fourth', placed: 'fourth' },
];

// One delta per winning line, idempotent via the (reason, ref_type, ref_id,
// manager_id) unique index — so consolations carry per-slot reasons (a manager can
// land up to four of them). An exact hit never also pays its consolation. When the
// third-place playoff is void (third/fourth placements null), those slots degrade
// to consolation for any pick in the top 4.
export function goldenBracketDeltas(input: GoldenBracketInput): CurrencyDelta[] {
  const { picks, placements, multByTeam, scorer, cfg, seasonKey } = input;
  const deltas: CurrencyDelta[] = [];

  for (const pick of picks) {
    const award = (reason: string, amount: number) => {
      if (amount === 0) return;
      deltas.push({
        managerId: pick.managerId,
        currency: 'glory',
        amount,
        reason,
        refType: 'season',
        refId: seasonKey,
      });
    };
    // Missing odds should never happen (the loader refuses to open the window
    // without them) — fall back to the floor rather than overpay or crash.
    const mult = (teamId: string) => multByTeam.get(teamId) ?? cfg.min_mult;

    for (const { slot, pick: pickField, placed } of SLOT_FIELDS) {
      const pickedTeam = pick[pickField] as string;
      const points = gbSlotPoints(cfg, mult(pickedTeam));
      if (placements[placed] === pickedTeam) {
        award(`gb_${slot}`, points[slot]);
      } else if (placements.top4.has(pickedTeam)) {
        award(`gb_top4_${slot}`, points.consolation);
      }
    }

    if (scorer.leaders.has(pick.scorerId)) {
      award('gb_scorer', cfg.scorer_player);
      const diff = Math.abs(pick.scorerGoals - scorer.topGoals);
      if (diff === 0) award('gb_scorer_goals', cfg.scorer_exact);
      else if (diff === 1) award('gb_scorer_goals', cfg.scorer_close);
    }
  }
  return deltas;
}
