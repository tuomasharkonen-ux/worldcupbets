// Tournament form for the prop picker (pure — no DB access, see the match page
// for the queries). Aggregates per-footballer appearances, goals and cards from
// already-settled matches, plus a derived "suspended for the upcoming match" flag.
//
// All stats are this-World-Cup-only by construction: match_events and
// match_appearances are populated by the settle job, so only finished,
// ingested matches contribute.

import type { EventType, MatchStage, MatchStatus } from '@/types/db';

export interface PlayerFormStats {
  /** Matches actually played (starting XI + subs on; best-effort lineup data). */
  apps: number;
  /** Goals scored — penalties count, own goals don't (mirrors scorer-bet rules). */
  goals: number;
  yellows: number;
  /** Straight reds and second-yellow reds (ingest stores both as 'red'). */
  reds: number;
  /** Banned for the upcoming match: red card, or two accumulated yellows, in the team's most recent completed match. */
  suspended: boolean;
}

export interface FormMatch {
  id: string;
  kickoff_at: string;
  status: MatchStatus;
  stage: MatchStage;
  home_team_id: string;
  away_team_id: string;
}

export interface FormEvent {
  match_id: string;
  footballer_id: string | null;
  type: EventType;
  is_own_goal: boolean;
}

export interface FormAppearance {
  match_id: string;
  footballer_id: string;
}

interface Input {
  /** Players of the two teams in the upcoming match. */
  footballers: { id: string; team_id: string }[];
  /** Both teams' non-void matches with kickoff before the upcoming match, kickoff-ascending. */
  matches: FormMatch[];
  events: FormEvent[];
  appearances: FormAppearance[];
}

// FIFA wipes single accumulated yellows after the quarterfinals, so a semifinal
// booking can't combine with a group-stage one into a ban.
const POST_WIPE_STAGES: ReadonlySet<MatchStage> = new Set(['sf', 'third', 'final']);

/**
 * Per-footballer tournament form. Players whose team has no finished prior
 * match are omitted entirely — the picker shows nothing rather than a wall of
 * zeroes on each team's first match day.
 */
export function computePlayerForm(input: Input): Map<string, PlayerFormStats> {
  const { footballers, matches, events, appearances } = input;

  const eventsByMatch = new Map<string, FormEvent[]>();
  for (const e of events) {
    if (!e.footballer_id) continue;
    const list = eventsByMatch.get(e.match_id);
    if (list) list.push(e);
    else eventsByMatch.set(e.match_id, [e]);
  }
  const appearedBy = new Map<string, Set<string>>(); // footballer → match ids
  for (const a of appearances) {
    const set = appearedBy.get(a.footballer_id);
    if (set) set.add(a.match_id);
    else appearedBy.set(a.footballer_id, new Set([a.match_id]));
  }

  // Per team: that team's prior matches, in kickoff order.
  const teamMatches = new Map<string, FormMatch[]>();
  for (const f of footballers) {
    if (!teamMatches.has(f.team_id)) {
      teamMatches.set(
        f.team_id,
        matches.filter(m => m.home_team_id === f.team_id || m.away_team_id === f.team_id),
      );
    }
  }

  const out = new Map<string, PlayerFormStats>();
  for (const f of footballers) {
    const timeline = teamMatches.get(f.team_id) ?? [];
    if (!timeline.some(m => m.status === 'finished')) continue; // cold start → no stats

    const stats: PlayerFormStats = { apps: 0, goals: 0, yellows: 0, reds: 0, suspended: false };
    const appearedIn = appearedBy.get(f.id);

    // Walk the team's matches in order, tracking yellow accumulation. A red or a
    // second accumulated yellow bans the player from the team's NEXT match — so the
    // flag only sticks when the trigger is the team's most recent prior match
    // (anything in between, played or not, serves the ban instead).
    let yellowCount = 0;
    let banAfterIndex = -1;
    let wiped = false;
    timeline.forEach((m, i) => {
      if (!wiped && POST_WIPE_STAGES.has(m.stage)) {
        yellowCount = 0;
        wiped = true;
      }
      if (appearedIn?.has(m.id)) stats.apps += 1;
      for (const e of eventsByMatch.get(m.id) ?? []) {
        if (e.footballer_id !== f.id) continue;
        if ((e.type === 'goal' || e.type === 'penalty') && !e.is_own_goal) stats.goals += 1;
        if (e.type === 'yellow') {
          stats.yellows += 1;
          yellowCount += 1;
          if (yellowCount >= 2) {
            banAfterIndex = i;
            yellowCount = 0;
          }
        }
        if (e.type === 'red') {
          stats.reds += 1;
          banAfterIndex = i;
        }
      }
    });
    stats.suspended =
      banAfterIndex !== -1 &&
      banAfterIndex === timeline.length - 1 &&
      timeline[banAfterIndex].status === 'finished';

    out.set(f.id, stats);
  }
  return out;
}
