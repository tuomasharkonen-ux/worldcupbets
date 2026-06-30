import { redirect } from 'next/navigation';
import Link from 'next/link';
import { CalendarDays, Clock, Lock, CircleDot, CheckCircle2, Ticket, Loader2, Coffee, Pencil, Eye } from 'lucide-react';
import { getSession, requireOnboarded } from '@/lib/session';
import { db } from '@/lib/supabase';
import { Nav } from '@/components/Nav';
import { Countdown } from '@/components/Countdown';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Flag } from '@/components/ui/flag';
import { currentSlateKey, slateKeyOf, slateLabel } from '@/lib/slate';
import { matchDayNumber } from '@/lib/matchday';
import { buildSlateShareText } from '@/lib/share';
import { Recap, type RecapData, type RecapMatch, type RecapPick, type RecapCoinItem, type RecapStanding, type RecapFavoriteItem } from './Recap';
import { ShareBetsButton } from './ShareBetsButton';
import { Social } from './Social';
import { buildSocialData } from './social-data';
import { markRecapSeen } from './actions';
import { nudgeSettlement } from '@/settlement/run';
import type {
  Bet,
  ExactScoreSelection,
  FootballerSelection,
  League,
  LedgerEntry,
  Manager,
  ManagerState,
  Match,
  OutcomeSelection,
  Team,
} from '@/types/db';
import { BONUS_LABEL, bonusDetail, isBonusBet, isPlayerBonusBet } from '@/lib/bonus-bets';

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

// Live (non-void) members of a given slate. Pulls a generous UTC window around the
// slate's Helsinki day, then filters to the exact slate — membership is computed
// from kickoff, never stored.
async function fetchSlateMembers(slateKey: string, rollover: number): Promise<MatchRow[]> {
  const dayMs = 24 * 60 * 60 * 1000;
  const slateMidnightUtc = new Date(`${slateKey}T00:00:00Z`).getTime();
  const windowStart = new Date(slateMidnightUtc - dayMs).toISOString();
  const windowEnd = new Date(slateMidnightUtc + 2 * dayMs).toISOString();

  const { data } = await db
    .from('matches')
    .select('*, home_team:home_team_id(*), away_team:away_team_id(*)')
    .gte('kickoff_at', windowStart)
    .lte('kickoff_at', windowEnd)
    // Secondary sort by the stable id PK: kickoff_at alone leaves the order of two
    // same-kickoff matches undefined, so it can differ from the match page's stepper
    // order and from load to load. Pinning it keeps the slate (and the remaining-bets
    // count) consistent with the stepper navigation in matches/[matchId]/page.tsx.
    .order('kickoff_at', { ascending: true })
    .order('id', { ascending: true });

  return ((data ?? []) as MatchRow[]).filter(
    m => m.status !== 'void' && slateKeyOf(m.kickoff_at, rollover) === slateKey,
  );
}

// Favorite-team milestone (migration 009): the ledger reason suffix earned by reaching
// a stage maps from the team's match stage; champion/third are won, handled separately.
const STAGE_RUNG: Record<string, string> = { r32: 'r32', r16: 'r16', qf: 'qf', sf: 'sf', final: 'final' };
const MILESTONE_LABEL: Record<string, string> = {
  r32: 'Out of the group',
  r16: 'Reached the round of 16',
  qf: 'Reached the quarter-final',
  sf: 'Reached the semi-final',
  third: 'Won the 3rd-place playoff',
  final: 'Reached the final',
  champion: 'Champions! 🏆',
};

function outcomeLabel(result: string, home: string, away: string): string {
  return result === 'home' ? home : result === 'away' ? away : 'Draw';
}

export default async function TodayPage() {
  const session = await getSession();
  if (!session.managerId) redirect('/join');
  await requireOnboarded(session.managerId);
  const managerId = session.managerId;

  const { data: league } = await db
    .from('league')
    .select('config')
    .eq('id', 1)
    .single<Pick<League, 'config'>>();
  const rollover = league?.config.daily?.rollover_hour_local ?? 9;

  const now = new Date();

  // Settle on read: if results are in but the morning cron (06–10 Helsinki) hasn't
  // run since — e.g. a match that finished late in the morning — kick a background
  // settlement pass so the recap below becomes available the same day, for everyone,
  // instead of waiting for tomorrow's sweep. Non-blocking (runs after the response)
  // and throttled, so it never slows the page.
  nudgeSettlement();

  // ─── pending recap ───────────────────────────────────────────────────────────
  // A settled slate's recap stays pending until this manager dismisses it ("Next
  // match day"), tracked in managers.state.recap_seen_slate. We surface the *earliest*
  // slate the manager hasn't dismissed yet, and show it only once every match on it is
  // settled. Anchoring on the earliest unseen slate — not the latest-settled one —
  // means a newer slate settling first can never silently bury an older owed recap,
  // and it survives the 09:00 rollover (settlement landing after rollover just shows
  // the recap on the next load instead of never).
  const { data: managerRow } = await db
    .from('managers')
    .select('state')
    .eq('id', managerId)
    .maybeSingle();
  const seenSlate = ((managerRow?.state ?? {}) as ManagerState).recap_seen_slate ?? '';

  // First non-void match on or after the seen slate whose slate is newer than it: its
  // slate is the earliest one the manager still owes a recap for. (Slate keys sort
  // lexicographically, same as chronologically, since they're YYYY-MM-DD.)
  const { data: unseenRows } = await db
    .from('matches')
    .select('kickoff_at')
    .neq('status', 'void')
    .gte('kickoff_at', `${seenSlate || '1970-01-01'}T00:00:00Z`)
    .order('kickoff_at', { ascending: true });
  const recapSlateKey = (unseenRows ?? [])
    .map(r => slateKeyOf(r.kickoff_at as string, rollover))
    .find(k => k > seenSlate);
  if (recapSlateKey) {
    const recapMembers = await fetchSlateMembers(recapSlateKey, rollover);
    if (recapMembers.length > 0 && recapMembers.every(m => m.settled_at != null)) {
      const { data: recapBetRows } = await db
        .from('bets')
        .select('*')
        .eq('manager_id', managerId)
        .in('match_id', recapMembers.map(m => m.id));
      const recap = await buildRecap(managerId, recapSlateKey, recapMembers, (recapBetRows ?? []) as Bet[]);
      return (
        <Shell>
          <Recap data={recap} doneAction={markRecapSeen.bind(null, recapSlateKey)} />
        </Shell>
      );
    }
  }

  let slateKey = currentSlateKey(now, rollover);
  let members = await fetchSlateMembers(slateKey, rollover);

  // If the current slate has no fixtures (a rest day) — or it's fully settled and its
  // recap has been dismissed above — jump ahead to the next slate that has matches.
  // We always surface the next *known* matches, with betting open until their kickoff,
  // rather than a dead-end "nothing today".
  let isUpcoming = false;
  if (members.length === 0 || members.every(m => m.settled_at != null)) {
    const { data: nextRows } = await db
      .from('matches')
      .select('kickoff_at')
      .neq('status', 'void')
      .gte('kickoff_at', now.toISOString())
      .order('kickoff_at', { ascending: true })
      .limit(1);
    const nextKickoff = nextRows?.[0]?.kickoff_at as string | undefined;
    if (nextKickoff) {
      slateKey = slateKeyOf(nextKickoff, rollover);
      members = await fetchSlateMembers(slateKey, rollover);
      isUpcoming = true;
    } else {
      members = []; // settled slate with nothing ahead → fall to the empty state
    }
  }

  // ─── no fixtures known ───────────────────────────────────────────────────────
  // The only empty state left: the schedule ahead genuinely isn't published yet (rare).
  if (members.length === 0) {
    return (
      <Shell>
        <SlateHeader slateKey={slateKey} />
        <Card variant="glass" padding="lg" className="space-y-3 text-center">
          <Coffee className="mx-auto size-8 text-subtle" aria-hidden />
          <p className="font-display text-lg font-bold text-foreground">No matches yet</p>
          <p className="text-sm text-muted">
            The next fixtures haven’t been published yet. Check the{' '}
            <Link href="/fixtures" className="font-medium text-primary-bright hover:underline">full schedule</Link>{' '}
            once they’re announced.
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

  // Once the slate's last match has kicked off nothing is editable any more, so the
  // page flips to "results are coming in" right away — not when the first result
  // lands in the database. (A fully settled slate never reaches here: the recap or
  // the jump-ahead above already claimed it.)
  const lastKickoffPassed = now >= new Date(members[members.length - 1].kickoff_at);
  const coreCompleteAll = members.every(m => hasCompleteCore(m.id));

  const state: 'settling' | 'allset' | 'betting' = lastKickoffPassed
    ? 'settling'
    : coreCompleteAll
      ? 'allset'
      : 'betting';

  // The social layer (everyone's bets + the banter feed) lives on the slate from
  // the moment your slip is in until the recap takes over.
  const social =
    state === 'allset' || state === 'settling'
      ? await buildSocialData({ viewerId: managerId, slateKey, members, now })
      : null;
  // Once every match on the slate is settled the feed is frozen and the recap is
  // imminent — stop the client poll so open tabs don't keep re-querying the feed.
  const socialPoll = social != null && !members.every(m => m.settled_at != null);

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
        {social && <Social data={social} poll={socialPoll} />}
      </Shell>
    );
  }

  // ─── betting (1) & all-set (2) ───────────────────────────────────────────────
  const firstKickoff = members[0].kickoff_at;

  // Game-day number for the slate, numbered over the whole (non-void) schedule so it
  // matches the full fixtures list and the recap.
  const { data: allKickoffs } = await db
    .from('matches')
    .select('kickoff_at')
    .neq('status', 'void');
  const matchDay = matchDayNumber((allKickoffs ?? []).map(r => r.kickoff_at as string), firstKickoff);

  // Shareable, Wordle-style digest of this manager's picks — only meaningful once
  // every slip is in (the all-set state), so build it lazily there.
  const shareText = state === 'allset' ? await buildShareText(matchDay, members, betsByMatch) : null;

  // Player names for any prop picks, so the all-set list can name the footballer.
  const propPlayerName = new Map<string, string>();
  if (state === 'allset') {
    const propIds = myBets
      .filter(b => isPlayerBonusBet(b.bet_type))
      .map(b => (b.selection as FootballerSelection).footballer_id);
    if (propIds.length > 0) {
      const { data: players } = await db.from('footballers').select('id, name').in('id', propIds);
      for (const p of players ?? []) propPlayerName.set(p.id as string, p.name as string);
    }
  }

  // All-set row: the slip is in for every match here, so lead with the prediction
  // itself — flags flanking the called scoreline — and offer a real Edit button.
  // Group label and the open/locked chip are intentionally dropped as noise.
  function AllSetRow({ m }: { m: MatchRow }) {
    const locked = m.status !== 'scheduled' || now >= new Date(m.kickoff_at);
    const bs = betsByMatch.get(m.id) ?? [];
    const outcome = bs.find(b => b.bet_type === 'outcome')!;
    const exact = bs.find(b => b.bet_type === 'exact_score')!;
    const bonus = bs.find(b => isBonusBet(b.bet_type));
    const ex = exact.selection as ExactScoreSelection;
    const mult = outcome.stake_mult; // one stake/multiplier per match slip
    const bonusText = bonus
      ? bonusDetail(bonus, {
          playerName: id => propPlayerName.get(id),
          homeTeam: m.home_team.name,
          awayTeam: m.away_team.name,
        })
      : null;

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

        {bonus && (
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted">
            <span className="text-subtle">{BONUS_LABEL[bonus.bet_type as keyof typeof BONUS_LABEL]}:</span>
            <span className="font-medium text-foreground">{bonusText ?? 'Unknown'}</span>
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
          {locked ? (
            <Button asChild size="sm" variant="glass" className="shrink-0">
              <Link href={`/matches/${m.id}`}>
                <Eye aria-hidden />
                View result
              </Link>
            </Button>
          ) : (
            <Button asChild size="sm" variant="glass" className="shrink-0">
              <Link href={`/matches/${m.id}?edit=1`}>
                <Pencil aria-hidden />
                Edit bet
              </Link>
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Inner row content, shared between the clickable (all-set) and plain (betting) layouts.
  // `editable` shows the pencil affordance only where a row actually links somewhere.
  function MatchRowInner({ m, editable }: { m: MatchRow; editable: boolean }) {
    const locked = m.status !== 'scheduled' || now >= new Date(m.kickoff_at);
    const bs = betsByMatch.get(m.id) ?? [];
    const outcome = bs.find(b => b.bet_type === 'outcome');
    const exact = bs.find(b => b.bet_type === 'exact_score');
    const bonus = bs.find(b => isBonusBet(b.bet_type));
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
                {bonus ? ' · bonus bet' : ''}
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
            <Link href={`/matches/${members[0].id}`}>
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
          {members.map(m => (
            <AllSetRow key={m.id} m={m} />
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {members.map(m => (
            <div key={m.id} className="flex flex-col gap-3 px-1 py-3.5">
              <MatchRowInner m={m} editable={false} />
            </div>
          ))}
        </div>
      )}

      {social && <Social data={social} poll={socialPoll} />}
    </Shell>
  );
}

// ─── share text builder ─────────────────────────────────────────────────────────

// Fetches the prop player names, then delegates to the pure builder shared with the
// /admin preview (see lib/share.ts).
async function buildShareText(
  matchDay: number,
  members: MatchRow[],
  betsByMatch: Map<string, Bet[]>,
): Promise<string> {
  const propIds = members
    .flatMap(m => betsByMatch.get(m.id) ?? [])
    .filter(b => isPlayerBonusBet(b.bet_type))
    .map(b => (b.selection as FootballerSelection).footballer_id);
  const playerName = new Map<string, string>();
  if (propIds.length > 0) {
    const { data: players } = await db.from('footballers').select('id, name').in('id', propIds);
    for (const p of players ?? []) playerName.set(p.id as string, p.name as string);
  }
  return buildSlateShareText(matchDay, members, betsByMatch, playerName);
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
    .filter(b => isPlayerBonusBet(b.bet_type))
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
        const points = b.glory_awarded ?? 0;
        if (b.bet_type === 'outcome') {
          const sel = b.selection as OutcomeSelection;
          return { label: 'Outcome', detail: outcomeLabel(sel.result, m.home_team.name, m.away_team.name), result: b.status, points } as RecapPick;
        }
        if (b.bet_type === 'exact_score') {
          const sel = b.selection as ExactScoreSelection;
          return { label: 'Score', detail: `${sel.home}–${sel.away}`, result: b.status, points } as RecapPick;
        }
        if (isBonusBet(b.bet_type)) {
          const detail = bonusDetail(b, {
            playerName: id => playerName.get(id),
            homeTeam: m.home_team.name,
            awayTeam: m.away_team.name,
          });
          return { label: BONUS_LABEL[b.bet_type], detail, result: b.status, points } as RecapPick;
        }
        return null;
      })
      .filter((p): p is RecapPick => p != null);

    // One stake per match slip: coins recorded on the outcome bet, the multiplier
    // shared across every pick (GAME_DESIGN §5).
    const staked = bs.reduce((s, b) => s + b.stake_coins, 0);
    const stakeMult = bs[0]?.stake_mult ?? 1;

    return {
      id: m.id,
      home: m.home_team.name,
      away: m.away_team.name,
      homeCode: m.home_team.country_code,
      awayCode: m.away_team.country_code,
      homeScore: m.home_score ?? 0,
      awayScore: m.away_score ?? 0,
      picks,
      staked,
      stakeMult,
    };
  });

  const betPoints = myBets.reduce((s, b) => s + (b.glory_awarded ?? 0), 0);

  // Coin breakdown from this manager's ledger, scoped to the slate.
  const myBetIds = new Set(myBets.map(b => b.id));
  const { data: ledgerRows } = await db
    .from('ledger')
    .select('*')
    .eq('manager_id', managerId)
    .eq('currency', 'coins');
  const slateMatchIds = new Set(memberIds);
  const slateLedger = ((ledgerRows ?? []) as LedgerEntry[]).filter(
    e =>
      (e.ref_type === 'bet' && myBetIds.has(e.ref_id)) ||
      (e.ref_type === 'slate' && e.ref_id === slateKey) ||
      // Stake spend is recorded once per match (ref_type 'match'), not per bet — without
      // this clause the "Coins staked" line is dropped and the recap shows gross bet
      // winnings instead of the net actually added to the balance.
      (e.ref_type === 'match' && slateMatchIds.has(e.ref_id)),
  );
  const sumReason = (reason: string) =>
    slateLedger.filter(e => e.reason === reason).reduce((s, e) => s + e.amount, 0);

  const itemDefs: { reason: string; label: string }[] = [
    { reason: 'participation', label: 'Participation' },
    { reason: 'clean_slate', label: 'Clean slate' },
    { reason: 'bet_coin', label: 'Bet winnings' },
    { reason: 'stake_spend', label: 'Coins staked' },
  ];
  const coinItems: RecapCoinItem[] = itemDefs
    .map(d => ({ label: d.label, amount: sumReason(d.reason) }))
    .filter(it => it.amount !== 0);
  const coinsGained = coinItems.reduce((s, it) => s + it.amount, 0);

  // Leaderboard before/after. `after` = current Glory; `before` = current minus the
  // Glory this manager earned on the slate (from bet.glory_awarded).
  const { data: managers } = await db
    .from('managers')
    .select('id, display_name, glory, coins, favorite_team_id, favorite_footballer_id');
  const allManagers = (managers ?? []) as Pick<
    Manager,
    'id' | 'display_name' | 'glory' | 'coins' | 'favorite_team_id' | 'favorite_footballer_id'
  >[];

  const { data: allSlateBets } = await db
    .from('bets')
    .select('manager_id, glory_awarded')
    .in('match_id', memberIds);
  const gainedByManager = new Map<string, number>();
  for (const b of allSlateBets ?? []) {
    gainedByManager.set(b.manager_id, (gainedByManager.get(b.manager_id) ?? 0) + (b.glory_awarded ?? 0));
  }

  // ── favorites (migration 009): fold this slate's favorite-player + favorite-team
  // Points into the standings delta (so before/after ranks stay exact) and itemise
  // them for this manager's breakdown.
  const favItems: RecapFavoriteItem[] = [];
  let myFavTotal = 0;
  {
    // Per-manager favorite-player Points keyed by match — one ledger row per match.
    const { data: favPlayerRows } = await db
      .from('ledger')
      .select('manager_id, amount, ref_id')
      .eq('currency', 'glory')
      .eq('reason', 'fav_player')
      .in('ref_id', memberIds);
    // Per-(manager,milestone) favorite-team Points — season-scoped, attributed below to
    // the slate where the team's matching match was played.
    const { data: teamRows } = await db
      .from('ledger')
      .select('manager_id, amount, reason')
      .eq('currency', 'glory')
      .eq('ref_type', 'season')
      .like('reason', 'team_%');
    const teamAmount = new Map<string, number>();
    for (const r of teamRows ?? []) teamAmount.set(`${r.manager_id}:${r.reason}`, r.amount);

    // The milestone keys a team can claim from its matches *on this slate* — reach-rungs
    // from each stage played, plus champion/third when won here.
    //
    // r16/qf/sf's "reach" milestone only becomes claimable once the next round's fixture
    // exists (REACH_RUNGS in settlement/favorites.ts fires on the fixture existing, not on
    // winning) — and that fixture isn't assigned until the bracket updates after this win,
    // typically the next fixtures-sync. Without WIN_UNLOCKS, the recap would only ever show
    // e.g. "reached r16" on the slate of the r16 match itself, days after the team actually
    // got there — so a manager would never see "Norway beat Ivory Coast → +Points for
    // reaching R16" the morning after the win, only whenever R16 kicks off. Attributing it
    // here, to the win, surfaces it as soon as the ledger amount exists (recap is built live
    // on every render until dismissed, so an early check before the bracket syncs just won't
    // show it yet; a later one will).
    const WIN_UNLOCKS: Record<string, string> = { r32: 'r16', r16: 'qf', qf: 'sf', sf: 'final' };
    const milestoneKeysFor = (teamId: string): string[] => {
      const keys = new Set<string>();
      for (const m of members) {
        if (m.home_team_id !== teamId && m.away_team_id !== teamId) continue;
        if (STAGE_RUNG[m.stage]) keys.add(STAGE_RUNG[m.stage]);
        if (m.stage === 'final' && m.status === 'finished' && m.winner_team_id === teamId) keys.add('champion');
        if (m.stage === 'third' && m.status === 'finished' && m.winner_team_id === teamId) keys.add('third');
        if (m.status === 'finished' && m.winner_team_id === teamId && WIN_UNLOCKS[m.stage]) {
          keys.add(WIN_UNLOCKS[m.stage]);
        }
      }
      return [...keys];
    };

    for (const mgr of allManagers) {
      let favTotal = (favPlayerRows ?? [])
        .filter(r => r.manager_id === mgr.id)
        .reduce((s, r) => s + r.amount, 0);
      if (mgr.favorite_team_id) {
        for (const key of milestoneKeysFor(mgr.favorite_team_id)) {
          favTotal += teamAmount.get(`${mgr.id}:team_${key}`) ?? 0;
        }
      }
      if (favTotal !== 0) gainedByManager.set(mgr.id, (gainedByManager.get(mgr.id) ?? 0) + favTotal);
      if (mgr.id === managerId) myFavTotal = favTotal;
    }

    // Itemise this manager's favorites for the recap breakdown.
    const me = allManagers.find(m => m.id === managerId);
    if (me?.favorite_footballer_id) {
      const { data: events } = await db
        .from('match_events')
        .select('match_id, type, is_own_goal')
        .eq('footballer_id', me.favorite_footballer_id)
        .in('match_id', memberIds);
      const { data: playerRow } = await db
        .from('footballers')
        .select('name')
        .eq('id', me.favorite_footballer_id)
        .maybeSingle();
      const playerName = (playerRow?.name as string | undefined) ?? 'Your player';
      const playerPtsByMatch = new Map<string, number>();
      for (const r of favPlayerRows ?? []) {
        if (r.manager_id === managerId) playerPtsByMatch.set(r.ref_id, r.amount);
      }
      for (const m of members) {
        const pts = playerPtsByMatch.get(m.id);
        if (pts == null) continue; // player didn't feature / nothing scored or booked
        const evs = (events ?? []).filter(e => e.match_id === m.id);
        const goals = evs.filter(e => (e.type === 'goal' || e.type === 'penalty') && !e.is_own_goal).length;
        const booked = evs.some(e => e.type === 'yellow' || e.type === 'red');
        const parts: string[] = [];
        if (goals > 0) parts.push(`${goals} goal${goals > 1 ? 's' : ''}`);
        if (booked) parts.push('booked');
        favItems.push({ kind: 'player', label: playerName, detail: parts.join(' · ') || 'featured', points: pts });
      }
    }
    if (me?.favorite_team_id) {
      const teamMatch = members.find(
        m => m.home_team_id === me.favorite_team_id || m.away_team_id === me.favorite_team_id,
      );
      const teamName = teamMatch
        ? (teamMatch.home_team_id === me.favorite_team_id ? teamMatch.home_team.name : teamMatch.away_team.name)
        : 'Your team';
      for (const key of milestoneKeysFor(me.favorite_team_id)) {
        const pts = teamAmount.get(`${managerId}:team_${key}`);
        if (pts == null) continue;
        favItems.push({ kind: 'team', label: teamName, detail: MILESTONE_LABEL[key] ?? key, points: pts });
      }
    }
  }
  const pointsGained = betPoints + myFavTotal;

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

  // Match-day number for the slate, numbered over the whole (non-void) schedule so it
  // matches the full fixtures list.
  const { data: allKickoffs } = await db
    .from('matches')
    .select('kickoff_at')
    .neq('status', 'void');
  const matchDay = matchDayNumber(
    (allKickoffs ?? []).map(r => r.kickoff_at as string),
    members[0].kickoff_at,
  );

  return {
    matchDay,
    matches: recapMatches,
    pointsGained,
    favoriteItems: favItems,
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
