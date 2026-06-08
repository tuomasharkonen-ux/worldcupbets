'use server';

import { db } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { hashPin, normalizePin, verifyPin } from '@/lib/pin';
import type { LeagueConfig } from '@/types/db';
import { redirect } from 'next/navigation';

const DEFAULT_MAX_MANAGERS = 20;

export async function joinLeague(formData: FormData) {
  const passcode = formData.get('passcode')?.toString().trim();
  const displayName = formData.get('display_name')?.toString().trim();
  const pin = normalizePin(formData.get('pin')?.toString());

  if (!passcode || !displayName) {
    redirect('/join?error=missing_fields');
  }
  if (!pin) {
    redirect('/join?error=pin_format');
  }

  const { data: league } = await db.from('league').select('passcode, config').eq('id', 1).single();
  if (!league || league.passcode !== passcode) {
    redirect('/join?error=wrong_passcode');
  }

  const config = league.config as LeagueConfig;

  // Identity is the display name. An existing name means "log me back in" (verify
  // PIN); a new name means "sign me up" (set a PIN, subject to the league cap).
  const { data: existing } = await db
    .from('managers')
    .select('id, pin_hash')
    .eq('display_name', displayName)
    .maybeSingle();

  let managerId: string;

  if (existing) {
    const row = existing as { id: string; pin_hash: string | null };
    if (row.pin_hash) {
      // Returning player — the PIN is what proves it's really them on a new device.
      const ok = await verifyPin(pin, row.pin_hash);
      if (!ok) redirect('/join?error=wrong_pin');
    } else {
      // Legacy player from before PINs existed: claim the slot by setting one now.
      const { error } = await db
        .from('managers')
        .update({ pin_hash: await hashPin(pin) })
        .eq('id', row.id);
      if (error) redirect('/join?error=server_error');
    }
    managerId = row.id;
  } else {
    const maxManagers = config?.max_managers ?? DEFAULT_MAX_MANAGERS;
    const { count } = await db.from('managers').select('id', { count: 'exact', head: true });
    if ((count ?? 0) >= maxManagers) {
      redirect('/join?error=league_full');
    }

    const startingCoins = config?.coins?.starting_balance ?? 100;

    const { data: manager, error } = await db
      .from('managers')
      .insert({ display_name: displayName, coins: startingCoins, pin_hash: await hashPin(pin) })
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

  redirect('/today');
}
