'use server';

import { db } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export async function joinLeague(formData: FormData) {
  const passcode = formData.get('passcode')?.toString().trim();
  const displayName = formData.get('display_name')?.toString().trim();

  if (!passcode || !displayName) {
    redirect('/join?error=missing_fields');
  }

  const { data: league } = await db.from('league').select('passcode').eq('id', 1).single();
  if (!league || league.passcode !== passcode) {
    redirect('/join?error=wrong_passcode');
  }

  const { count } = await db.from('managers').select('id', { count: 'exact', head: true });
  if ((count ?? 0) >= 5) {
    redirect('/join?error=league_full');
  }

  const { data: existing } = await db
    .from('managers')
    .select('id, display_name')
    .eq('display_name', displayName)
    .maybeSingle();

  let managerId: string;

  if (existing) {
    managerId = existing.id;
  } else {
    const { data: leagueConfig } = await db.from('league').select('config').eq('id', 1).single();
    const startingCoins = (leagueConfig?.config as { coins?: { starting_balance?: number } })?.coins?.starting_balance ?? 100;

    const { data: manager, error } = await db
      .from('managers')
      .insert({ display_name: displayName, coins: startingCoins })
      .select('id')
      .single();
    if (error || !manager) redirect('/join?error=server_error');
    managerId = (manager as { id: string }).id;
  }

  const session = await getSession();
  session.managerId = managerId;
  session.displayName = displayName;
  await session.save();

  redirect('/fixtures');
}
