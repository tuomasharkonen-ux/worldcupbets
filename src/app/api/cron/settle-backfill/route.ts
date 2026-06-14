import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron';
import { backfillSettledProps } from '@/settlement/run';

// One-off repair endpoint for prop bets that were settled before football-data
// published the scorers (every goalscorer pick was auto-lost for lack of data).
// Re-ingests events for already-settled matches and re-settles ONLY their prop bets.
//
//   GET .../settle-backfill?dry=1   → preview the changes, write nothing
//   GET .../settle-backfill         → apply them
//
// CRON_SECRET-guarded, like the other cron routes. Safe to run repeatedly.
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get('dry') === '1';
  try {
    const result = await backfillSettledProps(dryRun);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[settle-backfill] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
