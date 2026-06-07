'use server';

import { db } from '@/lib/supabase';
import { requireManager } from '@/lib/session';
import { redirect } from 'next/navigation';

export type BetSlipState = {
  error?: string;
  success?: boolean;
};

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
    .select('id, kickoff_at, status')
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

  if (!outcomeResult && !hasExactScore) {
    return { error: 'Place at least one bet — outcome or exact score.' };
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

  // Replace any existing pending bets for this manager + match
  await db
    .from('bets')
    .delete()
    .eq('manager_id', managerId)
    .eq('match_id', matchId)
    .eq('status', 'pending');

  const newBets = [];

  if (outcomeResult) {
    if (!['home', 'draw', 'away'].includes(outcomeResult)) {
      return { error: 'Invalid outcome selection.' };
    }
    newBets.push({
      manager_id: managerId,
      match_id: matchId,
      bet_type: 'outcome',
      selection: { result: outcomeResult },
      stake_coins: 0,
      stake_mult: 1.0,
      locked_at: match.kickoff_at,
    });
  }

  if (homeScore !== null && awayScore !== null) {
    newBets.push({
      manager_id: managerId,
      match_id: matchId,
      bet_type: 'exact_score',
      selection: { home: homeScore, away: awayScore },
      stake_coins: 0,
      stake_mult: 1.0,
      locked_at: match.kickoff_at,
    });
  }

  const { error } = await db.from('bets').insert(newBets);
  if (error) return { error: 'Could not save bets. Try again.' };

  return { success: true };
}
