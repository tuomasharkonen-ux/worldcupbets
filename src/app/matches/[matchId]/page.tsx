import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, Lock, CircleDot, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { getSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { Nav } from '@/components/Nav';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BetSlip } from './BetSlip';
import type { Bet, Match, Team } from '@/types/db';

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

type MatchWithTeams = Match & { home_team: Team; away_team: Team };

const STATUS_STYLE = {
  won: { color: 'text-success', Icon: CheckCircle2 },
  lost: { color: 'text-danger', Icon: XCircle },
  pending: { color: 'text-muted', Icon: MinusCircle },
} as const;

export default async function MatchPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;

  const session = await getSession();
  if (!session.managerId) redirect('/join');

  const { data: match } = await db
    .from('matches')
    .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
    .eq('id', matchId)
    .single<MatchWithTeams>();

  if (!match) notFound();

  const locked = match.status !== 'scheduled' || new Date() >= new Date(match.kickoff_at);

  const { data: existingBets } = await db
    .from('bets')
    .select('bet_type, selection, status')
    .eq('match_id', matchId)
    .eq('manager_id', session.managerId!);

  const bets = (existingBets ?? []) as Pick<Bet, 'bet_type' | 'selection' | 'status'>[];
  const outcomeBet = bets.find(b => b.bet_type === 'outcome');
  const exactBet = bets.find(b => b.bet_type === 'exact_score');

  const existingForSlip = {
    outcome: outcomeBet
      ? (outcomeBet.selection as { result: 'home' | 'draw' | 'away' }).result
      : undefined,
    exactScore: exactBet
      ? (exactBet.selection as { home: number; away: number })
      : undefined,
  };

  const stageLabel = match.group_label ? `Group ${match.group_label}` : match.stage.toUpperCase();
  const isFinished = match.status === 'finished';
  const settledBets = bets.filter(b => b.status !== 'pending');
  const pendingBets = bets.filter(b => b.status === 'pending');

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-lg space-y-6 px-4 py-8">
        <Link
          href="/fixtures"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Fixtures
        </Link>

        {/* Scoreboard */}
        <Card variant="glass" padding="lg" className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-subtle">
              {stageLabel}
            </span>
            {locked ? (
              <Badge variant="locked" size="md">
                <Lock aria-hidden />
                {isFinished ? 'Finished' : 'Locked'}
              </Badge>
            ) : (
              <Badge variant="open" size="md">
                <CircleDot aria-hidden />
                Open
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <span className="text-right font-display text-lg font-bold leading-tight text-foreground">
              {match.home_team.name}
            </span>
            {isFinished && match.home_score != null ? (
              <span className="rounded-xl bg-surface-3 px-3 py-1.5 font-mono text-2xl font-bold tabular-nums text-foreground">
                {match.home_score}<span className="px-1 text-subtle">–</span>{match.away_score}
              </span>
            ) : (
              <span className="text-sm font-medium uppercase text-subtle">vs</span>
            )}
            <span className="font-display text-lg font-bold leading-tight text-foreground">
              {match.away_team.name}
            </span>
          </div>

          <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
            <Clock className="size-3.5" aria-hidden />
            {formatKickoff(match.kickoff_at)}
          </p>
        </Card>

        {/* Settled / read-only bets */}
        {settledBets.length > 0 && (
          <Card variant="solid" padding="md" className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">Your bets</h3>
            {bets.map((b, i) => {
              const label =
                b.bet_type === 'outcome'
                  ? `Outcome: ${(b.selection as { result: string }).result}`
                  : `Score: ${(b.selection as { home: number; away: number }).home}–${(b.selection as { home: number; away: number }).away}`;
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
        )}

        {/* Bet slip */}
        {(!locked || pendingBets.length > 0) && (
          <div className="space-y-3">
            <h2 className="font-display text-base font-bold text-foreground">
              {locked ? 'Your pending bets' : 'Place your bets'}
            </h2>
            <BetSlip
              matchId={matchId}
              homeTeam={match.home_team.name}
              awayTeam={match.away_team.name}
              locked={locked}
              existing={existingForSlip}
            />
          </div>
        )}
      </main>
    </>
  );
}
