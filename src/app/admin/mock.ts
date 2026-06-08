// Mock data for the hidden admin preview gallery (/admin).
//
// Everything here is fabricated — no DB, no session — so every view renders
// instantly and deterministically. The shapes mirror the real types in
// @/types/db so the previews feed the *actual* components (Recap, BetSlip, …).

import type { Bet, BetStatus, Match, Team } from '@/types/db';
import type { RecapData } from '@/app/today/Recap';
import type { SlipSquads, SlipPlayer } from '@/app/matches/[matchId]/BetSlip';
import type { StakeTier } from '@/app/matches/[matchId]/StakeSelector';

export type MatchRow = Match & { home_team: Team; away_team: Team };

// ─── primitives ──────────────────────────────────────────────────────────────

function team(id: string, name: string, code: string): Team {
  return { id, name, country_code: code, flag_url: null, fd_team_id: null, sofa_team_id: null };
}

export const TEAMS = {
  brazil: team('t-bra', 'Brazil', 'BRA'),
  argentina: team('t-arg', 'Argentina', 'ARG'),
  france: team('t-fra', 'France', 'FRA'),
  spain: team('t-esp', 'Spain', 'ESP'),
  germany: team('t-ger', 'Germany', 'GER'),
  england: team('t-eng', 'England', 'ENG'),
  netherlands: team('t-ned', 'Netherlands', 'NED'),
  portugal: team('t-por', 'Portugal', 'POR'),
  croatia: team('t-cro', 'Croatia', 'CRO'),
  japan: team('t-jpn', 'Japan', 'JPN'),
  morocco: team('t-mar', 'Morocco', 'MAR'),
  usa: team('t-usa', 'United States', 'USA'),
};

// Stake config mirrors migration 004 (tiers + cap), with a sample balance.
export const MOCK_STAKE: { tiers: StakeTier[]; capCoins: number; balance: number } = {
  tiers: [
    { coins: 0, mult: 1.0 },
    { coins: 10, mult: 1.25 },
    { coins: 25, mult: 1.5 },
    { coins: 50, mult: 2.0 },
  ],
  capCoins: 50,
  balance: 120,
};

// Scoring config for the bet slip's live max-winnings counter (GAME_DESIGN §3/§5).
export const MOCK_SCORING = {
  stageMult: 1.0,
  maxTotalMult: 3.0,
  outcome: 10,
  exactBonus: 15,
  goalDiff: 5,
  props: { first_scorer: 20, anytime_scorer: 8, carded: 6 },
};

let _betSeq = 0;
function bet(partial: Partial<Bet> & Pick<Bet, 'match_id' | 'bet_type' | 'selection'>): Bet {
  _betSeq += 1;
  return {
    id: `bet-${_betSeq}`,
    manager_id: 'me',
    stake_coins: 0,
    stake_mult: 1,
    status: 'pending' as BetStatus,
    glory_awarded: null,
    created_at: '2026-06-15T12:00:00Z',
    locked_at: null,
    ...partial,
  };
}

function match(
  id: string,
  home: Team,
  away: Team,
  kickoff: string,
  extra: Partial<Match> = {},
): MatchRow {
  return {
    id,
    fd_match_id: 0,
    sofa_match_id: null,
    stage: 'group',
    group_label: 'A',
    home_team_id: home.id,
    away_team_id: away.id,
    kickoff_at: kickoff,
    status: 'scheduled',
    home_score: null,
    away_score: null,
    glory_multiplier: 1,
    settled_at: null,
    ...extra,
    home_team: home,
    away_team: away,
  };
}

// ─── Today scenarios ───────────────────────────────────────────────────────────
//
// The real Today page derives a `state` then renders match cards from `members`
// + `betsByMatch`. We hand the preview the same inputs plus a fixed `now`, so the
// rendering is faithful without any time-of-day flakiness.

export type TodayVariant = 'betting' | 'allset' | 'settling' | 'recap' | 'restday';

export interface TodayScenario {
  state: 'betting' | 'allset' | 'settling';
  slateKey: string;
  now: Date;
  members: MatchRow[];
  betsByMatch: Map<string, Bet[]>;
  settledCount: number;
}

const SLATE_KEY = '2026-06-15';

// An evening slate: three group games.
function slateMatches(): MatchRow[] {
  return [
    match('m-1', TEAMS.brazil, TEAMS.croatia, '2026-06-15T16:00:00Z', { group_label: 'C' }),
    match('m-2', TEAMS.france, TEAMS.netherlands, '2026-06-15T19:00:00Z', { group_label: 'D' }),
    match('m-3', TEAMS.spain, TEAMS.japan, '2026-06-15T21:00:00Z', { group_label: 'E' }),
  ];
}

// `recap` and `restday` are handled directly in the preview (recap renders the
// real <Recap> on MOCK_RECAP; restday is the empty state), so they never reach here.
export function todayScenario(variant: Exclude<TodayVariant, 'restday' | 'recap'>): TodayScenario {
  const members = slateMatches();
  const betsByMatch = new Map<string, Bet[]>();

  // One stake per match rides the whole slip: Coins on the outcome bet, the
  // multiplier on every pick (GAME_DESIGN §5).
  if (variant === 'betting') {
    // Only the first match has a complete slip; the other two still need picks.
    betsByMatch.set('m-1', [
      bet({ match_id: 'm-1', bet_type: 'outcome', selection: { result: 'home' }, stake_coins: 25, stake_mult: 1.5 }),
      bet({ match_id: 'm-1', bet_type: 'exact_score', selection: { home: 2, away: 0 }, stake_coins: 0, stake_mult: 1.5 }),
    ]);
    return { state: 'betting', slateKey: SLATE_KEY, now: new Date('2026-06-15T12:00:00Z'), members, betsByMatch, settledCount: 0 };
  }

  if (variant === 'allset') {
    for (const m of members) {
      betsByMatch.set(m.id, [
        bet({ match_id: m.id, bet_type: 'outcome', selection: { result: 'home' }, stake_coins: 25, stake_mult: 1.5 }),
        bet({ match_id: m.id, bet_type: 'exact_score', selection: { home: 2, away: 1 }, stake_coins: 0, stake_mult: 1.5 }),
        ...(m.id === 'm-2'
          ? [bet({ match_id: m.id, bet_type: 'first_scorer', selection: { footballer_id: 'p-x' }, stake_coins: 0, stake_mult: 1.5 })]
          : []),
      ]);
    }
    return { state: 'allset', slateKey: SLATE_KEY, now: new Date('2026-06-15T12:00:00Z'), members, betsByMatch, settledCount: 0 };
  }

  // settling — first two finished + settled, last still live/pending.
  const settling = members.map((m, i) =>
    i < 2
      ? { ...m, status: 'finished' as const, home_score: 2, away_score: 1, settled_at: '2026-06-16T07:00:00Z' }
      : { ...m, status: 'live' as const },
  );
  for (const m of settling) {
    betsByMatch.set(m.id, [
      bet({ match_id: m.id, bet_type: 'outcome', selection: { result: 'home' }, stake_coins: 25, stake_mult: 1.5 }),
      bet({ match_id: m.id, bet_type: 'exact_score', selection: { home: 2, away: 1 }, stake_coins: 0, stake_mult: 1.5 }),
    ]);
  }
  return {
    state: 'settling',
    slateKey: SLATE_KEY,
    now: new Date('2026-06-16T06:30:00Z'),
    members: settling,
    betsByMatch,
    settledCount: 2,
  };
}

// ─── Morning recap ─────────────────────────────────────────────────────────────

export const MOCK_RECAP: RecapData = {
  slateLabel: 'Mon 15 Jun',
  matches: [
    {
      id: 'm-1',
      home: 'Brazil',
      away: 'Croatia',
      homeCode: 'BRA',
      awayCode: 'CRO',
      homeScore: 2,
      awayScore: 0,
      staked: 25,
      stakeMult: 1.5,
      picks: [
        { label: 'Outcome', detail: 'Brazil', result: 'won' },
        { label: 'Score', detail: '2–0', result: 'won' },
        { label: 'First scorer', detail: 'Vinícius Jr.', result: 'lost' },
      ],
    },
    {
      id: 'm-2',
      home: 'France',
      away: 'Netherlands',
      homeCode: 'FRA',
      awayCode: 'NED',
      homeScore: 1,
      awayScore: 1,
      staked: 25,
      stakeMult: 1.5,
      picks: [
        { label: 'Outcome', detail: 'France', result: 'lost' },
        { label: 'Score', detail: '2–1', result: 'lost' },
        { label: 'First scorer', detail: 'K. Mbappé', result: 'lost' },
      ],
    },
    {
      id: 'm-3',
      home: 'Spain',
      away: 'Japan',
      homeCode: 'ESP',
      awayCode: 'JPN',
      homeScore: 3,
      awayScore: 1,
      staked: 10,
      stakeMult: 1.25,
      picks: [
        { label: 'Outcome', detail: 'Spain', result: 'won' },
        { label: 'Anytime scorer', detail: 'A. Morata', result: 'won' },
      ],
    },
  ],
  pointsGained: 86,
  coinItems: [
    { label: 'Participation', amount: 15 },
    { label: 'Bet winnings', amount: 92 },
    { label: 'Coins staked', amount: -60 },
  ],
  coinsGained: 47,
  standings: [
    { id: 'me', name: 'You', before: 214, after: 300, rankBefore: 3, rankAfter: 1, isYou: true },
    { id: 'a', name: 'Semi', before: 290, after: 295, rankBefore: 1, rankAfter: 2, isYou: false },
    { id: 'b', name: 'Janne', before: 255, after: 268, rankBefore: 2, rankAfter: 3, isYou: false },
    { id: 'c', name: 'Pekka', before: 180, after: 192, rankBefore: 4, rankAfter: 4, isYou: false },
    { id: 'd', name: 'Aino', before: 120, after: 120, rankBefore: 5, rankAfter: 5, isYou: false },
  ],
  balance: 192,
};

// ─── Bet slip (match detail) ─────────────────────────────────────────────────

function player(id: string, name: string, num: number, position: string): SlipPlayer {
  return { id, name, squad_number: num, position };
}

export const MOCK_SQUADS: SlipSquads = {
  homeTeam: 'Brazil',
  awayTeam: 'Croatia',
  homePlayers: [
    player('b-1', 'Alisson', 1, 'Goalkeeper'),
    player('b-2', 'Danilo', 2, 'Right-Back'),
    player('b-3', 'Marquinhos', 4, 'Centre-Back'),
    player('b-4', 'Éder Militão', 3, 'Centre-Back'),
    player('b-5', 'Casemiro', 5, 'Defensive Midfield'),
    player('b-6', 'Bruno Guimarães', 8, 'Central Midfield'),
    player('b-7', 'Rodrygo', 10, 'Right Winger'),
    player('b-8', 'Vinícius Jr.', 7, 'Left Winger'),
    player('b-9', 'Raphinha', 11, 'Right Winger'),
    player('b-10', 'Endrick', 9, 'Centre-Forward'),
  ],
  awayPlayers: [
    player('c-1', 'Dominik Livaković', 1, 'Goalkeeper'),
    player('c-2', 'Joško Gvardiol', 20, 'Centre-Back'),
    player('c-3', 'Josip Stanišić', 2, 'Right-Back'),
    player('c-4', 'Mateo Kovačić', 8, 'Central Midfield'),
    player('c-5', 'Luka Modrić', 10, 'Central Midfield'),
    player('c-6', 'Marcelo Brozović', 11, 'Defensive Midfield'),
    player('c-7', 'Ivan Perišić', 4, 'Left Winger'),
    player('c-8', 'Andrej Kramarić', 9, 'Centre-Forward'),
    player('c-9', 'Bruno Petković', 16, 'Centre-Forward'),
  ],
};

// ─── Full schedule (fixtures) ──────────────────────────────────────────────────

export interface FixturesData {
  upcoming: MatchRow[];
  results: MatchRow[];
  betsPerMatch: Map<string, Set<string>>;
  now: Date;
}

export function fixturesData(): FixturesData {
  const upcoming = [
    match('f-1', TEAMS.brazil, TEAMS.croatia, '2026-06-15T16:00:00Z', { group_label: 'C' }),
    match('f-2', TEAMS.france, TEAMS.netherlands, '2026-06-15T19:00:00Z', { group_label: 'D' }),
    match('f-3', TEAMS.spain, TEAMS.japan, '2026-06-16T16:00:00Z', { group_label: 'E' }),
    match('f-4', TEAMS.england, TEAMS.usa, '2026-06-16T19:00:00Z', { group_label: 'F' }),
    match('f-5', TEAMS.portugal, TEAMS.morocco, '2026-06-17T19:00:00Z', { group_label: 'G' }),
    match('f-6', TEAMS.argentina, TEAMS.germany, '2026-06-18T19:00:00Z', { stage: 'r16', group_label: null }),
  ];
  const results = [
    match('r-1', TEAMS.germany, TEAMS.japan, '2026-06-14T19:00:00Z', {
      group_label: 'E', status: 'finished', home_score: 1, away_score: 2, settled_at: '2026-06-15T07:00:00Z',
    }),
    match('r-2', TEAMS.argentina, TEAMS.morocco, '2026-06-14T16:00:00Z', {
      group_label: 'B', status: 'finished', home_score: 3, away_score: 1, settled_at: '2026-06-15T07:00:00Z',
    }),
    match('r-3', TEAMS.england, TEAMS.usa, '2026-06-13T19:00:00Z', {
      group_label: 'F', status: 'finished', home_score: 0, away_score: 0, settled_at: '2026-06-14T07:00:00Z',
    }),
  ];
  const betsPerMatch = new Map<string, Set<string>>([
    ['f-1', new Set(['outcome', 'exact_score', 'first_scorer'])],
    ['f-2', new Set(['outcome', 'exact_score'])],
    ['r-1', new Set(['outcome', 'exact_score'])],
  ]);
  return { upcoming, results, betsPerMatch, now: new Date('2026-06-15T12:00:00Z') };
}

// ─── Leaderboard ───────────────────────────────────────────────────────────────

export const MOCK_LEADERBOARD: { id: string; display_name: string; glory: number; coins: number }[] = [
  { id: 'a', display_name: 'Semi', glory: 295, coins: 410 },
  { id: 'b', display_name: 'Janne', glory: 268, coins: 150 },
  { id: 'me', display_name: 'You', glory: 300, coins: 192 },
  { id: 'c', display_name: 'Pekka', glory: 192, coins: 88 },
  { id: 'd', display_name: 'Aino', glory: 120, coins: 305 },
]
  .sort((x, y) => y.glory - x.glory);

export const MOCK_ME_ID = 'me';

// ─── Match detail (finished, read-only) ─────────────────────────────────────────

export interface FinishedMatchData {
  match: MatchRow;
  bets: Pick<Bet, 'bet_type' | 'selection' | 'status' | 'stake_coins'>[];
  playerName: Map<string, string>;
}

export function finishedMatchData(): FinishedMatchData {
  return {
    match: match('m-1', TEAMS.brazil, TEAMS.croatia, '2026-06-15T16:00:00Z', {
      group_label: 'C', status: 'finished', home_score: 2, away_score: 0, settled_at: '2026-06-16T07:00:00Z',
    }),
    bets: [
      { bet_type: 'outcome', selection: { result: 'home' }, status: 'won', stake_coins: 25 },
      { bet_type: 'exact_score', selection: { home: 2, away: 0 }, status: 'won', stake_coins: 10 },
      { bet_type: 'first_scorer', selection: { footballer_id: 'b-8' }, status: 'lost', stake_coins: 10 },
    ],
    playerName: new Map([['b-8', 'Vinícius Jr.']]),
  };
}
