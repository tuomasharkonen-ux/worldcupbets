import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron';
import { db } from '@/lib/supabase';

// Dev-only endpoint — blocked in production.
// Marks a match as finished with a given score so the settle cron can pick it up.
//
// Usage:
//   POST /api/dev/finish-match
//   Body: { "matchId": "<uuid>", "homeScore": 2, "awayScore": 1 }
//
// After calling this, trigger settlement:
//   GET /api/cron/settle  (with Authorization: Bearer <CRON_SECRET>)

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.matchId || body.homeScore == null || body.awayScore == null) {
    return NextResponse.json(
      { error: 'Body must be { matchId, homeScore, awayScore }' },
      { status: 400 },
    );
  }

  const { matchId, homeScore, awayScore } = body as {
    matchId: string;
    homeScore: number;
    awayScore: number;
  };

  // Back-date kickoff to the past so the settle cron's lock check passes,
  // then mark finished — bets that are still pending will be settled.
  const { error } = await db
    .from('matches')
    .update({
      status: 'finished',
      home_score: homeScore,
      away_score: awayScore,
      kickoff_at: new Date(Date.now() - 120 * 60 * 1000).toISOString(), // 2 h ago
      settled_at: null, // ensure settle cron picks it up
    })
    .eq('id', matchId)
    .is('settled_at', null); // safety: don't re-open an already-settled match

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    matchId,
    score: `${homeScore}–${awayScore}`,
    next: 'GET /api/cron/settle  (Authorization: Bearer <CRON_SECRET>)',
  });
}
