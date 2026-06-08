'use client';

import { Trophy, KeyRound, UserRound, AlertCircle, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function JoinScreen({ error = false }: { error?: boolean }) {
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-3 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-primary text-on-primary shadow-[0_6px_0_0_var(--color-primary-press)]">
            <Trophy className="size-8" aria-hidden />
          </span>
          <h1 className="text-glow font-display text-4xl font-bold tracking-tight text-foreground">
            World Cup Bets
          </h1>
          <p className="text-sm text-muted">WC 2026 — five-player betting league</p>
        </div>

        <Card variant="glass" padding="lg" className="space-y-5">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-danger/30 bg-[color-mix(in_oklab,var(--color-danger)_14%,transparent)] px-3 py-2.5 text-sm text-danger"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>Wrong passcode — check with the league admin.</span>
            </div>
          )}

          <form className="space-y-4" onSubmit={e => e.preventDefault()}>
            <div className="space-y-1.5">
              <label htmlFor="passcode" className="flex items-center gap-1.5 text-sm font-medium text-muted">
                <KeyRound className="size-4" aria-hidden />
                League passcode
              </label>
              <Input id="passcode" name="passcode" type="password" autoComplete="off" placeholder="Enter the shared passcode" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="display_name" className="flex items-center gap-1.5 text-sm font-medium text-muted">
                <UserRound className="size-4" aria-hidden />
                Your name
              </label>
              <Input id="display_name" name="display_name" type="text" maxLength={32} autoComplete="nickname" placeholder="How you'll appear on the leaderboard" />
            </div>

            <Button type="submit" size="lg" className="w-full">
              Join the league
              <ArrowRight className="size-5" aria-hidden />
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
