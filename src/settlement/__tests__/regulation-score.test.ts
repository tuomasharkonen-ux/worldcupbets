import { regulationScoreFromEvents } from '../regulation';
import { MatchEvent } from '@/types/db';

// A knockout match: Belgium (home) vs Senegal (away).
const match = { stage: 'r32' as const, home_team_id: 'BEL', away_team_id: 'SEN' };
const teamOf = new Map<string, string>([
  ['bel1', 'BEL'],
  ['bel2', 'BEL'],
  ['bel3', 'BEL'],
  ['sen1', 'SEN'],
  ['sen2', 'SEN'],
]);

function goal(overrides: Partial<MatchEvent>): MatchEvent {
  return {
    id: 'e',
    match_id: 'm',
    footballer_id: 'bel1',
    type: 'goal',
    minute: 10,
    is_own_goal: false,
    ...overrides,
  };
}

describe('regulationScoreFromEvents', () => {
  test('Belgium 2-2 Senegal, 3-2 a.e.t. → the 90-minute score is 2-2', () => {
    // 25' SEN, 51' SEN, 86' BEL, 89' BEL (2-2 at 90'), 120' BEL penalty (extra time).
    const events: MatchEvent[] = [
      goal({ footballer_id: 'sen1', minute: 25 }),
      goal({ footballer_id: 'sen2', minute: 51 }),
      { id: 'a', match_id: 'm', footballer_id: 'sen1', type: 'assist', minute: 51, is_own_goal: false },
      goal({ footballer_id: 'bel1', minute: 86 }),
      goal({ footballer_id: 'bel2', minute: 89 }),
      { id: 'y', match_id: 'm', footballer_id: 'bel1', type: 'yellow', minute: 64, is_own_goal: false },
      goal({ footballer_id: 'bel3', type: 'penalty', minute: 120 }),
    ];
    expect(regulationScoreFromEvents(match, events, teamOf)).toEqual({ home: 2, away: 2 });
  });

  test('no extra-time goal → null (the stored summary score is already the 90-minute score)', () => {
    const events: MatchEvent[] = [
      goal({ footballer_id: 'bel1', minute: 30 }),
      goal({ footballer_id: 'sen1', minute: 70 }),
    ];
    expect(regulationScoreFromEvents(match, events, teamOf)).toBeNull();
  });

  test('group games are never corrected', () => {
    const events: MatchEvent[] = [goal({ footballer_id: 'bel1', minute: 118 })];
    expect(regulationScoreFromEvents({ ...match, stage: 'group' }, events, teamOf)).toBeNull();
  });

  test('own goal in regulation credits the opponent', () => {
    // Belgium player scores an own goal at 30' (counts for Senegal); Senegal adds one in
    // extra time (excluded). 90-minute score: 0-1.
    const events: MatchEvent[] = [
      goal({ footballer_id: 'bel1', type: 'own_goal', minute: 30, is_own_goal: true }),
      goal({ footballer_id: 'sen1', minute: 100 }),
    ];
    expect(regulationScoreFromEvents(match, events, teamOf)).toEqual({ home: 0, away: 1 });
  });

  test('bails (null) when an extra-time match has a goal with an unknown scorer', () => {
    const events: MatchEvent[] = [
      goal({ footballer_id: null, minute: 20 }),
      goal({ footballer_id: 'bel1', minute: 105 }),
    ];
    expect(regulationScoreFromEvents(match, events, teamOf)).toBeNull();
  });

  test('bails (null) when a goal has an unknown minute (can’t classify regulation vs ET)', () => {
    const events: MatchEvent[] = [
      goal({ footballer_id: 'bel1', minute: null }),
      goal({ footballer_id: 'bel2', minute: 110 }),
    ];
    expect(regulationScoreFromEvents(match, events, teamOf)).toBeNull();
  });

  test('minute exactly 90 counts as regulation; 91 does not', () => {
    const events: MatchEvent[] = [
      goal({ footballer_id: 'bel1', minute: 90 }),
      goal({ footballer_id: 'sen1', minute: 91 }),
    ];
    expect(regulationScoreFromEvents(match, events, teamOf)).toEqual({ home: 1, away: 0 });
  });
});
