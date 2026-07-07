'use client';

import { useEffect } from 'react';

// Jumps the schedule to the next match on open, so a returning manager doesn't have
// to scroll past every finished match day. Runs once on mount; the anchor id is
// placed by the page on the next-up match day (or the Golden Bracket promo when it
// leads into the upcoming knockouts). Instant jump, and scroll-margin on the target
// keeps it clear of the sticky nav.
export function ScrollToAnchor({ targetId }: { targetId: string }) {
  useEffect(() => {
    // Instant, not smooth — the page sets `scroll-behavior: smooth` globally, and we
    // don't want to animate the whole way down from the top on every open.
    document.getElementById(targetId)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [targetId]);
  return null;
}
