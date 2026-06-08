'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, CalendarDays, Trophy, User } from 'lucide-react';

const TABS = [
  { href: '/today', label: 'Today', Icon: Home },
  { href: '/fixtures', label: 'Schedule', Icon: CalendarDays },
  { href: '/leaderboard', label: 'Leaderboard', Icon: Trophy },
  { href: '/profile', label: 'Profile', Icon: User },
] as const;

/**
 * Floating glass tab bar, mobile only (`sm:hidden`). Fixed to the bottom with a
 * safe-area inset so it clears the home indicator — an iOS-native feel. The
 * desktop nav lives in the top bar (see Nav.tsx).
 */
export function BottomTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pt-6 pb-[max(0.6rem,env(safe-area-inset-bottom))] sm:hidden"
    >
      {/* Gradient scrim: content stays sharp above the bar, then fades out so it's
          fully background by the bar's bottom edge — no clutter under the glass.
          Stops are tuned to the nav box (pt-6 → bar → pb): solid by ~18% (bar's
          bottom edge), transparent by ~70% (just above the bar's top edge). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-[var(--color-background)] from-[18%] via-[color-mix(in_oklab,var(--color-background)_55%,transparent)] via-[45%] to-transparent to-[70%]"
      />
      <div className="glass-strong flex w-full max-w-sm items-stretch justify-around gap-1 rounded-2xl p-1.5">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[0.65rem] font-medium transition-colors ${
                active
                  ? 'bg-[color-mix(in_oklab,var(--color-primary-bright)_18%,transparent)] text-[var(--color-primary-bright)]'
                  : 'text-muted active:bg-[rgba(255,255,255,0.06)]'
              }`}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
