import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { Nav } from '@/components/Nav';
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

  const locked =
    match.status !== 'scheduled' || new Date() >= new Date(match.kickoff_at);

  // Load this manager's existing bets for this match
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

  const stageLabel = match.group_label
    ? `Group ${match.group_label}`
    : match.stage.toUpperCase();

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-lg px-4 py-8 space-y-6">
        <Link
          href="/fixtures"
          className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          ← Fixtures
        </Link>

        {/* Match header */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">
              {stageLabel}
            </span>
            {locked ? (
              <span className="rounded-full bg-red-900/50 border border-red-800 px-2.5 py-0.5 text-xs font-medium text-red-300">
                {match.status === 'finished' ? 'Finished' : 'Locked'}
              </span>
            ) : (
              <span className="rounded-full bg-green-900/50 border border-green-800 px-2.5 py-0.5 text-xs font-medium text-green-300">
                Open
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="flex-1 text-lg font-semibold text-white text-right leading-tight">
              {match.home_team.name}
            </span>
            {match.status === 'finished' && match.home_score != null ? (
              <span className="text-2xl font-mono font-bold text-white tabular-nums">
                {match.home_score}–{match.away_score}
              </span>
            ) : (
              <span className="text-sm text-zinc-500">vs</span>
            )}
            <span className="flex-1 text-lg font-semibold text-white leading-tight">
              {match.away_team.name}
            </span>
          </div>

          <p className="text-xs text-zinc-400 text-center">{formatKickoff(match.kickoff_at)}</p>
        </div>

        {/* Existing settled bets (read-only after lock) */}
        {bets.filter(b => b.status !== 'pending').length > 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 space-y-2">
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Your bets</h3>
            {bets.map((b, i) => {
              const label =
                b.bet_type === 'outcome'
                  ? `Outcome: ${(b.selection as { result: string }).result}`
                  : `Score: ${(b.selection as { home: number; away: number }).home}–${(b.selection as { home: number; away: number }).away}`;
              const color =
                b.status === 'won'
                  ? 'text-green-400'
                  : b.status === 'lost'
                    ? 'text-red-400'
                    : 'text-zinc-400';
              return (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-300">{label}</span>
                  <span className={`font-medium capitalize ${color}`}>{b.status}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Bet slip (editable until locked) */}
        {(!locked || bets.filter(b => b.status === 'pending').length > 0) && (
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-zinc-300">
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
