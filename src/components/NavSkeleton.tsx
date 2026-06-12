import Link from 'next/link';
import { Trophy, CalendarDays, Home, User } from 'lucide-react';
import { BottomTabs } from '@/components/BottomTabs';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Static stand-in for <Nav /> used inside route-level loading.tsx files. The top
 * bar is session-independent chrome, so we render it identically — only the
 * manager's display name (a server lookup in the real Nav) becomes a placeholder.
 * Rendering the real <BottomTabs /> keeps the mobile tab bar mounted and correctly
 * highlighted the instant a navigation starts, so the chrome never flickers.
 *
 * Keep the top-bar markup in sync with Nav.tsx.
 */
export function NavSkeleton() {
  return (
    <>
      <nav className="glass sticky top-0 z-40 border-x-0 border-t-0 px-4 py-3">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="flex items-center gap-5">
            <Link href="/today" className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-xl bg-primary text-on-primary shadow-[0_3px_0_0_var(--color-primary-press)]">
                <Trophy className="size-5" aria-hidden />
              </span>
              <span className="font-display text-lg font-bold tracking-tight text-foreground">
                World Cup Bets
              </span>
            </Link>
            <div className="hidden items-center gap-1 sm:flex">
              <Link
                href="/today"
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground"
              >
                <Home className="size-4" aria-hidden />
                Today
              </Link>
              <Link
                href="/fixtures"
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground"
              >
                <CalendarDays className="size-4" aria-hidden />
                Full schedule
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

          <div className="hidden items-center gap-2 sm:flex">
            <span className="flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-sm text-muted">
              <User className="size-4" aria-hidden />
              <Skeleton className="h-3.5 w-20" />
            </span>
          </div>
        </div>
      </nav>

      <BottomTabs />
    </>
  );
}
