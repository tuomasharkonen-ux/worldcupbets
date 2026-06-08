import { Trophy, KeyRound, UserRound, Lock, AlertCircle, ArrowRight } from 'lucide-react';
import { joinLeague } from './actions';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: 'Passcode and name are required.',
  wrong_passcode: 'Wrong passcode — check with the league admin.',
  pin_format: 'Your PIN must be 4–6 digits.',
  wrong_pin: 'Wrong PIN for that name. New here? Pick a different name.',
  locked: 'Too many wrong PINs for that name. Try again in about 15 minutes.',
  league_full: 'The league is full — ask the admin to make room.',
  server_error: 'Something went wrong. Try again.',
};

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMsg = error ? (ERROR_MESSAGES[error] ?? 'Something went wrong.') : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-3 text-center">
          <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-primary text-on-primary shadow-[0_6px_0_0_var(--color-primary-press)]">
            <Trophy className="size-8" aria-hidden />
          </span>
          <h1 className="text-glow font-display text-4xl font-bold tracking-tight text-foreground">
            World Cup Bets
          </h1>
          <p className="text-sm text-muted">WC 2026 — the friends&apos; betting league</p>
        </div>

        <Card variant="glass" padding="lg" className="space-y-5">
          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-danger/30 bg-[color-mix(in_oklab,var(--color-danger)_14%,transparent)] px-3 py-2.5 text-sm text-danger"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{errorMsg}</span>
            </div>
          )}

          <form action={joinLeague} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="passcode"
                className="flex items-center gap-1.5 text-sm font-medium text-muted"
              >
                <KeyRound className="size-4" aria-hidden />
                League passcode
              </label>
              <Input
                id="passcode"
                name="passcode"
                type="password"
                required
                autoComplete="off"
                placeholder="Enter the shared passcode"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="display_name"
                className="flex items-center gap-1.5 text-sm font-medium text-muted"
              >
                <UserRound className="size-4" aria-hidden />
                Your name
              </label>
              <Input
                id="display_name"
                name="display_name"
                type="text"
                required
                maxLength={32}
                autoComplete="nickname"
                placeholder="How you'll appear on the leaderboard"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="pin"
                className="flex items-center gap-1.5 text-sm font-medium text-muted"
              >
                <Lock className="size-4" aria-hidden />
                Your PIN
              </label>
              <Input
                id="pin"
                name="pin"
                type="password"
                inputMode="numeric"
                pattern="\d{4,6}"
                required
                minLength={4}
                maxLength={6}
                autoComplete="off"
                placeholder="4–6 digits"
              />
              <p className="text-xs text-muted">
                New name? This sets your PIN. Returning? Enter the PIN you chose — it keeps
                others from logging in as you.
              </p>
            </div>

            <Button type="submit" size="lg" className="w-full">
              Enter the league
              <ArrowRight className="size-5" aria-hidden />
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
