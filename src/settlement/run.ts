import { after } from 'next/server';
import { db } from '@/lib/supabase';
import { getCompetitionMatches, getMatchDetail, mapFdStatus, regulationScore } from '@/lib/football-data';
import { getFixtureEvents, getFixtureLineups } from '@/lib/api-football';
import { afEventToRow, isShootoutKick } from '@/settlement/af-events';
import {
  settle,
  settleBet,
  PLAYER_PROP_BET_TYPES,
  SCORER_FEED_BET_TYPES,
} from '@/settlement/engine';
import { closeSlate } from '@/settlement/dayclose';
import {
  favoritePlayerDeltas,
  teamLadderDeltas,
  teamMultiplier,
  type LadderMatch,
} from '@/settlement/favorites';
import { regulationScoreFromEvents } from '@/settlement/regulation';
import {
  gbMultiplier,
  goldenBracketDeltas,
  resolvePlacements,
  topScorers,
  type GbScorerEvent,
} from '@/settlement/golden-bracket';
import { slateKeyOf } from '@/lib/slate';
import type { Bet, EventType, GoldenBracket, League, ManagerState, Match, MatchEvent } from '@/types/db';

// bet_types that need match_events / lineups to settle. Single source of truth lives
// in the engine (PLAYER_PROP_BET_TYPES) so the gating here can't drift from the set of
// props the engine actually settles off the feed.
const PROP_BET_TYPES: string[] = [...PLAYER_PROP_BET_TYPES];

export interface SettlementResult {
  statusesSynced: number;
  settled: number;
  slatesClosed: number;
  favTeamAwards: number;
  gbAwards: number;
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
  // Golden Bracket special bet (migration 016): a no-op every tick until the
  // tournament is fully settled, then pays each winning line exactly once.
  const gbAwards = await settleGoldenBracket();
  return { statusesSynced, settled, slatesClosed, favTeamAwards, gbAwards };
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
    // winner_team_id tracks the TRUE result (incl. extra time / shootout) for the
    // favorite-team ladder; the stored score is the 90-minute result bets settle on.
    const winnerTeamId =
      fd.score?.winner === 'HOME_TEAM'
        ? row.home_team_id
        : fd.score?.winner === 'AWAY_TEAM'
          ? row.away_team_id
          : null;
    const reg = regulationScore(fd.score);
    const { error: updErr } = await db
      .from('matches')
      .update({
        status,
        home_score: reg.home,
        away_score: reg.away,
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

// Golden Bracket special bet (migration 016). Settles exactly once, at tournament
// end: the final must be finished AND settled, and no non-void match may be left
// unfinished or unsettled — which guarantees every goal event is ingested, so the
// top-scorer tally is complete. (The explicit final gate matters: mid-tournament
// there are moments when every EXISTING row is settled but the next round's
// fixtures haven't been drawn yet.) Idempotent like the favorites ladder: each
// winning line is one ledger row keyed (reason='gb_*', ref_type='season',
// ref_id=season, manager_id).
async function settleGoldenBracket(): Promise<number> {
  const { data: league } = await db
    .from('league')
    .select('season, config')
    .eq('id', 1)
    .single<Pick<League, 'season' | 'config'>>();
  const cfg = league?.config.golden_bracket;
  if (!league || !cfg) return 0; // not configured → nothing to do

  const { data: pickRows } = await db.from('golden_brackets').select('*');
  const brackets = (pickRows ?? []) as GoldenBracket[];
  if (brackets.length === 0) return 0;

  // Tournament-over gates, cheapest first (both are head counts).
  const { count: finalDone } = await db
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('stage', 'final')
    .eq('status', 'finished')
    .not('settled_at', 'is', null);
  if (!finalDone) return 0;
  const { count: outstanding } = await db
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'void')
    .or('status.neq.finished,settled_at.is.null');
  if (outstanding !== 0) return 0;

  // Placements from the last three fixtures; the scorer tally from every goal event.
  const { data: matchRows } = await db
    .from('matches')
    .select('stage, status, home_team_id, away_team_id, winner_team_id')
    .in('stage', ['sf', 'third', 'final'])
    .neq('status', 'void');
  const placements = resolvePlacements((matchRows ?? []) as LadderMatch[]);
  if (placements.champion == null) return 0;

  const { data: eventRows } = await db
    .from('match_events')
    .select('footballer_id, type, is_own_goal')
    .in('type', ['goal', 'penalty']);
  const scorer = topScorers((eventRows ?? []) as GbScorerEvent[]);

  // Odds → multipliers for every picked team.
  const pickedTeamIds = [
    ...new Set(
      brackets.flatMap(b => [
        b.champion_team_id,
        b.runner_up_team_id,
        b.third_team_id,
        b.fourth_team_id,
      ]),
    ),
  ];
  const { data: teamRows } = await db.from('teams').select('id, gb_odds').in('id', pickedTeamIds);
  const multByTeam = new Map<string, number>(
    (teamRows ?? []).map(t => [t.id as string, gbMultiplier(t.gb_odds as number | null, cfg)]),
  );

  // Already-awarded lines → only write (and recompute) genuinely new ones.
  const { data: priorRows } = await db
    .from('ledger')
    .select('manager_id, reason')
    .eq('ref_type', 'season')
    .eq('ref_id', league.season)
    .like('reason', 'gb_%');
  const alreadyAwarded = new Set((priorRows ?? []).map(r => `${r.manager_id}:${r.reason}`));

  const deltas = goldenBracketDeltas({
    picks: brackets.map(b => ({
      managerId: b.manager_id,
      champion: b.champion_team_id,
      runnerUp: b.runner_up_team_id,
      third: b.third_team_id,
      fourth: b.fourth_team_id,
      scorerId: b.top_scorer_id,
      scorerGoals: b.scorer_goals,
    })),
    placements,
    multByTeam,
    scorer,
    cfg,
    seasonKey: league.season,
  }).filter(d => !alreadyAwarded.has(`${d.managerId}:${d.reason}`));
  if (deltas.length === 0) return 0;

  const rows = deltas.map(d => ({
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

  await recomputeBalances([...new Set(deltas.map(d => d.managerId))]);
  return deltas.length;
}

// Recompute the cached managers.glory / managers.coins from the append-only ledger
// (the source of truth) for the given managers. Delegates to the atomic SQL function
// (migration 014): it sums the ledger and writes the cache in a single statement under
// a row lock, so there is no app-side read-then-write window for a concurrent run to
// clobber with a stale total — the lost-update race the per-manager JS loop suffered.
async function recomputeBalances(managerIds: string[]): Promise<void> {
  if (managerIds.length === 0) return;
  const { error } = await db.rpc('recompute_manager_balances', { manager_ids: managerIds });
  if (error) throw error;
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

// Load a footballer→team map for both sides of a match — used to attribute goal events to
// a side when recomputing the regulation score.
async function loadTeamOf(match: Pick<Match, 'home_team_id' | 'away_team_id'>): Promise<Map<string, string>> {
  const { data: players } = await db
    .from('footballers')
    .select('id, team_id')
    .in('team_id', [match.home_team_id, match.away_team_id]);
  return new Map((players ?? []).map(p => [p.id as string, p.team_id as string]));
}

// Recompute + persist the 90' regulation score for a knockout that ran to extra time,
// mutating `match` in place so the pure engine settles against it. No-op for group games,
// matches that didn't go past 90, or an untrustworthy goal timeline. Shared by the live
// settle path and the backfill/reconcile path so both agree on the scoreline.
async function applyRegulationScoreCorrection(
  match: Match,
  events: MatchEvent[],
  teamOf: Map<string, string>,
): Promise<void> {
  const reg = regulationScoreFromEvents(match, events, teamOf);
  if (!reg) return;
  if (reg.home === match.home_score && reg.away === match.away_score) return;
  await db.from('matches').update({ home_score: reg.home, away_score: reg.away }).eq('id', match.id);
  console.log(
    `[settle] match ${match.id}: 90' regulation score ${reg.home}-${reg.away} ` +
      `(was ${match.home_score}-${match.away_score}) from the goal timeline`,
  );
  match.home_score = reg.home;
  match.away_score = reg.away;
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
    .select('id, team_id')
    .in('team_id', [match.home_team_id, match.away_team_id]);
  const squadIds = (squad ?? []).map(s => s.id as string);
  // footballer→team, reused to attribute goals when recomputing the 90' score below.
  const teamOf = new Map((squad ?? []).map(s => [s.id as string, s.team_id as string]));
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

  // Player props AND favorite players need goals/cards/lineups from football-data. Knockout
  // matches need the goal timeline too — to recompute the 90' regulation score for a game
  // that ran to extra time (see applyRegulationScoreCorrection). Only pay for the extra API
  // call when something on this match actually depends on it. If ingestion throws, we let
  // settleMatch throw too: the match stays unsettled (settled_at null) and the next cron run
  // retries — better than prematurely settling props on missing data.
  const hasProps = pendingBets.some(b => PROP_BET_TYPES.includes(b.bet_type));
  const isKnockout = match.stage !== 'group';
  if (hasProps || favPlayers.length > 0 || isKnockout) {
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

  // Defer if the goal feed hasn't landed. The granular feed (API-Football) can report the
  // final score before the scorers, leaving goals on the board but zero goal events —
  // settling now would void deserved scorer props (and silently skip favorite-player
  // goal bonuses). Hold off while we're inside a grace window so a later run (the cron
  // or the on-read nudge) re-ingests and pays out the win once the scorers arrive. Past
  // the window we settle anyway and the engine voids any still-missing scorer props, so
  // a permanently-incomplete feed can never block the slate's recap forever.
  //
  // Only matches mapped to API-Football (af_fixture_id set) have a scorer source at all;
  // a football-data-only match (af_fixture_id null) will NEVER get goal events, so there
  // is nothing to wait for. Deferring those is worse than useless: the grace window (8h
  // from kickoff) outlasts the morning cron's last run (10:00 Helsinki / 07:00 UTC) for
  // any post-~23:00-UTC kickoff, so no cron run ever exits the wait — the match hangs
  // unsettled until grace expires and some on-read nudge happens to fire hours later,
  // silently blocking the whole slate's recap for everyone in the meantime. So we only
  // defer when a scorer source actually exists; otherwise settle now and let the engine
  // void the (unwinnable) scorer props.
  const totalGoals = (match.home_score ?? 0) + (match.away_score ?? 0);
  const goalFeedLanded = (events ?? []).some(
    e => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal',
  );
  const hasScorerSource = match.af_fixture_id != null;
  // A knockout also needs the goal timeline landed before it can settle — not for scorers
  // but to recompute the 90' regulation score for a game that ran to extra time. Settling
  // off the a.e.t. scoreline would grade every score-derived bet against the wrong result.
  const needsScorers =
    pendingBets.some(b => SCORER_FEED_BET_TYPES.includes(b.bet_type)) ||
    favPlayers.length > 0 ||
    isKnockout;
  const SCORER_GRACE_MS = 8 * 60 * 60 * 1000; // ~kickoff + 8h: well past full time
  const withinGrace = Date.now() - new Date(match.kickoff_at).getTime() < SCORER_GRACE_MS;
  if (needsScorers && hasScorerSource && totalGoals > 0 && !goalFeedLanded && withinGrace) {
    console.log(
      `[settle] match ${match.id}: ${match.home_score}-${match.away_score} but API-Football has no scorers yet — deferring`,
    );
    return false; // not settled; a later run retries once the scorer feed catches up
  }

  // Unmapped match with goals + scorer/prop/knockout needs but no goal feed: there is no
  // scorer source, so the engine below will VOID every scorer prop (and skip favorite-player
  // goal bonuses). For WC2026 this should never be a legitimate "football-data-only" match —
  // every fixture is in API-Football — so it means the af-map sync hasn't reached this fixture
  // yet (e.g. a knockout pairing set after the last mapping run). This used to void silently
  // (Paraguay–France R16: Mbappé's penalty lost). Surface it loudly. Fix: run /api/cron/af-map
  // to map the fixture, then /api/cron/settle-backfill?match=<id>&undecided=1 to re-grade.
  if (needsScorers && !hasScorerSource && totalGoals > 0 && !goalFeedLanded) {
    console.error(
      `[settle] match ${match.id}: ${match.home_score}-${match.away_score} with pending scorer/prop/knockout bets but af_fixture_id is null — no API-Football scorer source. Scorer props will VOID and favorite-player goals will be missed. Run af-map, then settle-backfill?match=${match.id}&undecided=1.`,
    );
  }

  // Knockout gone to extra time: recompute + persist the 90' regulation score from the goal
  // timeline before grading, so outcome/exact/over-under settle on the 90' result (a draw
  // for a match decided after 90) rather than the a.e.t. scoreline the summary feed stored.
  if (isKnockout) {
    await applyRegulationScoreCorrection(match, (events ?? []) as MatchEvent[], teamOf);
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

// Load already-persisted events + appearances for a match (the fallback when the live
// feed carries no scorers, or errored, during a backfill re-evaluation).
async function loadStoredEvents(matchId: string): Promise<{ evs: MatchEvent[]; appearances: string[] }> {
  const { data: events } = await db.from('match_events').select('*').eq('match_id', matchId);
  const { data: appRows } = await db
    .from('match_appearances')
    .select('footballer_id')
    .eq('match_id', matchId);
  return {
    evs: (events ?? []) as MatchEvent[],
    appearances: (appRows ?? []).map(a => a.footballer_id as string),
  };
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

// One-off repair for already-settled matches whose stored result no longer matches the
// bets' settled status. It heals two gaps, both caused by data that landed or changed
// after the match was first settled:
//   • prop bets auto-lost because football-data published the final score before the
//     scorers (the free-tier "score before scorers" gap that lost every goalscorer
//     pick), and
//   • score-derived bets (outcome / exact_score / over_under / clean_sheet) settled
//     against a score that was later corrected — e.g. a late or own goal added to the
//     scoreboard only after the match had already been settled. syncStartedMatchStatuses
//     stops refreshing a match's score once it's finished+settled, so without this such a
//     correction would never reach the bets. (This is exactly how a correct Spain 4–0
//     exact-score pick was left marked lost when the 4th goal — an own goal — was applied
//     post-settlement.)
//
// For each already-settled match: re-ingest events from the feed (only when the match
// carries prop bets — score-derived bets read just the final score, already on the match
// row), then re-evaluate every bet with the same pure engine. Per-bet ledger
// reconciliation (delete the bet's prior win/coin rows, re-insert the new result) makes
// it safe to run repeatedly and in any direction (lost→won, won→void, …). The
// match-scoped stake_spend and the day-close slate grants are untouched. Pass dryRun to
// preview the changes without writing.
//
// `onlyUndecided` restricts the re-grade to bets currently in a non-final state
// (`void`/`pending`) — it never overturns an already-decided win/loss. Use it when a
// data source is added after the fact (e.g. a match newly mapped to API-Football, so its
// scorer props can finally settle off real goals instead of voiding): it fixes those
// refunded/undecided props without retroactively re-pointing historical bets that were
// settled — and possibly grandfathered — under earlier scoring rules.
//
// `matchId` scopes the sweep to a single match. A full sweep re-grades EVERY decided bet,
// which also surfaces (and would overwrite) bets deliberately grandfathered under earlier
// scoring rules — e.g. exact_score paid 35 before the 35→25 change. When you only mean to
// repair one match (a score correction like an extra-time knockout), scope to it so those
// grandfathered bets are left untouched.
export async function backfillSettledBets(
  dryRun = false,
  onlyUndecided = false,
  matchId?: string,
): Promise<BackfillResult> {
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

  // Every already-settled match — a post-settlement score correction can flip a
  // score-derived bet on any of them, not only the ones carrying props. Scoped to one
  // match when matchId is given.
  let matchQuery = db.from('matches').select('*').not('settled_at', 'is', null);
  if (matchId) matchQuery = matchQuery.eq('id', matchId);
  const { data: matchRows } = await matchQuery;
  const matches = (matchRows ?? []) as Match[];
  result.matchesScanned = matches.length;

  const affectedManagers = new Set<string>();

  for (const match of matches) {
    const r = await reconcileMatchBets(match, league, dryRun, onlyUndecided);
    result.betsReevaluated += r.betsReevaluated;
    if (r.hadScorers) result.matchesWithScorers++;
    for (const c of r.changes) {
      result.betsChanged++;
      if (c.to === 'won') result.newlyWon++;
      result.changes.push(c);
    }
    r.affectedManagers.forEach(m => affectedManagers.add(m));
  }

  if (!dryRun && affectedManagers.size > 0) await recomputeBalances([...affectedManagers]);
  return result;
}

interface ReconcileMatchResult {
  betsReevaluated: number;
  hadScorers: boolean;
  changes: BackfillResult['changes'];
  affectedManagers: string[];
}

// Re-grade every bet on ONE already-settled match against its current stored score +
// events, reconciling the ledger in BOTH directions: delete the bet's prior win/coin
// rows and re-insert the new result, so a flip works lost→won AND won→lost. (The normal
// settleMatch path is insert-only/idempotent-forward — it can add a missing win but can't
// reverse a stale one, which is why a plain "clear settled_at and re-settle" would leave
// a phantom win in the ledger.) Shared by the bulk backfillSettledBets sweep and the
// fixtures-sync score-correction trigger (reSettleCorrectedMatch). Does NOT recompute
// cached balances — callers batch that across every match they touch. Pass dryRun to
// preview without writing.
//
// `onlyUndecided` limits the re-grade to bets currently `void`/`pending` and skips the
// match entirely (no feed fetch) when none qualify — so a newly-added data source can
// settle previously-voided props without disturbing already-decided wins/losses.
async function reconcileMatchBets(
  match: Match,
  league: League,
  dryRun: boolean,
  onlyUndecided = false,
): Promise<ReconcileMatchResult> {
  const out: ReconcileMatchResult = {
    betsReevaluated: 0,
    hadScorers: false,
    changes: [],
    affectedManagers: [],
  };

  const { data: betRows } = await db.from('bets').select('*').eq('match_id', match.id);
  let bets = (betRows ?? []) as Bet[];
  if (onlyUndecided) bets = bets.filter(b => b.status === 'void' || b.status === 'pending');
  if (bets.length === 0) return out;

  // Favorite-player bonus (migration 009): managers whose locked favorite player is in
  // this match earn Points for goals — whether or not they bet. Like settleMatch, the
  // re-grade must re-apply these off the (possibly freshly re-ingested) feed, else a
  // backfill that heals a scorer prop would leave the same manager's favorite-player goal
  // bonus lost — the exact silent under-pay behind the Paraguay–France void.
  const favPlayers = league.config.favorites ? await loadFavoritePlayers(match) : [];

  // Props (and favorite players) need the goal/card/lineup feed; score-derived bets read
  // only the final score (already on the match row), so only pay for the feed when it's
  // actually needed. Read the live feed (read-only) so even a dry run previews what a real
  // run would settle; if it now carries scorers, evaluate against those and persist them on
  // a real run, otherwise fall back to whatever events we already have. A feed outage must
  // not block re-evaluating this match's score-derived bets, so on error we fall back too.
  const hasProps = bets.some(b => PROP_BET_TYPES.includes(b.bet_type));
  let evs: MatchEvent[] = [];
  let appearances: string[] = [];
  if (hasProps || favPlayers.length > 0) {
    try {
      const fetched = await fetchMatchEvents(match);
      if (fetched.hasGoals) {
        evs = fetched.eventRows.map((r, i) => ({ id: `preview-${i}`, ...r })) as MatchEvent[];
        appearances = fetched.appeared;
        if (!dryRun) await ingestMatchData(match); // persist the freshly-fetched events
      } else {
        ({ evs, appearances } = await loadStoredEvents(match.id));
      }
    } catch (err) {
      console.error(`[reconcile] feed fetch for match ${match.id} failed (using stored events):`, err);
      ({ evs, appearances } = await loadStoredEvents(match.id));
    }
    out.hadScorers = evs.some(e => e.type === 'goal' || e.type === 'penalty' || e.type === 'own_goal');
  }

  // Knockout gone to extra time: recompute the 90' regulation score from the goal timeline
  // so the re-grade below settles score-derived bets on the 90' result — this is what lets a
  // one-off backfill heal a match settled against its a.e.t. scoreline. Needs the goal
  // timeline even for a match with no props, so load stored events when we didn't fetch any
  // above. Mutates the in-memory score so a dry run previews the flip; only writes on a real
  // run. Idempotent: a match already stored at its 90' score recomputes to the same value.
  if (match.stage !== 'group') {
    let goalEvents = evs;
    if (goalEvents.length === 0) ({ evs: goalEvents } = await loadStoredEvents(match.id));
    const reg = regulationScoreFromEvents(match, goalEvents, await loadTeamOf(match));
    if (reg && (reg.home !== match.home_score || reg.away !== match.away_score)) {
      if (!dryRun) {
        await db
          .from('matches')
          .update({ home_score: reg.home, away_score: reg.away })
          .eq('id', match.id);
      }
      match.home_score = reg.home;
      match.away_score = reg.away;
    }
  }

  for (const bet of bets) {
    const update = settleBet(bet, {
      match,
      bets: [],
      config: league.config,
      events: evs,
      appearances: appearances.length > 0 ? appearances : undefined,
    });
    out.betsReevaluated++;

    const changed =
      update.status !== bet.status || update.pointsAwarded !== (bet.glory_awarded ?? 0);
    if (!changed) continue;

    out.changes.push({
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
    out.affectedManagers.push(bet.manager_id);
  }

  // Reconcile the favorite-player goal/booking bonus off the same (re-ingested) events,
  // in both directions like the bets above: for every manager whose favorite is in this
  // match, delete the prior match-scoped `fav_player` row and re-insert the current net
  // delta if non-zero. Idempotent — a match already at its correct bonus recomputes to the
  // same value. Only touches balances (recomputed by the caller), not the bet-shaped
  // `changes` report. Skipped on a dry run so it stays preview-only.
  if (!dryRun && league.config.favorites && favPlayers.length > 0) {
    const favDeltas = favoritePlayerDeltas({
      matchId: match.id,
      events: evs,
      favorites: favPlayers,
      fav: league.config.favorites,
    });
    const byManager = new Map(favDeltas.map(d => [d.managerId, d]));
    for (const { managerId } of favPlayers) {
      const { data: prior } = await db
        .from('ledger')
        .select('amount')
        .eq('reason', 'fav_player')
        .eq('ref_type', 'match')
        .eq('ref_id', match.id)
        .eq('manager_id', managerId)
        .maybeSingle();
      const next = byManager.get(managerId);
      const priorAmount = (prior?.amount as number | undefined) ?? 0;
      if (priorAmount === (next?.amount ?? 0)) continue; // unchanged — leave it be

      await db
        .from('ledger')
        .delete()
        .eq('reason', 'fav_player')
        .eq('ref_type', 'match')
        .eq('ref_id', match.id)
        .eq('manager_id', managerId);
      if (next) {
        const { error } = await db.from('ledger').insert({
          manager_id: managerId,
          currency: next.currency,
          amount: next.amount,
          reason: next.reason,
          ref_type: next.refType,
          ref_id: next.refId,
        });
        if (error) throw error;
      }
      out.affectedManagers.push(managerId);
    }
  }

  return out;
}

// Managers whose locked favorite player is in this match, with that player's id. Mirrors
// the same lookup in settleMatch so the settle and backfill paths pay identical bonuses.
async function loadFavoritePlayers(
  match: Pick<Match, 'home_team_id' | 'away_team_id'>,
): Promise<{ managerId: string; footballerId: string }[]> {
  const { data: squad } = await db
    .from('footballers')
    .select('id')
    .in('team_id', [match.home_team_id, match.away_team_id]);
  const squadIds = (squad ?? []).map(s => s.id as string);
  if (squadIds.length === 0) return [];
  const { data: favMgrs } = await db
    .from('managers')
    .select('id, favorite_footballer_id')
    .in('favorite_footballer_id', squadIds);
  return (favMgrs ?? []).map(m => ({
    managerId: m.id as string,
    footballerId: m.favorite_footballer_id as string,
  }));
}

// Public entry for the fixtures-sync score-correction trigger. When the daily sync
// overwrites the score/status of a match that was ALREADY settled, its bets were graded
// against the old score and the normal settle path won't revisit them (it only picks up
// settled_at IS NULL, and syncStartedMatchStatuses stops refreshing a match once it's
// finished). Re-grade just this one match and reconcile its ledger so a post-settlement
// correction — a late/disallowed goal, or a feed that briefly published a wrong score
// then fixed it — reaches the bets. Caller fires this only on a real change, so it adds
// no recurring reads. Returns the bets it changed (empty when nothing flipped).
export async function reSettleCorrectedMatch(matchId: string): Promise<BackfillResult['changes']> {
  const { data: league, error: leagueErr } = await db
    .from('league')
    .select('*')
    .eq('id', 1)
    .single<League>();
  if (leagueErr || !league) throw new Error('Could not load league config');

  const { data: match } = await db.from('matches').select('*').eq('id', matchId).single<Match>();
  if (!match || !match.settled_at) return []; // unsettled → the normal settle path owns it

  const r = await reconcileMatchBets(match, league, false);
  if (r.affectedManagers.length > 0) await recomputeBalances([...new Set(r.affectedManagers)]);
  return r.changes;
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
    // bets). AF carries the assister in `e.assist` on Goal events; own goals, missed
    // penalties and shootout kicks have no meaningful assist.
    if (e.type === 'Goal' && e.detail !== 'Own Goal' && e.detail !== 'Missed Penalty' && !isShootoutKick(e) && e.assist?.id != null) {
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
