// Server-side loaders for the Golden Bracket special bet (migration 016) — the
// betting window, the 8 quarter-finalists with their underdog multipliers, the
// top-scorer board for the picker, and a manager's saved bracket. The point values
// come from src/settlement/golden-bracket.ts (shared with settlement) so what the
// wizard shows and what settlement pays can never drift.

import { db } from '@/lib/supabase';
import { computePlayerForm, type FormAppearance, type FormEvent, type FormMatch } from '@/lib/player-form';
import { gbMultiplier, gbSlotPoints, type GbSlotPoints } from '@/settlement/golden-bracket';
import type { Footballer, GoldenBracket, GoldenBracketConfig, Team } from '@/types/db';

// The betting window: opens once all 8 quarter-finalists are known (the feed only
// assigns knockout teams when they've qualified), locks at the first QF kickoff.
export interface GoldenBracketWindow {
  teamIds: string[]; // the 8 quarter-finalists
  lockAt: string; // ISO kickoff of the first QF
}

export async function getGoldenBracketWindow(): Promise<GoldenBracketWindow | null> {
  const { data } = await db
    .from('matches')
    .select('kickoff_at, home_team_id, away_team_id')
    .eq('stage', 'qf')
    .neq('status', 'void')
    .order('kickoff_at', { ascending: true });
  const rows = (data ?? []) as { kickoff_at: string; home_team_id: string; away_team_id: string }[];
  if (rows.length === 0) return null;

  const teamIds = [...new Set(rows.flatMap(m => [m.home_team_id, m.away_team_id]))];
  // Partially-drawn bracket (or placeholder fixtures) → not open yet.
  if (teamIds.length !== 8) return null;
  return { teamIds, lockAt: rows[0].kickoff_at };
}

// One quarter-finalist as the wizard needs it: identity + multiplier + what every
// slot pays for this team.
export interface GbTeamOption {
  id: string;
  name: string;
  country_code: string;
  mult: number;
  points: GbSlotPoints;
}

// The 8 QF teams with multipliers and slot values. Returns null (and logs loudly)
// if any of them is missing gb_odds — a silent min_mult fallback would UNDERPAY an
// underdog pick, and the fix is a one-line SQL update on teams.gb_odds.
export async function getGbTeams(
  window: GoldenBracketWindow,
  cfg: GoldenBracketConfig,
): Promise<GbTeamOption[] | null> {
  const { data } = await db
    .from('teams')
    .select('id, name, country_code, gb_odds')
    .in('id', window.teamIds);
  const teams = (data ?? []) as Pick<Team, 'id' | 'name' | 'country_code' | 'gb_odds'>[];

  const missing = window.teamIds.filter(id => teams.find(t => t.id === id)?.gb_odds == null);
  if (missing.length > 0) {
    console.error(
      `[golden-bracket] gb_odds missing for QF team(s) ${missing.join(', ')} — ` +
        'window stays closed until teams.gb_odds is seeded for them.',
    );
    return null;
  }

  return teams
    .map(t => {
      const mult = gbMultiplier(t.gb_odds, cfg);
      return { id: t.id, name: t.name, country_code: t.country_code, mult, points: gbSlotPoints(cfg, mult) };
    })
    .sort((a, b) => a.mult - b.mult || a.name.localeCompare(b.name));
}

// One row of the top-scorer picker: every player still alive (the 8 QF squads),
// with tournament goals + matches played so the current Boot race sorts on top.
export interface GbScorerOption {
  id: string;
  teamId: string;
  name: string;
  position: string | null;
  availability: Footballer['availability'];
  goals: number;
  apps: number;
}

export async function getScorerBoard(window: GoldenBracketWindow): Promise<GbScorerOption[]> {
  const teamIds = window.teamIds;
  const { data: playerRows } = await db
    .from('footballers')
    .select('id, name, position, team_id, availability')
    .in('team_id', teamIds)
    .order('squad_number', { ascending: true });
  const players = (playerRows ?? []) as Pick<
    Footballer,
    'id' | 'name' | 'position' | 'team_id' | 'availability'
  >[];
  if (players.length === 0) return [];

  // The QF squads' own matches carry every goal these players have scored.
  const { data: matchRows } = await db
    .from('matches')
    .select('id, kickoff_at, status, stage, home_team_id, away_team_id')
    .or(`home_team_id.in.(${teamIds.join(',')}),away_team_id.in.(${teamIds.join(',')})`)
    .neq('status', 'void')
    .order('kickoff_at', { ascending: true });
  const matches = (matchRows ?? []) as FormMatch[];
  const matchIds = matches.map(m => m.id);

  let events: FormEvent[] = [];
  let appearances: FormAppearance[] = [];
  if (matchIds.length > 0) {
    const [{ data: ev }, { data: ap }] = await Promise.all([
      db.from('match_events').select('match_id, footballer_id, type, is_own_goal').in('match_id', matchIds),
      db.from('match_appearances').select('match_id, footballer_id').in('match_id', matchIds),
    ]);
    events = (ev ?? []) as FormEvent[];
    appearances = (ap ?? []) as FormAppearance[];
  }

  const form = computePlayerForm({ footballers: players, matches, events, appearances });
  return players
    .map(p => {
      const f = form.get(p.id);
      return {
        id: p.id,
        teamId: p.team_id,
        name: p.name,
        position: p.position,
        availability: p.availability,
        goals: f?.goals ?? 0,
        apps: f?.apps ?? 0,
      };
    })
    .sort((a, b) => b.goals - a.goals || b.apps - a.apps || a.name.localeCompare(b.name));
}

export async function getMyBracket(managerId: string): Promise<GoldenBracket | null> {
  const { data } = await db
    .from('golden_brackets')
    .select('*')
    .eq('manager_id', managerId)
    .maybeSingle<GoldenBracket>();
  return data ?? null;
}
