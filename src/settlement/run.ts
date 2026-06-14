import { after } from 'next/server';
import { db } from '@/lib/supabase';
import { getCompetitionMatches, getMatchDetail, mapFdStatus } from '@/lib/football-data';
import { getFixtureEvents, getFixtureLineups, type AfEvent } from '@/lib/api-football';
import { settle, settleBet } from '@/settlement/engine';
import { closeSlate } from '@/settlement/dayclose';
import {
  favoritePlayerDeltas,
  teamLadderDeltas,
  teamMultiplier,
  type LadderMatch,
} from '@/settlement/favorites';
import { slateKeyOf } from '@/lib/slate';
import type { Bet, EventType, League, ManagerState, Match, MatchEvent } from '@/types/db';

// bet_types that need match_events / lineups to settle
const PROP_BET_TYPES = ['first_scorer', 'anytime_scorer', 'carded'];

export interface SettlementResult {
  statusesSynced: number;
  settled: number;
  slatesClosed: number;
  favTeamAwards: number;
}

// The full settlement pass: sync started-match statuses from football-data, settle
// every finished-but-unsettled match, close any now-complete slate, and award
// favorite-team milestones. Idempotent — safe to run from the cron and from the
// on-read nudge concurrently. Shared by both so they can never drift apart.
export async function runSettlement(): Promise<SettlementResult> {
  // Flip status/score for matches that have kicked off, so settlement never waits
  // on the once-daily fixtures-sync. Best-effort: a football-data outage must not
  // block settling matches that are already marked finished.
  let statusesSynced = 0;
  try {
    statusesSynced = await syncStartedMatchStatuses();
  } catch (err) {
    console.error('[settle] status sync failed (continuing):', err);
  }
  const { settled, slatesClosed } = await settleFinishedMatches();
  // Favorite-team advancement ladder (migration 009). Runs every tick, independent
  // of which matches just finished: a reach-a-stage milestone fires as soon as the
  // knockout fixture appears, and champion/third resolve when those games finish.
  const favTeamAwards = await settleFavoriteTeams();
  return { statusesSynced, settled, slatesClosed, favTeamAwards };
}

// True when there is settlement work outstanding: a finished match not yet settled,
// or a match that has kicked off but whose status we haven't synced to finished yet.
// Cheap (two head-count queries) so it can gate the on-read nudge.
export async function hasPendingSettlement(): Promise<boolean> {
  const nowIso = new Date().toISOString();

  const { count: unsettled } = await db
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'finished')
    .is('settled_at', null);
  if ((unsettled ?? 0) > 0) return true;

  const { count: stale } = await db
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .in('status', ['scheduled', 'live'])
    .lte('kickoff_at', nowIso);
  return (stale ?? 0) > 0;
}

// In-memory throttle for the on-read nudge. Fluid Compute reuses instances, so this
// suppresses the common case (one warm instance serving several managers). A rare
// cross-instance double-run is harmless: runSettlement is idempotent. The morning
// cron remains the backstop if every nudge in a window happens to no-op.
let lastNudgeAt = 0;
const NUDGE_THROTTLE_MS = 2 * 60 * 1000;

// Fire settlement in the background once results are in, without blocking the page.
// This is what guarantees the recap appears for everyone the same day: a match that
// finishes after the morning cron window (06–10 Helsinki) is settled as soon as any
// manager opens the app, instead of waiting for the next morning's sweep. Schedules
// via `after()`, so the current response is never slowed.
export function nudgeSettlement(): void {
  const now = Date.now();
  if (now - lastNudgeAt < NUDGE_THROTTLE_MS) return;
  lastNudgeAt = now;
  after(async () => {
    try {
      if (await hasPendingSettlement()) await runSettlement();
    } catch (err) {
      console.error('[settle] on-read nudge failed:', err);
    }
  });
}

// Pull status + score from football-data for every match that has kicked off but
// isn't finished/void in our DB yet, in one windowed call. This is what lets the
// hourly morning sweep settle results itself instead of waiting for the daily
// fixtures-sync at 08:00 Helsinki (the match-day-1 recap was missed exactly because
// statuses flipped that late and settlement landed seconds after slate rollover).
async function syncStartedMatchStatuses(): Promise<number> {
  const now = new Date();
  const { data: staleRows, error } = await db
    .from('matches')
    .select('id, fd_match_id, home_team_id, away_team_id, status')
    .in('status', ['scheduled', 'live'])
    .lte('kickoff_at', now.toISOString());
  if (error) throw error;
  const stale = staleRows ?? [];
  if (stale.length === 0) return 0;

  // One window call covers everything started-but-unfinished (a match never spans
  // more than a day; pad both sides for timezone safety).
  const dayMs = 24 * 60 * 60 * 1000;
  const dateFrom = new Date(now.getTime() - 2 * dayMs).toISOString().slice(0, 10);
  const dateTo = new Date(now.getTime() + dayMs).toISOString().slice(0, 10);
  const { matches: fdMatches } = await getCompetitionMatches(dateFrom, dateTo);
  const byFdId = new Map(fdMatches.map(m => [m.id, m]));

  let updated = 0;
  for (const row of stale) {
    const fd = byFdId.get(row.fd_match_id as number);
    if (!fd) continue;
    const status = mapFdStatus(fd.status);
    // Skip only when the feed still says not-started; live rows re-write to refresh scores.
    if (status === 'scheduled' && row.status === 'scheduled') continue;
    const winnerTeamId =
      fd.score?.winner === 'HOME_TEAM'
        ? row.home_team_id
        : fd.score?.winner === 'AWAY_TEAM'
          ? row.away_team_id
          : null;
    const { error: updErr } = await db
      .from('matches')
      .update({
        status,
        home_score: fd.score?.fullTime?.home ?? null,
        away_score: fd.score?.fullTime?.away ?? null,
        winner_team_id: winnerTeamId,
      })
      .eq('id', row.id);
    if (updErr) {
      console.error(`[settle] status update for match ${row.id} failed:`, updErr);
      continue;
    }
    updated++;
  }
  return updated;
}

async function settleFinishedMatches(): Promise<{ settled: number; slatesClosed: number }> {
  // Load config once
  const { data: league, error: leagueErr } = await db
    .from('league')
    .select('*')
    .eq('id', 1)
    .single<League>();
  if (leagueErr || !league) throw new Error('Could not load league config');

  // Find finished, unsettled matches
  const { data: matches, error: matchErr } = await db
    .from('matches')
    .select('*')
    .eq('status', 'finished')
    .is('settled_at', null);
  if (matchErr) throw matchErr;
  if (!matches || matches.length === 0) return { settled: 0, slatesClosed: 0 };

  const justSettled: Match[] = [];
  for (const match of matches as Match[]) {
    try {
      if (await settleMatch(match, league)) justSettled.push(match);
    } catch (err) {
      console.error(`[settle] match ${match.id} failed:`, err);
      // Continue to next match — one failure doesn't block others
    }
  }

  // Day-close: any slate whose matches we just finished may now be fully settled.
  // Grant slate-scoped bonuses (participation, clean-slate) + advance streak state.
  const rollover = league.config.daily?.rollover_hour_local ?? 9;
  const touchedSlates = [...new Set(justSettled.map(m => slateKeyOf(m.kickoff_at, rollover)))].sort();
  let slatesClosed = 0;
  for (const slateKey of touchedSlates) {
    try {
      if (await closeCompletedSlate(slateKey, league, rollover)) slatesClosed++;
    } catch (err) {
      console.error(`[settle] day-close for slate ${slateKey} failed:`, err);
    }
  }

  return { settled: justSettled.length, slatesClosed };
}

// Favorite-team advancement ladder (migration 009). For every manager with a locked
// favorite team, award any milestones the team has now reached/won. Idempotent: each
// milestone is one ledger row keyed (reason='team_<stage>', ref_type='season',
// ref_id=season, manager_id), so re-running every 10 min is a no-op once awarded.
async function settleFavoriteTeams(): Promise<number> {
  const { data: league } = await db
    .from('league')
    .select('season, config')
    .eq('id', 1)
    .single<Pick<League, 'season' | 'config'>>();
  const fav = league?.config.favorites;
  if (!league || !fav) return 0; // favorites not configured → nothing to do

  const { data: mgrRows } = await db
    .from('managers')
    .select('id, favorite_team_id')
    .not('favorite_team_id', 'is', null);
  const managers = (mgrRows ?? []) as { id: string; favorite_team_id: string }[];
  if (managers.length === 0) return 0;

  // Odds for the favorite teams → underdog multipliers.
  const teamIds = [...new Set(managers.map(m => m.favorite_team_id))];
  const { data: teamRows } = await db.from('teams').select('id, champion_odds').in('id', teamIds);
  const oddsById = new Map<string, number | null>(
    (teamRows ?? []).map(t => [t.id as string, t.champion_odds as number | null]),
  );

  // Every non-void match — the ladder filters to each team's own games.
  const { data: matchRows } = await db
    .from('matches')
    .select('stage, status, home_team_id, away_team_id, winner_team_id')
    .neq('status', 'void');
  const matches = (matchRows ?? []) as LadderMatch[];

  // Already-awarded milestones, so we only write (and recompute) genuinely new ones —
  // teamLadderDeltas returns every milestone reached so far on each run.
  const { data: priorRows } = await db
    .from('ledger')
    .select('manager_id, reason')
    .eq('ref_type', 'season')
    .eq('ref_id', league.season)
    .like('reason', 'team_%')
    .in('manager_id', managers.map(m => m.id));
  const alreadyAwarded = new Set((priorRows ?? []).map(r => `${r.manager_id}:${r.reason}`));

  const allDeltas: { managerId: string; currency: string; amount: number; reason: string; refType: string; refId: string }[] = [];
  for (const m of managers) {
    const deltas = teamLadderDeltas({
      managerId: m.id,
      teamId: m.favorite_team_id,
      multiplier: teamMultiplier(oddsById.get(m.favorite_team_id), fav),
      matches,
      fav,
      seasonKey: league.season,
    });
    for (const d of deltas) {
      if (!alreadyAwarded.has(`${d.managerId}:${d.reason}`)) allDeltas.push(d);
    }
  }
  if (allDeltas.length === 0) return 0;

  const rows = allDeltas.map(d => ({
    manager_id: d.managerId,
    currency: d.currency,
    amount: d.amount,
    reason: d.reason,
    ref_type: d.refType,
    ref_id: d.refId,
  }));
  const { error } = await db
    .from('ledger')
    .upsert(rows, { onConflict: 'reason,ref_type,ref_id,manager_id', ignoreDuplicates: true });
  if (error) throw error;

  await recomputeBalances([...new Set(allDeltas.map(d => d.managerId))]);
  return allDeltas.length;
}

// Recompute the cached managers.glory / managers.coins from the append-only ledger
// (the source of truth) for the given managers.
async function recomputeBalances(managerIds: string[]): Promise<void> {
  for (const managerId of managerIds) {
    const { data: rows } = await db
      .from('ledger')
      .select('currency, amount')
      .eq('manager_id', managerId);

    const points = (rows ?? []).filter(r => r.currency === 'glory').reduce((s, r) => s + r.amount, 0);
    const coins = (rows ?? []).filter(r => r.currency === 'coins').reduce((s, r) => s + r.amount, 0);
    await db.from('managers').update({ glory: points, coins }).eq('id', managerId);
  }
}

// Run day-close for a slate, but only once every non-void match on it is settled.
// Returns true when the slate was complete (and processed), false when it's not
// ready yet. Idempotent: the ledger unique index dedupes coin grants and
// manager_state.last_closed_slate guards the streak counter.
async function closeCompletedSlate(slateKey: string, league: League, rollover: number): Promise<boolean> {
  // Slate membership is computed, not stored — derive it from every match's kickoff.
  const { data: allMatches, error } = await db
    .from('matches')
    .select('id, kickoff_at, status, settled_at');
  if (error) throw error;

  const members = (allMatches ?? []).filter(
    m => m.status !== 'void' && slateKeyOf(m.kickoff_at as string, rollover) === slateKey,
  );
  if (members.length === 0) return false;
  if (members.some(m => !m.settled_at)) return false; // not fully settled yet

  const memberIds = members.map(m => m.id as string);

  // All bets on the slate, grouped by manager.
  const { data: betRows, error: betsErr } = await db.from('bets').select('*').in('match_id', memberIds);
  if (betsErr) throw betsErr;
  const byManager = new Map<string, Bet[]>();
  for (const b of (betRows ?? []) as Bet[]) {
    const list = byManager.get(b.manager_id);
    if (list) list.push(b);
    else byManager.set(b.manager_id, [b]);
  }

  const managerIds = [...byManager.keys()];
  if (managerIds.length === 0) return true; // complete slate, but nobody bet

  // Prior per-manager state.
  const { data: mgrRows } = await db.from('managers').select('id, state').in('id', managerIds);
  const stateById = new Map<string, ManagerState>(
    (mgrRows ?? []).map(m => [m.id as string, (m.state ?? {}) as ManagerState]),
  );

  const affected = new Set<string>();
  for (const managerId of managerIds) {
    const result = closeSlate({
      managerId,
      slateKey,
      slateMatchIds: memberIds,
      bets: byManager.get(managerId)!,
      config: league.config,
      priorState: stateById.get(managerId) ?? {},
    });

    if (result.deltas.length > 0) {
      const rows = result.deltas.map(d => ({
        manager_id: d.managerId,
        currency: d.currency,
        amount: d.amount,
        reason: d.reason,
        ref_type: d.refType,
        ref_id: d.refId,
      }));
      const { error: ledgerErr } = await db
        .from('ledger')
        .upsert(rows, { onConflict: 'reason,ref_type,ref_id,manager_id', ignoreDuplicates: true });
      if (ledgerErr) throw ledgerErr;
      affected.add(managerId);
    }

    if (!result.alreadyClosed) {
      await db.from('managers').update({ state: result.newState }).eq('id', managerId);
    }
  }

  await recomputeBalances([...affected]);
  return true;
}

// Settles one match. Returns true when it actually settled, false when it was
// deferred (e.g. the goal feed hasn't landed yet) or already settled by a concurrent
// run — so the caller only runs day-close for slates it genuinely just completed.
async function settleMatch(match: Match, league: League): Promise<boolean> {
  // Re-check settled_at to guard against concurrent runs
  const { data: fresh } = await db
    .from('matches')
    .select('settled_at')
    .eq('id', match.id)
    .single();
  if (fresh?.settled_at) return false; // already settled by a concurrent invocation

  // Load open bets
  const { data: bets, error: betsErr } = await db
    .from('bets')
    .select('*')
    .eq('match_id', match.id)
    .eq('status', 'pending');
  if (betsErr) throw betsErr;
  const pendingBets = (bets ?? []) as Bet[];

  // Favorite-player bonus (migration 009): managers whose locked favorite player is in
  // this match earn Points for goals / lose some if booked — whether or not they bet.
  // Resolve which managers that's, so we know to pull match events for them too.
  const { data: squad } = await db
    .from('footballers')
    .select('id')
    .in('team_id', [match.home_team_id, match.away_team_id]);
  const squadIds = (squad ?? []).map(s => s.id as string);
  let favPlayers: { managerId: string; footballerId: string }[] = [];
  if (squadIds.length > 0) {
    const { data: favMgrs } = await db
      .from('managers')
      .select('id, favorite_footballer_id')
      .in('favorite_footballer_id', squadIds);
    favPlayers = (favMgrs ?? []).map(m => ({
      managerId: m.id as string,
      footballerId: m.favorite_footballer_id as string,
    }));
  }

  // Player props AND favorite players need goals/cards/lineups from football-data. Only
  // pay for the extra API call when something on this match actually depends on it.
  // If ingestion throws, we let settleMatch throw too: the match stays unsettled
  // (settled_at null) and the next cron run retries — better than prematurely
  // settling props on missing data.
  const hasProps = pendingBets.some(b => PROP_BET_TYPES.includes(b.bet_type));
  if (hasProps || favPlayers.length > 0) {
    await ingestMatchData(match);
  }

  // Load match events (goals, cards) + known appearances (for prop void logic)
  const { data: events, error: eventsErr } = await db
    .from('match_events')
    .select('*')
    .eq('match_id', match.id);
  if (eventsErr) throw eventsErr;

  const { data: appRows } = await db
    .from('match_appearances')
    .select('footballer_id')
    .eq('match_id', match.id);
  const appearances = (appRows ?? []).map(a => a.footballer_id as string);

  // Defer if the goal feed hasn't landed. football-data's free tier can report the
  // final score before the scorers, leaving goals on the board but zero goal events —
  // settling now would void deserved scorer props (and silently skip favorite-player
  // goal bonuses). Hold off while we're inside a grace window so a later run (the cron
  // or the on-read nudge) re-ingests and pays out the win once the scorers arrive. Past
  // the window we settle anyway and the engine voids any still-missing scorer props, so
  // a permanently-incomplete feed can never block the slate's recap forever.
  const totalGoals = (match.home_score ?? 0) + (match.away_score ?? 0);
  const goalFeedLanded = (events ?? []).some(
    e => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal',
  );
  const needsScorers =
    pendingBets.some(b => b.bet_type === 'first_scorer' || b.bet_type === 'anytime_scorer') ||
    favPlayers.length > 0;
  const SCORER_GRACE_MS = 8 * 60 * 60 * 1000; // ~kickoff + 8h: well past full time
  const withinGrace = Date.now() - new Date(match.kickoff_at).getTime() < SCORER_GRACE_MS;
  if (needsScorers && totalGoals > 0 && !goalFeedLanded && withinGrace) {
    console.log(
      `[settle] match ${match.id}: ${match.home_score}-${match.away_score} but football-data has no scorers yet — deferring`,
    );
    return false; // not settled; a later run retries once the scorer feed catches up
  }

  // Run the pure settlement engine
  const result = settle({
    match,
    bets: pendingBets,
    events: (events ?? []) as MatchEvent[],
    config: league.config,
    appearances: appearances.length > 0 ? appearances : undefined,
  });

  // Favorite-player Points ride along on the same idempotent ledger upsert below.
  if (league.config.favorites && favPlayers.length > 0) {
    const favDeltas = favoritePlayerDeltas({
      matchId: match.id,
      events: (events ?? []) as MatchEvent[],
      favorites: favPlayers,
      fav: league.config.favorites,
    });
    result.deltas.push(...favDeltas);
  }

  // Write results in a single transaction-like batch
  // (Supabase doesn't have true multi-table transactions via the REST client;
  //  idempotency guards in the ledger unique index protect against re-runs.)

  // 1. Upsert ledger entries (idempotency: unique index on reason+ref_type+ref_id+manager_id)
  if (result.deltas.length > 0) {
    const ledgerRows = result.deltas.map(d => ({
      manager_id: d.managerId,
      currency: d.currency,
      amount: d.amount,
      reason: d.reason,
      ref_type: d.refType,
      ref_id: d.refId,
    }));
    const { error } = await db
      .from('ledger')
      .upsert(ledgerRows, { onConflict: 'reason,ref_type,ref_id,manager_id', ignoreDuplicates: true });
    if (error) throw error;
  }

  // 2. Update bet statuses
  for (const update of result.betUpdates) {
    const { error } = await db
      .from('bets')
      .update({ status: update.status, glory_awarded: update.pointsAwarded })
      .eq('id', update.betId);
    if (error) throw error;
  }

  // 3. Recompute cached balances from ledger
  await recomputeBalances([...new Set(result.deltas.map(d => d.managerId))]);

  // 4. Mark match as settled
  await db
    .from('matches')
    .update({ settled_at: new Date().toISOString() })
    .eq('id', match.id);

  return true;
}

export interface BackfillResult {
  dryRun: boolean;
  matchesScanned: number;
  matchesWithScorers: number;
  betsReevaluated: number;
  betsChanged: number;
  newlyWon: number;
  changes: Array<{
    betId: string;
    managerId: string;
    betType: string;
    from: string;
    to: string;
    points: number;
  }>;
}

// One-off repair for prop bets that were settled before football-data published the
// scorers (the free-tier "score before scorers" gap that auto-lost every goalscorer
// pick). For each already-settled match carrying prop bets, re-ingest events from the
// feed, then re-evaluate ONLY its prop bets with the same pure engine. Outcome/exact
// bets and day-close are untouched — they only need the score, which was always
// available — so this never re-charges stakes or re-grants slate bonuses.
//
// Per-bet ledger reconciliation (delete the bet's prior win/coin rows, re-insert the
// new result) makes it safe to run repeatedly and in any direction (lost→won,
// won→void, …). Pass dryRun to preview the changes without writing.
export async function backfillSettledProps(dryRun = false): Promise<BackfillResult> {
  const { data: league, error: leagueErr } = await db
    .from('league')
    .select('*')
    .eq('id', 1)
    .single<League>();
  if (leagueErr || !league) throw new Error('Could not load league config');

  const result: BackfillResult = {
    dryRun,
    matchesScanned: 0,
    matchesWithScorers: 0,
    betsReevaluated: 0,
    betsChanged: 0,
    newlyWon: 0,
    changes: [],
  };

  // Settled matches that carry at least one prop bet.
  const { data: propRows } = await db.from('bets').select('match_id').in('bet_type', PROP_BET_TYPES);
  const matchIds = [...new Set((propRows ?? []).map(b => b.match_id as string))];
  if (matchIds.length === 0) return result;

  const { data: matchRows } = await db
    .from('matches')
    .select('*')
    .in('id', matchIds)
    .not('settled_at', 'is', null);
  const matches = (matchRows ?? []) as Match[];
  result.matchesScanned = matches.length;

  const affectedManagers = new Set<string>();

  for (const match of matches) {
    // Always read the live feed (read-only) so even a dry run previews what a real
    // run would settle. If the feed now carries scorers, evaluate against those and
    // persist them on a real run; if it still has none, fall back to whatever events
    // we already have (the ingest guard would keep them) so we never wipe good data.
    let evs: MatchEvent[];
    let appearances: string[];
    try {
      const fetched = await fetchMatchEvents(match);
      if (fetched.hasGoals) {
        evs = fetched.eventRows.map((r, i) => ({ id: `preview-${i}`, ...r })) as MatchEvent[];
        appearances = fetched.appeared;
        if (!dryRun) await ingestMatchData(match); // persist the freshly-fetched events
      } else {
        const { data: events } = await db.from('match_events').select('*').eq('match_id', match.id);
        evs = (events ?? []) as MatchEvent[];
        const { data: appRows } = await db
          .from('match_appearances')
          .select('footballer_id')
          .eq('match_id', match.id);
        appearances = (appRows ?? []).map(a => a.footballer_id as string);
      }
    } catch (err) {
      console.error(`[backfill] feed fetch for match ${match.id} failed (skipping):`, err);
      continue;
    }
    if (evs.some(e => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal')) {
      result.matchesWithScorers++;
    }

    const { data: bets } = await db
      .from('bets')
      .select('*')
      .eq('match_id', match.id)
      .in('bet_type', PROP_BET_TYPES);

    for (const bet of (bets ?? []) as Bet[]) {
      const update = settleBet(bet, {
        match,
        bets: [],
        config: league.config,
        events: evs,
        appearances: appearances.length > 0 ? appearances : undefined,
      });
      result.betsReevaluated++;

      const changed =
        update.status !== bet.status || update.pointsAwarded !== (bet.glory_awarded ?? 0);
      if (!changed) continue;

      result.betsChanged++;
      if (update.status === 'won') result.newlyWon++;
      result.changes.push({
        betId: bet.id,
        managerId: bet.manager_id,
        betType: bet.bet_type,
        from: bet.status,
        to: update.status,
        points: update.pointsAwarded,
      });
      if (dryRun) continue;

      // Reconcile this bet's ledger rows (bet-scoped only; stake_spend is match-scoped
      // and stays put), then write the new bet status.
      await db.from('ledger').delete().eq('ref_type', 'bet').eq('ref_id', bet.id);
      const ledgerRows: { manager_id: string; currency: string; amount: number; reason: string; ref_type: string; ref_id: string }[] = [];
      if (update.status === 'won') {
        if (update.pointsAwarded > 0)
          ledgerRows.push({ manager_id: bet.manager_id, currency: 'glory', amount: update.pointsAwarded, reason: 'bet_win', ref_type: 'bet', ref_id: bet.id });
        if (update.coinsAwarded > 0)
          ledgerRows.push({ manager_id: bet.manager_id, currency: 'coins', amount: update.coinsAwarded, reason: 'bet_coin', ref_type: 'bet', ref_id: bet.id });
      }
      if (ledgerRows.length > 0) {
        const { error } = await db
          .from('ledger')
          .upsert(ledgerRows, { onConflict: 'reason,ref_type,ref_id,manager_id', ignoreDuplicates: true });
        if (error) throw error;
      }
      await db
        .from('bets')
        .update({ status: update.status, glory_awarded: update.pointsAwarded })
        .eq('id', bet.id);
      affectedManagers.add(bet.manager_id);
    }
  }

  if (!dryRun && affectedManagers.size > 0) await recomputeBalances([...affectedManagers]);
  return result;
}

// Pull goals/cards/lineups from football-data.org and (re)write match_events +
// match_appearances for this match. Idempotent: clears prior rows first, so a
// retried settle produces the same result. Throws on fetch failure — the caller
// treats that as "not ready yet" and leaves the match unsettled.
interface FetchedMatchData {
  eventRows: Array<{
    match_id: string;
    footballer_id: string | null;
    type: EventType;
    minute: number | null;
    is_own_goal: boolean;
  }>;
  appeared: string[];
  hasGoals: boolean;
}

// Read-only: fetch + parse goals/cards/lineups for a match, mapped to our footballer
// UUIDs. No DB writes — so the props-backfill can use it to *preview* what a real run
// would settle. Throws on fetch failure.
//
// Source dispatch: a match mapped to API-Football (af_fixture_id set) uses that — the
// granular provider with real scorers/cards/lineups. Everything else falls back to
// football-data's free tier (schedule/score only; no goal/card detail for WC2026).
export async function fetchMatchEvents(match: Match): Promise<FetchedMatchData> {
  if (match.af_fixture_id != null) return fetchMatchEventsFromAf(match);

  // Map football-data player ids → our footballer UUIDs (both teams' squads).
  const { data: players } = await db
    .from('footballers')
    .select('id, fd_player_id')
    .in('team_id', [match.home_team_id, match.away_team_id]);

  const byFdId = new Map<number, string>();
  for (const p of players ?? []) {
    if (p.fd_player_id != null) byFdId.set(p.fd_player_id, p.id as string);
  }

  const detail = await getMatchDetail(match.fd_match_id);

  // Goals → match_events. Own goals keep the scorer but are flagged so the
  // engine excludes them from goalscorer props.
  const eventRows: FetchedMatchData['eventRows'] = [];

  for (const g of detail.goals ?? []) {
    const fid = g.scorer?.id != null ? byFdId.get(g.scorer.id) ?? null : null;
    const isOwn = g.type === 'OWN';
    const type: EventType = isOwn ? 'own_goal' : g.type === 'PENALTY' ? 'penalty' : 'goal';
    eventRows.push({ match_id: match.id, footballer_id: fid, type, minute: g.minute ?? null, is_own_goal: isOwn });
  }

  for (const b of detail.bookings ?? []) {
    const fid = byFdId.get(b.player.id) ?? null;
    const type: EventType = b.card === 'RED' || b.card === 'YELLOW_RED' ? 'red' : 'yellow';
    eventRows.push({ match_id: match.id, footballer_id: fid, type, minute: b.minute ?? null, is_own_goal: false });
  }

  // Appearances: starting XI + subs who came on. Only trustworthy when the feed
  // actually carries lineups; otherwise this stays empty and void logic is skipped.
  const appeared = new Set<string>();
  for (const side of [detail.homeTeam, detail.awayTeam]) {
    for (const p of side.lineup ?? []) {
      const id = byFdId.get(p.id);
      if (id) appeared.add(id);
    }
  }
  for (const s of detail.substitutions ?? []) {
    if (s.playerIn?.id != null) {
      const id = byFdId.get(s.playerIn.id);
      if (id) appeared.add(id);
    }
  }

  const hasGoals = eventRows.some(e => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal');
  return { eventRows, appeared: [...appeared], hasGoals };
}

// Read-only API-Football fetch for a mapped fixture. Same contract as fetchMatchEvents:
// returns the rows to write, never writes. Resolves footballers by af_player_id — AF
// events/lineups carry player.id, so there's no name-matching here (that happened once,
// in the mapping sync). Throws on fetch failure, same as the football-data path.
async function fetchMatchEventsFromAf(match: Match): Promise<FetchedMatchData> {
  const fixtureId = match.af_fixture_id!;

  // af player id → our footballer UUID (both teams' squads).
  const { data: players } = await db
    .from('footballers')
    .select('id, af_player_id')
    .in('team_id', [match.home_team_id, match.away_team_id]);
  const byAfId = new Map<number, string>();
  for (const p of players ?? []) {
    if (p.af_player_id != null) byAfId.set(p.af_player_id as number, p.id as string);
  }

  const [events, lineups] = await Promise.all([
    getFixtureEvents(fixtureId),
    getFixtureLineups(fixtureId),
  ]);

  // Goals + cards → match_events. AF's `type`/`detail` pair refines the kind:
  //   Goal: "Normal Goal" | "Penalty" | "Own Goal" | "Missed Penalty" (skip the miss)
  //   Card: "Yellow Card" | "Red Card"
  const eventRows: FetchedMatchData['eventRows'] = [];
  for (const e of events) {
    const row = afEventToRow(e, byAfId, match.id);
    if (row) eventRows.push(row);

    // A scored goal's assister → a separate `assist` event row (settles anytime-assist
    // bets). AF carries the assister in `e.assist` on Goal events; own goals and missed
    // penalties have no meaningful assist. This data was previously fetched and dropped.
    if (e.type === 'Goal' && e.detail !== 'Own Goal' && e.detail !== 'Missed Penalty' && e.assist?.id != null) {
      const assistId = byAfId.get(e.assist.id) ?? null;
      if (assistId) {
        eventRows.push({
          match_id: match.id,
          footballer_id: assistId,
          type: 'assist',
          minute: e.time?.elapsed ?? null,
          is_own_goal: false,
        });
      }
    }
  }

  // Appearances: starting XI from lineups + both players named in every substitution
  // event (one came on, one went off — both took the pitch, regardless of which field
  // AF puts in `player` vs `assist`, which varies). This drives prop void logic.
  const appeared = new Set<string>();
  for (const l of lineups) {
    for (const p of l.startXI ?? []) {
      const id = byAfId.get(p.player.id);
      if (id) appeared.add(id);
    }
  }
  for (const e of events) {
    if (e.type !== 'subst') continue;
    for (const pid of [e.player?.id, e.assist?.id]) {
      if (pid != null) {
        const id = byAfId.get(pid);
        if (id) appeared.add(id);
      }
    }
  }

  const hasGoals = eventRows.some(e => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal');
  return { eventRows, appeared: [...appeared], hasGoals };
}

// Map one API-Football event to a match_events row, or null for events we don't store
// (substitutions, VAR, missed penalties).
function afEventToRow(
  e: AfEvent,
  byAfId: Map<number, string>,
  matchId: string,
): FetchedMatchData['eventRows'][number] | null {
  const fid = e.player?.id != null ? byAfId.get(e.player.id) ?? null : null;
  const minute = e.time?.elapsed ?? null;

  if (e.type === 'Goal') {
    if (e.detail === 'Missed Penalty') return null;
    const isOwn = e.detail === 'Own Goal';
    const type: EventType = isOwn ? 'own_goal' : e.detail === 'Penalty' ? 'penalty' : 'goal';
    return { match_id: matchId, footballer_id: fid, type, minute, is_own_goal: isOwn };
  }
  if (e.type === 'Card') {
    if (e.detail !== 'Yellow Card' && e.detail !== 'Red Card') return null;
    const type: EventType = e.detail === 'Red Card' ? 'red' : 'yellow';
    return { match_id: matchId, footballer_id: fid, type, minute, is_own_goal: false };
  }
  return null;
}

// Fetch from football-data and (re)write match_events + match_appearances for this
// match. Idempotent: clears prior rows first, so a retried settle produces the same
// result. Throws on fetch failure — the caller treats that as "not ready yet".
export async function ingestMatchData(match: Match): Promise<void> {
  const { eventRows, appeared, hasGoals } = await fetchMatchEvents(match);

  // Guard against clobbering: if the feed carries no goals for a match that did
  // score, treat it as "data not ready" and leave any existing rows intact rather
  // than wiping them to empty. (This is the free-tier "score before scorers" gap —
  // see settleMatch's defer logic.) Without this, a re-ingest while the feed is
  // still empty would erase good scorer data we already have.
  const scoreboardGoals = (match.home_score ?? 0) + (match.away_score ?? 0);
  if (!hasGoals && scoreboardGoals > 0) {
    return; // nothing trustworthy to write; keep whatever we already have
  }

  // Idempotent re-ingest: clear then insert.
  await db.from('match_events').delete().eq('match_id', match.id);
  if (eventRows.length > 0) {
    const { error } = await db.from('match_events').insert(eventRows);
    if (error) throw error;
  }

  await db.from('match_appearances').delete().eq('match_id', match.id);
  if (appeared.length > 0) {
    const rows = appeared.map(footballer_id => ({ match_id: match.id, footballer_id }));
    const { error } = await db.from('match_appearances').insert(rows);
    if (error) throw error;
  }
}
