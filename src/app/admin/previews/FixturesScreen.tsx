'use client';

import Link from 'next/link';
import { CalendarDays, Clock, Lock, CircleDot, Ticket } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flag } from '@/components/ui/flag';
import { currentSlateKey, slateKeyOf } from '@/lib/slate';
import { ScreenFrame } from './ScreenFrame';
import { fixturesData, type MatchRow } from '../mock';

const TIMEZONE = 'Europe/Helsinki';
// NA zone used only to group matches into match days — never shown to the user.
const NA_TIMEZONE = 'America/Los_Angeles';

function naDayKey(utc: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(utc));
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function naDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function formatKickoff(utcString: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(utcString));
}

export function FixturesScreen({ empty = false }: { empty?: boolean }) {
  const { matches: allMatches, betsPerMatch, now, rollover } = fixturesData();
  const matches = empty ? [] : allMatches;

  const slateKey = currentSlateKey(now, rollover);
  const isToday = (m: MatchRow) => slateKeyOf(m.kickoff_at, rollover) === slateKey;

  const groups: { key: string; matches: MatchRow[] }[] = [];
  for (const m of matches) {
    const key = naDayKey(m.kickoff_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.matches.push(m);
    else groups.push({ key, matches: [m] });
  }

  function MatchInner({ m, today }: { m: MatchRow; today: boolean }) {
    const betTypes = betsPerMatch.get(m.id);
    const hasBets = betTypes && betTypes.size > 0;
    const isFinished = m.status === 'finished';
    const isLocked = now >= new Date(m.kickoff_at);

    return (
      <>
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

  function MatchItem({ m }: { m: MatchRow }) {
    const today = isToday(m);
    if (today) {
      return (
        <Link
          href="#"
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
    <ScreenFrame>
      <main className="mx-auto max-w-2xl space-y-8 px-4 py-8">
        <section className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <CalendarDays className="size-6 text-primary-bright" aria-hidden />
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Full schedule</h1>
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
    </ScreenFrame>
  );
}
