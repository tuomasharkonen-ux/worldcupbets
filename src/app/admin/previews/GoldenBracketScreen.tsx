'use client';

import { ScreenFrame } from './ScreenFrame';
import { GoldenBracketFlow, type GbStep } from '@/app/golden-bracket/GoldenBracketFlow';
import { GoldenBracketPromo } from '@/app/today/GoldenBracketPromo';
import {
  MOCK_GB_CONFIG,
  MOCK_GB_LOCK_AT,
  MOCK_GB_PICK,
  MOCK_GB_SCORERS,
  MOCK_GB_TEAMS,
} from '../mock';

export type GoldenBracketVariant = GbStep | 'submitted' | 'locked' | 'promo';

// No-op stand-in for the submitGoldenBracket server action, so the full wizard is
// clickable in the gallery without a session or DB (same trick as MatchScreen's
// previewSubmit for BetSlip).
async function previewSubmit() {}

export function GoldenBracketScreen({ variant }: { variant: GoldenBracketVariant }) {
  // All three Today-promo states side by side.
  if (variant === 'promo') {
    return (
      <ScreenFrame>
        <main className="mx-auto w-full max-w-lg space-y-5 px-4 py-8">
          <GoldenBracketPromo state="open" lockAt={MOCK_GB_LOCK_AT} />
          <GoldenBracketPromo state="submitted" lockAt={MOCK_GB_LOCK_AT} />
          <GoldenBracketPromo state="locked" lockAt={MOCK_GB_LOCK_AT} />
          {/* Compact row + pre-window teaser — used on the schedule page. */}
          <GoldenBracketPromo state="teaser" lockAt={MOCK_GB_LOCK_AT} compact />
          <GoldenBracketPromo state="open" lockAt={MOCK_GB_LOCK_AT} compact />
          <GoldenBracketPromo state="submitted" lockAt={MOCK_GB_LOCK_AT} compact />
          <GoldenBracketPromo state="locked" lockAt={MOCK_GB_LOCK_AT} compact />
        </main>
      </ScreenFrame>
    );
  }

  const summary = variant === 'submitted' || variant === 'locked';
  return (
    <ScreenFrame>
      <main className="mx-auto w-full max-w-lg space-y-5 px-4 py-8">
        <GoldenBracketFlow
          teams={MOCK_GB_TEAMS}
          scorers={MOCK_GB_SCORERS}
          cfg={MOCK_GB_CONFIG}
          myPick={summary || variant === 'review' || variant === 'scorer' ? MOCK_GB_PICK : null}
          lockAt={MOCK_GB_LOCK_AT}
          locked={variant === 'locked'}
          submitAction={previewSubmit}
          initialStep={summary ? 'summary' : variant}
        />
      </main>
    </ScreenFrame>
  );
}
