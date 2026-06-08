'use server';

import { db } from '@/lib/supabase';
import { requireManager } from '@/lib/session';
import { redirect } from 'next/navigation';
import type { BetType, League } from '@/types/db';

export type BetSlipState = {
  error?: string;
  success?: boolean;
};

// The three optional player props, in display order. Each maps a form field to a
// bet_type; the field value is a footballer UUID (or '' for none).
const PROP_FIELDS: { field: string; betType: BetType }[] = [
  { field: 'first_scorer', betType: 'first_scorer' },
  { field: 'anytime_scorer', betType: 'anytime_scorer' },
  { field: 'carded', betType: 'carded' },
];

// One prop slot for now (more slots are planned). The engine already supports
// multiple prop bets per match, so raising this is the only change needed here.
const MAX_PROP_SLOTS = 1;

export async function submitBet(
  matchId: string,
  _prev: BetSlipState,
  formData: FormData,
): Promise<BetSlipState> {
  let managerId: string;
  try {
    ({ managerId } = await requireManager());
  } catch {
    redirect('/join');
  }

  // Load match — enforce lock server-side in UTC
  const { data: match } = await db
    .from('matches')
    .select('id, kickoff_at, status, home_team_id, away_team_id')
    .eq('id', matchId)
    .single();

  if (!match) return { error: 'Match not found.' };
  if (match.status !== 'scheduled' || new Date() >= new Date(match.kickoff_at)) {
    return { error: 'This match is locked — bets closed at kickoff.' };
  }

  const outcomeResult = formData.get('outcome') as string | null;
  const homeScoreRaw = formData.get('home_score') as string | null;
  const awayScoreRaw = formData.get('away_score') as string | null;
  const hasExactScore = homeScoreRaw !== null && homeScoreRaw !== '' && awayScoreRaw !== null && awayScoreRaw !== '';

  // Collect chosen props (non-empty selects)
  const chosenProps = PROP_FIELDS
    .map(p => ({ ...p, footballerId: (formData.get(p.field) as string | null)?.trim() || '' }))
    .filter(p => p.footballerId !== '');

  // Core bets are mandatory.
  if (!outcomeResult) {
    return { error: 'Pick a match outcome.' };
  }
  if (!hasExactScore) {
    return { error: 'Enter an exact score.' };
  }
  if (chosenProps.length > MAX_PROP_SLOTS) {
    return { error: `Only ${MAX_PROP_SLOTS} player bet allowed for now.` };
  }

  // Validate exact score values
  const homeScore = parseInt(homeScoreRaw!, 10);
  const awayScore = parseInt(awayScoreRaw!, 10);
  if (
    isNaN(homeScore) || isNaN(awayScore) ||
    homeScore < 0 || awayScore < 0 ||
    homeScore > 20 || awayScore > 20
  ) {
    return { error: 'Exact score values must be between 0 and 20.' };
  }

  // Validate picked footballers belong to one of the two teams in this match
  if (chosenProps.length > 0) {
    const { data: validPlayers } = await db
      .from('footballers')
      .select('id')
      .in('team_id', [match.home_team_id, match.away_team_id]);
    const validIds = new Set((validPlayers ?? []).map(p => p.id as string));
    if (chosenProps.some(p => !validIds.has(p.footballerId))) {
      return { error: 'A selected player is not in this match.' };
    }
  }

  if (!['home', 'draw', 'away'].includes(outcomeResult)) {
    return { error: 'Invalid outcome selection.' };
  }

  // The exact score must agree with the chosen outcome.
  const impliedResult = homeScore > awayScore ? 'home' : homeScore < awayScore ? 'away' : 'draw';
  if (impliedResult !== outcomeResult) {
    return { error: 'Your exact score must match the outcome you picked.' };
  }

  // ─── Staking (GAME_DESIGN §5) ─────────────────────────────────────────────
  // One stake rides the whole match slip, not individual bets. The chosen tier's
  // multiplier amplifies Glory on *every* winning pick; the Coins are spent either
  // way (charged once per match at settlement). Tiers (cost → multiplier) and the
  // per-match cap live in league.config.
  const { data: league } = await db
    .from('league')
    .select('config')
    .eq('id', 1)
    .single<Pick<League, 'config'>>();
  const tiers = league?.config.stake.tiers ?? [{ coins: 0, mult: 1.0 }];
  const capCoins = league?.config.stake.cap_coins ?? 0;

  // Map the submitted Coin amount to a valid tier; null for anything that isn't an
  // exact tier value or exceeds the cap.
  const coins = parseInt((formData.get('stake_match') as string | null ?? '0').trim() || '0', 10);
  if (isNaN(coins) || coins < 0 || coins > capCoins) return { error: 'Invalid stake amount.' };
  const matchStake = tiers.find(t => t.coins === coins);
  if (!matchStake) return { error: 'Invalid stake amount.' };

  // The stake is charged at settlement (not held upfront), so guard against
  // committing more than the current balance across the slate: this match's stake
  // plus everything already staked on *other* pending matches must fit the balance.
  if (matchStake.coins > 0) {
    const { data: me } = await db
      .from('managers')
      .select('coins')
      .eq('id', managerId)
      .single<{ coins: number }>();
    const balance = me?.coins ?? 0;
    const { data: otherPending } = await db
      .from('bets')
      .select('stake_coins')
      .eq('manager_id', managerId)
      .eq('status', 'pending')
      .neq('match_id', matchId);
    const committedElsewhere = (otherPending ?? []).reduce((s, b) => s + ((b.stake_coins as number) ?? 0), 0);
    if (committedElsewhere + matchStake.coins > balance) {
      const extra = committedElsewhere > 0 ? `, ${committedElsewhere}¢ already staked on other matches` : '';
      return { error: `Not enough Coins to stake ${matchStake.coins}¢ (you have ${balance}¢${extra}).` };
    }
  }

  // Replace any existing pending bets for this manager + match
  await db
    .from('bets')
    .delete()
    .eq('manager_id', managerId)
    .eq('match_id', matchId)
    .eq('status', 'pending');

  // Every pick carries the match's stake multiplier (so settlement amplifies each
  // winning pick); the stake's Coin cost is recorded once, on the mandatory outcome
  // bet, which settlement reads to charge the match stake a single time.
  const base = { manager_id: managerId, match_id: matchId, locked_at: match.kickoff_at, stake_mult: matchStake.mult };
  const newBets: Array<Record<string, unknown>> = [
    { ...base, bet_type: 'outcome', selection: { result: outcomeResult }, stake_coins: matchStake.coins },
    { ...base, bet_type: 'exact_score', selection: { home: homeScore, away: awayScore }, stake_coins: 0 },
  ];

  for (const p of chosenProps) {
    newBets.push({ ...base, bet_type: p.betType, selection: { footballer_id: p.footballerId }, stake_coins: 0 });
  }

  const { error } = await db.from('bets').insert(newBets);
  if (error) return { error: 'Could not save bets. Try again.' };

  return { success: true };
}
