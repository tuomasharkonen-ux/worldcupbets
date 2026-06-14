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

// Letters NFD doesn't decompose to ASCII \u2014 chiefly Turkish dotless \u0131 (which would
// otherwise be *deleted*, leaving "\u00c7ak\u0131r"\u2192"cakr" vs AF's "Cakir"\u2192"cakir"), plus the
// usual Nordic/Slavic base letters. Folded before the a-z0-9 filter so both sides land
// on the same spelling.
const FOLD: Record<string, string> = {
  \u0131: 'i', \u0130: 'i', \u0142: 'l', \u0141: 'l', \u00f8: 'o', \u00d8: 'o', \u0111: 'd', \u0110: 'd',
  \u00f0: 'd', \u00d0: 'd', \u00fe: 'th', \u00de: 'th', \u00df: 'ss', \u00e6: 'ae', \u00c6: 'ae', \u0153: 'oe', \u0152: 'oe', \u014b: 'n',
};

// Diacritics stripped, special base letters folded, lowercased. The shared front-end of
// both normalize() and tokens().
function fold(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritical marks
    .replace(/[\u0131\u0130\u0142\u0141\u00f8\u00d8\u0111\u0110\u00f0\u00d0\u00fe\u00de\u00df\u00e6\u00c6\u0153\u0152\u014b]/g, c => FOLD[c] ?? c)
    .toLowerCase();
}

// Drop everything but a-z0-9, collapse to a bare token (team names).
function normalize(name: string): string {
  return fold(name).replace(/[^a-z0-9]/g, '');
}

// Split a name into normalized word tokens. Robust to name ORDER (AF stores "Son
// Heung-Min" family-first vs our "Heung-min Son") and accents.
function tokens(name: string): string[] {
  return fold(name)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Order-invariant match keys for a name: the sorted token set, PLUS a variant with
// hyphens joined rather than split \u2014 so "Hwang Heechan" and AF's "Hwang Hee-Chan" share
// a key (Korean/Arabic syllable hyphenation), without breaking genuinely separate
// hyphenated surnames (which still match via the split variant).
function nameKeys(name: string): string[] {
  const folded = fold(name);
  const split = folded.split(/[^a-z0-9]+/).filter(Boolean);
  const joined = folded.replace(/[-'\u2019\u00b7]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  const keys = new Set<string>([[...split].sort().join(' '), [...joined].sort().join(' ')]);
  return [...keys];
}

// a \u2286 b \u2014 every token of a appears in b (used for the mononym/abbreviation fallback).
const isSubset = (a: string[], b: string[]) => a.every(t => b.includes(t));

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
  turkey: 'turkey',
  turkiye: 'turkey',
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

    // Match our footballers to AF squad players in precision tiers. `used` stops two of
    // our players claiming the same AF id; we stop a player at the first tier that yields
    // a *unique* candidate, so a tighter rule always beats a looser one.
    const used = new Set<number>();
    const matchOf = new Map<string, { id: number; name: string }>();

    // Tier 1 — order/accent/hyphen-invariant token-set equality (handles the SK reorder
    // and Korean syllable hyphenation). A player registers under each of its name keys.
    const afByKey = new Map<string, { id: number; name: string }[]>();
    for (const p of squad) {
      for (const k of nameKeys(p.name)) (afByKey.get(k) ?? afByKey.set(k, []).get(k)!).push(p);
    }
    for (const f of ourFooters) {
      const cands = new Map<number, { id: number; name: string }>();
      for (const k of nameKeys(f.name)) {
        for (const p of afByKey.get(k) ?? []) if (!used.has(p.id)) cands.set(p.id, p);
      }
      if (cands.size === 1) {
        const p = [...cands.values()][0];
        matchOf.set(f.id, p);
        used.add(p.id);
      }
    }

    // Tier 2 — first-initial + surname (last token), unique. Splits same-surname pairs
    // (Theo vs Lucas Hernández) and catches AF's abbreviated squad names ("T. Hernández").
    for (const f of ourFooters) {
      if (matchOf.has(f.id)) continue;
      const ft = tokens(f.name);
      if (ft.length === 0) continue;
      const fInit = ft[0][0];
      const fLast = ft[ft.length - 1];
      const cands = squad.filter(p => {
        if (used.has(p.id)) return false;
        const pt = tokens(p.name);
        return pt.length > 0 && pt[pt.length - 1] === fLast && pt[0][0] === fInit;
      });
      if (cands.length === 1) {
        matchOf.set(f.id, cands[0]);
        used.add(cands[0].id);
      }
    }

    // Tier 3 — one token set is a subset of the other, unique (mononyms/extra middle
    // names: AF "Cubarsí" ⊆ our "Pau Cubarsí"). Uniqueness keeps ambiguous cases (two
    // Danilos, the many Senegalese Sarrs) safely unmatched rather than mis-mapped.
    for (const f of ourFooters) {
      if (matchOf.has(f.id)) continue;
      const ft = tokens(f.name);
      if (ft.length === 0) continue;
      const cands = squad.filter(p => {
        if (used.has(p.id)) return false;
        const pt = tokens(p.name);
        return pt.length > 0 && (isSubset(ft, pt) || isSubset(pt, ft));
      });
      if (cands.length === 1) {
        matchOf.set(f.id, cands[0]);
        used.add(cands[0].id);
      }
    }

    for (const f of ourFooters) {
      const af = matchOf.get(f.id);
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
