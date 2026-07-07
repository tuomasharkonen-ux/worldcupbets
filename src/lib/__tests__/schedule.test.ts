import { undrawnKnockoutSlots, buildScheduleGroups } from '../schedule';
import type { MatchStage } from '@/types/db';

// Deterministic NA-day key for tests: the calendar day is just the ISO date. The
// canonical slots and the fixtures below are timed so this matches by day.
const dayKey = (utc: string) => utc.slice(0, 10);

type M = { id: string; stage: MatchStage; kickoff_at: string };
const m = (id: string, stage: MatchStage, kickoff_at: string): M => ({ id, stage, kickoff_at });

describe('undrawnKnockoutSlots', () => {
  it('returns the whole knockout calendar when nothing is drawn', () => {
    const slots = undrawnKnockoutSlots<M>([], dayKey);
    expect(slots.map(s => s.stage)).toEqual(['qf', 'qf', 'qf', 'qf', 'sf', 'sf', 'third', 'final']);
  });

  it('drops slots already covered by a drawn match on the same day', () => {
    // Two QFs drawn — one on 9 Jul, one on 11 Jul (matching two canonical slots).
    const matches = [
      m('a', 'qf', '2026-07-09T20:00:00Z'),
      m('b', 'qf', '2026-07-11T21:00:00Z'),
    ];
    const slots = undrawnKnockoutSlots(matches, dayKey);
    // 2 QF placeholders remain (10 Jul + the second 11 Jul), plus SF/third/final.
    expect(slots.map(s => s.id)).toEqual(['gb-qf-2', 'gb-qf-4', 'gb-sf-1', 'gb-sf-2', 'gb-third', 'gb-final']);
  });

  it('never emits more than a round can hold, even for off-calendar matches', () => {
    // Three QFs drawn, one on a day with no canonical slot (12 Jul).
    const matches = [
      m('a', 'qf', '2026-07-09T20:00:00Z'),
      m('b', 'qf', '2026-07-10T20:00:00Z'),
      m('c', 'qf', '2026-07-12T20:00:00Z'),
    ];
    const qfPlaceholders = undrawnKnockoutSlots(matches, dayKey).filter(s => s.stage === 'qf');
    expect(qfPlaceholders).toHaveLength(1); // 4 (round size) − 3 drawn
  });

  it('ignores group-stage and early-round matches entirely', () => {
    const matches = [m('g', 'group', '2026-06-15T16:00:00Z'), m('r', 'r16', '2026-07-04T20:00:00Z')];
    expect(undrawnKnockoutSlots(matches, dayKey)).toHaveLength(8);
  });
});

describe('buildScheduleGroups', () => {
  it('interleaves placeholders into the timeline and groups by day', () => {
    const matches = [
      m('a', 'qf', '2026-07-09T20:00:00Z'),
      m('b', 'qf', '2026-07-11T21:00:00Z'),
    ];
    const groups = buildScheduleGroups(matches, dayKey);
    const byDay = Object.fromEntries(groups.map(g => [g.key, g.items.map(i => i.kind)]));
    expect(byDay['2026-07-09']).toEqual(['match']);
    expect(byDay['2026-07-10']).toEqual(['placeholder']);
    expect(byDay['2026-07-11']).toEqual(['match', 'placeholder']); // real sorts before placeholder
    expect(byDay['2026-07-19']).toEqual(['placeholder']); // final
  });

  it('keeps a real match ahead of a placeholder at the same kickoff instant', () => {
    const matches = [m('a', 'qf', '2026-07-10T20:00:00Z')]; // same instant as gb-qf-2
    const day = buildScheduleGroups(matches, dayKey).find(g => g.key === '2026-07-10')!;
    expect(day.items[0].kind).toBe('match');
  });
});
