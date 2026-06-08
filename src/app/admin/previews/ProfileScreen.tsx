'use client';

import { ArrowLeft, Trophy, Coins, UserRound, Lock, LogOut, Star, Shield } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Flag } from '@/components/ui/flag';
import { ladderBreakdown } from '@/settlement/favorites';
import type { FavoritesConfig } from '@/types/db';

const FAV: FavoritesConfig = {
  base_odds: 5.5, min_mult: 1.0, max_mult: 5.0,
  ladder: { r32: 10, r16: 20, qf: 35, sf: 55, third: 40, final: 75, champion: 90 },
  player_goal: 15, player_card: -5,
};
const RUNG_ORDER = ['r32', 'r16', 'qf', 'sf', 'third', 'final', 'champion'];

const AVATAR_CHOICES = [
  '⚽', '🦁', '🐉', '🦅', '🐺', '🦈', '🐅', '🐂',
  '🔥', '⚡', '👑', '🎯', '💎', '🚀', '🍀', '🎲',
];

export function ProfileScreen() {
  const avatar = '🦁';
  return (
    <main className="mx-auto w-full max-w-xl space-y-6 px-4 py-8">
      <Button type="button" variant="ghost" size="sm" className="-ml-2">
        <ArrowLeft className="size-4" aria-hidden />
        Back
      </Button>

      <h1 className="text-glow font-display text-3xl font-bold tracking-tight text-foreground">
        Your profile
      </h1>

      <Card variant="glass" padding="lg" className="space-y-5">
        <div className="flex items-center gap-4">
          <span className="grid size-16 place-items-center rounded-3xl bg-surface-2 text-4xl shadow-[inset_0_2px_6px_rgba(0,0,0,0.3)]">
            {avatar}
          </span>
          <div>
            <p className="font-display text-2xl font-bold tracking-tight text-foreground">
              Marko
            </p>
            <p className="text-sm text-muted">Joined 8 Jun 2026</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-surface-2 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              <Trophy className="size-3.5" aria-hidden />
              Points
            </p>
            <p className="font-display text-2xl font-bold text-foreground">145</p>
          </div>
          <div className="rounded-2xl bg-surface-2 px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
              <Coins className="size-3.5" aria-hidden />
              Coins
            </p>
            <p className="font-display text-2xl font-bold text-foreground">212</p>
          </div>
        </div>
      </Card>

      <FavoritesCard />

      <Card variant="glass" padding="lg" className="space-y-5">
        <CardTitle>Name &amp; avatar</CardTitle>
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-1.5">
            <label htmlFor="display_name" className="flex items-center gap-1.5 text-sm font-medium text-muted">
              <UserRound className="size-4" aria-hidden />
              Display name
            </label>
            <Input id="display_name" name="display_name" type="text" maxLength={32} defaultValue="Marko" />
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

      <Card variant="glass" padding="lg" className="space-y-5">
        <CardTitle>Change PIN</CardTitle>
        <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-1.5">
            <label htmlFor="current_pin" className="flex items-center gap-1.5 text-sm font-medium text-muted">
              <Lock className="size-4" aria-hidden />
              Current PIN
            </label>
            <Input id="current_pin" name="current_pin" type="password" inputMode="numeric" placeholder="Leave blank if you’ve never set one" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new_pin" className="flex items-center gap-1.5 text-sm font-medium text-muted">
              <Lock className="size-4" aria-hidden />
              New PIN
            </label>
            <Input id="new_pin" name="new_pin" type="password" inputMode="numeric" placeholder="4–6 digits" />
          </div>
          <Button type="submit" variant="glass" className="w-full">
            Update PIN
          </Button>
        </form>
      </Card>

      <Button type="button" variant="ghost" className="w-full text-danger">
        <LogOut className="size-4" aria-hidden />
        Sign out
      </Button>
    </main>
  );
}

// Marko backed Morocco (a ×3 underdog) and a striker — earned points so far.
function FavoritesCard() {
  const breakdown = ladderBreakdown(51, FAV); // Morocco-ish odds → ×3
  const rungs = [...breakdown.rungs].sort((a, b) => RUNG_ORDER.indexOf(a.key) - RUNG_ORDER.indexOf(b.key));
  return (
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
            <Flag name="Morocco" countryCode="MAR" size="md" />
            <span className="truncate">Morocco</span>
          </p>
        </div>
        <div className="space-y-1.5 rounded-2xl bg-surface-2 px-4 py-3">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            <Star className="size-3.5" aria-hidden />
            Favorite player
          </p>
          <p className="truncate font-display font-bold text-foreground">Hakim Ziyech</p>
        </div>
      </div>
      <div className="flex items-center justify-between rounded-2xl bg-surface-2 px-4 py-3">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
          <Trophy className="size-3.5" aria-hidden />
          Earned from your picks
        </p>
        <p className="font-display text-xl font-bold text-points">95 pts</p>
      </div>
      <div className="space-y-1">
        {rungs.map(r => (
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
    </Card>
  );
}
