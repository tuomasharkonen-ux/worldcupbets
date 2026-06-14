// One-off (re-runnable) ID-mapping sync: pair our teams / matches / footballers with
// API-Football's (api-sports.io) ids, writing teams.af_team_id, matches.af_fixture_id,
// footballers.af_player_id. Nothing in the app depends on these until populated, so this
// is safe to dry-run first (the default in the route) and inspect the unmatched lists
// before committing.
//
// Strategy, in order (each stage feeds the next):
//   1. Teams   — match our team names to API-Football's, with an alias table for the
//                known WC naming differences (Korea Republic↔South Korea, IR Iran↔Iran…).
//   2. Fixtures— with teams mapped, pair each AF fixture to our match by unordered
//                team pair + kickoff date.
//   3. Players — for each mapped team, fetch its AF squad and match our footballers by
//                normalized name (then last-name fallback) within that team.
//
// Player matching only happens HERE. At settle time, AF events carry player.id, so the
// ingest adapter resolves footballers by af_player_id directly — no name-matching on the
// hot path, where abbreviated event names ("J. Quinones") would be unreliable.

import { db } from '@/lib/supabase';
import {
  getWorldCupFixtures,
  getWorldCupTeams,
  getTeamSquad,
  type AfFixture,
} from '@/lib/api-football';

// ─── name normalization ────────────────────────────────────────────────────────

// Lowercase, strip diacritics, drop everything but a-z0-9, collapse to a bare token.
function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, "") // combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Known WC team-name differences between our seed and API-Football. Both sides are
// normalized then mapped to a shared canonical token, so either spelling matches.
// Extend this from the dry-run's unmatched lists as needed.
const TEAM_CANON: Record<string, string> = {
  korearepublic: 'southkorea',
  southkorea: 'southkorea',
  koreadpr: 'northkorea',
  northkorea: 'northkorea',
  iriran: 'iran',
  iran: 'iran',
  unitedstates: 'usa',
  usa: 'usa',
  cotedivoire: 'ivorycoast',
  ivorycoast: 'ivorycoast',
  czechia: 'czechrepublic',
  czechrepublic: 'czechrepublic',
  capeverdeislands: 'capeverde',
  capeverde: 'capeverde',
  congodr: 'drcongo',
  drcongo: 'drcongo',
  drcongo2: 'drcongo',
};

function canonTeam(name: string): string {
  const n = normalize(name);
  return TEAM_CANON[n] ?? n;
}

// ─── report shape ───────────────────────────────────────────────────────────────

export interface AfMappingResult {
  dryRun: boolean;
  approxRequests: number;
  teams: {
    ours: number;
    af: number;
    matched: number;
    unmatchedOurs: string[];
    unmatchedAf: string[];
  };
  fixtures: {
    ours: number;
    af: number;
    matched: number;
    unmatchedOurs: Array<{ home: string; away: string; date: string }>;
  };
  players: {
    teamsProcessed: number;
    matched: number;
    unmatchedOurs: Array<{ team: string; name: string }>;
  };
}

const dateKey = (iso: string) => iso.slice(0, 10);
const pairKey = (a: string, b: string) => [a, b].sort().join('|');

// ─── the sync ─────────────────────────────────────────────────────────────────

export async function syncAfMappings(dryRun = false): Promise<AfMappingResult> {
  const result: AfMappingResult = {
    dryRun,
    approxRequests: 0,
    teams: { ours: 0, af: 0, matched: 0, unmatchedOurs: [], unmatchedAf: [] },
    fixtures: { ours: 0, af: 0, matched: 0, unmatchedOurs: [] },
    players: { teamsProcessed: 0, matched: 0, unmatchedOurs: [] },
  };

  // ── 1. Teams ──────────────────────────────────────────────────────────────
  const { data: ourTeamRows } = await db.from('teams').select('id, name');
  const ourTeams = (ourTeamRows ?? []) as { id: string; name: string }[];
  result.teams.ours = ourTeams.length;

  const afTeams = await getWorldCupTeams();
  result.approxRequests += 1;
  result.teams.af = afTeams.length;

  const afTeamByCanon = new Map<string, { id: number; name: string }>();
  for (const t of afTeams) afTeamByCanon.set(canonTeam(t.team.name), { id: t.team.id, name: t.team.name });

  // our team uuid → af team id (held in memory so fixtures/players work in dry runs too)
  const afTeamIdByOurId = new Map<string, number>();
  const matchedAfCanons = new Set<string>();
  for (const ot of ourTeams) {
    const af = afTeamByCanon.get(canonTeam(ot.name));
    if (af) {
      afTeamIdByOurId.set(ot.id, af.id);
      matchedAfCanons.add(canonTeam(ot.name));
      result.teams.matched++;
      if (!dryRun) await db.from('teams').update({ af_team_id: af.id }).eq('id', ot.id);
    } else {
      result.teams.unmatchedOurs.push(ot.name);
    }
  }
  result.teams.unmatchedAf = afTeams
    .filter(t => !matchedAfCanons.has(canonTeam(t.team.name)))
    .map(t => t.team.name);

  // ── 2. Fixtures ───────────────────────────────────────────────────────────
  const { data: ourMatchRows } = await db
    .from('matches')
    .select('id, home_team_id, away_team_id, kickoff_at');
  const ourMatches = (ourMatchRows ?? []) as {
    id: string;
    home_team_id: string;
    away_team_id: string;
    kickoff_at: string;
  }[];
  result.fixtures.ours = ourMatches.length;

  const afFixtures = await getWorldCupFixtures();
  result.approxRequests += 1;
  result.fixtures.af = afFixtures.length;

  // Index AF fixtures by (unordered af-team-pair + date). Both sides use AF team ids.
  const afFixtureByKey = new Map<string, AfFixture>();
  for (const f of afFixtures) {
    afFixtureByKey.set(`${pairKey(String(f.teams.home.id), String(f.teams.away.id))}@${dateKey(f.fixture.date)}`, f);
  }

  for (const m of ourMatches) {
    const homeAf = afTeamIdByOurId.get(m.home_team_id);
    const awayAf = afTeamIdByOurId.get(m.away_team_id);
    const teamNameById = new Map(ourTeams.map(t => [t.id, t.name]));
    if (homeAf == null || awayAf == null) {
      result.fixtures.unmatchedOurs.push({
        home: teamNameById.get(m.home_team_id) ?? '?',
        away: teamNameById.get(m.away_team_id) ?? '?',
        date: dateKey(m.kickoff_at),
      });
      continue;
    }
    const af = afFixtureByKey.get(`${pairKey(String(homeAf), String(awayAf))}@${dateKey(m.kickoff_at)}`);
    if (af) {
      result.fixtures.matched++;
      if (!dryRun) await db.from('matches').update({ af_fixture_id: af.fixture.id }).eq('id', m.id);
    } else {
      result.fixtures.unmatchedOurs.push({
        home: teamNameById.get(m.home_team_id) ?? '?',
        away: teamNameById.get(m.away_team_id) ?? '?',
        date: dateKey(m.kickoff_at),
      });
    }
  }

  // ── 3. Players ────────────────────────────────────────────────────────────
  const teamNameById = new Map(ourTeams.map(t => [t.id, t.name]));
  for (const [ourTeamId, afTeamId] of afTeamIdByOurId) {
    const { data: footRows } = await db
      .from('footballers')
      .select('id, name')
      .eq('team_id', ourTeamId);
    const ourFooters = (footRows ?? []) as { id: string; name: string }[];
    if (ourFooters.length === 0) continue;

    let squad: { id: number; name: string }[] = [];
    try {
      const sq = await getTeamSquad(afTeamId);
      result.approxRequests += 1;
      squad = (sq[0]?.players ?? []).map(p => ({ id: p.id, name: p.name }));
    } catch (err) {
      console.error(`[af-map] squad fetch for af team ${afTeamId} failed:`, err);
      continue;
    }
    result.players.teamsProcessed++;

    // AF squad indexed by normalized full name + by last-name token (for fallback).
    const afByNorm = new Map<string, { id: number; name: string }>();
    const afByLast = new Map<string, { id: number; name: string }[]>();
    for (const p of squad) {
      afByNorm.set(normalize(p.name), p);
      const last = normalize(p.name.split(' ').pop() ?? '');
      if (last) (afByLast.get(last) ?? afByLast.set(last, []).get(last)!).push(p);
    }

    for (const f of ourFooters) {
      let af = afByNorm.get(normalize(f.name));
      if (!af) {
        const last = normalize(f.name.split(' ').pop() ?? '');
        const cands = afByLast.get(last) ?? [];
        if (cands.length === 1) af = cands[0]; // unambiguous last-name match within the team
      }
      if (af) {
        result.players.matched++;
        if (!dryRun) await db.from('footballers').update({ af_player_id: af.id }).eq('id', f.id);
      } else {
        result.players.unmatchedOurs.push({ team: teamNameById.get(ourTeamId) ?? '?', name: f.name });
      }
    }
  }

  return result;
}
