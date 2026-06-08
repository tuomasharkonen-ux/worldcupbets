import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { ladderBreakdown } from '@/settlement/favorites';
import type { FavoritesConfig } from '@/types/db';
import { OnboardingPicker, type PickerTeam, type PickerPlayer } from './OnboardingPicker';

// Page size for the paginated footballers fetch below. PostgREST caps any single
// response at this many rows by default, so we page through in lockstep with it.
const PLAYER_PAGE_SIZE = 1000;

// One page of the deterministic, fully-ordered squad list. Ordering by team_id then
// name (squad_number is NULL for everyone today) gives a stable total order so .range()
// pagination never skips or double-counts a row.
function fetchPlayerPage(from: number) {
  return db
    .from('footballers')
    .select('id, team_id, name, position, squad_number')
    .order('team_id', { ascending: true })
    .order('squad_number', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })
    .range(from, from + PLAYER_PAGE_SIZE - 1)
    .then(r => r.data);
}

// First-login onboarding (migration 009): lock in a favorite team (your title bet,
// scored on an odds-weighted advancement ladder) and a favorite player (Points per
// goal, a small penalty if booked). Both are fixed for the whole tournament.
//
// Auth-only gate here — NOT gateManager() — or we'd loop, since gateManager() sends
// un-onboarded managers straight back to this page.
export default async function OnboardingPage() {
  const session = await getSession();
  if (!session.managerId) redirect('/join');

  const { data: manager } = await db
    .from('managers')
    .select('onboarding_completed_at')
    .eq('id', session.managerId)
    .maybeSingle();
  if (!manager) redirect('/join');
  // Already locked in — picks are immutable, so there's nothing to do here.
  if (manager.onboarding_completed_at) redirect('/today');

  const { data: league } = await db.from('league').select('config').eq('id', 1).single();
  const fav = (league?.config as { favorites?: FavoritesConfig } | undefined)?.favorites;

  const { data: teamRows } = await db
    .from('teams')
    .select('id, name, country_code, champion_odds')
    .order('champion_odds', { ascending: true, nullsFirst: false });

  // Pre-compute each team's full bonus ladder server-side so the picker can show — and
  // live-update — the exact Points each milestone is worth, using the same helper the
  // settlement engine uses. Favorites being a precise mirror of what's actually paid.
  const teams: PickerTeam[] = (teamRows ?? []).map(t => ({
    id: t.id as string,
    name: t.name as string,
    countryCode: t.country_code as string,
    breakdown: fav ? ladderBreakdown(t.champion_odds as number | null, fav) : null,
  }));

  // The full squad list (small per-player payload) so player selection is instant once
  // a team is chosen — no extra round-trip mid-flow. There are ~1250 footballers across
  // 48 squads, which is over PostgREST's default 1000-row response cap, so we MUST
  // paginate — a single un-ranged select silently truncates and leaves whole teams
  // (whichever sort last) with zero players in the picker. Order by team first so
  // pagination is deterministic; squad_number is currently NULL for every player (the
  // competition-teams API doesn't return shirt numbers), hence the name tiebreaker.
  const playerRows: NonNullable<Awaited<ReturnType<typeof fetchPlayerPage>>> = [];
  for (let from = 0; ; from += PLAYER_PAGE_SIZE) {
    const page = await fetchPlayerPage(from);
    if (!page || page.length === 0) break;
    playerRows.push(...page);
    if (page.length < PLAYER_PAGE_SIZE) break;
  }
  const players: PickerPlayer[] = playerRows.map(p => ({
    id: p.id as string,
    teamId: p.team_id as string,
    name: p.name as string,
    position: (p.position as string | null) ?? null,
    number: (p.squad_number as number | null) ?? null,
  }));

  return <OnboardingPicker teams={teams} players={players} />;
}
