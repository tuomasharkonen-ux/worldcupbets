// Regulation-score helper — pure function only. No DB, no fetch, no Date.
//
// Bets settle on the 90-minute result (GAME_DESIGN §"Extra time & penalty shootouts"),
// but our feed's summary score folds extra-time goals into `fullTime` and provides no
// `regularTime` (see regulationScore in lib/football-data.ts). So a knockout won in extra
// time — e.g. Belgium 2-2 Senegal, 3-2 a.e.t. — is stored with the a.e.t. scoreline unless
// we recompute the 90' score from the goal timeline, which is what this does.

import { Match, MatchEvent } from '@/types/db';

// The 90-minute (regulation) score of a knockout that ran past 90, recomputed from the goal
// timeline. Returns null when no correction is needed or the timeline can't be trusted to
// give one:
//   • a group game — never goes to extra time;
//   • no goal after minute 90 — the stored score already IS the 90' score;
//   • any goal with an unknown minute (can't tell regulation from extra time) or an
//     unresolvable scorer (can't attribute it to a side) — leave the score alone.
// Only goals at minute ≤ 90 count. Own goals credit the opponent of the scorer's team,
// mirroring the scoreboard. `teamOf` maps footballer id → team id for both squads.
export function regulationScoreFromEvents(
  match: Pick<Match, 'stage' | 'home_team_id' | 'away_team_id'>,
  events: MatchEvent[],
  teamOf: Map<string, string>,
): { home: number; away: number } | null {
  if (match.stage === 'group') return null;
  const goals = events.filter(
    e => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal',
  );
  // No extra-time goal → whatever the summary stored is already the 90' score.
  if (!goals.some(e => e.minute != null && e.minute > 90)) return null;

  let home = 0;
  let away = 0;
  for (const e of goals) {
    if (e.minute == null) return null; // can't tell regulation from extra time
    if (e.minute > 90) continue; // extra-time (or shootout) goal — excluded from the 90' score
    if (e.footballer_id == null) return null; // unknown scorer — can't attribute to a side
    const scorerTeam = teamOf.get(e.footballer_id);
    if (scorerTeam == null) return null;
    const side = e.is_own_goal
      ? scorerTeam === match.home_team_id
        ? match.away_team_id
        : match.home_team_id
      : scorerTeam;
    if (side === match.home_team_id) home++;
    else if (side === match.away_team_id) away++;
    else return null;
  }
  return { home, away };
}
