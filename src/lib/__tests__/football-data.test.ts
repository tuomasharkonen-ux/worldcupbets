import { regulationScore } from '../football-data';

describe('regulationScore', () => {
  it('returns fullTime (certain) for a 90-minute match (no regularTime field)', () => {
    expect(regulationScore({ winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 2, away: 0 } })).toEqual({
      home: 2,
      away: 0,
      certain: true,
    });
  });

  it('returns regularTime — NOT fullTime — for a penalty shootout (certain)', () => {
    // The feed folds ET + the shootout tally into fullTime: a 1-1 decided on
    // penalties 3-4 is reported as fullTime 4-5. Bets settle on the 90' result, 1-1.
    expect(
      regulationScore({
        winner: 'AWAY_TEAM',
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 4, away: 5 },
        regularTime: { home: 1, away: 1 },
      }),
    ).toEqual({ home: 1, away: 1, certain: true });
  });

  it('returns regularTime (certain) for a match decided in extra time', () => {
    expect(
      regulationScore({
        winner: 'HOME_TEAM',
        duration: 'EXTRA_TIME',
        fullTime: { home: 2, away: 1 },
        regularTime: { home: 1, away: 1 },
      }),
    ).toEqual({ home: 1, away: 1, certain: true });
  });

  it('flags uncertain when a past-90 match has no regularTime (our feed) — fullTime still folds in ET', () => {
    // Belgium 2-2 Senegal, 3-2 a.e.t.: the feed reports fullTime 3-2 with NO regularTime,
    // so we cannot recover the 90' score from the summary — the goal timeline settles it.
    expect(
      regulationScore({ winner: 'HOME_TEAM', duration: 'EXTRA_TIME', fullTime: { home: 3, away: 2 } }),
    ).toEqual({ home: 3, away: 2, certain: false });
    // A shootout with no regularTime is uncertain too.
    expect(
      regulationScore({ winner: 'AWAY_TEAM', duration: 'PENALTY_SHOOTOUT', fullTime: { home: 1, away: 1 } }),
    ).toEqual({ home: 1, away: 1, certain: false });
  });

  it('is null-safe (and certain) when score or its fields are missing', () => {
    expect(regulationScore(undefined)).toEqual({ home: null, away: null, certain: true });
    expect(regulationScore({})).toEqual({ home: null, away: null, certain: true });
    expect(regulationScore({ fullTime: { home: null, away: null } })).toEqual({
      home: null,
      away: null,
      certain: true,
    });
  });
});
