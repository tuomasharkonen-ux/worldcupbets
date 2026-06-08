'use client';

import { Trophy, CalendarDays, LogOut, User, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';

// A static, non-functional replica of the app's <Nav> (which is an auth-gated
// server component). Used purely so full-screen previews read like the real
// thing. Links are inert so they don't navigate away from /admin.
function PreviewNav() {
  const item = 'flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground';
  return (
    <nav className="glass sticky top-0 z-40 border-x-0 border-t-0 px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
        <div className="flex items-center gap-5">
          <span className="flex items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-on-primary shadow-[0_3px_0_0_var(--color-primary-press)]">
              <Trophy className="size-5" aria-hidden />
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-foreground">World Cup Bets</span>
          </span>
          <div className="hidden items-center gap-1 sm:flex">
            <span className={item}><Home className="size-4" aria-hidden />Today</span>
            <span className={item}><CalendarDays className="size-4" aria-hidden />Full schedule</span>
            <span className={item}><Trophy className="size-4" aria-hidden />Leaderboard</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-sm text-muted sm:flex">
            <User className="size-4" aria-hidden />You
          </span>
          <Button type="button" variant="ghost" size="sm" aria-label="Sign out">
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </div>
    </nav>
  );
}

// Wraps a preview so it looks like a real authenticated screen: nav on top,
// content below. `nav={false}` for chrome-less screens (e.g. Join).
export function ScreenFrame({ children, nav = true }: { children: React.ReactNode; nav?: boolean }) {
  return (
    <div className="min-h-full">
      {nav && <PreviewNav />}
      {children}
    </div>
  );
}
