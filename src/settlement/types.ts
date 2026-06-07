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
  gloryAwarded: number;
}

export interface SettleResult {
  deltas: CurrencyDelta[];
  betUpdates: BetUpdate[];
}
