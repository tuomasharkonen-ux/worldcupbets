import { afEventToRow, isShootoutKick } from '../af-events';
import type { AfEvent } from '@/lib/api-football';

const byAfId = new Map<number, string>([[100, 'uuid-100']]);

function ev(overrides: Partial<AfEvent>): AfEvent {
  return {
    time: { elapsed: 55, extra: null },
    team: { id: 1, name: 'France' },
    player: { id: 100, name: 'K. Mbappé' },
    assist: { id: null, name: null },
    type: 'Goal',
    detail: 'Normal Goal',
    comments: null,
    ...overrides,
  };
}

describe('afEventToRow', () => {
  it('maps a normal goal', () => {
    expect(afEventToRow(ev({}), byAfId, 'm1')).toEqual({
      match_id: 'm1',
      footballer_id: 'uuid-100',
      type: 'goal',
      minute: 55,
      is_own_goal: false,
    });
  });

  it('maps an in-game penalty to a penalty goal', () => {
    expect(afEventToRow(ev({ detail: 'Penalty' }), byAfId, 'm1')?.type).toBe('penalty');
  });

  it('maps an own goal with the flag set', () => {
    const row = afEventToRow(ev({ detail: 'Own Goal' }), byAfId, 'm1');
    expect(row).toMatchObject({ type: 'own_goal', is_own_goal: true });
  });

  it('drops missed penalties', () => {
    expect(afEventToRow(ev({ detail: 'Missed Penalty' }), byAfId, 'm1')).toBeNull();
  });

  it('drops shootout kicks (Goal/Penalty tagged via comments)', () => {
    const kick = ev({
      detail: 'Penalty',
      comments: 'Penalty Shootout',
      time: { elapsed: 120, extra: null },
    });
    expect(isShootoutKick(kick)).toBe(true);
    expect(afEventToRow(kick, byAfId, 'm1')).toBeNull();
  });

  it('drops missed shootout kicks too', () => {
    const miss = ev({ detail: 'Missed Penalty', comments: 'Penalty Shootout' });
    expect(afEventToRow(miss, byAfId, 'm1')).toBeNull();
  });

  it('maps cards and drops unknown card details', () => {
    expect(afEventToRow(ev({ type: 'Card', detail: 'Yellow Card' }), byAfId, 'm1')?.type).toBe('yellow');
    expect(afEventToRow(ev({ type: 'Card', detail: 'Red Card' }), byAfId, 'm1')?.type).toBe('red');
    expect(afEventToRow(ev({ type: 'Card', detail: 'White Card' }), byAfId, 'm1')).toBeNull();
  });

  it('drops substitutions and VAR events', () => {
    expect(afEventToRow(ev({ type: 'subst', detail: 'Substitution 1' }), byAfId, 'm1')).toBeNull();
    expect(afEventToRow(ev({ type: 'Var', detail: 'Goal cancelled' }), byAfId, 'm1')).toBeNull();
  });

  it('keeps the goal but nulls the scorer when the AF player is unmapped', () => {
    const row = afEventToRow(ev({ player: { id: 999, name: 'Unknown' } }), byAfId, 'm1');
    expect(row).toMatchObject({ type: 'goal', footballer_id: null });
  });
});
