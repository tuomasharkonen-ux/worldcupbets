// Thin client for API-Football v3 (api-sports.io direct access). Server-only.
// This is the granular-stats provider: goals, cards, and lineups for finished
// matches — the data football-data.org's free tier does NOT carry (see
// docs/ARCHITECTURE.md). Used post-match by the settlement ingest.
//
// Direct api-sports.io access: base host below + the `x-apisports-key` header.
// (RapidAPI uses a different host/headers — not used here.) Free plan ≈ 100 req/day,
// which is ample: a few finished matches per day, one events + one lineups call each.

const AF_BASE = 'https://v3.football.api-sports.io';

// API-Football's competition id for the FIFA World Cup. Season is the tournament's
// start year. Overridable via env in case the id ever differs for 2026.
export const AF_WORLD_CUP_LEAGUE = Number(process.env.API_FOOTBALL_WC_LEAGUE_ID ?? 1);
export const AF_SEASON = Number(process.env.API_FOOTBALL_WC_SEASON ?? 2026);

function token(): string {
  const t = process.env.API_FOOTBALL_KEY;
  if (!t) throw new Error('API_FOOTBALL_KEY not set');
  return t;
}

// Every v3 response is wrapped: { response: [...], errors: [...] | {...}, results }.
async function afFetch<T>(path: string): Promise<T[]> {
  const res = await fetch(`${AF_BASE}${path}`, {
    headers: { 'x-apisports-key': token() },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`api-football ${path} failed: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { response: T[]; errors?: unknown };
  // v3 returns HTTP 200 even for auth/quota errors — they surface in `errors`.
  const errors = body.errors;
  const hasErrors = Array.isArray(errors) ? errors.length > 0 : errors && Object.keys(errors).length > 0;
  if (hasErrors) {
    throw new Error(`api-football ${path} returned errors: ${JSON.stringify(errors)}`);
  }
  return body.response ?? [];
}

// ─── response shapes (only the fields we consume) ──────────────────────────────

export interface AfFixture {
  fixture: { id: number; date: string; status: { short: string } };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
  goals: { home: number | null; away: number | null };
}

// /fixtures/events — type ∈ Goal | Card | subst | Var; detail refines it
// (e.g. "Normal Goal", "Own Goal", "Penalty", "Missed Penalty", "Yellow Card", "Red Card").
export interface AfEvent {
  time: { elapsed: number | null; extra: number | null };
  team: { id: number; name: string };
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  type: string;
  detail: string;
  comments: string | null;
}

export interface AfLineupPlayer {
  player: { id: number; name: string; number: number | null; pos: string | null };
}

export interface AfLineup {
  team: { id: number; name: string };
  formation: string | null;
  startXI: AfLineupPlayer[];
  substitutes: AfLineupPlayer[];
}

export interface AfSquadPlayer {
  id: number;
  name: string;
  number: number | null;
  position: string | null;
}

export interface AfTeam {
  team: { id: number; name: string; code: string | null; country: string | null };
}

// ─── calls ─────────────────────────────────────────────────────────────────────

// All World Cup fixtures for the season — used by the ID-mapping sync to pair our
// matches (by kickoff + teams) with API-Football fixture ids.
export function getWorldCupFixtures(): Promise<AfFixture[]> {
  return afFetch<AfFixture>(`/fixtures?league=${AF_WORLD_CUP_LEAGUE}&season=${AF_SEASON}`);
}

// Goals + cards for one finished fixture.
export function getFixtureEvents(fixtureId: number): Promise<AfEvent[]> {
  return afFetch<AfEvent>(`/fixtures/events?fixture=${fixtureId}`);
}

// Starting XI + substitutes per team for one fixture.
export function getFixtureLineups(fixtureId: number): Promise<AfLineup[]> {
  return afFetch<AfLineup>(`/fixtures/lineups?fixture=${fixtureId}`);
}

// All World Cup teams for the season — used by the mapping sync to pair team ids.
export function getWorldCupTeams(): Promise<AfTeam[]> {
  return afFetch<AfTeam>(`/teams?league=${AF_WORLD_CUP_LEAGUE}&season=${AF_SEASON}`);
}

// A team's squad — used to map our footballers to API-Football player ids by name.
export function getTeamSquad(afTeamId: number): Promise<{ team: { id: number }; players: AfSquadPlayer[] }[]> {
  return afFetch<{ team: { id: number }; players: AfSquadPlayer[] }>(`/players/squads?team=${afTeamId}`);
}
