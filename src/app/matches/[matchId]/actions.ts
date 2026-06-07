'use server';

import { db } from '@/lib/supabase';
import { requireManager } from '@/lib/session';
import { redirect } from 'next/navigation';
import type { BetType } from '@/types/db';

export type BetSlipState = {
  error?: string;
  success?: boolean;
};

// The three optional player props, in display order. Each maps a form field to a
// bet_type; the field value is a footballer UUID (or '' for none).
const PROP_FIELDS: { field: string; betType: BetType }[] = [
  { field: 'first_scorer', betType: 'first_scorer' },
  { field: 'anytime_scorer', betType: 'anytime_scorer' },
  { field: 'carded', betType: 'carded' },
];

const MAX_PROPS = 2;

export async function submitBet(
  matchId: string,
  _prev: BetSlipState,
  formData: FormData,
): Promise<BetSlipState> {
  let managerId: string;
  try {
    ({ managerId } = await requireManager());
  } catch {
    redirect('/join');
  }

  // Load match — enforce lock server-side in UTC
  const { data: match } = await db
    .from('matches')
    .select('id, kickoff_at, status, home_team_id, away_team_id')
    .eq('id', matchId)
    .single();

  if (!match) return { error: 'Match not found.' };
  if (match.status !== 'scheduled' || new Date() >= new Date(match.kickoff_at)) {
    return { error: 'This match is locked — bets closed at kickoff.' };
  }

  const outcomeResult = formData.get('outcome') as string | null;
  const homeScoreRaw = formData.get('home_score') as string | null;
  const awayScoreRaw = formData.get('away_score') as string | null;
  const hasExactScore = homeScoreRaw !== null && homeScoreRaw !== '' && awayScoreRaw !== null && awayScoreRaw !== '';

  // Collect chosen props (non-empty selects)
  const chosenProps = PROP_FIELDS
    .map(p => ({ ...p, footballerId: (formData.get(p.field) as string | null)?.trim() || '' }))
    .filter(p => p.footballerId !== '');

  if (!outcomeResult && !hasExactScore && chosenProps.length === 0) {
    return { error: 'Place at least one bet.' };
  }

  if (chosenProps.length > MAX_PROPS) {
    return { error: `Pick at most ${MAX_PROPS} player props.` };
  }

  // Validate exact score values
  let homeScore: number | null = null;
  let awayScore: number | null = null;
  if (hasExactScore) {
    homeScore = parseInt(homeScoreRaw!, 10);
    awayScore = parseInt(awayScoreRaw!, 10);
    if (
      isNaN(homeScore) || isNaN(awayScore) ||
      homeScore < 0 || awayScore < 0 ||
      homeScore > 20 || awayScore > 20
    ) {
      return { error: 'Exact score values must be between 0 and 20.' };
    }
  }

  // Validate picked footballers belong to one of the two teams in this match
  if (chosenProps.length > 0) {
    const { data: validPlayers } = await db
      .from('footballers')
      .select('id')
      .in('team_id', [match.home_team_id, match.away_team_id]);
    const validIds = new Set((validPlayers ?? []).map(p => p.id as string));
    if (chosenProps.some(p => !validIds.has(p.footballerId))) {
      return { error: 'A selected player is not in this match.' };
    }
  }

  if (outcomeResult && !['home', 'draw', 'away'].includes(outcomeResult)) {
    return { error: 'Invalid outcome selection.' };
  }

  // Replace any existing pending bets for this manager + match
  await db
    .from('bets')
    .delete()
    .eq('manager_id', managerId)
    .eq('match_id', matchId)
    .eq('status', 'pending');

  const base = { manager_id: managerId, match_id: matchId, stake_coins: 0, stake_mult: 1.0, locked_at: match.kickoff_at };
  const newBets: Array<Record<string, unknown>> = [];

  if (outcomeResult) {
    newBets.push({ ...base, bet_type: 'outcome', selection: { result: outcomeResult } });
  }

  if (homeScore !== null && awayScore !== null) {
    newBets.push({ ...base, bet_type: 'exact_score', selection: { home: homeScore, away: awayScore } });
  }

  for (const p of chosenProps) {
    newBets.push({ ...base, bet_type: p.betType, selection: { footballer_id: p.footballerId } });
  }

  const { error } = await db.from('bets').insert(newBets);
  if (error) return { error: 'Could not save bets. Try again.' };

  return { success: true };
}
