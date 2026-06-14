import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron';
import {
  AF_SEASON,
  AF_WORLD_CUP_LEAGUE,
  getAccountStatus,
  searchLeagues,
  getWorldCupFixtures,
  getFixtureEvents,
  getFixtureLineups,
} from '@/lib/api-football';

// Read-only probe to validate the API-Football integration before building the
// mapping sync + ingest adapter. Confirms the key works, resolves the WC2026 league
// id, and proves a finished match returns events + lineups in the expected shape.
// ~5 requests. CRON_SECRET-guarded.
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const status = await getAccountStatus();

    // Which league ids does API-Football return for "world cup", and do any cover 2026?
    const leagues = await searchLeagues('world cup');
    const leagueCandidates = leagues.map(l => ({
      id: l.league.id,
      name: l.league.name,
      type: l.league.type,
      country: l.country?.name ?? null,
      has2026: (l.seasons ?? []).some(s => s.year === AF_SEASON),
    }));

    // Fixtures for the configured WC league/season.
    const fixtures = await getWorldCupFixtures();
    const finished = fixtures.filter(f => ['FT', 'AET', 'PEN'].includes(f.fixture.status.short));

    const sample = finished[0] ?? fixtures[0];
    let sampleEvents: unknown = null;
    let sampleLineups: unknown = null;
    if (sample) {
      const events = await getFixtureEvents(sample.fixture.id);
      const lineups = await getFixtureLineups(sample.fixture.id);
      sampleEvents = {
        count: events.length,
        goals: events.filter(e => e.type === 'Goal').length,
        cards: events.filter(e => e.type === 'Card').length,
        first3: events.slice(0, 3).map(e => ({
          type: e.type,
          detail: e.detail,
          player: e.player?.name ?? null,
          team: e.team?.name ?? null,
          minute: e.time?.elapsed ?? null,
        })),
      };
      sampleLineups = {
        teams: lineups.length,
        startXICounts: lineups.map(l => ({ team: l.team?.name ?? null, startXI: l.startXI?.length ?? 0 })),
      };
    }

    return NextResponse.json({
      ok: true,
      status: {
        plan: status.subscription?.plan ?? null,
        active: status.subscription?.active ?? null,
        requestsToday: status.requests?.current ?? null,
        dailyLimit: status.requests?.limit_day ?? null,
      },
      configuredLeagueId: AF_WORLD_CUP_LEAGUE,
      season: AF_SEASON,
      leagueCandidates,
      fixturesForConfiguredLeague: fixtures.length,
      finishedFixtures: finished.length,
      sampleFixture: sample
        ? {
            afFixtureId: sample.fixture.id,
            date: sample.fixture.date,
            status: sample.fixture.status.short,
            home: sample.teams.home.name,
            away: sample.teams.away.name,
            score: `${sample.goals.home ?? '-'}-${sample.goals.away ?? '-'}`,
          }
        : null,
      sampleEvents,
      sampleLineups,
    });
  } catch (err) {
    console.error('[af-probe] error:', err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
