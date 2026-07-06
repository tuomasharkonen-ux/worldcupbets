import type { AfEvent } from '@/lib/api-football';
import type { EventType } from '@/types/db';

// One match_events row as produced from the API-Football feed. Mirrors
// FetchedMatchData['eventRows'] in run.ts — kept here so the mapping stays pure
// and unit-testable (run.ts pulls in the DB client and can't load under Jest).
export interface AfMatchEventRow {
  match_id: string;
  footballer_id: string | null;
  type: EventType;
  minute: number | null;
  is_own_goal: boolean;
}

// AF tags shootout kicks as ordinary Goal/Penalty (or Missed Penalty) events,
// distinguished only by `comments: "Penalty Shootout"`. They are not goals —
// counting them inflates scorer tallies, player form, and favorite-player bonuses.
export function isShootoutKick(e: AfEvent): boolean {
  return e.comments?.toLowerCase().includes('penalty shootout') ?? false;
}

// Map one API-Football event to a match_events row, or null for events we don't
// store (substitutions, VAR, missed penalties, shootout kicks).
export function afEventToRow(
  e: AfEvent,
  byAfId: Map<number, string>,
  matchId: string,
): AfMatchEventRow | null {
  const fid = e.player?.id != null ? byAfId.get(e.player.id) ?? null : null;
  const minute = e.time?.elapsed ?? null;

  if (e.type === 'Goal') {
    if (e.detail === 'Missed Penalty') return null;
    if (isShootoutKick(e)) return null;
    const isOwn = e.detail === 'Own Goal';
    const type: EventType = isOwn ? 'own_goal' : e.detail === 'Penalty' ? 'penalty' : 'goal';
    return { match_id: matchId, footballer_id: fid, type, minute, is_own_goal: isOwn };
  }
  if (e.type === 'Card') {
    if (e.detail !== 'Yellow Card' && e.detail !== 'Red Card') return null;
    const type: EventType = e.detail === 'Red Card' ? 'red' : 'yellow';
    return { match_id: matchId, footballer_id: fid, type, minute, is_own_goal: false };
  }
  return null;
}
