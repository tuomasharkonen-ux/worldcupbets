import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron';
import { db } from '@/lib/supabase';
import { mapFdStatus, regulationScore } from '@/lib/football-data';
import { reSettleCorrectedMatch } from '@/settlement/run';

// Vercel Cron: daily at 06:00 UTC — pulls fixtures + teams from football-data.org
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = process.env.FOOTBALL_DATA_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'FOOTBALL_DATA_TOKEN not set' }, { status: 500 });
  }

  try {
    const synced = await syncFixtures(token);
    return NextResponse.json({ ok: true, synced });
  } catch (err) {
    console.error('[fixtures-sync] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

const FD_BASE = 'https://api.football-data.org/v4';
const WC_COMPETITION = 'WC'; // football-data.org competition code for World Cup 2026

async function syncFixtures(token: string): Promise<{ matches: number; teams: number; corrected: number }> {
  const headers = { 'X-Auth-Token': token };

  // --- teams ---
  const teamsRes = await fetch(`${FD_BASE}/competitions/${WC_COMPETITION}/teams`, { headers });
  if (!teamsRes.ok) throw new Error(`teams fetch failed: ${teamsRes.status}`);
  const teamsData = await teamsRes.json();

  let teamsUpserted = 0;
  for (const t of teamsData.teams ?? []) {
    const countryCode = (t.tla ?? t.shortName ?? t.name).slice(0, 3).toUpperCase();
    const { error } = await db.from('teams').upsert(
      {
        name: t.name,
        country_code: countryCode,
        flag_url: t.crest ?? null,
        fd_team_id: t.id,
      },
      { onConflict: 'fd_team_id' },
    );
    if (error) throw error;
    teamsUpserted++;
  }

  // --- matches ---
  const matchesRes = await fetch(`${FD_BASE}/competitions/${WC_COMPETITION}/matches`, { headers });
  if (!matchesRes.ok) throw new Error(`matches fetch failed: ${matchesRes.status}`);
  const matchesData = await matchesRes.json();

  let matchesUpserted = 0;
  let corrected = 0;
  for (const m of matchesData.matches ?? []) {
    // Look up internal team UUIDs by fd_team_id
    const { data: homeTeam } = await db
      .from('teams')
      .select('id')
      .eq('fd_team_id', m.homeTeam.id)
      .single();
    const { data: awayTeam } = await db
      .from('teams')
      .select('id')
      .eq('fd_team_id', m.awayTeam.id)
      .single();

    if (!homeTeam || !awayTeam) continue;

    const stage = resolveStage(m);
    const status = mapFdStatus(m.status);
    // Bets settle on the 90-minute result, so store regulation time — never the feed's
    // `fullTime`, which folds in extra time + the shootout tally for knockouts (see
    // regulationScore).
    const reg = regulationScore(m.score);

    // For a finished match, read the current row once: needed both to detect a
    // post-settlement score correction (priorSettled below) AND to avoid clobbering the
    // event-derived 90' score. Only a finished match can carry settled bets or a corrected
    // score, so we skip this read otherwise — the daily sync's egress stays flat.
    type ExistingRow = {
      id: string;
      home_score: number | null;
      away_score: number | null;
      status: string;
      settled_at: string | null;
    };
    let existing: ExistingRow | null = null;
    if (status === 'finished') {
      const { data } = await db
        .from('matches')
        .select('id, home_score, away_score, status, settled_at')
        .eq('fd_match_id', m.id)
        .maybeSingle();
      existing = (data ?? null) as ExistingRow | null;
    }

    // When reg.certain is false the summary can't give us the 90' result — a knockout that
    // ran past 90 with no `regularTime` (our feed publishes only the a.e.t. `fullTime`). The
    // authoritative 90' score for such a match is the one settlement recomputed from the goal
    // timeline (regulationScoreFromEvents), so keep the stored value instead of overwriting it
    // with the a.e.t. scoreline. A fresh, not-yet-settled row (no stored score) still takes the
    // provisional summary score; settlement corrects it at settle time.
    const newHome = reg.certain ? reg.home : existing?.home_score ?? reg.home;
    const newAway = reg.certain ? reg.away : existing?.away_score ?? reg.away;

    // Post-settlement score-correction detection. This upsert is the only writer that
    // touches a match's score once it's finished (syncStartedMatchStatuses skips finished
    // rows), so if it changes the score/status of an ALREADY-settled match, the bets were
    // graded against the old score and nothing else will revisit them. Capture the prior
    // row so we can re-grade just this match afterward.
    const priorSettled: { id: string; home_score: number | null; away_score: number | null; status: string } | null =
      existing?.settled_at
        ? {
            id: existing.id,
            home_score: existing.home_score,
            away_score: existing.away_score,
            status: existing.status,
          }
        : null;

    // The true winner — needed for the favorite-team ladder. The stored score is the
    // 90-minute result (a draw for a knockout that went to penalties), so winner can't be
    // derived from it; score.winner reflects the actual result (incl. extra time /
    // shootout). DRAW or unfinished → null.
    const winnerTeamId =
      m.score?.winner === 'HOME_TEAM'
        ? homeTeam.id
        : m.score?.winner === 'AWAY_TEAM'
          ? awayTeam.id
          : null;

    const { error } = await db.from('matches').upsert(
      {
        fd_match_id: m.id,
        stage,
        group_label: m.group?.replace('GROUP_', '') ?? null,
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
        kickoff_at: m.utcDate,
        status,
        home_score: newHome,
        away_score: newAway,
        winner_team_id: winnerTeamId,
        glory_multiplier: pointsMultiplier(stage),
      },
      { onConflict: 'fd_match_id' },
    );
    if (error) throw error;
    matchesUpserted++;

    // A correction landed on an already-settled match → re-grade its bets and reconcile
    // the ledger so the fix reaches managers' Points. Best-effort: a re-settle failure
    // must not abort the rest of the sync.
    if (
      priorSettled &&
      (priorSettled.home_score !== newHome ||
        priorSettled.away_score !== newAway ||
        priorSettled.status !== status)
    ) {
      try {
        const changes = await reSettleCorrectedMatch(priorSettled.id);
        if (changes.length > 0) {
          corrected += changes.length;
          console.log(
            `[fixtures-sync] match ${priorSettled.id} corrected ` +
              `${priorSettled.home_score}-${priorSettled.away_score} → ${newHome}-${newAway}; ` +
              `re-graded ${changes.length} bet(s)`,
          );
        }
      } catch (err) {
        console.error(`[fixtures-sync] re-settle of corrected match ${priorSettled.id} failed:`, err);
      }
    }
  }

  return { matches: matchesUpserted, teams: teamsUpserted, corrected };
}

function mapStage(fdStage: string): string {
  const map: Record<string, string> = {
    GROUP_STAGE: 'group',
    ROUND_OF_32: 'r32',
    LAST_16: 'r16',
    QUARTER_FINALS: 'qf',
    SEMI_FINALS: 'sf',
    THIRD_PLACE: 'third',
    FINAL: 'final',
  };
  return map[fdStage] ?? 'group';
}

// football-data's `stage` field for the 48-team WC2026 knockout rounds doesn't reliably
// match the `ROUND_OF_32` etc. literals above — confirmed empirically: the 16 round-of-32
// fixtures (2026-06-28 to 2026-07-03, kickoff dates only, no `group`) all landed on the
// `?? 'group'` fallback above and silently passed as group-stage matches, which meant the
// favorite-team "out of group" milestone (settlement/favorites.ts) never fired for anyone.
// The 2026 WC schedule's stage windows are fixed and published months ahead — only the teams
// in each match are unknown beforehand — so for any match with no `group` (i.e. a knockout
// fixture), derive the stage from its kickoff date instead of trusting the API's stage string.
const KNOCKOUT_STAGE_BOUNDARIES: [string, string][] = [
  ['2026-06-28T00:00:00Z', 'r32'],
  ['2026-07-04T00:00:00Z', 'r16'],
  ['2026-07-09T00:00:00Z', 'qf'],
  ['2026-07-14T00:00:00Z', 'sf'],
  ['2026-07-18T00:00:00Z', 'third'],
  ['2026-07-19T00:00:00Z', 'final'],
];

function knockoutStageForDate(utcDate: string): string {
  const t = new Date(utcDate).getTime();
  let stage = 'r32';
  for (const [boundary, s] of KNOCKOUT_STAGE_BOUNDARIES) {
    if (t >= new Date(boundary).getTime()) stage = s;
  }
  return stage;
}

function resolveStage(m: { stage: string; group?: string | null; utcDate: string }): string {
  if (m.group) return 'group';
  const dateStage = knockoutStageForDate(m.utcDate);
  const apiStage = mapStage(m.stage);
  if (apiStage !== 'group' && apiStage !== dateStage) {
    console.warn(
      `[fixtures-sync] stage mismatch at ${m.utcDate}: football-data stage='${m.stage}' ` +
        `mapped to '${apiStage}', but the fixed schedule says '${dateStage}' — using the schedule.`,
    );
  }
  return dateStage;
}

function pointsMultiplier(stage: string): number {
  // Knockout-only amplification: group → R16 stay flat, multipliers kick in from the
  // quarter-finals (GAME_DESIGN §3). Keep in sync with config.glory_multipliers.
  const map: Record<string, number> = {
    group: 1.0,
    r32: 1.0,
    r16: 1.0,
    qf: 1.5,
    sf: 1.75,
    third: 1.75,
    final: 2.0,
  };
  return map[stage] ?? 1.0;
}
