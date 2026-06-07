import { NextRequest, NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/cron';
import { db } from '@/lib/supabase';
import { settle } from '@/settlement/engine';
import type { Bet, League, Match, MatchEvent } from '@/types/db';

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

  // Load match events (goals, cards)
  const { data: events, error: eventsErr } = await db
    .from('match_events')
    .select('*')
    .eq('match_id', match.id);
  if (eventsErr) throw eventsErr;

  // Run the pure settlement engine
  const result = settle({
    match,
    bets: (bets ?? []) as Bet[],
    events: (events ?? []) as MatchEvent[],
    config: league.config,
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
      .update({ status: update.status, glory_awarded: update.gloryAwarded })
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

    const glory = (rows ?? [])
      .filter(r => r.currency === 'glory')
      .reduce((s, r) => s + r.amount, 0);
    const coins = (rows ?? [])
      .filter(r => r.currency === 'coins')
      .reduce((s, r) => s + r.amount, 0);

    await db.from('managers').update({ glory, coins }).eq('id', managerId);
  }

  // 4. Mark match as settled
  await db
    .from('matches')
    .update({ settled_at: new Date().toISOString() })
    .eq('id', match.id);
}
