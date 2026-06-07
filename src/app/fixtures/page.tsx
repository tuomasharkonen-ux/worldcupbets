import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CalendarDays, History, Clock, Lock, CircleDot, Ticket } from 'lucide-react';
import { getSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { Nav } from '@/components/Nav';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flag } from '@/components/ui/flag';
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

  const { data: upcomingData } = await db
    .from('matches')
    .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
    .eq('status', 'scheduled')
    .gt('kickoff_at', now)
    .order('kickoff_at', { ascending: true })
    .limit(30);

  const { data: resultsData } = await db
    .from('matches')
    .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
    .eq('status', 'finished')
    .order('kickoff_at', { ascending: false })
    .limit(10);

  const upcoming = (upcomingData ?? []) as MatchRow[];
  const results = (resultsData ?? []) as MatchRow[];
  const allMatches = [...upcoming, ...results];

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

  function MatchCard({ m, isLocked }: { m: MatchRow; isLocked: boolean }) {
    const betTypes = betsPerMatch.get(m.id);
    const hasBets = betTypes && betTypes.size > 0;
    const isFinished = m.status === 'finished';

    return (
      <Link
        href={`/matches/${m.id}`}
        className="glass group flex flex-col gap-3 rounded-2xl px-4 py-3.5 transition-[transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-border-strong"
      >
        {/* Top: stage + status */}
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-subtle">
            {m.group_label ? `Group ${m.group_label}` : m.stage}
          </span>
          {isFinished ? (
            <Badge variant="finished" size="sm">FT</Badge>
          ) : isLocked ? (
            <Badge variant="locked" size="sm"><Lock aria-hidden />Locked</Badge>
          ) : (
            <Badge variant="open" size="sm"><CircleDot aria-hidden />Open</Badge>
          )}
        </div>

        {/* Middle: teams + score/vs */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className="flex min-w-0 items-center justify-end gap-2 font-display font-semibold text-foreground">
            <span className="truncate">{m.home_team?.name ?? '—'}</span>
            {m.home_team && <Flag name={m.home_team.name} countryCode={m.home_team.country_code} size="sm" />}
          </span>
          {isFinished && m.home_score != null ? (
            <span className="rounded-lg bg-surface-3 px-2.5 py-1 font-mono text-lg font-bold tabular-nums text-foreground">
              {m.home_score}<span className="px-1 text-subtle">–</span>{m.away_score}
            </span>
          ) : (
            <span className="text-xs font-medium uppercase text-subtle">vs</span>
          )}
          <span className="flex min-w-0 items-center gap-2 font-display font-semibold text-foreground">
            {m.away_team && <Flag name={m.away_team.name} countryCode={m.away_team.country_code} size="sm" />}
            <span className="truncate">{m.away_team?.name ?? '—'}</span>
          </span>
        </div>

        {/* Bottom: time + bet indicator */}
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 text-muted">
            <Clock className="size-4" aria-hidden />
            {formatKickoff(m.kickoff_at)}
          </span>
          {hasBets && (
            <Badge variant="primary" size="sm">
              <Ticket aria-hidden />
              {[...betTypes!].map(t => (t === 'exact_score' ? 'score' : t)).join(' + ')}
            </Badge>
          )}
        </div>
      </Link>
    );
  }

  const nowDate = new Date();

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-2xl space-y-8 px-4 py-8">
        <section className="space-y-3">
          <div className="flex items-center gap-2.5">
            <CalendarDays className="size-6 text-primary-bright" aria-hidden />
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Full schedule
              </h1>
              <p className="text-xs text-subtle">Every fixture — your daily slate lives on Today.</p>
            </div>
          </div>
          {upcoming.length === 0 ? (
            <Card className="text-center text-sm text-muted">
              No upcoming fixtures — the sync job will populate them.
            </Card>
          ) : (
            <div className="space-y-2.5">
              {upcoming.map(m => (
                <MatchCard key={m.id} m={m} isLocked={nowDate >= new Date(m.kickoff_at)} />
              ))}
            </div>
          )}
        </section>

        {results.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2.5">
              <History className="size-5 text-muted" aria-hidden />
              <h2 className="font-display text-lg font-bold tracking-tight text-muted">
                Recent results
              </h2>
            </div>
            <div className="space-y-2.5">
              {results.map(m => (
                <MatchCard key={m.id} m={m} isLocked={true} />
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
