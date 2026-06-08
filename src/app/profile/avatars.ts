// Emoji avatars (stored in managers.avatar_url as a plain string — no upload infra).
// Kept out of actions.ts because a 'use server' file may only export async functions.
export const AVATAR_CHOICES = [
  '⚽', '🦁', '🐉', '🦅', '🐺', '🦈', '🐅', '🐂',
  '🔥', '⚡', '👑', '🎯', '💎', '🚀', '🍀', '🎲',
] as const;
