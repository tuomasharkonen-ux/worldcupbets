import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron';
import { db } from '@/lib/supabase';

// Dev-only endpoint — blocked in production.
// Creates a test match and two placeholder teams.
//
// Usage:
//   GET /api/dev/seed-match
//     → kickoff in 3 minutes (time to place bets before the lock)
//   GET /api/dev/seed-match?locked=true
//     → kickoff already passed (bets immediately locked; skip straight to finish-match)
//
// Requires Authorization: Bearer <CRON_SECRET> header.

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const locked = req.nextUrl.searchParams.get('locked') === 'true';
  const kickoffOffset = locked ? -5 * 60 * 1000 : 3 * 60 * 1000; // -5 min or +3 min
  const kickoffAt = new Date(Date.now() + kickoffOffset).toISOString();

  // Upsert two placeholder teams
  const teamA = await upsertTeam({
    name: 'Test United',
    country_code: 'TUT',
    fd_team_id: 999001,
    flag_url: null,
  });
  const teamB = await upsertTeam({
    name: 'Dev City',
    country_code: 'DVC',
    fd_team_id: 999002,
    flag_url: null,
  });

  // Insert a new test match (always a new row so multiple test rounds work)
  const { data: match, error } = await db
    .from('matches')
    .insert({
      fd_match_id: Date.now(), // unique per seed call
      stage: 'group',
      group_label: 'T',
      home_team_id: teamA.id,
      away_team_id: teamB.id,
      kickoff_at: kickoffAt,
      status: 'scheduled',
      glory_multiplier: 1.0,
    })
    .select('id, kickoff_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    matchId: match.id,
    kickoff_at: match.kickoff_at,
    locked,
    next: locked
      ? `POST /api/dev/finish-match  body: { "matchId": "${match.id}", "homeScore": 2, "awayScore": 1 }`
      : `Place bets at /matches/${match.id}, then in 3 min POST /api/dev/finish-match`,
  });
}

async function upsertTeam(team: {
  name: string;
  country_code: string;
  fd_team_id: number;
  flag_url: string | null;
}): Promise<{ id: string }> {
  const { data } = await db
    .from('teams')
    .upsert(team, { onConflict: 'fd_team_id' })
    .select('id')
    .single();
  return data as { id: string };
}
