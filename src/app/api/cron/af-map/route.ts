import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron';
import { syncAfMappings } from '@/lib/af-mapping';

// ID-mapping sync: pair our teams / matches / footballers with API-Football ids,
// writing teams.af_team_id, matches.af_fixture_id, footballers.af_player_id. Nothing
// settles off these until populated, so dry-run first and eyeball the unmatched lists.
//
//   GET .../af-map?dry=1   → preview matches + unmatched lists, write nothing
//   GET .../af-map         → apply the mapping
//
// ~50 requests (teams + fixtures + one squad call per matched team). CRON_SECRET-guarded.
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = new URL(req.url).searchParams.get('dry') === '1';
  try {
    const result = await syncAfMappings(dryRun);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[af-map] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
