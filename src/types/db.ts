// Hand-written types that mirror DATA_MODEL.md.
// Source of truth: the SQL migration. Update here when the schema changes.

export type Phase = 'group' | 'knockout' | 'finished';
export type MatchStage = 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final';
export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'void';
export type BetType = 'outcome' | 'exact_score' | 'first_scorer' | 'anytime_scorer' | 'carded';
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
    // Player props (Phase 2). Optional so v1 configs still type-check; the
    // settlement engine falls back to 0 when a value is absent.
    first_goalscorer?: number;
    anytime_scorer?: number;
    carded?: number;
  };
  // Coin income (GAME_DESIGN §4): per-bet keys (migration 003) + slate-scoped
  // day-close keys (migration 005).
  coins: {
    starting_balance: number;
    // per bet
    outcome: number;
    exact: number;
    prop: number;
    // per slate, granted at day-close (slice 3)
    participation?: number;
    clean_slate?: number;
    // Linear streak reward: this many Coins per consecutive qualifying day, read by
    // the slice-4 Hot Hand payout (e.g. 1 → +1¢ on a 1-day streak, +2¢ on day 2…).
    streak_bonus_per_day?: number;
  };
  // Daily-loop config (migration 005). Optional so pre-005 configs still type-check;
  // callers fall back to the 09:00 default.
  daily?: {
    rollover_hour_local: number;
  };
  stake: {
    // Coin cost → Glory multiplier per stake tier (GAME_DESIGN §5). Tier 0 is the
    // "no stake" option ({ coins: 0, mult: 1.0 }).
    tiers: { coins: number; mult: number }[];
    // Per-bet stake ceiling in Coins (raisable via the Bigger Wallet upgrade).
    cap_coins: number;
  };
  glory_multipliers: Record<MatchStage, number>;
  // Max players allowed to join the league (migration 006; was a hardcoded 5).
  // Optional so pre-006 configs still type-check; callers fall back to a default.
  max_managers?: number;
  // Favorite team + player scoring (migration 009). Optional so pre-009 configs
  // still type-check; the favorites settlement no-ops when absent.
  favorites?: FavoritesConfig;
}

// Tuning for the favorite-team advancement ladder and favorite-player rewards
// (migration 009). See src/settlement/favorites.ts for how these are applied.
export interface FavoritesConfig {
  // The top favorite's decimal odds → multiplier 1.0. Longer odds scale up from here.
  base_odds: number;
  // Clamp on the derived underdog multiplier.
  min_mult: number;
  max_mult: number;
  // Base Points per advancement milestone (before the team's odds multiplier). Each
  // is awarded once: reach-stage rungs on qualifying, champion/third on winning the
  // final / third-place playoff.
  ladder: {
    r32: number;
    r16: number;
    qf: number;
    sf: number;
    third: number;
    final: number;
    champion: number;
  };
  // Flat (un-multiplied) favorite-player rewards: per goal scored, and a one-off
  // per-match penalty when booked (negative).
  player_goal: number;
  player_card: number;
}

export interface Manager {
  id: string;
  display_name: string;
  avatar_url: string | null;
  glory: number;
  coins: number;
  joined_at: string;
  state: ManagerState;
  // Per-player PIN hash (migration 006), stored as salt:hash via src/lib/pin.ts.
  // Null for players who joined before PINs existed — back-filled on next login.
  pin_hash: string | null;
  // Brute-force lockout (migration 007): consecutive wrong-PIN count and a cooldown
  // timestamp. Reset on a successful login. See src/app/join/actions.ts.
  failed_pin_attempts: number;
  pin_locked_until: string | null;
  // First-login picks (migration 009), locked for the whole tournament. Null until
  // onboarding is completed; onboarding_completed_at both gates the flow and locks
  // the picks (the server action refuses to overwrite a set timestamp).
  favorite_team_id: string | null;
  favorite_footballer_id: string | null;
  onboarding_completed_at: string | null;
}

// Per-manager scratch state (migration 005), updated at day-close. All fields
// optional: a fresh manager has `{}`. See DATA_MODEL.md.
export interface ManagerState {
  // Consecutive slates with every outcome correct (drives the Hot Hand payout).
  outcome_streak?: number;
  // Slate key (YYYY-MM-DD) of the last day-close processed — guards the streak
  // counter against re-running settlement.
  last_closed_slate?: string;
}

export interface Team {
  id: string;
  name: string;
  country_code: string;
  flag_url: string | null;
  fd_team_id: number | null;
  sofa_team_id: number | null;
  // Pre-tournament decimal championship odds (migration 009). Drives the favorite-team
  // underdog multiplier. Null until seeded.
  champion_odds: number | null;
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
  // The actual winner (migration 009) — set for finished knockouts, where a penalty
  // shootout can leave the scoreline level. Null for group games and draws.
  winner_team_id: string | null;
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

// Match-day social (migration 010). A comment lives on a slate's feed; it can
// optionally point at another manager's slip — (slip_manager_id, slip_match_id) —
// never at a bets row, because bets are deleted + re-inserted on every edit.
export interface Comment {
  id: string;
  slate_key: string;
  manager_id: string;
  slip_manager_id: string | null;
  slip_match_id: string | null;
  body: string;
  gif_url: string | null;
  created_at: string;
}

// An emoji reaction on exactly one target: a comment, or a slip (manager × match).
export interface Reaction {
  id: string;
  manager_id: string;
  emoji: string;
  comment_id: string | null;
  slip_manager_id: string | null;
  slip_match_id: string | null;
  created_at: string;
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
