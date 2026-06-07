import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron';
import { db } from '@/lib/supabase';

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

async function syncFixtures(token: string): Promise<{ matches: number; teams: number }> {
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

    const stage = mapStage(m.stage);
    const status = mapStatus(m.status);

    const { error } = await db.from('matches').upsert(
      {
        fd_match_id: m.id,
        stage,
        group_label: m.group?.replace('GROUP_', '') ?? null,
        home_team_id: homeTeam.id,
        away_team_id: awayTeam.id,
        kickoff_at: m.utcDate,
        status,
        home_score: m.score?.fullTime?.home ?? null,
        away_score: m.score?.fullTime?.away ?? null,
        glory_multiplier: gloryMultiplier(stage),
      },
      { onConflict: 'fd_match_id' },
    );
    if (error) throw error;
    matchesUpserted++;
  }

  return { matches: matchesUpserted, teams: teamsUpserted };
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

function mapStatus(fdStatus: string): string {
  const map: Record<string, string> = {
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

function gloryMultiplier(stage: string): number {
  const map: Record<string, number> = {
    group: 1.0,
    r32: 1.25,
    r16: 1.5,
    qf: 1.75,
    sf: 1.75,
    third: 1.5,
    final: 2.0,
  };
  return map[stage] ?? 1.0;
}
