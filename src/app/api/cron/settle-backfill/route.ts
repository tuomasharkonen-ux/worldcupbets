import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron';
import { backfillSettledBets } from '@/settlement/run';

// One-off repair endpoint for already-settled matches whose result changed after they
// were settled: prop bets auto-lost before football-data published the scorers, and
// score-derived bets (outcome/exact_score/over_under/clean_sheet) settled against a
// score that was later corrected (e.g. a late or own goal). Re-evaluates every bet on
// each settled match with the same pure engine and reconciles its ledger rows.
//
//   GET .../settle-backfill?dry=1            → preview the changes, write nothing
//   GET .../settle-backfill                  → apply them
//   GET .../settle-backfill?undecided=1      → only re-grade void/pending bets (never
//                                              overturns a decided win/loss); combine
//                                              with dry=1 to preview. Use after a data
//                                              source is added (e.g. a match newly mapped
//                                              to API-Football) so previously-voided
//                                              scorer props settle without retroactively
//                                              re-pointing grandfathered historical bets.
//
// CRON_SECRET-guarded, like the other cron routes. Safe to run repeatedly.
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const params = new URL(req.url).searchParams;
  const dryRun = params.get('dry') === '1';
  const onlyUndecided = params.get('undecided') === '1';
  try {
    const result = await backfillSettledBets(dryRun, onlyUndecided);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[settle-backfill] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
