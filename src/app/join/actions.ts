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

  const { data: league } = await db.from('league').select('passcode, config').eq('id', 1).single();
  if (!league || league.passcode !== passcode) {
    redirect('/join?error=wrong_passcode');
  }

  const { count } = await db.from('managers').select('id', { count: 'exact', head: true });
  if ((count ?? 0) >= 5) {
    redirect('/join?error=league_full');
  }

  const { data: existing } = await db
    .from('managers')
    .select('id')
    .eq('display_name', displayName)
    .maybeSingle();

  let managerId: string;

  if (existing) {
    // Reclaiming an existing slot — just log back in
    managerId = existing.id;
  } else {
    const startingCoins =
      (league.config as { coins?: { starting_balance?: number } })?.coins?.starting_balance ?? 100;

    const { data: manager, error } = await db
      .from('managers')
      .insert({ display_name: displayName, coins: startingCoins })
      .select('id')
      .single();
    if (error || !manager) redirect('/join?error=server_error');
    managerId = (manager as { id: string }).id;

    // Seed the ledger so the settle cron can recompute balances correctly.
    // Without this entry the recompute would under-count coins by startingCoins.
    await db.from('ledger').insert({
      manager_id: managerId,
      currency: 'coins',
      amount: startingCoins,
      reason: 'starting_balance',
      ref_type: 'manager',
      ref_id: managerId,
    });
  }

  const session = await getSession();
  session.managerId = managerId;
  session.displayName = displayName;
  await session.save();

  redirect('/fixtures');
}
