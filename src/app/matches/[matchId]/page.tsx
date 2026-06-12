import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, Lock, CircleDot, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { getSession, requireOnboarded } from '@/lib/session';
import { db } from '@/lib/supabase';
import { Nav } from '@/components/Nav';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BetSlip, type SlipSquads } from './BetSlip';
import { Flag } from '@/components/ui/flag';
import { currentSlateKey, slateKeyOf } from '@/lib/slate';
import { computePlayerForm, type FormAppearance, type FormEvent, type FormMatch } from '@/lib/player-form';
import type { Bet, Footballer, League, Match, Team } from '@/types/db';

type PropField = 'first_scorer' | 'anytime_scorer' | 'carded';
const PROP_LABELS: Record<PropField, string> = {
  first_scorer: 'First scorer',
  anytime_scorer: 'Anytime scorer',
  carded: 'Carded',
};

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
  searchParams,
}: {
  params: Promise<{ matchId: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const { matchId } = await params;
  // `?edit=1` — opened from the "all set" Today screen to tweak a single slip.
  // Saving returns to Today instead of stepping through the rest of the slate.
  const editing = (await searchParams).edit === '1';

  const session = await getSession();
  if (!session.managerId) redirect('/join');
  await requireOnboarded(session.managerId);

  const { data: match } = await db
    .from('matches')
    .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
    .eq('id', matchId)
    .single<MatchWithTeams>();

  if (!match) notFound();

  const locked = match.status !== 'scheduled' || new Date() >= new Date(match.kickoff_at);

  const { data: existingBets } = await db
    .from('bets')
    .select('bet_type, selection, status, stake_coins')
    .eq('match_id', matchId)
    .eq('manager_id', session.managerId!);

  // Staking config + this manager's Coin balance for the stake widget (GAME_DESIGN §5).
  const { data: league } = await db
    .from('league')
    .select('config')
    .eq('id', 1)
    .single<Pick<League, 'config'>>();
  const { data: me } = await db
    .from('managers')
    .select('coins')
    .eq('id', session.managerId!)
    .single<{ coins: number }>();
  const stakeConfig = {
    tiers: league?.config.stake.tiers ?? [{ coins: 0, mult: 1.0 }],
    capCoins: league?.config.stake.cap_coins ?? 0,
    balance: me?.coins ?? 0,
  };
  const glory = league?.config.glory;
  const scoring = {
    stageMult: match.glory_multiplier,
    outcome: glory?.outcome_correct ?? 0,
    exactBonus: glory?.exact_score_bonus ?? 0,
    props: {
      first_scorer: glory?.first_goalscorer ?? 0,
      anytime_scorer: glory?.anytime_scorer ?? 0,
      carded: glory?.carded ?? 0,
    },
  };

  // Slate stepper: if this match belongs to the active slate, work out its position
  // and the next match to jump to after saving (null on the last → the all-set
  // screen). The active slate mirrors the Today screen: today's slate, or — when
  // today is a rest day — the next upcoming slate with fixtures. Without that same
  // fallback the stepper (1/N counter + auto-advance) silently vanishes whenever
  // Today is surfacing an upcoming slate, e.g. before the first match day.
  const rollover = league?.config.daily?.rollover_hour_local ?? 9;
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const slateMembers = async (key: string) => {
    const slateMidnightUtc = new Date(`${key}T00:00:00Z`).getTime();
    const { data } = await db
      .from('matches')
      .select('id, kickoff_at, status')
      .gte('kickoff_at', new Date(slateMidnightUtc - dayMs).toISOString())
      .lte('kickoff_at', new Date(slateMidnightUtc + 2 * dayMs).toISOString())
      .order('kickoff_at', { ascending: true });
    return (data ?? []).filter(
      mm => mm.status !== 'void' && slateKeyOf(mm.kickoff_at as string, rollover) === key,
    );
  };

  let slate: { index: number; total: number; nextHref: string | null } | undefined;
  if (!editing) {
    let activeKey = currentSlateKey(now, rollover);
    let members = await slateMembers(activeKey);
    if (members.length === 0) {
      const { data: nextRows } = await db
        .from('matches')
        .select('kickoff_at')
        .neq('status', 'void')
        .gte('kickoff_at', now.toISOString())
        .order('kickoff_at', { ascending: true })
        .limit(1);
      const nextKickoff = nextRows?.[0]?.kickoff_at as string | undefined;
      if (nextKickoff) {
        activeKey = slateKeyOf(nextKickoff, rollover);
        members = await slateMembers(activeKey);
      }
    }
    const idx = members.findIndex(mm => mm.id === matchId);
    if (idx !== -1) {
      const next = members[idx + 1];
      slate = { index: idx + 1, total: members.length, nextHref: next ? `/matches/${next.id}` : null };
    }
  }

  // Squads for the prop pickers (null until squads-sync has populated them).
  const { data: footballers } = await db
    .from('footballers')
    .select('id, name, squad_number, position, team_id')
    .in('team_id', [match.home_team_id, match.away_team_id])
    .order('squad_number', { ascending: true });

  const players = (footballers ?? []) as Pick<Footballer, 'id' | 'name' | 'squad_number' | 'position' | 'team_id'>[];
  const playerName = new Map(players.map(p => [p.id, p.name]));

  // Tournament form for the picker: both teams' earlier matches plus the goal/card
  // events and lineups the settle job has ingested for them. Empty before each
  // team's first settled match — computePlayerForm then yields nothing and the
  // picker simply shows no stats.
  const teamIds = [match.home_team_id, match.away_team_id];
  const { data: priorRows } = await db
    .from('matches')
    .select('id, kickoff_at, status, stage, home_team_id, away_team_id')
    .or(`home_team_id.in.(${teamIds.join(',')}),away_team_id.in.(${teamIds.join(',')})`)
    .neq('status', 'void')
    .lt('kickoff_at', match.kickoff_at)
    .order('kickoff_at', { ascending: true });
  const priorMatches = (priorRows ?? []) as FormMatch[];
  const priorIds = priorMatches.map(m => m.id);
  let formEvents: FormEvent[] = [];
  let formAppearances: FormAppearance[] = [];
  if (priorIds.length > 0) {
    const [{ data: ev }, { data: ap }] = await Promise.all([
      db.from('match_events').select('match_id, footballer_id, type, is_own_goal').in('match_id', priorIds),
      db.from('match_appearances').select('match_id, footballer_id').in('match_id', priorIds),
    ]);
    formEvents = (ev ?? []) as FormEvent[];
    formAppearances = (ap ?? []) as FormAppearance[];
  }
  const form = computePlayerForm({
    footballers: players,
    matches: priorMatches,
    events: formEvents,
    appearances: formAppearances,
  });
  const withForm = players.map(p => ({ ...p, form: form.get(p.id) }));

  const squads: SlipSquads | null = players.length > 0
    ? {
        homeTeam: match.home_team.name,
        awayTeam: match.away_team.name,
        homePlayers: withForm.filter(p => p.team_id === match.home_team_id),
        awayPlayers: withForm.filter(p => p.team_id === match.away_team_id),
      }
    : null;

  const bets = (existingBets ?? []) as Pick<Bet, 'bet_type' | 'selection' | 'status' | 'stake_coins'>[];
  const outcomeBet = bets.find(b => b.bet_type === 'outcome');
  const exactBet = bets.find(b => b.bet_type === 'exact_score');

  // One prop slot for now: take the first prop bet on the slip, if any.
  const propBet = bets.find(b => (Object.keys(PROP_LABELS) as PropField[]).includes(b.bet_type as PropField));
  const propSlot = propBet
    ? { type: propBet.bet_type as PropField, playerId: (propBet.selection as { footballer_id: string }).footballer_id }
    : null;

  const existingForSlip = {
    outcome: outcomeBet
      ? (outcomeBet.selection as { result: 'home' | 'draw' | 'away' }).result
      : undefined,
    exactScore: exactBet
      ? (exactBet.selection as { home: number; away: number })
      : undefined,
    propSlot,
    // One stake for the whole slip — recorded on the outcome bet (GAME_DESIGN §5).
    stake: outcomeBet?.stake_coins,
  };

  const isFinished = match.status === 'finished';
  const settledBets = bets.filter(b => b.status !== 'pending');
  const pendingBets = bets.filter(b => b.status === 'pending');

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-lg space-y-6 px-4 py-8">
        <Link
          href={editing ? '/today' : '/fixtures'}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {editing ? 'Today' : 'Fixtures'}
        </Link>

        {/* Scoreboard — plain info, not a card */}
        <div className="space-y-4">
          <div className="flex items-center justify-end">
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
            <span className="flex min-w-0 items-center justify-end gap-2.5 font-display text-xl font-bold leading-tight text-foreground">
              <span className="truncate">{match.home_team.name}</span>
              <Flag name={match.home_team.name} countryCode={match.home_team.country_code} size="lg" />
            </span>
            {isFinished && match.home_score != null ? (
              <span className="rounded-xl bg-surface-3 px-3 py-1.5 font-mono text-2xl font-bold tabular-nums text-foreground">
                {match.home_score}<span className="px-1 text-subtle">–</span>{match.away_score}
              </span>
            ) : (
              <span className="text-sm font-medium uppercase text-subtle">vs</span>
            )}
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

        {/* Settled / read-only bets */}
        {settledBets.length > 0 && (
          <Card variant="solid" padding="md" className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-subtle">Your bets</h3>
            {bets.map((b, i) => {
              let label: string;
              if (b.bet_type === 'outcome') {
                label = `Outcome: ${(b.selection as { result: string }).result}`;
              } else if (b.bet_type === 'exact_score') {
                const s = b.selection as { home: number; away: number };
                label = `Score: ${s.home}–${s.away}`;
              } else {
                const propLabel = PROP_LABELS[b.bet_type as PropField] ?? b.bet_type;
                const fid = (b.selection as { footballer_id: string }).footballer_id;
                label = `${propLabel}: ${playerName.get(fid) ?? 'Unknown'}`;
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
        )}

        {/* Bet slip */}
        {(!locked || pendingBets.length > 0) && (
          <div className="space-y-3">
            <h2 className="font-display text-base font-bold text-foreground">
              {locked ? 'Your pending bets' : 'Place your bets'}
            </h2>
            <BetSlip
              key={matchId}
              matchId={matchId}
              homeTeam={match.home_team.name}
              awayTeam={match.away_team.name}
              locked={locked}
              squads={squads}
              stake={stakeConfig}
              scoring={scoring}
              slate={slate}
              returnTo={editing ? '/today' : undefined}
              existing={existingForSlip}
            />
          </div>
        )}
      </main>
    </>
  );
}
