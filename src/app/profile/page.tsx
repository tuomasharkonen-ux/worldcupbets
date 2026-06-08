import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft, Trophy, Coins, UserRound, Lock, LogOut, AlertCircle, CheckCircle2, Star, Shield } from 'lucide-react';
import { getSession, requireOnboarded } from '@/lib/session';
import { signOut } from '@/app/actions';
import { db } from '@/lib/supabase';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Flag } from '@/components/ui/flag';
import { ladderBreakdown } from '@/settlement/favorites';
import type { FavoritesConfig } from '@/types/db';
import { updateProfile, changePin } from './actions';
import { AVATAR_CHOICES } from './avatars';

const ERROR_MESSAGES: Record<string, string> = {
  missing_name: 'Your name can’t be empty.',
  name_too_long: 'Names are limited to 32 characters.',
  name_taken: 'That name is already taken by another player.',
  bad_avatar: 'Pick an avatar from the list.',
  pin_format: 'Your PIN must be 4–6 digits.',
  wrong_current_pin: 'That’s not your current PIN.',
  server_error: 'Something went wrong. Try again.',
};

const SAVED_MESSAGES: Record<string, string> = {
  profile: 'Profile updated.',
  pin: 'PIN updated.',
};

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const session = await getSession();
  if (!session.managerId) redirect('/join');
  await requireOnboarded(session.managerId);

  const { error, saved } = await searchParams;
  const errorMsg = error ? (ERROR_MESSAGES[error] ?? 'Something went wrong.') : null;
  const savedMsg = saved ? (SAVED_MESSAGES[saved] ?? null) : null;

  const { data } = await db
    .from('managers')
    .select('display_name, avatar_url, glory, coins, joined_at, favorite_team_id, favorite_footballer_id')
    .eq('id', session.managerId)
    .single();

  const manager = data as {
    display_name: string;
    avatar_url: string | null;
    glory: number;
    coins: number;
    joined_at: string;
    favorite_team_id: string | null;
    favorite_footballer_id: string | null;
  } | null;

  if (!manager) redirect('/join');

  // Locked first-login picks (migration 009) + the bonus ladder for the chosen team.
  const favorites = await loadFavorites(
    session.managerId,
    manager.favorite_team_id,
    manager.favorite_footballer_id,
  );

  const avatar = manager.avatar_url ?? '⚽';
  const joined = new Date(manager.joined_at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <main className="mx-auto w-full max-w-xl space-y-6 px-4 py-8">
      <Button asChild variant="ghost" size="sm" className="-ml-2 self-start">
        <Link href="/today">
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Link>
      </Button>

      <h1 className="text-glow font-display text-3xl font-bold tracking-tight text-foreground">
        Your profile
      </h1>

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/30 bg-[color-mix(in_oklab,var(--color-danger)_14%,transparent)] px-3 py-2.5 text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{errorMsg}</span>
        </div>
      )}
      {savedMsg && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-success/30 bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)] px-3 py-2.5 text-sm text-success"
        >
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{savedMsg}</span>
        </div>
      )}

      {/* Identity + standings */}
      <Card variant="glass" padding="lg" className="space-y-5">
        <div className="flex items-center gap-4">
          <span className="grid size-16 place-items-center rounded-3xl bg-surface-2 text-4xl shadow-[inset_0_2px_6px_rgba(0,0,0,0.3)]">
            {avatar}
          </span>
          <div>
            <p className="font-display text-2xl font-bold tracking-tight text-foreground">
              {manager.display_name}
            </p>
            <p className="text-sm text-muted">Joined {joined}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface-2 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              <Trophy className="size-3.5" aria-hidden />
              Points
            </p>
            <p className="font-display text-2xl font-bold text-foreground">{manager.glory}</p>
          </div>
          <div className="rounded-2xl bg-surface-2 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              <Coins className="size-3.5" aria-hidden />
              Coins
            </p>
            <p className="font-display text-2xl font-bold text-foreground">{manager.coins}</p>
          </div>
        </div>
      </Card>

      {/* Locked tournament picks */}
      {favorites.team && (
        <Card variant="glass" padding="lg" className="space-y-4">
          <div className="flex items-center justify-between">
            <CardTitle>Your tournament picks</CardTitle>
            <span className="flex items-center gap-1 text-xs text-subtle">
              <Lock className="size-3.5" aria-hidden />
              Locked
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 rounded-2xl bg-surface-2 px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                <Shield className="size-3.5" aria-hidden />
                Champion pick
              </p>
              <p className="flex items-center gap-2 font-display font-bold text-foreground">
                <Flag name={favorites.team.name} countryCode={favorites.team.countryCode} size="md" />
                <span className="truncate">{favorites.team.name}</span>
              </p>
            </div>
            <div className="space-y-1.5 rounded-2xl bg-surface-2 px-4 py-3">
              <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                <Star className="size-3.5" aria-hidden />
                Favorite player
              </p>
              <p className="truncate font-display font-bold text-foreground">
                {favorites.player ? favorites.player.name : '—'}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              <Trophy className="size-3.5" aria-hidden />
              Earned from your picks
            </p>
            <p className="font-display text-xl font-bold text-points">{favorites.earned} pts</p>
          </div>

          {favorites.team.breakdown && (
            <div className="space-y-1">
              {[...favorites.team.breakdown.rungs]
                .sort((a, b) => RUNG_ORDER.indexOf(a.key) - RUNG_ORDER.indexOf(b.key))
                .map(r => (
                  <div
                    key={r.key}
                    className={`flex items-center justify-between text-sm ${
                      r.key === 'champion' ? 'font-semibold text-points' : 'text-muted'
                    }`}
                  >
                    <span>{r.label}</span>
                    <span className="font-mono">+{r.points} pts</span>
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}

      {/* Edit name + avatar */}
      <Card variant="glass" padding="lg" className="space-y-5">
        <CardTitle>Name &amp; avatar</CardTitle>
        <form action={updateProfile} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="display_name"
              className="flex items-center gap-1.5 text-sm font-medium text-muted"
            >
              <UserRound className="size-4" aria-hidden />
              Display name
            </label>
            <Input
              id="display_name"
              name="display_name"
              type="text"
              required
              maxLength={32}
              defaultValue={manager.display_name}
              autoComplete="nickname"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-muted">Avatar</legend>
            <div className="grid grid-cols-8 gap-2">
              {AVATAR_CHOICES.map((emoji) => (
                <label key={emoji} className="cursor-pointer">
                  <input
                    type="radio"
                    name="avatar"
                    value={emoji}
                    defaultChecked={emoji === avatar}
                    className="peer sr-only"
                  />
                  <span className="grid aspect-square place-items-center rounded-xl bg-surface-2 text-xl ring-2 ring-transparent transition peer-checked:ring-[var(--color-primary-bright)] peer-focus-visible:ring-[var(--color-primary-bright)]">
                    {emoji}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <Button type="submit" className="w-full">
            Save changes
          </Button>
        </form>
      </Card>

      {/* Change PIN */}
      <Card variant="glass" padding="lg" className="space-y-5">
        <CardTitle>Change PIN</CardTitle>
        <form action={changePin} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="current_pin"
              className="flex items-center gap-1.5 text-sm font-medium text-muted"
            >
              <Lock className="size-4" aria-hidden />
              Current PIN
            </label>
            <Input
              id="current_pin"
              name="current_pin"
              type="password"
              inputMode="numeric"
              pattern="\d{4,6}"
              minLength={4}
              maxLength={6}
              autoComplete="off"
              placeholder="Leave blank if you’ve never set one"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="new_pin"
              className="flex items-center gap-1.5 text-sm font-medium text-muted"
            >
              <Lock className="size-4" aria-hidden />
              New PIN
            </label>
            <Input
              id="new_pin"
              name="new_pin"
              type="password"
              inputMode="numeric"
              pattern="\d{4,6}"
              required
              minLength={4}
              maxLength={6}
              autoComplete="off"
              placeholder="4–6 digits"
            />
          </div>
          <Button type="submit" variant="glass" className="w-full">
            Update PIN
          </Button>
        </form>
      </Card>

      <form action={signOut}>
        <Button type="submit" variant="ghost" className="w-full text-danger">
          <LogOut className="size-4" aria-hidden />
          Sign out
        </Button>
      </form>
    </main>
  );
}

// True bracket order for displaying the ladder (3rd place before the final).
const RUNG_ORDER = ['r32', 'r16', 'qf', 'sf', 'third', 'final', 'champion'];

// Resolve the locked picks into display data: the team (with its bonus ladder), the
// player, and the Points earned from both so far (favorite-player + team-milestone
// ledger entries).
async function loadFavorites(
  managerId: string,
  teamId: string | null,
  footballerId: string | null,
) {
  if (!teamId) return { team: null, player: null, earned: 0 } as const;

  const [{ data: league }, { data: team }, { data: player }, { data: ledger }] = await Promise.all([
    db.from('league').select('config').eq('id', 1).single(),
    db.from('teams').select('name, country_code, champion_odds').eq('id', teamId).maybeSingle(),
    footballerId
      ? db.from('footballers').select('name, squad_number').eq('id', footballerId).maybeSingle()
      : Promise.resolve({ data: null }),
    db
      .from('ledger')
      .select('amount, reason')
      .eq('manager_id', managerId)
      .eq('currency', 'glory'),
  ]);

  const fav = (league?.config as { favorites?: FavoritesConfig } | undefined)?.favorites;
  const earned = ((ledger ?? []) as { amount: number; reason: string }[])
    .filter(r => r.reason === 'fav_player' || r.reason.startsWith('team_'))
    .reduce((s, r) => s + r.amount, 0);

  return {
    team: team
      ? {
          name: team.name as string,
          countryCode: team.country_code as string,
          breakdown: fav ? ladderBreakdown(team.champion_odds as number | null, fav) : null,
        }
      : null,
    player: player
      ? { name: player.name as string, number: (player.squad_number as number | null) ?? null }
      : null,
    earned,
  } as const;
}
