import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CalendarDays, Clock, Lock, CircleDot, Ticket } from 'lucide-react';
import { getSession, requireOnboarded } from '@/lib/session';
import { db } from '@/lib/supabase';
import { Nav } from '@/components/Nav';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flag } from '@/components/ui/flag';
import { currentSlateKey, slateKeyOf } from '@/lib/slate';
import { naDayKey, naDayLabel } from '@/lib/matchday';
import type { League, Match, Team } from '@/types/db';

// Times are shown to our (Helsinki-based) audience in Helsinki time; matches are grouped
// into match days by NA calendar day (see @/lib/matchday).
const TIMEZONE = 'Europe/Helsinki';

// Kickoff in Helsinki time, with weekday so a game that grouping placed on a given NA
// match day still reads clearly when its Helsinki time falls on the next calendar day.
function formatKickoff(utc: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(utc));
}

type MatchRow = Match & { home_team: Team; away_team: Team };

export default async function FixturesPage() {
  const session = await getSession();
  if (!session.managerId) redirect('/join');
  await requireOnboarded(session.managerId);

  const { data: league } = await db
    .from('league')
    .select('config')
    .eq('id', 1)
    .single<Pick<League, 'config'>>();
  const rollover = league?.config.daily?.rollover_hour_local ?? 9;

  const nowDate = new Date();
  const slateKey = currentSlateKey(nowDate, rollover);
  // Only the current slate (the same set the Today view drives) is bettable —
  // everything else is read-only schedule info.
  const isToday = (m: MatchRow) => slateKeyOf(m.kickoff_at, rollover) === slateKey;

  const { data: matchData } = await db
    .from('matches')
    .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
    .neq('status', 'void')
    .order('kickoff_at', { ascending: true });

  const matches = (matchData ?? []) as MatchRow[];

  const matchIds = matches.map(m => m.id);
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

  // Group into NA match days (matches are already kickoff-ascending, so consecutive
  // grouping preserves order). Each distinct match day gets a sequential number.
  const groups: { key: string; matches: MatchRow[] }[] = [];
  for (const m of matches) {
    const key = naDayKey(m.kickoff_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.matches.push(m);
    else groups.push({ key, matches: [m] });
  }

  // Inner card/row content — shared between the clickable (today) and plain layouts.
  function MatchInner({ m, today }: { m: MatchRow; today: boolean }) {
    const betTypes = betsPerMatch.get(m.id);
    const hasBets = betTypes && betTypes.size > 0;
    const isFinished = m.status === 'finished';
    const isLocked = nowDate >= new Date(m.kickoff_at);

    return (
      <>
        {/* Top: stage + status */}
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-subtle">
            {m.group_label ? `Group ${m.group_label}` : m.stage}
          </span>
          {isFinished ? (
            <Badge variant="finished" size="sm">FT</Badge>
          ) : today ? (
            isLocked ? (
              <Badge variant="locked" size="sm"><Lock aria-hidden />Locked</Badge>
            ) : (
              <Badge variant="open" size="sm"><CircleDot aria-hidden />Open</Badge>
            )
          ) : null}
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
      </>
    );
  }

  // Today's matches are clickable cards (betting lives here); the rest are plain,
  // container-less rows — read-only schedule info.
  function MatchItem({ m }: { m: MatchRow }) {
    const today = isToday(m);
    if (today) {
      return (
        <Link
          href={`/matches/${m.id}`}
          className="glass group flex flex-col gap-3 rounded-2xl px-4 py-3.5 transition-[transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-border-strong"
        >
          <MatchInner m={m} today />
        </Link>
      );
    }
    return (
      <div className="flex flex-col gap-3 px-1 py-3">
        <MatchInner m={m} today={false} />
      </div>
    );
  }

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-2xl space-y-8 px-4 py-8">
        <section className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <CalendarDays className="size-6 text-primary-bright" aria-hidden />
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
                Full schedule
              </h1>
              <p className="text-xs text-subtle">
                Every fixture by match day. Betting opens only on today’s slate — tap those on Today.
              </p>
            </div>
          </div>
        </section>

        {groups.length === 0 ? (
          <Card className="text-center text-sm text-muted">
            No fixtures yet — the sync job will populate them.
          </Card>
        ) : (
          groups.map((group, i) => (
            <section key={group.key} className="space-y-3">
              <div className="flex items-baseline justify-between border-b border-border pb-1.5">
                <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
                  Match day {i + 1}
                </h2>
                <span className="text-xs font-medium uppercase tracking-wider text-subtle">
                  {naDayLabel(group.key)}
                </span>
              </div>
              <div className="space-y-2.5">
                {group.matches.map(m => (
                  <MatchItem key={m.id} m={m} />
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </>
  );
}
