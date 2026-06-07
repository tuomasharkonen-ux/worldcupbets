import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { Nav } from '@/components/Nav';
import type { Match, Team } from '@/types/db';

// Helsinki time — the league's local timezone
const TIMEZONE = 'Europe/Helsinki';

function formatKickoff(utcString: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(utcString));
}

type MatchWithTeams = Match & {
  home_team: Team;
  away_team: Team;
};

export default async function FixturesPage() {
  const session = await getSession();
  if (!session.managerId) redirect('/join');

  const { data: matches } = await db
    .from('matches')
    .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
    .order('kickoff_at', { ascending: true })
    .limit(20);

  const upcoming = (matches ?? []) as MatchWithTeams[];

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-xl font-semibold text-white mb-6">Upcoming fixtures</h1>

        {upcoming.length === 0 ? (
          <p className="text-zinc-500 text-sm">
            No fixtures yet — the sync job will populate them shortly.
          </p>
        ) : (
          <div className="space-y-2">
            {upcoming.map(m => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
              >
                <div className="flex items-center gap-3 text-sm">
                  <span className="text-zinc-400 w-8 text-center uppercase text-xs">
                    {m.group_label ?? m.stage.toUpperCase()}
                  </span>
                  <span className="font-medium text-white w-28 text-right">
                    {m.home_team?.name ?? '—'}
                  </span>
                  <span className="text-zinc-500 text-xs px-2">vs</span>
                  <span className="font-medium text-white w-28">
                    {m.away_team?.name ?? '—'}
                  </span>
                </div>
                <div className="text-xs text-zinc-400 text-right">
                  <div>{formatKickoff(m.kickoff_at)}</div>
                  {m.status === 'finished' && m.home_score != null && (
                    <div className="text-zinc-300 font-mono">
                      {m.home_score}–{m.away_score}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
