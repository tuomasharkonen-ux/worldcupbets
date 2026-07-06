'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { getGoldenBracketWindow } from '@/lib/golden-bracket';

export interface GoldenBracketPayload {
  champion: string;
  runnerUp: string;
  third: string;
  fourth: string;
  scorerId: string;
  scorerGoals: number;
}

// Save (or re-save) a manager's Golden Bracket. Unlike the onboarding picks this is
// freely editable — the lock is temporal, not one-shot: the server re-derives the
// betting window on every submit and refuses anything at/after the first QF kickoff.
export async function submitGoldenBracket(payload: GoldenBracketPayload) {
  const session = await getSession();
  if (!session.managerId) redirect('/join');

  // Re-derive the window server-side — never trust the page load. Also the anchor
  // for validation: picks must come from the 8 actual quarter-finalists.
  const window = await getGoldenBracketWindow();
  if (!window) redirect('/golden-bracket?error=closed');
  if (Date.now() >= new Date(window.lockAt).getTime()) redirect('/golden-bracket?error=locked');

  const { champion, runnerUp, third, fourth, scorerId } = payload;
  const teams = [champion, runnerUp, third, fourth];
  const qf = new Set(window.teamIds);
  if (teams.some(t => !t || !qf.has(t)) || new Set(teams).size !== 4) {
    redirect('/golden-bracket?error=teams');
  }

  const scorerGoals = Math.trunc(Number(payload.scorerGoals));
  if (!Number.isFinite(scorerGoals) || scorerGoals < 1 || scorerGoals > 30) {
    redirect('/golden-bracket?error=goals');
  }

  // The scorer pick must be a player on one of the 8 remaining squads (guards
  // against a tampered payload).
  const { data: scorer } = await db
    .from('footballers')
    .select('id, team_id')
    .eq('id', scorerId)
    .maybeSingle();
  if (!scorer || !qf.has(scorer.team_id as string)) redirect('/golden-bracket?error=scorer');

  const { error } = await db.from('golden_brackets').upsert(
    {
      manager_id: session.managerId,
      champion_team_id: champion,
      runner_up_team_id: runnerUp,
      third_team_id: third,
      fourth_team_id: fourth,
      top_scorer_id: scorerId,
      scorer_goals: scorerGoals,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'manager_id' },
  );
  if (error) {
    console.error('[golden-bracket] submit failed:', error);
    redirect('/golden-bracket?error=server');
  }

  revalidatePath('/today'); // flip the promo to its "bracket's in" state
  revalidatePath('/golden-bracket');
  redirect('/golden-bracket?saved=1');
}
