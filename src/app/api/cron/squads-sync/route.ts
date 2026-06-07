import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron';
import { db } from '@/lib/supabase';
import { getCompetitionTeams } from '@/lib/football-data';

// Manual-trigger sync: pulls 26-man squads from football-data.org into
// `footballers`. Heavy (one team at a time) and only needs running once squads
// are confirmed (~June 1) and again if a team revises its list. Not on a Vercel
// cron — trigger by hand with the CRON_SECRET when ready.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/squads-sync
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const synced = await syncSquads();
    return NextResponse.json({ ok: true, ...synced });
  } catch (err) {
    console.error('[squads-sync] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function syncSquads(): Promise<{ teams: number; players: number }> {
  const { teams } = await getCompetitionTeams();

  let teamsTouched = 0;
  let playersUpserted = 0;

  for (const t of teams ?? []) {
    // Resolve our internal team UUID via the football-data team id.
    const { data: team } = await db.from('teams').select('id').eq('fd_team_id', t.id).single();
    if (!team) continue; // team not in our fixtures yet — fixtures-sync runs first

    const squad = t.squad ?? [];
    if (squad.length === 0) continue;

    // Upsert keyed on fd_player_id keeps each footballer's UUID stable across
    // re-runs (bet selections reference that UUID).
    const rows = squad.map(p => ({
      team_id: team.id,
      name: p.name,
      position: p.position ?? null,
      squad_number: p.shirtNumber ?? null,
      fd_player_id: p.id,
    }));

    const { error } = await db.from('footballers').upsert(rows, { onConflict: 'fd_player_id' });
    if (error) throw error;

    teamsTouched++;
    playersUpserted += rows.length;
  }

  return { teams: teamsTouched, players: playersUpserted };
}
