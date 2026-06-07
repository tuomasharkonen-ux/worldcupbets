// Hand-written types that mirror DATA_MODEL.md.
// Source of truth: the SQL migration. Update here when the schema changes.

export type Phase = 'group' | 'knockout' | 'finished';
export type MatchStage = 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final';
export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'void';
export type BetType = 'outcome' | 'exact_score' | 'first_scorer' | 'anytime_scorer' | 'carded' | 'stat_leader';
export type BetStatus = 'pending' | 'won' | 'lost' | 'void';
export type Currency = 'glory' | 'coins';
export type ItemKind = 'powerup' | 'upgrade' | 'sabotage' | 'counter';
export type ItemStatus = 'owned' | 'active' | 'consumed' | 'blocked';
export type EventType = 'goal' | 'own_goal' | 'yellow' | 'red' | 'penalty';

export interface League {
  id: 1;
  passcode: string;
  season: string;
  phase: Phase;
  config: LeagueConfig;
}

export interface LeagueConfig {
  glory: {
    outcome_correct: number;
    exact_score_bonus: number;
    // Goal-difference bonus (right outcome + right margin, not exact). Added in
    // migration 003; optional so older configs still type-check (engine falls back to 0).
    goal_difference?: number;
    // Player props (Phase 2). Optional so v1 configs still type-check; the
    // settlement engine falls back to 0 when a value is absent.
    first_goalscorer?: number;
    anytime_scorer?: number;
    carded?: number;
    stat_leader?: number;
  };
  // Per-bet Coin income (GAME_DESIGN §4). Slate-scoped rewards (participation,
  // clean_slate, streak, interest) join this object in a later Phase 3 slice.
  coins: {
    starting_balance: number;
    outcome: number;
    goal_difference: number;
    exact: number;
    prop: number;
  };
  stake: {
    // Coin cost → Glory multiplier per stake tier (GAME_DESIGN §5). Tier 0 is the
    // "no stake" option ({ coins: 0, mult: 1.0 }).
    tiers: { coins: number; mult: number }[];
    // Per-bet stake ceiling in Coins (raisable via the Bigger Wallet upgrade).
    cap_coins: number;
    // Hard cap on the combined stage × stake multiplier the engine applies (×3.0).
    max_total_multiplier: number;
  };
  glory_multipliers: Record<MatchStage, number>;
}

export interface Manager {
  id: string;
  display_name: string;
  avatar_url: string | null;
  glory: number;
  coins: number;
  joined_at: string;
}

export interface Team {
  id: string;
  name: string;
  country_code: string;
  flag_url: string | null;
  fd_team_id: number | null;
  sofa_team_id: number | null;
}

export interface Footballer {
  id: string;
  team_id: string;
  name: string;
  position: string | null;
  squad_number: number | null;
  photo_url: string | null;
  fd_player_id: number | null;
  sofa_player_id: number | null;
}

export interface Match {
  id: string;
  fd_match_id: number;
  sofa_match_id: number | null;
  stage: MatchStage;
  group_label: string | null;
  home_team_id: string;
  away_team_id: string;
  kickoff_at: string; // ISO UTC
  status: MatchStatus;
  home_score: number | null;
  away_score: number | null;
  glory_multiplier: number;
  settled_at: string | null;
}

export interface MatchEvent {
  id: string;
  match_id: string;
  footballer_id: string | null;
  type: EventType;
  minute: number | null;
  is_own_goal: boolean;
}

export interface MatchAppearance {
  id: string;
  match_id: string;
  footballer_id: string;
}

export interface PlayerMatchStats {
  id: string;
  match_id: string;
  footballer_id: string;
  touches: number | null;
  passes: number | null;
  shots: number | null;
  rating: number | null;
}

// Selection shapes per bet_type
export type OutcomeSelection = { result: 'home' | 'draw' | 'away' };
export type ExactScoreSelection = { home: number; away: number };
export type FootballerSelection = { footballer_id: string };
export type StatLeaderSelection = { footballer_id: string; stat: 'passes' | 'shots' | 'touches' };

export type BetSelection =
  | OutcomeSelection
  | ExactScoreSelection
  | FootballerSelection
  | StatLeaderSelection;

export interface Bet {
  id: string;
  manager_id: string;
  match_id: string;
  bet_type: BetType;
  selection: BetSelection;
  stake_coins: number;
  stake_mult: number;
  status: BetStatus;
  glory_awarded: number | null;
  created_at: string;
  locked_at: string | null;
}

export interface LedgerEntry {
  id: string;
  manager_id: string;
  currency: Currency;
  amount: number;
  reason: string;
  ref_type: string;
  ref_id: string;
  created_at: string;
}

export interface ShopItem {
  id: string;
  code: string;
  name: string;
  kind: ItemKind;
  cost_coins: number;
  config: Record<string, unknown>;
}

export interface ManagerItem {
  id: string;
  manager_id: string;
  item_id: string;
  target_manager_id: string | null;
  scope_match_id: string | null;
  scope_matchday: string | null;
  status: ItemStatus;
  purchased_at: string;
  consumed_at: string | null;
}
