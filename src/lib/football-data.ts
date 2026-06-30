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

// football-data's `score` block. `fullTime` is the *aggregate* result for a knockout
// that goes the distance — it folds in extra-time goals and the penalty-shootout tally
// (a 1-1 decided on penalties 3-4 is reported as fullTime 4-5). `regularTime` holds the
// 90-minute score and is present only when `duration` isn't REGULAR; for a 90-minute
// match it's absent and `fullTime` already is the regulation score. See regulationScore.
export interface FdScore {
  winner?: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
  duration?: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT' | string;
  fullTime?: { home: number | null; away: number | null };
  regularTime?: { home: number | null; away: number | null };
}

// One row of GET /competitions/{code}/matches — just the fields status sync needs.
export interface FdMatchSummary {
  id: number;
  status: string;
  utcDate: string;
  score?: FdScore;
}

// The 90-minute (regulation) score. Bets settle on the result at full time EXCLUDING
// extra time and the shootout (GAME_DESIGN §"Penalty shootouts" — the league fixed this:
// a knockout level after 90 is a draw for Outcome/Exact, the shootout only decides
// `winner_team_id`). Read `regularTime` when football-data provides it (knockouts that
// ran past 90); otherwise `fullTime` is already the 90-minute score. Single source of
// truth so the settle sweep and the daily fixtures-sync can never disagree on what a
// score "is".
export function regulationScore(score?: FdScore): { home: number | null; away: number | null } {
  return {
    home: score?.regularTime?.home ?? score?.fullTime?.home ?? null,
    away: score?.regularTime?.away ?? score?.fullTime?.away ?? null,
  };
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

// Competition matches in a UTC date window (YYYY-MM-DD, inclusive). One call covers
// a whole match day — used by the settle cron to flip statuses without per-match fetches.
export function getCompetitionMatches(
  dateFrom: string,
  dateTo: string,
): Promise<{ matches: FdMatchSummary[] }> {
  return fdFetch<{ matches: FdMatchSummary[] }>(
    `/competitions/${WC_COMPETITION}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
  );
}

// football-data status → our matches.status enum. Shared by fixtures-sync and the
// settle cron's status sweep so the two can never drift.
export function mapFdStatus(fdStatus: string): 'scheduled' | 'live' | 'finished' | 'void' {
  const map: Record<string, 'scheduled' | 'live' | 'finished' | 'void'> = {
    SCHEDULED: 'scheduled',
    TIMED: 'scheduled',
    IN_PLAY: 'live',
    PAUSED: 'live',
    FINISHED: 'finished',
    SUSPENDED: 'void',
    POSTPONED: 'void',
    CANCELLED: 'void',
  };
  return map[fdStatus] ?? 'scheduled';
}
