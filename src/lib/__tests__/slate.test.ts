import { slateKeyOf, currentSlateKey, groupBySlate, slateLabel } from '../slate';

const ROLLOVER = 9; // 09:00 Helsinki default boundary

describe('slateKeyOf', () => {
  // Helsinki is UTC+3 in mid-June (EEST).
  test('an evening kickoff belongs to that calendar day', () => {
    // 18:00 UTC = 21:00 Helsinki on the 15th.
    expect(slateKeyOf('2026-06-15T18:00:00Z', ROLLOVER)).toBe('2026-06-15');
  });

  test('a small-hours kickoff belongs to the previous evening slate', () => {
    // 01:00 UTC = 04:00 Helsinki on the 16th → before 09:00 → slate of the 15th.
    expect(slateKeyOf('2026-06-16T01:00:00Z', ROLLOVER)).toBe('2026-06-15');
  });

  test('a kickoff exactly at the rollover hour starts the new slate', () => {
    // 06:00 UTC = 09:00 Helsinki on the 16th → not before 09:00 → slate of the 16th.
    expect(slateKeyOf('2026-06-16T06:00:00Z', ROLLOVER)).toBe('2026-06-16');
  });

  test('just before the rollover hour stays on the previous slate', () => {
    // 05:59 UTC = 08:59 Helsinki on the 16th → before 09:00 → slate of the 15th.
    expect(slateKeyOf('2026-06-16T05:59:00Z', ROLLOVER)).toBe('2026-06-15');
  });

  test('month boundary rolls back correctly', () => {
    // 00:30 UTC Jun 1 = 03:30 Helsinki → before 09:00 → slate of May 31.
    expect(slateKeyOf('2026-06-01T00:30:00Z', ROLLOVER)).toBe('2026-05-31');
  });
});

describe('currentSlateKey', () => {
  test('morning before rollover focuses last night’s slate', () => {
    // 04:00 UTC = 07:00 Helsinki on the 16th → before 09:00 → slate of the 15th.
    expect(currentSlateKey(new Date('2026-06-16T04:00:00Z'), ROLLOVER)).toBe('2026-06-15');
  });

  test('afternoon focuses tonight’s slate', () => {
    // 12:00 UTC = 15:00 Helsinki on the 16th → slate of the 16th.
    expect(currentSlateKey(new Date('2026-06-16T12:00:00Z'), ROLLOVER)).toBe('2026-06-16');
  });
});

describe('groupBySlate', () => {
  test('groups matches across the small-hours boundary into one slate', () => {
    const matches = [
      { id: 'a', kickoff_at: '2026-06-15T16:00:00Z' }, // 19:00 Hel, 15th
      { id: 'b', kickoff_at: '2026-06-15T19:00:00Z' }, // 22:00 Hel, 15th
      { id: 'c', kickoff_at: '2026-06-16T01:00:00Z' }, // 04:00 Hel 16th → slate 15th
      { id: 'd', kickoff_at: '2026-06-16T16:00:00Z' }, // 19:00 Hel, 16th
    ];
    const grouped = groupBySlate(matches, m => m.kickoff_at, ROLLOVER);
    expect(grouped.get('2026-06-15')?.map(m => m.id)).toEqual(['a', 'b', 'c']);
    expect(grouped.get('2026-06-16')?.map(m => m.id)).toEqual(['d']);
  });
});

describe('slateLabel', () => {
  test('renders the Helsinki calendar date without re-shifting', () => {
    expect(slateLabel('2026-06-15')).toBe('Mon 15 Jun');
  });
});
