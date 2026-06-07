import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CalendarDays, Clock, Lock, CircleDot, CheckCircle2, Ticket, Loader2, Coffee, Pencil } from 'lucide-react';
import { getSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { Nav } from '@/components/Nav';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flag } from '@/components/ui/flag';
import { currentSlateKey, slateKeyOf, slateLabel } from '@/lib/slate';
import { Recap, type RecapData, type RecapMatch, type RecapPick, type RecapCoinItem, type RecapStanding } from './Recap';
import type {
  Bet,
  ExactScoreSelection,
  FootballerSelection,
  League,
  LedgerEntry,
  Manager,
  Match,
  OutcomeSelection,
  Team,
} from '@/types/db';

const TIMEZONE = 'Europe/Helsinki';

function formatKickoff(utc: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(utc));
}

type MatchRow = Match & { home_team: Team; away_team: Team };

const PROP_LABEL: Record<string, string> = {
  first_scorer: 'First scorer',
  anytime_scorer: 'Anytime scorer',
  carded: 'Booked',
};

function outcomeLabel(result: string, home: string, away: string): string {
  return result === 'home' ? home : result === 'away' ? away : 'Draw';
}

export default async function TodayPage() {
  const session = await getSession();
  if (!session.managerId) redirect('/join');
  const managerId = session.managerId;

  const { data: league } = await db
    .from('league')
    .select('config')
    .eq('id', 1)
    .single<Pick<League, 'config'>>();
  const rollover = league?.config.daily?.rollover_hour_local ?? 9;

  const now = new Date();
  const slateKey = currentSlateKey(now, rollover);

  // Pull a generous UTC window around the slate's Helsinki day, then filter to the
  // exact slate. (Membership is computed from kickoff, never stored.)
  const dayMs = 24 * 60 * 60 * 1000;
  const slateMidnightUtc = new Date(`${slateKey}T00:00:00Z`).getTime();
  const windowStart = new Date(slateMidnightUtc - dayMs).toISOString();
  const windowEnd = new Date(slateMidnightUtc + 2 * dayMs).toISOString();

  const { data: windowMatches } = await db
    .from('matches')
    .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
    .gte('kickoff_at', windowStart)
    .lte('kickoff_at', windowEnd)
    .order('kickoff_at', { ascending: true });

  const members = ((windowMatches ?? []) as MatchRow[]).filter(
    m => m.status !== 'void' && slateKeyOf(m.kickoff_at, rollover) === slateKey,
  );

  // ─── rest day ──────────────────────────────────────────────────────────────
  if (members.length === 0) {
    return (
      <Shell>
        <SlateHeader slateKey={slateKey} />
        <Card variant="glass" padding="lg" className="space-y-3 text-center">
          <Coffee className="mx-auto size-8 text-subtle" aria-hidden />
          <p className="font-display text-lg font-bold text-foreground">No matches today</p>
          <p className="text-sm text-muted">
            A rest day — the slate skips a beat. Check the{' '}
            <Link href="/fixtures" className="font-medium text-primary-bright hover:underline">full schedule</Link>{' '}
            for what’s next.
          </p>
        </Card>
      </Shell>
    );
  }

  const memberIds = members.map(m => m.id);

  // This manager's bets across the slate.
  const { data: myBetRows } = await db
    .from('bets')
    .select('*')
    .eq('manager_id', managerId)
    .in('match_id', memberIds);
  const myBets = (myBetRows ?? []) as Bet[];

  const betsByMatch = new Map<string, Bet[]>();
  for (const b of myBets) {
    const list = betsByMatch.get(b.match_id);
    if (list) list.push(b);
    else betsByMatch.set(b.match_id, [b]);
  }
  const hasCompleteCore = (matchId: string) => {
    const bs = betsByMatch.get(matchId) ?? [];
    return bs.some(b => b.bet_type === 'outcome') && bs.some(b => b.bet_type === 'exact_score');
  };

  const anyFinished = members.some(m => m.status === 'finished');
  const allSettled = members.every(m => m.settled_at != null);
  const coreCompleteAll = members.every(m => hasCompleteCore(m.id));

  const state: 'recap' | 'settling' | 'allset' | 'betting' = allSettled
    ? 'recap'
    : anyFinished
      ? 'settling'
      : coreCompleteAll
        ? 'allset'
        : 'betting';

  // ─── recap (state 4) ─────────────────────────────────────────────────────────
  if (state === 'recap') {
    const recap = await buildRecap(managerId, slateKey, members, myBets);
    return (
      <Shell>
        <Recap data={recap} />
      </Shell>
    );
  }

  // ─── settling (state 3) ────────────────────────────────────────────────────
  if (state === 'settling') {
    const settledCount = members.filter(m => m.settled_at != null).length;
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
      </Shell>
    );
  }

  // ─── betting (1) & all-set (2) ───────────────────────────────────────────────
  const firstKickoff = members[0].kickoff_at;
  const missingCount = members.filter(m => !hasCompleteCore(m.id)).length;

  return (
    <Shell>
      <SlateHeader slateKey={slateKey} />

      {state === 'allset' ? (
        <Card variant="glass" padding="md" className="flex items-center gap-3">
          <CheckCircle2 className="size-6 shrink-0 text-success" aria-hidden />
          <div className="min-w-0">
            <p className="font-display font-bold text-foreground">You’re all set</p>
            <p className="text-sm text-muted">
              Slip in for every match. Bets stay editable until each kickoff — first is {formatKickoff(firstKickoff)}.
            </p>
          </div>
        </Card>
      ) : (
        <Card variant="glass" padding="md" className="flex items-center gap-3">
          <Ticket className="size-6 shrink-0 text-primary-bright" aria-hidden />
          <div className="min-w-0">
            <p className="font-display font-bold text-foreground">Build tonight’s slip</p>
            <p className="text-sm text-muted">
              {missingCount} of {members.length} {missingCount === 1 ? 'match' : 'matches'} still need a pick.
            </p>
          </div>
        </Card>
      )}

      <div className="space-y-2.5">
        {members.map(m => {
          const locked = m.status !== 'scheduled' || now >= new Date(m.kickoff_at);
          const bs = betsByMatch.get(m.id) ?? [];
          const outcome = bs.find(b => b.bet_type === 'outcome');
          const exact = bs.find(b => b.bet_type === 'exact_score');
          const prop = bs.find(b => PROP_LABEL[b.bet_type]);
          const complete = hasCompleteCore(m.id);
          const totalStake = bs.reduce((s, b) => s + b.stake_coins, 0);

          return (
            <Link
              key={m.id}
              href={`/matches/${m.id}`}
              className="glass group flex flex-col gap-3 rounded-2xl px-4 py-3.5 transition-[transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-border-strong"
            >
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
                      {prop ? ' · prop' : ''}
                    </span>
                    {totalStake > 0 && <Badge variant="primary" size="sm">{totalStake}¢ staked</Badge>}
                    {!locked && <Pencil className="size-3.5 shrink-0 text-subtle" aria-hidden />}
                  </span>
                ) : locked ? (
                  <span className="text-xs text-subtle">No bet</span>
                ) : (
                  <Badge variant="primary" size="sm"><Ticket aria-hidden />Add picks</Badge>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {state === 'betting' && (
        <p className="text-center text-xs text-subtle">
          Tap a match to set your outcome, score, and optional player prop.
        </p>
      )}
    </Shell>
  );
}

// ─── recap data builder ─────────────────────────────────────────────────────────

async function buildRecap(
  managerId: string,
  slateKey: string,
  members: MatchRow[],
  myBets: Bet[],
): Promise<RecapData> {
  const memberIds = members.map(m => m.id);

  // Player names for any prop picks on the slate (mine + others not needed — only mine show).
  const propIds = myBets
    .filter(b => PROP_LABEL[b.bet_type])
    .map(b => (b.selection as FootballerSelection).footballer_id);
  const playerName = new Map<string, string>();
  if (propIds.length > 0) {
    const { data: players } = await db.from('footballers').select('id, name').in('id', propIds);
    for (const p of players ?? []) playerName.set(p.id as string, p.name as string);
  }

  // Per-match picks.
  const betsByMatch = new Map<string, Bet[]>();
  for (const b of myBets) {
    const list = betsByMatch.get(b.match_id);
    if (list) list.push(b);
    else betsByMatch.set(b.match_id, [b]);
  }

  const recapMatches: RecapMatch[] = members.map(m => {
    const bs = betsByMatch.get(m.id) ?? [];
    const picks: RecapPick[] = bs
      .map(b => {
        if (b.bet_type === 'outcome') {
          const sel = b.selection as OutcomeSelection;
          return { label: 'Outcome', detail: outcomeLabel(sel.result, m.home_team.name, m.away_team.name), result: b.status, staked: b.stake_coins } as RecapPick;
        }
        if (b.bet_type === 'exact_score') {
          const sel = b.selection as ExactScoreSelection;
          return { label: 'Score', detail: `${sel.home}–${sel.away}`, result: b.status, staked: b.stake_coins } as RecapPick;
        }
        if (PROP_LABEL[b.bet_type]) {
          const sel = b.selection as FootballerSelection;
          return { label: PROP_LABEL[b.bet_type], detail: playerName.get(sel.footballer_id) ?? 'Unknown', result: b.status, staked: b.stake_coins } as RecapPick;
        }
        return null;
      })
      .filter((p): p is RecapPick => p != null);

    return {
      id: m.id,
      home: m.home_team.name,
      away: m.away_team.name,
      homeCode: m.home_team.country_code,
      awayCode: m.away_team.country_code,
      homeScore: m.home_score ?? 0,
      awayScore: m.away_score ?? 0,
      picks,
    };
  });

  const pointsGained = myBets.reduce((s, b) => s + (b.glory_awarded ?? 0), 0);

  // Coin breakdown from this manager's ledger, scoped to the slate.
  const myBetIds = new Set(myBets.map(b => b.id));
  const { data: ledgerRows } = await db
    .from('ledger')
    .select('*')
    .eq('manager_id', managerId)
    .eq('currency', 'coins');
  const slateLedger = ((ledgerRows ?? []) as LedgerEntry[]).filter(
    e =>
      (e.ref_type === 'bet' && myBetIds.has(e.ref_id)) ||
      (e.ref_type === 'slate' && e.ref_id === slateKey),
  );
  const sumReason = (reason: string) =>
    slateLedger.filter(e => e.reason === reason).reduce((s, e) => s + e.amount, 0);

  const itemDefs: { reason: string; label: string }[] = [
    { reason: 'participation', label: 'Participation' },
    { reason: 'clean_slate', label: 'Clean slate' },
    { reason: 'bet_coin', label: 'Bet winnings' },
    { reason: 'stake_loss', label: 'Stakes lost' },
  ];
  const coinItems: RecapCoinItem[] = itemDefs
    .map(d => ({ label: d.label, amount: sumReason(d.reason) }))
    .filter(it => it.amount !== 0);
  const coinsGained = coinItems.reduce((s, it) => s + it.amount, 0);

  // Leaderboard before/after. `after` = current Glory; `before` = current minus the
  // Glory this manager earned on the slate (from bet.glory_awarded).
  const { data: managers } = await db
    .from('managers')
    .select('id, display_name, glory, coins');
  const allManagers = (managers ?? []) as Pick<Manager, 'id' | 'display_name' | 'glory' | 'coins'>[];

  const { data: allSlateBets } = await db
    .from('bets')
    .select('manager_id, glory_awarded')
    .in('match_id', memberIds);
  const gainedByManager = new Map<string, number>();
  for (const b of allSlateBets ?? []) {
    gainedByManager.set(b.manager_id, (gainedByManager.get(b.manager_id) ?? 0) + (b.glory_awarded ?? 0));
  }

  const withScores = allManagers.map(m => ({
    id: m.id,
    name: m.display_name,
    after: m.glory,
    before: m.glory - (gainedByManager.get(m.id) ?? 0),
    isYou: m.id === managerId,
  }));
  const rankBefore = new Map<string, number>();
  [...withScores].sort((a, b) => b.before - a.before).forEach((m, i) => rankBefore.set(m.id, i + 1));
  const rankAfter = new Map<string, number>();
  [...withScores].sort((a, b) => b.after - a.after).forEach((m, i) => rankAfter.set(m.id, i + 1));

  const standings: RecapStanding[] = withScores.map(m => ({
    ...m,
    rankBefore: rankBefore.get(m.id)!,
    rankAfter: rankAfter.get(m.id)!,
  }));

  const balance = allManagers.find(m => m.id === managerId)?.coins ?? 0;

  return {
    slateLabel: slateLabel(slateKey),
    matches: recapMatches,
    pointsGained,
    coinItems,
    coinsGained,
    standings,
    balance,
  };
}

// ─── chrome ──────────────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-lg space-y-5 px-4 py-8">{children}</main>
    </>
  );
}

function SlateHeader({ slateKey }: { slateKey: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <CalendarDays className="size-6 text-primary-bright" aria-hidden />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Today</h1>
        <p className="text-xs text-subtle">{slateLabel(slateKey)} slate</p>
      </div>
    </div>
  );
}
