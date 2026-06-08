'use server';

import { db } from '@/lib/supabase';
import { getSession } from '@/lib/session';
import { hashPin, normalizePin, verifyPin } from '@/lib/pin';
import type { LeagueConfig } from '@/types/db';
import { redirect } from 'next/navigation';

const DEFAULT_MAX_MANAGERS = 20;

// PIN brute-force lockout (migration 007). PINs are 4–6 digits, so once an attacker
// knows the shared passcode the PIN is all that protects a name. After this many
// consecutive wrong PINs the name is frozen for the cooldown window.
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

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
    .select('id, pin_hash, failed_pin_attempts, pin_locked_until')
    .eq('display_name', displayName)
    .maybeSingle();

  let managerId: string;

  if (existing) {
    const row = existing as {
      id: string;
      pin_hash: string | null;
      failed_pin_attempts: number;
      pin_locked_until: string | null;
    };
    if (row.pin_hash) {
      // Frozen by too many wrong PINs? Stay frozen until the cooldown elapses.
      if (row.pin_locked_until && new Date(row.pin_locked_until) > new Date()) {
        redirect('/join?error=locked');
      }
      // Returning player — the PIN is what proves it's really them on a new device.
      const ok = await verifyPin(pin, row.pin_hash);
      if (!ok) {
        // Count the miss; freeze the name once the limit is hit (and reset the
        // counter so the next window starts clean).
        const attempts = (row.failed_pin_attempts ?? 0) + 1;
        const locked = attempts >= MAX_PIN_ATTEMPTS;
        await db
          .from('managers')
          .update({
            failed_pin_attempts: locked ? 0 : attempts,
            pin_locked_until: locked ? new Date(Date.now() + PIN_LOCKOUT_MS).toISOString() : null,
          })
          .eq('id', row.id);
        redirect(locked ? '/join?error=locked' : '/join?error=wrong_pin');
      }
      // Success — clear any accumulated lockout state.
      if ((row.failed_pin_attempts ?? 0) > 0 || row.pin_locked_until) {
        await db
          .from('managers')
          .update({ failed_pin_attempts: 0, pin_locked_until: null })
          .eq('id', row.id);
      }
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
