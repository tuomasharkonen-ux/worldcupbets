// Thin client for football-data.org v4. Server-only.
// Centralises base URL, auth header, and the response shapes Phase 2 needs
// (match detail with goals/bookings/lineups, and competition squads).

const FD_BASE = 'https://api.football-data.org/v4';
export const WC_COMPETITION = 'WC'; // World Cup 2026 competition code

function token(): string {
  const t = process.env.FOOTBALL_DATA_TOKEN;
  if (!t) throw new Error('FOOTBALL_DATA_TOKEN not set');
  return t;
}

async function fdFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${FD_BASE}${path}`, {
    headers: { 'X-Auth-Token': token() },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`football-data ${path} failed: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// ─── response shapes (only the fields we consume) ──────────────────────────────

export interface FdPlayer {
  id: number;
  name: string;
  position?: string | null;
  shirtNumber?: number | null;
}

export interface FdGoal {
  minute: number | null;
  type: 'REGULAR' | 'OWN' | 'PENALTY' | string;
  team: { id: number };
  scorer: { id: number; name: string } | null;
}

export interface FdBooking {
  minute: number | null;
  team: { id: number };
  player: { id: number; name: string };
  card: 'YELLOW' | 'RED' | 'YELLOW_RED' | string;
}

export interface FdSubstitution {
  minute: number | null;
  team: { id: number };
  playerIn: { id: number; name: string } | null;
  playerOut: { id: number; name: string } | null;
}

export interface FdMatchSide {
  id: number;
  name: string;
  lineup?: FdPlayer[];
  bench?: FdPlayer[];
}

// GET /matches/{id} returns the match object at the top level in v4.
export interface FdMatchDetail {
  id: number;
  status: string;
  homeTeam: FdMatchSide;
  awayTeam: FdMatchSide;
  goals?: FdGoal[];
  bookings?: FdBooking[];
  substitutions?: FdSubstitution[];
}

export interface FdTeamWithSquad {
  id: number;
  name: string;
  tla?: string | null;
  shortName?: string | null;
  crest?: string | null;
  squad?: FdPlayer[];
}

// ─── calls ─────────────────────────────────────────────────────────────────────

export function getMatchDetail(fdMatchId: number): Promise<FdMatchDetail> {
  return fdFetch<FdMatchDetail>(`/matches/${fdMatchId}`);
}

// Competition teams. The free tier embeds a (sometimes partial) `squad` per team.
export function getCompetitionTeams(): Promise<{ teams: FdTeamWithSquad[] }> {
  return fdFetch<{ teams: FdTeamWithSquad[] }>(`/competitions/${WC_COMPETITION}/teams`);
}
