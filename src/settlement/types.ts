import {
  Bet,
  LeagueConfig,
  Match,
  MatchEvent,
} from '@/types/db';

export interface SettleInput {
  match: Match;
  bets: Bet[];
  events: MatchEvent[];
  config: LeagueConfig;
  // footballer_ids known to have appeared (starting XI + subs on). Best-effort:
  // when the lineup feed is unavailable this is omitted and prop void logic is
  // skipped (a player with no matching event then settles as `lost`, not void).
  appearances?: string[];
}

export interface CurrencyDelta {
  managerId: string;
  currency: 'glory' | 'coins';
  amount: number;
  reason: string;
  refType: string;
  refId: string;
}

export interface BetUpdate {
  betId: string;
  status: 'won' | 'lost' | 'void';
  pointsAwarded: number;
}

export interface SettleResult {
  deltas: CurrencyDelta[];
  betUpdates: BetUpdate[];
}
