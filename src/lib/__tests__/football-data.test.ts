import { regulationScore } from '../football-data';

describe('regulationScore', () => {
  it('returns fullTime for a 90-minute match (no regularTime field)', () => {
    expect(regulationScore({ winner: 'HOME_TEAM', duration: 'REGULAR', fullTime: { home: 2, away: 0 } })).toEqual({
      home: 2,
      away: 0,
    });
  });

  it('returns regularTime — NOT fullTime — for a penalty shootout', () => {
    // football-data folds ET + the shootout tally into fullTime: a 1-1 decided on
    // penalties 3-4 is reported as fullTime 4-5. Bets settle on the 90' result, 1-1.
    expect(
      regulationScore({
        winner: 'AWAY_TEAM',
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 4, away: 5 },
        regularTime: { home: 1, away: 1 },
      }),
    ).toEqual({ home: 1, away: 1 });
  });

  it('returns regularTime for a match decided in extra time', () => {
    expect(
      regulationScore({
        winner: 'HOME_TEAM',
        duration: 'EXTRA_TIME',
        fullTime: { home: 2, away: 1 },
        regularTime: { home: 1, away: 1 },
      }),
    ).toEqual({ home: 1, away: 1 });
  });

  it('is null-safe when score or its fields are missing', () => {
    expect(regulationScore(undefined)).toEqual({ home: null, away: null });
    expect(regulationScore({})).toEqual({ home: null, away: null });
    expect(regulationScore({ fullTime: { home: null, away: null } })).toEqual({ home: null, away: null });
  });
});
