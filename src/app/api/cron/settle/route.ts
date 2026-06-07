import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron';
import { db } from '@/lib/supabase';
import { getMatchDetail } from '@/lib/football-data';
import { settle } from '@/settlement/engine';
import type { Bet, EventType, League, Match, MatchEvent } from '@/types/db';

// bet_types that need match_events / lineups to settle
const PROP_BET_TYPES = ['first_scorer', 'anytime_scorer', 'carded'];

// Vercel Cron: every 10 minutes — settles finished, unsettled matches
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const settled = await settleFinishedMatches();
    return NextResponse.json({ ok: true, settled });
  } catch (err) {
    console.error('[settle] error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function settleFinishedMatches(): Promise<number> {
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
  if (!matches || matches.length === 0) return 0;

  let count = 0;
  for (const match of matches as Match[]) {
    try {
      await settleMatch(match, league);
      count++;
    } catch (err) {
      console.error(`[settle] match ${match.id} failed:`, err);
      // Continue to next match — one failure doesn't block others
    }
  }
  return count;
}

async function settleMatch(match: Match, league: League): Promise<void> {
  // Re-check settled_at to guard against concurrent runs
  const { data: fresh } = await db
    .from('matches')
    .select('settled_at')
    .eq('id', match.id)
    .single();
  if (fresh?.settled_at) return; // already settled by a concurrent invocation

  // Load open bets
  const { data: bets, error: betsErr } = await db
    .from('bets')
    .select('*')
    .eq('match_id', match.id)
    .eq('status', 'pending');
  if (betsErr) throw betsErr;
  const pendingBets = (bets ?? []) as Bet[];

  // Player props need goals/cards/lineups from football-data. Only pay for the
  // extra API call when there's actually a prop bet riding on this match.
  // If ingestion throws, we let settleMatch throw too: the match stays unsettled
  // (settled_at null) and the next cron run retries — better than prematurely
  // settling props on missing data.
  const hasProps = pendingBets.some(b => PROP_BET_TYPES.includes(b.bet_type));
  if (hasProps) {
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

  // Run the pure settlement engine
  const result = settle({
    match,
    bets: pendingBets,
    events: (events ?? []) as MatchEvent[],
    config: league.config,
    appearances: appearances.length > 0 ? appearances : undefined,
  });

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
  const managerIds = [...new Set(result.deltas.map(d => d.managerId))];
  for (const managerId of managerIds) {
    const { data: rows } = await db
      .from('ledger')
      .select('currency, amount')
      .eq('manager_id', managerId);

    const points = (rows ?? [])
      .filter(r => r.currency === 'glory')
      .reduce((s, r) => s + r.amount, 0);
    const coins = (rows ?? [])
      .filter(r => r.currency === 'coins')
      .reduce((s, r) => s + r.amount, 0);

    await db.from('managers').update({ glory: points, coins }).eq('id', managerId);
  }

  // 4. Mark match as settled
  await db
    .from('matches')
    .update({ settled_at: new Date().toISOString() })
    .eq('id', match.id);
}

// Pull goals/cards/lineups from football-data.org and (re)write match_events +
// match_appearances for this match. Idempotent: clears prior rows first, so a
// retried settle produces the same result. Throws on fetch failure — the caller
// treats that as "not ready yet" and leaves the match unsettled.
async function ingestMatchData(match: Match): Promise<void> {
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
  const eventRows: Array<{
    match_id: string;
    footballer_id: string | null;
    type: EventType;
    minute: number | null;
    is_own_goal: boolean;
  }> = [];

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

  // Idempotent re-ingest: clear then insert.
  await db.from('match_events').delete().eq('match_id', match.id);
  if (eventRows.length > 0) {
    const { error } = await db.from('match_events').insert(eventRows);
    if (error) throw error;
  }

  await db.from('match_appearances').delete().eq('match_id', match.id);
  if (appeared.size > 0) {
    const rows = [...appeared].map(footballer_id => ({ match_id: match.id, footballer_id }));
    const { error } = await db.from('match_appearances').insert(rows);
    if (error) throw error;
  }
}
