// Builds the schedule timeline shown on /fixtures: the drawn matches plus synthesised
// placeholders for undrawn knockout slots, grouped into NA match days. Pure (naDayKey
// is injected) so the real page and the /admin preview share one implementation, and
// the placeholder-dedup edge cases are unit-tested.

import { WC2026_KNOCKOUT_SCHEDULE, type KnockoutSlot } from './knockout-schedule';
import type { MatchStage } from '@/types/db';

export type ScheduleItem<M> =
  | { kind: 'match'; kickoff_at: string; m: M }
  | { kind: 'placeholder'; kickoff_at: string; slot: KnockoutSlot };

export interface ScheduleGroup<M> {
  key: string;
  items: ScheduleItem<M>[];
}

// The true size of each knockout round — used to cap placeholders so real + placeholder
// never exceeds it, even if the feed puts a real match on an off-calendar day.
const KNOCKOUT_COUNT: Partial<Record<MatchStage, number>> = { qf: 4, sf: 2, third: 1, final: 1 };

// Which canonical slots are still undrawn: per round, a real match on a given NA day
// consumes the matching calendar slot; the remainder (capped at the round size) render
// as placeholders.
export function undrawnKnockoutSlots<M extends { stage: MatchStage; kickoff_at: string }>(
  matches: M[],
  naDayKey: (utc: string) => string,
): KnockoutSlot[] {
  const realByStageDay = new Map<string, number>();
  const realByStage = new Map<string, number>();
  for (const m of matches) {
    if (KNOCKOUT_COUNT[m.stage] == null) continue;
    const dayKey = `${m.stage}|${naDayKey(m.kickoff_at)}`;
    realByStageDay.set(dayKey, (realByStageDay.get(dayKey) ?? 0) + 1);
    realByStage.set(m.stage, (realByStage.get(m.stage) ?? 0) + 1);
  }
  const allowance = new Map<string, number>();
  for (const [stage, total] of Object.entries(KNOCKOUT_COUNT)) {
    allowance.set(stage, Math.max(0, (total ?? 0) - (realByStage.get(stage) ?? 0)));
  }
  const slots: KnockoutSlot[] = [];
  for (const slot of WC2026_KNOCKOUT_SCHEDULE) {
    const dayKey = `${slot.stage}|${naDayKey(slot.kickoff_at)}`;
    const realHere = realByStageDay.get(dayKey) ?? 0;
    if (realHere > 0) {
      realByStageDay.set(dayKey, realHere - 1); // this slot is already a drawn match
      continue;
    }
    if ((allowance.get(slot.stage) ?? 0) > 0) {
      slots.push(slot);
      allowance.set(slot.stage, allowance.get(slot.stage)! - 1);
    }
  }
  return slots;
}

export function buildScheduleGroups<M extends { stage: MatchStage; kickoff_at: string }>(
  matches: M[],
  naDayKey: (utc: string) => string,
): ScheduleGroup<M>[] {
  const items: ScheduleItem<M>[] = [
    ...matches.map((m): ScheduleItem<M> => ({ kind: 'match', kickoff_at: m.kickoff_at, m })),
    ...undrawnKnockoutSlots(matches, naDayKey).map(
      (slot): ScheduleItem<M> => ({ kind: 'placeholder', kickoff_at: slot.kickoff_at, slot }),
    ),
    // Stable input order (matches arrive kickoff+id sorted) is preserved for ties, and
    // a real match sorts ahead of a placeholder at the same instant.
  ].sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at) || (a.kind === b.kind ? 0 : a.kind === 'match' ? -1 : 1));

  const groups: ScheduleGroup<M>[] = [];
  for (const it of items) {
    const key = naDayKey(it.kickoff_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(it);
    else groups.push({ key, items: [it] });
  }
  return groups;
}
