import { Fragment } from 'react';
import { redirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import { CalendarDays, Clock, Lock, CircleDot, CircleDashed, Ticket, Trophy } from 'lucide-react';
import { getSession, requireOnboarded } from '@/lib/session';
import { db } from '@/lib/supabase';
import { Nav } from '@/components/Nav';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flag } from '@/components/ui/flag';
import { GoldenBracketPromo, type GoldenBracketPromoState } from '@/app/today/GoldenBracketPromo';
import { currentSlateKey, slateKeyOf } from '@/lib/slate';
import { naDayKey, naDayLabel } from '@/lib/matchday';
import { STAGE_LABEL, isFeatureStage } from '@/lib/stage';
import { type KnockoutSlot } from '@/lib/knockout-schedule';
import { buildScheduleGroups, type ScheduleItem } from '@/lib/schedule';
import type { League, Match, Team } from '@/types/db';
import { ScrollToAnchor } from './ScrollToAnchor';

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

// Date only (no time) — for placeholder knockout slots whose kickoff isn't confirmed.
function formatKickoffDate(utc: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(utc));
}

type MatchRow = Match & { home_team: Team; away_team: Team };

// The full fixture list is identical for every manager, so cache it briefly and
// share it across requests. On a busy match day this turns a per-load full-table
// read (every match + both team joins) into roughly one read per minute, which is
// the bulk of this page's Supabase egress. Scores can lag up to a minute on the
// schedule view, which is fine; the live recap on /today is unaffected.
const getFixtureMatches = unstable_cache(
  async (): Promise<MatchRow[]> => {
    const { data } = await db
      .from('matches')
      .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
      // Stable secondary sort so same-kickoff matches list in a fixed order, matching
      // the Today slate and the match-page stepper.
      .neq('status', 'void')
      .order('kickoff_at', { ascending: true })
      .order('id', { ascending: true });
    return (data ?? []) as MatchRow[];
  },
  ['fixtures-matches'],
  { revalidate: 60, tags: ['matches'] },
);

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

  const matches = await getFixtureMatches();

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

  // Merge drawn matches with placeholders for undrawn knockout slots, grouped into NA
  // match days (shared, unit-tested helper — see src/lib/schedule.ts).
  const groups = buildScheduleGroups(matches, naDayKey);

  // Golden Bracket banner — derived from the loaded fixtures (no extra matches read):
  // the window opens once all 8 quarter-finalists are known and locks at the first QF
  // kickoff. Before that, once QF pairings start landing, show a "coming soon" teaser.
  const qfMatches = matches.filter(m => m.stage === 'qf');
  const qfTeams = new Set(qfMatches.flatMap(m => [m.home_team_id, m.away_team_id]));
  let gbBanner:
    | { kind: 'promo'; state: GoldenBracketPromoState; lockAt: string }
    | { kind: 'teaser'; lockAt: string }
    | null = null;
  if (league?.config.golden_bracket) {
    if (qfTeams.size === 8) {
      const lockAt = qfMatches[0].kickoff_at;
      const { count } = await db
        .from('golden_brackets')
        .select('manager_id', { count: 'exact', head: true })
        .eq('manager_id', session.managerId!);
      const submitted = (count ?? 0) > 0;
      if (nowDate < new Date(lockAt)) gbBanner = { kind: 'promo', state: submitted ? 'submitted' : 'open', lockAt };
      else if (submitted) gbBanner = { kind: 'promo', state: 'locked', lockAt };
    } else if (qfMatches.length > 0) {
      gbBanner = { kind: 'teaser', lockAt: qfMatches[0].kickoff_at };
    }
  }

  // Where to land on open: the first match day still to come (an unfinished match or a
  // placeholder), so you don't scroll past everything already played. The banner, when
  // shown, sits just above the QF day and takes the anchor when that's the next day.
  const ANCHOR = 'sched-next';
  const isPending = (it: ScheduleItem<MatchRow>) => it.kind === 'placeholder' || it.m.status !== 'finished';
  const nextIdx = (() => {
    const i = groups.findIndex(g => g.items.some(isPending));
    return i === -1 ? Math.max(groups.length - 1, 0) : i;
  })();
  const qfGroupIdx = gbBanner
    ? groups.findIndex(g => g.items.some(it => (it.kind === 'match' ? it.m.stage : it.slot.stage) === 'qf'))
    : -1;
  const bannerIdx = gbBanner ? (qfGroupIdx === -1 ? nextIdx : qfGroupIdx) : -1;
  const anchorOnBanner = bannerIdx === nextIdx;

  // Inner card/row content — shared between the clickable (today) and plain layouts.
  function MatchInner({ m, today }: { m: MatchRow; today: boolean }) {
    const betTypes = betsPerMatch.get(m.id);
    const hasBets = betTypes && betTypes.size > 0;
    const isFinished = m.status === 'finished';
    const isLocked = nowDate >= new Date(m.kickoff_at);
    const stageLabel = m.group_label ? `Group ${m.group_label}` : STAGE_LABEL[m.stage];
    const feature = !m.group_label && isFeatureStage(m.stage);

    return (
      <>
        {/* Top: stage + status */}
        <div className="flex items-center justify-between">
          {feature ? (
            <Badge variant="points" size="sm">
              {m.stage === 'final' && <Trophy aria-hidden />}
              {stageLabel}
            </Badge>
          ) : (
            <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-subtle">
              {stageLabel}
            </span>
          )}
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
    const feature = isFeatureStage(m.stage);
    if (today) {
      return (
        <Link
          href={`/matches/${m.id}`}
          className={`glass group flex flex-col gap-3 rounded-2xl px-4 py-3.5 transition-[transform,border-color] duration-150 hover:-translate-y-0.5 ${
            feature
              ? 'border-points/45 bg-gradient-to-br from-points/10 to-transparent hover:border-points'
              : 'hover:border-border-strong'
          }`}
        >
          <MatchInner m={m} today />
        </Link>
      );
    }
    // The marquee knockout rounds get an emphasised box so they stand out from the
    // plain, container-less rows the rest of the (read-only) schedule uses.
    if (feature) {
      return (
        <div className="flex flex-col gap-3 rounded-2xl border border-points/30 bg-gradient-to-br from-points/10 to-transparent px-4 py-3.5">
          <MatchInner m={m} today={false} />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3 px-1 py-3">
        <MatchInner m={m} today={false} />
      </div>
    );
  }

  // An undrawn knockout slot: same shape as a match card but dashed + muted, with the
  // structural feeders instead of teams and the date only (kickoff not yet confirmed).
  function PlaceholderItem({ slot }: { slot: KnockoutSlot }) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-dashed border-points/40 px-4 py-3.5">
        <div className="flex items-center justify-between">
          <Badge variant="points" size="sm">
            {slot.stage === 'final' && <Trophy aria-hidden />}
            {STAGE_LABEL[slot.stage]}
          </Badge>
          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-subtle">To be decided</span>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className="flex min-w-0 items-center justify-end gap-2 font-display italic text-muted">
            <span className="truncate">{slot.home_label}</span>
            <CircleDashed className="size-4 shrink-0 text-subtle" aria-hidden />
          </span>
          <span className="text-xs font-medium uppercase text-subtle">vs</span>
          <span className="flex min-w-0 items-center gap-2 font-display italic text-muted">
            <CircleDashed className="size-4 shrink-0 text-subtle" aria-hidden />
            <span className="truncate">{slot.away_label}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted">
          <Clock className="size-4" aria-hidden />
          {formatKickoffDate(slot.kickoff_at)} · time TBC
        </div>
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
          groups.map((group, i) => {
            const showBannerHere = gbBanner != null && bannerIdx === i;
            const groupIsAnchor = i === nextIdx && !(showBannerHere && anchorOnBanner);
            return (
              <Fragment key={group.key}>
                {showBannerHere && gbBanner && (
                  <div id={anchorOnBanner ? ANCHOR : undefined} className={anchorOnBanner ? 'scroll-mt-20' : undefined}>
                    <GoldenBracketPromo
                      state={gbBanner.kind === 'teaser' ? 'teaser' : gbBanner.state}
                      lockAt={gbBanner.lockAt}
                      compact
                    />
                  </div>
                )}
                <section
                  id={groupIsAnchor ? ANCHOR : undefined}
                  className={`space-y-3 ${groupIsAnchor ? 'scroll-mt-20' : ''}`}
                >
                  <div className="flex items-baseline justify-between border-b border-border pb-1.5">
                    <h2 className="font-display text-lg font-bold tracking-tight text-foreground">
                      Match day {i + 1}
                    </h2>
                    <span className="text-xs font-medium uppercase tracking-wider text-subtle">
                      {naDayLabel(group.key)}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {group.items.map(it =>
                      it.kind === 'match' ? (
                        <MatchItem key={it.m.id} m={it.m} />
                      ) : (
                        <PlaceholderItem key={it.slot.id} slot={it.slot} />
                      ),
                    )}
                  </div>
                </section>
              </Fragment>
            );
          })
        )}
        {groups.length > 0 && <ScrollToAnchor targetId={ANCHOR} />}
      </main>
    </>
  );
}
