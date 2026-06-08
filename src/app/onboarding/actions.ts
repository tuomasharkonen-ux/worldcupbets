'use server';

import { db } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

// Lock in the first-login picks. Validates the pair, enforces the tournament lock
// (refuses to overwrite an already-set onboarding_completed_at), then stamps both
// favorites + the completion time in one update. The picks are immutable afterwards.
export async function completeOnboarding(teamId: string, footballerId: string) {
  const session = await getSession();
  if (!session.managerId) redirect('/join');

  if (!teamId || !footballerId) redirect('/onboarding?error=incomplete');

  // The player must belong to the chosen team (guards against a tampered payload).
  const { data: player } = await db
    .from('footballers')
    .select('id, team_id')
    .eq('id', footballerId)
    .maybeSingle();
  if (!player || player.team_id !== teamId) redirect('/onboarding?error=mismatch');

  // Lock check: never overwrite once set. Re-reading here (not trusting the page load)
  // closes the race where two submits arrive for the same manager.
  const { data: manager } = await db
    .from('managers')
    .select('onboarding_completed_at')
    .eq('id', session.managerId)
    .maybeSingle();
  if (!manager) redirect('/join');
  if (manager.onboarding_completed_at) redirect('/today'); // already locked

  const { error } = await db
    .from('managers')
    .update({
      favorite_team_id: teamId,
      favorite_footballer_id: footballerId,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq('id', session.managerId)
    .is('onboarding_completed_at', null); // belt-and-suspenders lock at the DB layer
  if (error) redirect('/onboarding?error=server');

  redirect('/today');
}
