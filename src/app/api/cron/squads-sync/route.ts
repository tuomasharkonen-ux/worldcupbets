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

// Note text squads-sync owns: only flags it wrote itself get auto-cleared when a
// player reappears on the list, so manual injury flags survive re-runs.
const WITHDRAWN_NOTE = 'Withdrawn from squad';

async function syncSquads(): Promise<{ teams: number; players: number; withdrawn: number }> {
  const { teams } = await getCompetitionTeams();

  let teamsTouched = 0;
  let playersUpserted = 0;
  let playersWithdrawn = 0;

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

    const squadIds = squad.map(p => p.id);
    const now = new Date().toISOString();

    // Players we synced earlier who have dropped off the official list were
    // replaced (injury withdrawal). Keep their rows — bets may reference them —
    // but mark them out so the picker warns about them.
    const { data: withdrawn, error: outError } = await db
      .from('footballers')
      .update({ availability: 'out', availability_note: WITHDRAWN_NOTE, availability_updated_at: now })
      .eq('team_id', team.id)
      .not('fd_player_id', 'is', null)
      .not('fd_player_id', 'in', `(${squadIds.join(',')})`)
      .neq('availability', 'out')
      .select('id');
    if (outError) throw outError;
    playersWithdrawn += withdrawn?.length ?? 0;

    // If a previously-withdrawn player is back on the list, clear our own flag.
    const { error: backError } = await db
      .from('footballers')
      .update({ availability: 'fit', availability_note: null, availability_updated_at: now })
      .eq('team_id', team.id)
      .in('fd_player_id', squadIds)
      .eq('availability', 'out')
      .eq('availability_note', WITHDRAWN_NOTE);
    if (backError) throw backError;

    teamsTouched++;
    playersUpserted += rows.length;
  }

  return { teams: teamsTouched, players: playersUpserted, withdrawn: playersWithdrawn };
}
