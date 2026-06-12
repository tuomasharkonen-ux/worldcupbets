import {
  computePlayerForm,
  type FormAppearance,
  type FormEvent,
  type FormMatch,
} from '../player-form';
import type { EventType, MatchStage, MatchStatus } from '@/types/db';

const TEAM_A = 'team-a';
const TEAM_B = 'team-b';
const OPP = 'team-opp';

let kickoffSeq = 0;
function match(
  id: string,
  team: string,
  status: MatchStatus = 'finished',
  stage: MatchStage = 'group',
): FormMatch {
  kickoffSeq += 1;
  return {
    id,
    kickoff_at: `2026-06-${String(10 + kickoffSeq).padStart(2, '0')}T18:00:00Z`,
    status,
    stage,
    home_team_id: team,
    away_team_id: OPP,
  };
}

function ev(
  match_id: string,
  footballer_id: string,
  type: EventType,
  is_own_goal = false,
): FormEvent {
  return { match_id, footballer_id, type, is_own_goal };
}

function app(match_id: string, footballer_id: string): FormAppearance {
  return { match_id, footballer_id };
}

function compute(opts: {
  matches: FormMatch[];
  events?: FormEvent[];
  appearances?: FormAppearance[];
  footballers?: { id: string; team_id: string }[];
}) {
  return computePlayerForm({
    footballers: opts.footballers ?? [{ id: 'p1', team_id: TEAM_A }],
    matches: opts.matches,
    events: opts.events ?? [],
    appearances: opts.appearances ?? [],
  });
}

beforeEach(() => {
  kickoffSeq = 0;
});

describe('computePlayerForm', () => {
  it('counts appearances, goals and cards across the team timeline', () => {
    const matches = [match('m1', TEAM_A), match('m2', TEAM_A)];
    const form = compute({
      matches,
      appearances: [app('m1', 'p1'), app('m2', 'p1')],
      events: [ev('m1', 'p1', 'goal'), ev('m2', 'p1', 'penalty'), ev('m2', 'p1', 'yellow')],
    });
    expect(form.get('p1')).toEqual({ apps: 2, goals: 2, yellows: 1, reds: 0, suspended: false });
  });

  it('excludes own goals from goal form', () => {
    const form = compute({
      matches: [match('m1', TEAM_A)],
      events: [ev('m1', 'p1', 'own_goal', true), ev('m1', 'p1', 'goal', true)],
    });
    expect(form.get('p1')!.goals).toBe(0);
  });

  it('omits players whose team has no finished prior match', () => {
    const form = compute({ matches: [match('m1', TEAM_A, 'scheduled')] });
    expect(form.has('p1')).toBe(false);
  });

  it('returns zeroed stats (not absence) for an unused player on a team with history', () => {
    const form = compute({ matches: [match('m1', TEAM_A)] });
    expect(form.get('p1')).toEqual({ apps: 0, goals: 0, yellows: 0, reds: 0, suspended: false });
  });

  it('flags suspension after a red card in the most recent match', () => {
    const form = compute({
      matches: [match('m1', TEAM_A), match('m2', TEAM_A)],
      events: [ev('m2', 'p1', 'red')],
    });
    expect(form.get('p1')!.suspended).toBe(true);
  });

  it('clears suspension once a later match exists (ban served)', () => {
    const form = compute({
      matches: [match('m1', TEAM_A), match('m2', TEAM_A)],
      events: [ev('m1', 'p1', 'red')],
    });
    expect(form.get('p1')!.suspended).toBe(false);
  });

  it('treats an intermediate scheduled match as serving the ban', () => {
    // Red in m1, but the team's m2 (still scheduled) comes before the match being
    // bet on — the ban falls on m2, not on this one.
    const form = compute({
      matches: [match('m1', TEAM_A), match('m2', TEAM_A, 'scheduled')],
      events: [ev('m1', 'p1', 'red')],
    });
    expect(form.get('p1')!.suspended).toBe(false);
  });

  it('flags suspension when the second accumulated yellow lands in the latest match', () => {
    const form = compute({
      matches: [match('m1', TEAM_A), match('m2', TEAM_A)],
      events: [ev('m1', 'p1', 'yellow'), ev('m2', 'p1', 'yellow')],
    });
    expect(form.get('p1')).toEqual({ apps: 0, goals: 0, yellows: 2, reds: 0, suspended: true });
  });

  it('resets yellow accumulation after a ban is triggered', () => {
    // Yellows in m1+m2 → banned for m3 (served). A third yellow in m3 starts a
    // fresh count of one, so no suspension going into the next match.
    const form = compute({
      matches: [match('m1', TEAM_A), match('m2', TEAM_A), match('m3', TEAM_A)],
      events: [ev('m1', 'p1', 'yellow'), ev('m2', 'p1', 'yellow'), ev('m3', 'p1', 'yellow')],
    });
    expect(form.get('p1')).toEqual({ apps: 0, goals: 0, yellows: 3, reds: 0, suspended: false });
  });

  it('wipes accumulated yellows after the quarterfinals (FIFA rule)', () => {
    // One yellow in the QF + one in the SF would be a ban without the wipe.
    const form = compute({
      matches: [match('m1', TEAM_A, 'finished', 'qf'), match('m2', TEAM_A, 'finished', 'sf')],
      events: [ev('m1', 'p1', 'yellow'), ev('m2', 'p1', 'yellow')],
    });
    expect(form.get('p1')!.suspended).toBe(false);
  });

  it('scopes stats to each player’s own team timeline', () => {
    const m1 = match('m1', TEAM_A);
    const m2 = match('m2', TEAM_B);
    const form = compute({
      footballers: [
        { id: 'p1', team_id: TEAM_A },
        { id: 'p2', team_id: TEAM_B },
      ],
      matches: [m1, m2],
      events: [ev('m1', 'p1', 'goal'), ev('m2', 'p2', 'red')],
      appearances: [app('m1', 'p1'), app('m2', 'p2')],
    });
    expect(form.get('p1')).toEqual({ apps: 1, goals: 1, yellows: 0, reds: 0, suspended: false });
    expect(form.get('p2')).toEqual({ apps: 1, goals: 0, yellows: 0, reds: 1, suspended: true });
  });
});
