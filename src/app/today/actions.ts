'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/supabase';
import { requireManager } from '@/lib/session';
import { REACTION_EMOJIS, MAX_COMMENT_CHARS, isAllowedGifUrl } from '@/lib/social';

const SLATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type SocialActionState = { error?: string };

export async function postComment(input: {
  slateKey: string;
  body: string;
  gifUrl?: string | null;
}): Promise<SocialActionState> {
  let managerId: string;
  try {
    ({ managerId } = await requireManager());
  } catch {
    return { error: 'Session expired — reload the page.' };
  }

  if (!SLATE_KEY_RE.test(input.slateKey)) return { error: 'Invalid slate.' };

  const body = input.body.trim();
  const gifUrl = input.gifUrl?.trim() || null;
  if (body.length === 0 && !gifUrl) return { error: 'Write something or pick a GIF.' };
  if (body.length > MAX_COMMENT_CHARS) return { error: `Keep it under ${MAX_COMMENT_CHARS} characters.` };
  if (gifUrl && !isAllowedGifUrl(gifUrl)) return { error: 'That GIF can’t be used.' };

  const { error } = await db.from('comments').insert({
    slate_key: input.slateKey,
    manager_id: managerId,
    body,
    gif_url: gifUrl,
  });
  if (error) return { error: 'Could not post. Try again.' };

  revalidatePath('/today');
  return {};
}

export async function deleteComment(commentId: string): Promise<SocialActionState> {
  let managerId: string;
  try {
    ({ managerId } = await requireManager());
  } catch {
    return { error: 'Session expired — reload the page.' };
  }

  // Scoped to the caller's own comments; deleting cascades to its reactions.
  const { error } = await db
    .from('comments')
    .delete()
    .eq('id', commentId)
    .eq('manager_id', managerId);
  if (error) return { error: 'Could not delete. Try again.' };

  revalidatePath('/today');
  return {};
}

export async function toggleReaction(input: {
  emoji: string;
  commentId: string;
}): Promise<SocialActionState> {
  let managerId: string;
  try {
    ({ managerId } = await requireManager());
  } catch {
    return { error: 'Session expired — reload the page.' };
  }

  if (!(REACTION_EMOJIS as readonly string[]).includes(input.emoji)) {
    return { error: 'Invalid reaction.' };
  }

  // Toggle: delete the existing row if there is one, otherwise insert. The partial
  // unique index (migration 010) makes the insert race-safe.
  const { data: deleted, error: delError } = await db
    .from('reactions')
    .delete()
    .eq('manager_id', managerId)
    .eq('emoji', input.emoji)
    .eq('comment_id', input.commentId)
    .select('id');
  if (delError) return { error: 'Could not react. Try again.' };

  if ((deleted ?? []).length === 0) {
    const { error } = await db.from('reactions').insert({
      manager_id: managerId,
      emoji: input.emoji,
      comment_id: input.commentId,
    });
    // Ignore a unique-violation race (double-tap) — the reaction is there either way.
    if (error && error.code !== '23505') return { error: 'Could not react. Try again.' };
  }

  revalidatePath('/today');
  return {};
}
