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
    return { error: `Only ${MAX_PROP_SLOTS} player prop allowed for now.` };
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

  // ─── Staking (GAME_DESIGN §5) ─────────────────────────────────────────────
  // Each bet may carry a Coin stake that amplifies its Glory on a hit and is
  // forfeited on a miss. Tiers (cost → multiplier) and the per-bet cap live in
  // league.config. We validate every stake against the config and the manager's
  // current balance before writing — settlement trusts stake_coins/stake_mult.
  const { data: league } = await db
    .from('league')
    .select('config')
    .eq('id', 1)
    .single<Pick<League, 'config'>>();
  const tiers = league?.config.stake.tiers ?? [{ coins: 0, mult: 1.0 }];
  const capCoins = league?.config.stake.cap_coins ?? 0;

  // Map a submitted Coin amount to a valid tier; returns null for anything that
  // isn't an exact tier value or exceeds the cap.
  const resolveStake = (raw: string | null): { coins: number; mult: number } | null => {
    const coins = parseInt((raw ?? '0').trim() || '0', 10);
    if (isNaN(coins) || coins < 0 || coins > capCoins) return null;
    return tiers.find(t => t.coins === coins) ?? null;
  };

  // Read a stake per bet. Props only carry a stake when the prop is actually set.
  const stakeInputs: { betType: BetType; raw: string | null }[] = [
    { betType: 'outcome', raw: formData.get('stake_outcome') as string | null },
    { betType: 'exact_score', raw: formData.get('stake_exact') as string | null },
  ];
  if (chosenProps.length > 0) {
    stakeInputs.push({ betType: chosenProps[0].betType, raw: formData.get('stake_prop') as string | null });
  }

  const stakeByType = new Map<BetType, { coins: number; mult: number }>();
  let totalStaked = 0;
  for (const { betType, raw } of stakeInputs) {
    const tier = resolveStake(raw);
    if (!tier) return { error: 'Invalid stake amount.' };
    stakeByType.set(betType, tier);
    totalStaked += tier.coins;
  }

  // Total committed stake must fit the manager's current Coin balance.
  if (totalStaked > 0) {
    const { data: me } = await db
      .from('managers')
      .select('coins')
      .eq('id', managerId)
      .single<{ coins: number }>();
    const balance = me?.coins ?? 0;
    if (totalStaked > balance) {
      return { error: `Not enough Coins to stake ${totalStaked}¢ (you have ${balance}¢).` };
    }
  }

  const stakeFor = (betType: BetType) => {
    const tier = stakeByType.get(betType) ?? { coins: 0, mult: 1.0 };
    return { stake_coins: tier.coins, stake_mult: tier.mult };
  };

  // Replace any existing pending bets for this manager + match
  await db
    .from('bets')
    .delete()
    .eq('manager_id', managerId)
    .eq('match_id', matchId)
    .eq('status', 'pending');

  const base = { manager_id: managerId, match_id: matchId, locked_at: match.kickoff_at };
  const newBets: Array<Record<string, unknown>> = [
    { ...base, bet_type: 'outcome', selection: { result: outcomeResult }, ...stakeFor('outcome') },
    { ...base, bet_type: 'exact_score', selection: { home: homeScore, away: awayScore }, ...stakeFor('exact_score') },
  ];

  for (const p of chosenProps) {
    newBets.push({ ...base, bet_type: p.betType, selection: { footballer_id: p.footballerId }, ...stakeFor(p.betType) });
  }

  const { error } = await db.from('bets').insert(newBets);
  if (error) return { error: 'Could not save bets. Try again.' };

  return { success: true };
}
