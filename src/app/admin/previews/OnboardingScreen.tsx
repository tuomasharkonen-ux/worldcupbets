'use client';

import { OnboardingPicker, type PickerTeam, type PickerPlayer } from '@/app/onboarding/OnboardingPicker';
import { ladderBreakdown } from '@/settlement/favorites';
import type { FavoritesConfig } from '@/types/db';

// Mirrors config.favorites from migration 009 so the preview ladders match production.
const FAV: FavoritesConfig = {
  base_odds: 5.5,
  min_mult: 1.0,
  max_mult: 5.0,
  ladder: { r32: 10, r16: 20, qf: 35, sf: 55, third: 40, final: 75, champion: 90 },
  player_goal: 15,
  player_card: -5,
};

// The full 48-team field with championship odds, mirroring the seeded `teams` table so
// the gallery preview matches what the real onboarding page pulls from the DB. Already
// ordered by odds (favorites first), as the live query returns them.
const ALL_TEAMS: [name: string, code: string, odds: number][] = [
  ['Spain', 'ESP', 5.5], ['France', 'FRA', 6], ['England', 'ENG', 7], ['Argentina', 'ARG', 8],
  ['Brazil', 'BRA', 8.5], ['Germany', 'GER', 11], ['Portugal', 'POR', 13], ['Netherlands', 'NED', 17],
  ['Belgium', 'BEL', 26], ['Uruguay', 'URY', 34], ['United States', 'USA', 34], ['Norway', 'NOR', 41],
  ['Colombia', 'COL', 41], ['Croatia', 'CRO', 51], ['Morocco', 'MAR', 51], ['Japan', 'JPN', 67],
  ['Mexico', 'MEX', 67], ['Senegal', 'SEN', 67], ['Austria', 'AUT', 81], ['Switzerland', 'SUI', 81],
  ['Turkey', 'TUR', 81], ['Ecuador', 'ECU', 101], ['South Korea', 'KOR', 101], ['Egypt', 'EGY', 151],
  ['Sweden', 'SWE', 151], ['Canada', 'CAN', 151], ['Czechia', 'CZE', 201], ['Scotland', 'SCO', 201],
  ['Ivory Coast', 'CIV', 251], ['Paraguay', 'PAR', 251], ['Algeria', 'ALG', 251], ['Bosnia-Herzegovina', 'BIH', 301],
  ['Tunisia', 'TUN', 301], ['Ghana', 'GHA', 301], ['South Africa', 'RSA', 301], ['Iran', 'IRN', 301],
  ['Congo DR', 'COD', 501], ['Qatar', 'QAT', 501], ['Saudi Arabia', 'KSA', 501], ['Australia', 'AUS', 501],
  ['Panama', 'PAN', 751], ['Uzbekistan', 'UZB', 751], ['Iraq', 'IRQ', 751], ['Jordan', 'JOR', 751],
  ['New Zealand', 'NZL', 1001], ['Haiti', 'HAI', 1001], ['Curaçao', 'CUW', 1001], ['Cape Verde Islands', 'CPV', 1001],
];

const TEAM_LIST: PickerTeam[] = ALL_TEAMS.map(([name, code, odds]) => ({
  id: `t-${code.toLowerCase()}`,
  name,
  countryCode: code,
  breakdown: ladderBreakdown(odds, FAV),
}));

// A few stand-in players per team so the second step is explorable in the gallery.
const POSITIONS = ['Goalkeeper', 'Centre-Back', 'Midfield', 'Winger', 'Centre-Forward'];
const PLAYERS: PickerPlayer[] = TEAM_LIST.flatMap(t =>
  POSITIONS.map((position, i) => ({
    id: `${t.id}-p${i + 1}`,
    teamId: t.id,
    name: `${t.name} Player ${i + 1}`,
    position,
    number: i + 1,
  })),
);

export function OnboardingScreen() {
  return (
    <main className="flex min-h-full justify-center px-4 py-10">
      <OnboardingPicker teams={TEAM_LIST} players={PLAYERS} />
    </main>
  );
}
