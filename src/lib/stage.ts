// Human labels + emphasis rules for the tournament stages. Shared by the schedule
// page and its /admin preview so the two never drift.

import type { MatchStage } from '@/types/db';

// Round names for the knockout stages. Group matches show "Group X" instead, so
// the group entry here is only a fallback.
export const STAGE_LABEL: Record<MatchStage, string> = {
  group: 'Group stage',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarter-final',
  sf: 'Semi-final',
  third: 'Third-place playoff',
  final: 'Final',
};

// The marquee knockout rounds we visually emphasise in the schedule list.
const FEATURE_STAGES: ReadonlySet<MatchStage> = new Set(['qf', 'sf', 'final']);
export function isFeatureStage(stage: MatchStage): boolean {
  return FEATURE_STAGES.has(stage);
}
