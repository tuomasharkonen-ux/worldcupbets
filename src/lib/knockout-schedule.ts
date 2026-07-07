// The fixed WC2026 knockout calendar (dates from FIFA: QF 9–11 Jul, SF 14–15 Jul,
// third place 18 Jul, final 19 Jul). The feed only creates a match row once both
// teams are known, so undrawn knockout slots have no row yet — the schedule renders
// these as placeholders ("teams to be decided") so managers can see when the rest of
// the tournament is, then swaps in the real fixture once it's drawn.
//
// Kickoff times aren't confirmed for undrawn matches, so the UI shows the date only
// ("time TBC"); the timestamps here exist purely to slot each placeholder onto the
// right NA match day and in the right order. The `home_label`/`away_label` are the
// structural feeders, always correct regardless of who advances.

import type { MatchStage } from '@/types/db';

export interface KnockoutSlot {
  id: string;
  stage: MatchStage;
  kickoff_at: string;
  home_label: string;
  away_label: string;
}

export const WC2026_KNOCKOUT_SCHEDULE: KnockoutSlot[] = [
  { id: 'gb-qf-1', stage: 'qf', kickoff_at: '2026-07-09T20:00:00Z', home_label: 'R16 winner', away_label: 'R16 winner' },
  { id: 'gb-qf-2', stage: 'qf', kickoff_at: '2026-07-10T20:00:00Z', home_label: 'R16 winner', away_label: 'R16 winner' },
  { id: 'gb-qf-3', stage: 'qf', kickoff_at: '2026-07-11T18:00:00Z', home_label: 'R16 winner', away_label: 'R16 winner' },
  { id: 'gb-qf-4', stage: 'qf', kickoff_at: '2026-07-11T22:00:00Z', home_label: 'R16 winner', away_label: 'R16 winner' },
  { id: 'gb-sf-1', stage: 'sf', kickoff_at: '2026-07-14T20:00:00Z', home_label: 'QF winner', away_label: 'QF winner' },
  { id: 'gb-sf-2', stage: 'sf', kickoff_at: '2026-07-15T20:00:00Z', home_label: 'QF winner', away_label: 'QF winner' },
  { id: 'gb-third', stage: 'third', kickoff_at: '2026-07-18T20:00:00Z', home_label: 'Semi-final loser', away_label: 'Semi-final loser' },
  { id: 'gb-final', stage: 'final', kickoff_at: '2026-07-19T19:00:00Z', home_label: 'Semi-final winner', away_label: 'Semi-final winner' },
];
