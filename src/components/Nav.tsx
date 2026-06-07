import Link from 'next/link';
import { Trophy, CalendarDays, LogOut, User } from 'lucide-react';
import { getSession } from '@/lib/session';
import { signOut } from '@/app/actions';
import { Button } from '@/components/ui/button';

export async function Nav() {
  const session = await getSession();
  if (!session.managerId) return null;

  return (
    <nav className="glass sticky top-0 z-40 border-x-0 border-t-0 px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
        <div className="flex items-center gap-5">
          <Link href="/fixtures" className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-on-primary shadow-[0_3px_0_0_var(--color-primary-press)]">
              <Trophy className="size-5" aria-hidden />
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-foreground">
              World Cup Bets
            </span>
          </Link>
          <div className="hidden items-center gap-1 sm:flex">
            <Link
              href="/fixtures"
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground"
            >
              <CalendarDays className="size-4" aria-hidden />
              Fixtures
            </Link>
            <Link
              href="/leaderboard"
              className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground"
            >
              <Trophy className="size-4" aria-hidden />
              Leaderboard
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-sm text-muted sm:flex">
            <User className="size-4" aria-hidden />
            {session.displayName}
          </span>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" aria-label="Sign out">
              <LogOut className="size-4" aria-hidden />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </form>
        </div>
      </div>

      {/* Mobile nav links */}
      <div className="mx-auto mt-2 flex max-w-4xl items-center gap-1 sm:hidden">
        <Link
          href="/fixtures"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-2 px-3 py-2 text-sm font-medium text-muted"
        >
          <CalendarDays className="size-4" aria-hidden />
          Fixtures
        </Link>
        <Link
          href="/leaderboard"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-2 px-3 py-2 text-sm font-medium text-muted"
        >
          <Trophy className="size-4" aria-hidden />
          Leaderboard
        </Link>
      </div>
    </nav>
  );
}
