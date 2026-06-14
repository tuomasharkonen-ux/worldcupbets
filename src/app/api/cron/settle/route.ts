import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron';
import { runSettlement } from '@/settlement/run';

// Settles finished, unsettled matches. Triggered by the external morning sweep
// (cron-job.org, hourly 06–10 Helsinki) and, on demand, by the on-read nudge in
// /today (see nudgeSettlement) so late-finishing matches settle the same day. The
// whole pass lives in @/settlement/run so both callers share identical, idempotent
// logic.
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runSettlement();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[settle] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
