'use client';

import Link from 'next/link';
import { CalendarDays, Clock, Lock, CircleDot, CheckCircle2, Ticket, Loader2, Coffee, Pencil, Eye } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Flag } from '@/components/ui/flag';
import { Countdown } from '@/components/Countdown';
import { Recap } from '@/app/today/Recap';
import { ShareBetsButton } from '@/app/today/ShareBetsButton';
import { Social } from '@/app/today/Social';
import { slateLabel } from '@/lib/slate';
import { buildSlateShareText } from '@/lib/share';
import type { Bet, ExactScoreSelection, FootballerSelection, OutcomeSelection } from '@/types/db';
import { ScreenFrame } from './ScreenFrame';
import { MOCK_RECAP, MOCK_RECAP_ROUGH, socialData, todayScenario, type MatchRow, type TodayVariant } from '../mock';

const TIMEZONE = 'Europe/Helsinki';

function formatKickoff(utc: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(utc));
}

const PROP_LABEL: Record<string, string> = {
  first_scorer: 'First scorer',
  anytime_scorer: 'Anytime scorer',
  carded: 'Booked',
};

// The mock slate's lone prop pick is on footballer 'p-x' (see mock.ts); name it so the
// all-set preview reads like the real page, which resolves names from the DB.
const PROP_PLAYER_NAME = new Map<string, string>([['p-x', 'A. Striker']]);

function outcomeLabel(result: string, home: string, away: string): string {
  return result === 'home' ? home : result === 'away' ? away : 'Draw';
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <ScreenFrame>
      <main className="mx-auto max-w-lg space-y-5 px-4 py-8">{children}</main>
    </ScreenFrame>
  );
}

function SlateHeader({ slateKey, isUpcoming = false }: { slateKey: string; isUpcoming?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <CalendarDays className="size-6 text-primary-bright" aria-hidden />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
          {isUpcoming ? 'Next up' : 'Today'}
        </h1>
        <p className="text-xs text-subtle">{slateLabel(slateKey)} slate</p>
      </div>
    </div>
  );
}

export function TodayScreen({ variant }: { variant: TodayVariant }) {
  // ─── no fixtures known ─────────────────────────────────────────────────────
  if (variant === 'noschedule') {
    return (
      <Shell>
        <SlateHeader slateKey="2026-06-19" />
        <Card variant="glass" padding="lg" className="space-y-3 text-center">
          <Coffee className="mx-auto size-8 text-subtle" aria-hidden />
          <p className="font-display text-lg font-bold text-foreground">No matches yet</p>
          <p className="text-sm text-muted">
            The next fixtures haven’t been published yet. Check the{' '}
            <Link href="#" className="font-medium text-primary-bright hover:underline">full schedule</Link>{' '}
            once they’re announced.
          </p>
        </Card>
      </Shell>
    );
  }

  // ─── recap ─────────────────────────────────────────────────────────────────
  if (variant === 'recap' || variant === 'recap-rough') {
    return (
      <Shell>
        <Recap data={variant === 'recap' ? MOCK_RECAP : MOCK_RECAP_ROUGH} />
      </Shell>
    );
  }

  const { state, slateKey, now, members, betsByMatch, settledCount, matchDay, isUpcoming } = todayScenario(variant);

  // ─── settling ────────────────────────────────────────────────────────────
  if (state === 'settling') {
    return (
      <Shell>
        <SlateHeader slateKey={slateKey} />
        <Card variant="glass" padding="lg" className="space-y-4 text-center">
          <Loader2 className="mx-auto size-8 animate-spin text-primary-bright" aria-hidden />
          <div>
            <p className="font-display text-lg font-bold text-foreground">Results are coming in</p>
            <p className="mt-1 text-sm text-muted">
              Settlement runs through the morning. Check back soon for the full recap.
            </p>
          </div>
          <div className="space-y-1.5">
            <div className="h-2 overflow-hidden rounded-full bg-surface-3">
              <div
                className="h-full rounded-full bg-primary-bright transition-[width] duration-500"
                style={{ width: `${(settledCount / members.length) * 100}%` }}
              />
            </div>
            <p className="font-mono text-xs text-subtle">{settledCount} of {members.length} settled</p>
          </div>
        </Card>
        <Social data={socialData()} preview />
      </Shell>
    );
  }

  // ─── betting & all-set ───────────────────────────────────────────────────
  const hasCompleteCore = (matchId: string) => {
    const bs = betsByMatch.get(matchId) ?? [];
    return bs.some(b => b.bet_type === 'outcome') && bs.some(b => b.bet_type === 'exact_score');
  };
  const firstKickoff = members[0].kickoff_at;

  // Share digest for the all-set preview, built from the same pure helper the real
  // page uses. The mock slate's lone prop is on footballer 'p-x'.
  const shareText =
    state === 'allset'
      ? buildSlateShareText(matchDay, members, betsByMatch, new Map([['p-x', 'A. Striker']]))
      : null;

  // Mirrors the real /today all-set row: flags flanking the called scoreline, plus a
  // real Edit button. Group label and the open/locked chip are dropped as noise.
  function AllSetRow({ m }: { m: MatchRow }) {
    const locked = m.status !== 'scheduled' || now >= new Date(m.kickoff_at);
    const bs: Bet[] = betsByMatch.get(m.id) ?? [];
    const outcome = bs.find(b => b.bet_type === 'outcome')!;
    const exact = bs.find(b => b.bet_type === 'exact_score')!;
    const prop = bs.find(b => PROP_LABEL[b.bet_type]);
    const ex = exact.selection as ExactScoreSelection;
    const mult = outcome.stake_mult; // one stake/multiplier per match slip
    const propPlayer = prop ? PROP_PLAYER_NAME.get((prop.selection as FootballerSelection).footballer_id) : null;

    return (
      <div className="glass flex flex-col gap-3 rounded-2xl px-4 py-3.5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className="flex min-w-0 items-center justify-end gap-2 font-display font-semibold text-foreground">
            <span className="truncate">{m.home_team.name}</span>
            <Flag name={m.home_team.name} countryCode={m.home_team.country_code} size="sm" />
          </span>
          <span className="rounded-lg bg-surface-2 px-2.5 py-1 font-mono text-base font-bold tabular-nums text-foreground">
            {ex.home}<span className="px-0.5 text-subtle">–</span>{ex.away}
          </span>
          <span className="flex min-w-0 items-center gap-2 font-display font-semibold text-foreground">
            <Flag name={m.away_team.name} countryCode={m.away_team.country_code} size="sm" />
            <span className="truncate">{m.away_team.name}</span>
          </span>
        </div>

        {prop && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted">
            <span className="text-subtle">{PROP_LABEL[prop.bet_type]}:</span>
            <span className="font-medium text-foreground">{propPlayer ?? 'Unknown'}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <Clock className="size-4" aria-hidden />
              {formatKickoff(m.kickoff_at)}
            </span>
            <span aria-hidden className="text-subtle">·</span>
            <span className="text-foreground">
              {outcomeLabel((outcome.selection as OutcomeSelection).result, m.home_team.name, m.away_team.name)} to win
            </span>
            {mult > 1 && <Badge variant="points" size="sm">×{mult}</Badge>}
          </div>
          <Button asChild size="sm" variant="glass" className="shrink-0">
            <Link href="#">
              {locked ? <Eye aria-hidden /> : <Pencil aria-hidden />}
              {locked ? 'View result' : 'Edit bet'}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  function MatchRowInner({ m, editable }: { m: MatchRow; editable: boolean }) {
    const locked = m.status !== 'scheduled' || now >= new Date(m.kickoff_at);
    const bs: Bet[] = betsByMatch.get(m.id) ?? [];
    const outcome = bs.find(b => b.bet_type === 'outcome');
    const exact = bs.find(b => b.bet_type === 'exact_score');
    const prop = bs.find(b => PROP_LABEL[b.bet_type]);
    const complete = hasCompleteCore(m.id);
    const totalStake = bs.reduce((s, b) => s + b.stake_coins, 0);

    return (
      <>
        <div className="flex items-center justify-between">
          <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-subtle">
            {m.group_label ? `Group ${m.group_label}` : m.stage}
          </span>
          {locked ? (
            <Badge variant="locked" size="sm"><Lock aria-hidden />Locked</Badge>
          ) : (
            <Badge variant="open" size="sm"><CircleDot aria-hidden />Open</Badge>
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <span className="flex min-w-0 items-center justify-end gap-2 font-display font-semibold text-foreground">
            <span className="truncate">{m.home_team.name}</span>
            <Flag name={m.home_team.name} countryCode={m.home_team.country_code} size="sm" />
          </span>
          <span className="text-xs font-medium uppercase text-subtle">vs</span>
          <span className="flex min-w-0 items-center gap-2 font-display font-semibold text-foreground">
            <Flag name={m.away_team.name} countryCode={m.away_team.country_code} size="sm" />
            <span className="truncate">{m.away_team.name}</span>
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-1.5 text-muted">
            <Clock className="size-4" aria-hidden />
            {formatKickoff(m.kickoff_at)}
          </span>
          {complete ? (
            <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted">
              <span className="truncate">
                {outcomeLabel((outcome!.selection as OutcomeSelection).result, m.home_team.name, m.away_team.name)}
                {' · '}
                {(exact!.selection as ExactScoreSelection).home}–{(exact!.selection as ExactScoreSelection).away}
                {prop ? ' · player bet' : ''}
              </span>
              {totalStake > 0 && <Badge variant="primary" size="sm">{totalStake}¢ staked</Badge>}
              {editable && !locked && <Pencil className="size-3.5 shrink-0 text-subtle" aria-hidden />}
            </span>
          ) : locked ? (
            <span className="text-xs text-subtle">No bet</span>
          ) : (
            <span className="text-xs font-semibold text-primary-bright">Needs a pick</span>
          )}
        </div>
      </>
    );
  }

  return (
    <Shell>
      <SlateHeader slateKey={slateKey} isUpcoming={isUpcoming} />

      {state === 'allset' ? (
        <div className="flex flex-col items-center gap-3 py-3 text-center">
          <CheckCircle2 className="size-12 text-success" aria-hidden />
          <div>
            <p className="font-display text-2xl font-bold text-foreground">You’re all set</p>
            <p className="mt-1.5 text-base text-muted">
              Slip in for every match. Tap any match below to edit before it kicks off.
            </p>
          </div>
          <Countdown target={firstKickoff} />
          {shareText && <ShareBetsButton text={shareText} />}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-3 text-center">
          <Ticket className="size-12 text-primary-bright" aria-hidden />
          <div>
            <p className="font-display text-2xl font-bold text-foreground">
              Place your bets
            </p>
            <p className="mt-1.5 text-base text-muted">
              Match Day {matchDay}
            </p>
          </div>
          <Countdown target={firstKickoff} />
          <Button asChild size="lg" variant="primary" className="mt-4 w-full">
            <Link href="#">
              <Ticket aria-hidden />
              Place your bets
            </Link>
          </Button>
        </div>
      )}

      {state === 'allset' ? (
        <div className="space-y-2.5 pt-4">
          <h2 className="px-1 text-[0.7rem] font-semibold uppercase tracking-wider text-subtle">
            My bets
          </h2>
          {members.map((m: MatchRow) => (
            <AllSetRow key={m.id} m={m} />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {members.map((m: MatchRow) => (
            <div key={m.id} className="flex flex-col gap-3 px-1 py-3.5">
              <MatchRowInner m={m} editable={false} />
            </div>
          ))}
        </div>
      )}

      {state === 'allset' && <Social data={socialData()} preview />}
    </Shell>
  );
}
