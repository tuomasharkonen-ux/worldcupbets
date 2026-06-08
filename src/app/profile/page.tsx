import { redirect } from 'next/navigation';
import { Trophy, Coins, UserRound, Lock, LogOut, AlertCircle, CheckCircle2 } from 'lucide-react';
import { getSession } from '@/lib/session';
import { signOut } from '@/app/actions';
import { db } from '@/lib/supabase';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { updateProfile, changePin, AVATAR_CHOICES } from './actions';

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

  const { error, saved } = await searchParams;
  const errorMsg = error ? (ERROR_MESSAGES[error] ?? 'Something went wrong.') : null;
  const savedMsg = saved ? (SAVED_MESSAGES[saved] ?? null) : null;

  const { data } = await db
    .from('managers')
    .select('display_name, avatar_url, glory, coins, joined_at')
    .eq('id', session.managerId)
    .single();

  const manager = data as {
    display_name: string;
    avatar_url: string | null;
    glory: number;
    coins: number;
    joined_at: string;
  } | null;

  if (!manager) redirect('/join');

  const avatar = manager.avatar_url ?? '⚽';
  const joined = new Date(manager.joined_at).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <main className="mx-auto w-full max-w-xl space-y-6 px-4 py-8">
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
