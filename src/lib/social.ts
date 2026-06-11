// Shared bits of the match-day social layer (migration 010) used on both sides:
// the server actions validate against these, the Social client component renders them.

// The fixed reaction palette — one tap each, toggled.
export const REACTION_EMOJIS = ['🔥', '😂', '😱', '👏', '🤡', '⚽'] as const;

export const MAX_COMMENT_CHARS = 500;

// Only GIFs picked through our /api/gifs proxy (Giphy media CDN) are accepted —
// a comment can't embed an arbitrary URL.
export function isAllowedGifUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      (u.hostname === 'media.giphy.com' || /^media\d+\.giphy\.com$/.test(u.hostname))
    );
  } catch {
    return false;
  }
}
