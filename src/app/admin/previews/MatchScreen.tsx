'use client';

import Link from 'next/link';
import { ArrowLeft, Clock, Lock, CircleDot, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flag } from '@/components/ui/flag';
import { BetSlip } from '@/app/matches/[matchId]/BetSlip';
import type { BetSlipState } from '@/app/matches/[matchId]/actions';
import { ScreenFrame } from './ScreenFrame';
import { MOCK_SCORING, MOCK_SQUADS, MOCK_STAKE, TEAMS, finishedMatchData } from '../mock';
import { BONUS_LABEL, bonusDetail, isBonusBet } from '@/lib/bonus-bets';

const TIMEZONE = 'Europe/Helsinki';
function formatKickoff(utcString: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(utcString));
}

const STATUS_STYLE = {
  won: { color: 'text-success', Icon: CheckCircle2 },
  lost: { color: 'text-danger', Icon: XCircle },
  pending: { color: 'text-muted', Icon: MinusCircle },
} as const;

// In-preview submit: never touches the server — just flashes the success state.
async function previewSubmit(): Promise<BetSlipState> {
  return { success: true };
}

// Stable no-op so BetSlip plays the "Bet saved" animation without navigating away
// from /admin (it replays on each save).
function previewSaved() {}

export function MatchScreen({ variant }: { variant: 'betslip' | 'finished' }) {
  if (variant === 'betslip') {
    return (
      <ScreenFrame>
        <main className="mx-auto max-w-lg space-y-6 px-4 py-8">
          <Link href="#" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden />
            Fixtures
          </Link>

          <div className="space-y-4">
            <div className="flex items-center justify-end">
              <Badge variant="open" size="md"><CircleDot aria-hidden />Open</Badge>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <span className="flex min-w-0 items-center justify-end gap-2.5 font-display text-xl font-bold leading-tight text-foreground">
                <span className="truncate">{TEAMS.brazil.name}</span>
                <Flag name={TEAMS.brazil.name} countryCode={TEAMS.brazil.country_code} size="lg" />
              </span>
              <span className="text-sm font-medium uppercase text-subtle">vs</span>
              <span className="flex min-w-0 items-center gap-2.5 font-display text-xl font-bold leading-tight text-foreground">
                <Flag name={TEAMS.croatia.name} countryCode={TEAMS.croatia.country_code} size="lg" />
                <span className="truncate">{TEAMS.croatia.name}</span>
              </span>
            </div>
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
              <Clock className="size-3.5" aria-hidden />
              {formatKickoff('2026-06-15T16:00:00Z')}
            </p>
          </div>

          <div className="space-y-3">
            <h2 className="font-display text-base font-bold text-foreground">Place your bets</h2>
            <BetSlip
              matchId="preview"
              homeTeam={TEAMS.brazil.name}
              awayTeam={TEAMS.croatia.name}
              locked={false}
              squads={MOCK_SQUADS}
              stake={MOCK_STAKE}
              scoring={MOCK_SCORING}
              slate={{ index: 1, total: 3, nextHref: null }}
              existing={{}}
              action={previewSubmit}
              onSaved={previewSaved}
            />
          </div>
        </main>
      </ScreenFrame>
    );
  }

  // ─── finished / settled (read-only) ────────────────────────────────────────
  const { match, bets, playerName } = finishedMatchData();

  return (
    <ScreenFrame>
      <main className="mx-auto max-w-lg space-y-6 px-4 py-8">
        <Link href="#" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          Fixtures
        </Link>

        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <Badge variant="locked" size="md"><Lock aria-hidden />Finished</Badge>
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <span className="flex min-w-0 items-center justify-end gap-2.5 font-display text-xl font-bold leading-tight text-foreground">
              <span className="truncate">{match.home_team.name}</span>
              <Flag name={match.home_team.name} countryCode={match.home_team.country_code} size="lg" />
            </span>
            <span className="rounded-xl bg-surface-3 px-3 py-1.5 font-mono text-2xl font-bold tabular-nums text-foreground">
              {match.home_score}<span className="px-1 text-subtle">–</span>{match.away_score}
            </span>
            <span className="flex min-w-0 items-center gap-2.5 font-display text-xl font-bold leading-tight text-foreground">
              <Flag name={match.away_team.name} countryCode={match.away_team.country_code} size="lg" />
              <span className="truncate">{match.away_team.name}</span>
            </span>
          </div>
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
            <Clock className="size-3.5" aria-hidden />
            {formatKickoff(match.kickoff_at)}
          </p>
        </div>

        <Card variant="solid" padding="md" className="space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">Your bets</h3>
          {bets.map((b, i) => {
            let label: string;
            if (b.bet_type === 'outcome') {
              label = `Outcome: ${(b.selection as { result: string }).result}`;
            } else if (b.bet_type === 'exact_score') {
              const s = b.selection as { home: number; away: number };
              label = `Score: ${s.home}–${s.away}`;
            } else if (isBonusBet(b.bet_type)) {
              const detail = bonusDetail(b, {
                playerName: id => playerName.get(id),
                homeTeam: match.home_team.name,
                awayTeam: match.away_team.name,
              });
              label = `${BONUS_LABEL[b.bet_type]}: ${detail}`;
            } else {
              label = b.bet_type;
            }
            const style = STATUS_STYLE[b.status as keyof typeof STATUS_STYLE] ?? STATUS_STYLE.pending;
            return (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-muted">{label}</span>
                <span className={`flex items-center gap-1.5 font-semibold capitalize ${style.color}`}>
                  <style.Icon className="size-4" aria-hidden />
                  {b.status}
                </span>
              </div>
            );
          })}
        </Card>
      </main>
    </ScreenFrame>
  );
}
