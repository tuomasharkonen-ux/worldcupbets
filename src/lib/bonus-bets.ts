// Shared helpers for the optional "bonus bet" slot on a match slip (migration 013).
// One place for: which bet types are bonus bets, which are tied to a footballer, and
// how to label / phrase a bonus pick — so the slip, recap, social feed and share
// digest don't drift apart. Pure (no I/O); callers supply name lookups via ctx.

import type {
  Bet,
  BetType,
  CleanSheetSelection,
  FootballerSelection,
  OverUnderSelection,
} from '@/types/db';

// The bonus markets offered in the slot, in display order (rarest player props first,
// then the score-derived ones). The slip lets a manager pick at most one.
export const BONUS_BET_TYPES = [
  'first_scorer',
  'anytime_scorer',
  'score_2plus',
  'anytime_assist',
  'carded',
  'over_under',
  'clean_sheet',
] as const;
export type BonusBetType = (typeof BONUS_BET_TYPES)[number];

// The subset whose selection is a single footballer ({ footballer_id }).
export const PLAYER_BONUS_TYPES: readonly BonusBetType[] = [
  'first_scorer',
  'anytime_scorer',
  'score_2plus',
  'anytime_assist',
  'carded',
];

const BONUS_SET = new Set<string>(BONUS_BET_TYPES);
const PLAYER_SET = new Set<string>(PLAYER_BONUS_TYPES);

export function isBonusBet(t: string): t is BonusBetType {
  return BONUS_SET.has(t);
}
export function isPlayerBonusBet(t: string): boolean {
  return PLAYER_SET.has(t);
}

// Fixed Over/Under line (decisions: single 2.5 line, never a push).
export const OVER_UNDER_LINE = 2.5;

// Short badge label per bonus type, used in slip rows and the recap.
export const BONUS_LABEL: Record<BonusBetType, string> = {
  first_scorer: 'First scorer',
  anytime_scorer: 'Anytime scorer',
  score_2plus: 'To score 2+',
  anytime_assist: 'Anytime assist',
  carded: 'Booked',
  over_under: 'Total goals',
  clean_sheet: 'Clean sheet',
};

export interface BonusDisplayCtx {
  /** footballer id → display name, for the player-based markets. */
  playerName?: (id: string) => string | undefined;
  homeTeam?: string;
  awayTeam?: string;
}

// The pick detail shown after the label (player name, the O/U side, or the team).
export function bonusDetail(bet: Pick<Bet, 'bet_type' | 'selection'>, ctx: BonusDisplayCtx): string {
  const t = bet.bet_type;
  if (isPlayerBonusBet(t)) {
    const id = (bet.selection as FootballerSelection).footballer_id;
    return ctx.playerName?.(id) ?? 'Unknown';
  }
  if (t === 'over_under') {
    const s = bet.selection as OverUnderSelection;
    return `${s.direction === 'over' ? 'Over' : 'Under'} ${s.line}`;
  }
  if (t === 'clean_sheet') {
    const s = bet.selection as CleanSheetSelection;
    return (s.team === 'home' ? ctx.homeTeam : ctx.awayTeam) ?? 'Unknown';
  }
  return '';
}

// One-line phrasing for the paste-into-chat share digest (sentence-style, distinct
// from the on-screen badge labels).
export function bonusShareText(bet: Pick<Bet, 'bet_type' | 'selection'>, ctx: BonusDisplayCtx): string {
  const t = bet.bet_type;
  const player = () =>
    isPlayerBonusBet(t)
      ? ctx.playerName?.((bet.selection as FootballerSelection).footballer_id) ?? 'Player'
      : '';
  switch (t) {
    case 'first_scorer':
      return `${player()} to score first`;
    case 'anytime_scorer':
      return `${player()} to score`;
    case 'score_2plus':
      return `${player()} to score 2+`;
    case 'anytime_assist':
      return `${player()} to assist`;
    case 'carded':
      return `${player()} booked`;
    case 'over_under': {
      const s = bet.selection as OverUnderSelection;
      return `${s.direction === 'over' ? 'Over' : 'Under'} ${s.line} goals`;
    }
    case 'clean_sheet': {
      const s = bet.selection as CleanSheetSelection;
      const team = s.team === 'home' ? ctx.homeTeam : ctx.awayTeam;
      return `${team ?? 'Team'} clean sheet`;
    }
    default:
      return '';
  }
}

// Collapse a stored bonus bet back into the slot's (type, value) pair — the inverse
// of buildBonusSelection, used to prefill the slip when editing. Null for non-bonus bets.
export function bonusBetToSlotValue(
  bet: Pick<Bet, 'bet_type' | 'selection'>,
): { type: BonusBetType; value: string } | null {
  const t = bet.bet_type;
  if (!isBonusBet(t)) return null;
  if (isPlayerBonusBet(t)) return { type: t, value: (bet.selection as FootballerSelection).footballer_id };
  if (t === 'over_under') return { type: t, value: (bet.selection as OverUnderSelection).direction };
  if (t === 'clean_sheet') return { type: t, value: (bet.selection as CleanSheetSelection).team };
  return null;
}

// Build a bet's `selection` payload from the slot's submitted (type, value). Returns
// null when the value is invalid for the type, so the caller can reject the slip.
export function buildBonusSelection(
  type: BetType,
  value: string,
): Bet['selection'] | null {
  if (isPlayerBonusBet(type)) {
    return value ? { footballer_id: value } : null;
  }
  if (type === 'over_under') {
    if (value !== 'over' && value !== 'under') return null;
    return { line: OVER_UNDER_LINE, direction: value };
  }
  if (type === 'clean_sheet') {
    if (value !== 'home' && value !== 'away') return null;
    return { team: value };
  }
  return null;
}
