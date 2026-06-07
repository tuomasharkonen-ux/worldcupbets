import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { Nav } from '@/components/Nav';
import type { Match, Team } from '@/types/db';

const TIMEZONE = 'Europe/Helsinki';

function formatKickoff(utcString: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(utcString));
}

type MatchRow = Match & { home_team: Team; away_team: Team };

export default async function FixturesPage() {
  const session = await getSession();
  if (!session.managerId) redirect('/join');

  const now = new Date().toISOString();

  // Upcoming: next 30 scheduled matches
  const { data: upcomingData } = await db
    .from('matches')
    .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
    .eq('status', 'scheduled')
    .gt('kickoff_at', now)
    .order('kickoff_at', { ascending: true })
    .limit(30);

  // Recent results: last 10 finished matches
  const { data: resultsData } = await db
    .from('matches')
    .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
    .eq('status', 'finished')
    .order('kickoff_at', { ascending: false })
    .limit(10);

  const upcoming = (upcomingData ?? []) as MatchRow[];
  const results = (resultsData ?? []) as MatchRow[];
  const allMatches = [...upcoming, ...results];

  // Load this manager's bets for all displayed matches in one query
  const matchIds = allMatches.map(m => m.id);
  const { data: betData } = matchIds.length
    ? await db
        .from('bets')
        .select('match_id, bet_type')
        .eq('manager_id', session.managerId!)
        .in('match_id', matchIds)
    : { data: [] };

  const betsPerMatch = new Map<string, Set<string>>();
  for (const b of betData ?? []) {
    if (!betsPerMatch.has(b.match_id)) betsPerMatch.set(b.match_id, new Set());
    betsPerMatch.get(b.match_id)!.add(b.bet_type);
  }

  function MatchRow({ m, isLocked }: { m: MatchRow; isLocked: boolean }) {
    const betTypes = betsPerMatch.get(m.id);
    const hasBets = betTypes && betTypes.size > 0;

    return (
      <Link
        href={`/matches/${m.id}`}
        className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 hover:border-zinc-700 hover:bg-zinc-800/60 transition-colors"
      >
        <div className="flex items-center gap-3 text-sm min-w-0">
          <span className="text-zinc-500 uppercase text-xs w-8 shrink-0 text-center">
            {m.group_label ?? m.stage}
          </span>
          <span className="font-medium text-white truncate w-24 text-right">
            {m.home_team?.name ?? '—'}
          </span>
          <span className="text-zinc-600 text-xs shrink-0">vs</span>
          <span className="font-medium text-white truncate w-24">
            {m.away_team?.name ?? '—'}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-3">
          {hasBets && (
            <span className="text-xs text-indigo-400 font-medium">
              {[...betTypes!].map(t => t === 'exact_score' ? 'score' : t).join(' + ')}
            </span>
          )}
          {m.status === 'finished' && m.home_score != null ? (
            <span className="font-mono text-sm text-zinc-300">
              {m.home_score}–{m.away_score}
            </span>
          ) : (
            <span className="text-xs text-zinc-400">{formatKickoff(m.kickoff_at)}</span>
          )}
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              m.status === 'finished'
                ? 'bg-zinc-800 text-zinc-400'
                : isLocked
                  ? 'bg-red-900/40 text-red-400'
                  : 'bg-green-900/40 text-green-400'
            }`}
          >
            {m.status === 'finished' ? 'FT' : isLocked ? 'Locked' : 'Open'}
          </span>
        </div>
      </Link>
    );
  }

  const nowDate = new Date();

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl px-4 py-8 space-y-8">
        <section className="space-y-3">
          <h1 className="text-xl font-semibold text-white">Upcoming fixtures</h1>
          {upcoming.length === 0 ? (
            <p className="text-zinc-500 text-sm">
              No upcoming fixtures — the sync job will populate them.
            </p>
          ) : (
            <div className="space-y-2">
              {upcoming.map(m => (
                <MatchRow
                  key={m.id}
                  m={m}
                  isLocked={nowDate >= new Date(m.kickoff_at)}
                />
              ))}
            </div>
          )}
        </section>

        {results.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-zinc-400">Recent results</h2>
            <div className="space-y-2">
              {results.map(m => (
                <MatchRow key={m.id} m={m} isLocked={true} />
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
