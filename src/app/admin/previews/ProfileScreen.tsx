'use client';

import { Trophy, Coins, UserRound, Lock, LogOut } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const AVATAR_CHOICES = [
  '⚽', '🦁', '🐉', '🦅', '🐺', '🦈', '🐅', '🐂',
  '🔥', '⚡', '👑', '🎯', '💎', '🚀', '🍀', '🎲',
];

export function ProfileScreen() {
  const avatar = '🦁';
  return (
    <main className="mx-auto w-full max-w-xl space-y-6 px-4 py-8">
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
