'use server';

import { db } from '@/lib/supabase';
import { getSession, requireManager } from '@/lib/session';
import { hashPin, normalizePin, verifyPin } from '@/lib/pin';
import { AVATAR_CHOICES } from './avatars';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function updateProfile(formData: FormData) {
  const { managerId } = await requireManager();

  const displayName = formData.get('display_name')?.toString().trim();
  const avatar = formData.get('avatar')?.toString().trim() || null;

  if (!displayName) redirect('/profile?error=missing_name');
  if (displayName.length > 32) redirect('/profile?error=name_too_long');
  if (avatar && !AVATAR_CHOICES.includes(avatar as (typeof AVATAR_CHOICES)[number])) {
    redirect('/profile?error=bad_avatar');
  }

  // display_name is unique and is the login identity — block collisions with others.
  const { data: clash } = await db
    .from('managers')
    .select('id')
    .eq('display_name', displayName)
    .neq('id', managerId)
    .maybeSingle();
  if (clash) redirect('/profile?error=name_taken');

  const { error } = await db
    .from('managers')
    .update({ display_name: displayName, avatar_url: avatar })
    .eq('id', managerId);
  if (error) redirect('/profile?error=server_error');

  // Keep the session's cached name in sync with the row (used across the nav/UI).
  const session = await getSession();
  session.displayName = displayName;
  await session.save();

  revalidatePath('/profile');
  redirect('/profile?saved=profile');
}

export async function changePin(formData: FormData) {
  const { managerId } = await requireManager();

  const currentPin = normalizePin(formData.get('current_pin')?.toString());
  const newPin = normalizePin(formData.get('new_pin')?.toString());

  if (!newPin) redirect('/profile?error=pin_format');

  const { data: row } = await db
    .from('managers')
    .select('pin_hash')
    .eq('id', managerId)
    .single();

  // If a PIN is already set, the current one must check out before we replace it.
  const existingHash = (row as { pin_hash: string | null } | null)?.pin_hash ?? null;
  if (existingHash) {
    if (!currentPin || !(await verifyPin(currentPin, existingHash))) {
      redirect('/profile?error=wrong_current_pin');
    }
  }

  const { error } = await db
    .from('managers')
    .update({ pin_hash: await hashPin(newPin) })
    .eq('id', managerId);
  if (error) redirect('/profile?error=server_error');

  redirect('/profile?saved=pin');
}
