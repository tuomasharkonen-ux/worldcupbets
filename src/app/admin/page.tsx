'use client';

import { useState } from 'react';
import {
  Home, CheckCircle2, Loader2, Coffee, Sparkles,
  Ticket, Trophy, CalendarDays, CalendarClock, CalendarX, KeyRound, AlertCircle, Palette, FlaskConical, UserCircle, Star,
  Crown, Megaphone, Target, ListChecks, Lock,
} from 'lucide-react';
import { GoldenBracketScreen } from './previews/GoldenBracketScreen';
import { TodayScreen } from './previews/TodayScreen';
import { FixturesScreen } from './previews/FixturesScreen';
import { LeaderboardScreen } from './previews/LeaderboardScreen';
import { MatchScreen } from './previews/MatchScreen';
import { JoinScreen } from './previews/JoinScreen';
import { OnboardingScreen } from './previews/OnboardingScreen';
import { ProfileScreen } from './previews/ProfileScreen';
import { DesignSystem } from './previews/DesignSystem';

type View = {
  key: string;
  label: string;
  Icon: typeof Home;
  render: () => React.ReactNode;
};

type Group = { group: string; views: View[] };

const GROUPS: Group[] = [
  {
    group: 'Today',
    views: [
      { key: 'today-betting', label: 'Filled (betting)', Icon: Ticket, render: () => <TodayScreen variant="betting" /> },
      { key: 'today-allset', label: 'All set', Icon: CheckCircle2, render: () => <TodayScreen variant="allset" /> },
      { key: 'today-settling', label: 'Settling', Icon: Loader2, render: () => <TodayScreen variant="settling" /> },
      { key: 'today-recap', label: 'Morning recap (big win)', Icon: Sparkles, render: () => <TodayScreen variant="recap" /> },
      { key: 'today-recap-rough', label: 'Morning recap (rough night)', Icon: Sparkles, render: () => <TodayScreen variant="recap-rough" /> },
      { key: 'today-upcoming', label: 'Next up (rest day)', Icon: CalendarClock, render: () => <TodayScreen variant="upcoming" /> },
      { key: 'today-noschedule', label: 'No fixtures yet', Icon: Coffee, render: () => <TodayScreen variant="noschedule" /> },
    ],
  },
  {
    group: 'Match',
    views: [
      { key: 'match-betslip', label: 'Bet slip (live)', Icon: Ticket, render: () => <MatchScreen variant="betslip" /> },
      { key: 'match-finished', label: 'Finished (settled)', Icon: CheckCircle2, render: () => <MatchScreen variant="finished" /> },
    ],
  },
  {
    group: 'Schedule',
    views: [
      { key: 'fixtures', label: 'Full schedule', Icon: CalendarDays, render: () => <FixturesScreen /> },
      { key: 'fixtures-empty', label: 'Empty schedule', Icon: CalendarX, render: () => <FixturesScreen empty /> },
    ],
  },
  {
    group: 'League',
    views: [
      { key: 'leaderboard', label: 'Leaderboard', Icon: Trophy, render: () => <LeaderboardScreen /> },
    ],
  },
  {
    group: 'Golden Bracket',
    views: [
      { key: 'gb-promo', label: 'Today promo (all states)', Icon: Megaphone, render: () => <GoldenBracketScreen variant="promo" /> },
      { key: 'gb-intro', label: 'Intro', Icon: Crown, render: () => <GoldenBracketScreen variant="intro" /> },
      { key: 'gb-bracket', label: 'Bracket picks', Icon: Trophy, render: () => <GoldenBracketScreen variant="bracket" /> },
      { key: 'gb-scorer', label: 'Top scorer', Icon: Target, render: () => <GoldenBracketScreen variant="scorer" /> },
      { key: 'gb-review', label: 'Review slip', Icon: ListChecks, render: () => <GoldenBracketScreen variant="review" /> },
      { key: 'gb-submitted', label: 'Submitted', Icon: CheckCircle2, render: () => <GoldenBracketScreen variant="submitted" /> },
      { key: 'gb-locked', label: 'Locked', Icon: Lock, render: () => <GoldenBracketScreen variant="locked" /> },
    ],
  },
  {
    group: 'Onboarding',
    views: [
      { key: 'join', label: 'Join', Icon: KeyRound, render: () => <JoinScreen /> },
      { key: 'join-error', label: 'Join (error)', Icon: AlertCircle, render: () => <JoinScreen error /> },
      { key: 'onboarding', label: 'Favorites picker', Icon: Star, render: () => <OnboardingScreen /> },
      { key: 'profile', label: 'Profile', Icon: UserCircle, render: () => <ProfileScreen /> },
    ],
  },
  {
    group: 'System',
    views: [
      { key: 'design-system', label: 'Design system', Icon: Palette, render: () => <DesignSystem /> },
    ],
  },
];

const ALL = GROUPS.flatMap(g => g.views);

export default function AdminPage() {
  const [active, setActive] = useState<string>('today-betting');
  const current = ALL.find(v => v.key === active) ?? ALL[0];

  return (
    <div className="flex min-h-screen">
      {/* Side navigation */}
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border bg-surface/80 backdrop-blur">
        <div className="flex items-center gap-2 border-b border-border px-4 py-4">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-on-primary shadow-[0_3px_0_0_var(--color-primary-press)]">
            <FlaskConical className="size-5" aria-hidden />
          </span>
          <div>
            <p className="font-display text-sm font-bold tracking-tight text-foreground">View gallery</p>
            <p className="text-[0.65rem] text-subtle">/admin · mock data</p>
          </div>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {GROUPS.map(g => (
            <div key={g.group}>
              <p className="px-2 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-subtle">{g.group}</p>
              <ul className="space-y-0.5">
                {g.views.map(v => {
                  const isActive = v.key === active;
                  return (
                    <li key={v.key}>
                      <button
                        type="button"
                        onClick={() => setActive(v.key)}
                        aria-current={isActive}
                        className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-[color-mix(in_oklab,var(--color-primary-bright)_18%,transparent)] text-foreground'
                            : 'text-muted hover:bg-[rgba(255,255,255,0.05)] hover:text-foreground'
                        }`}
                      >
                        <v.Icon className={`size-4 shrink-0 ${isActive ? 'text-primary-bright' : ''}`} aria-hidden />
                        <span className="truncate">{v.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <p className="border-t border-border px-4 py-3 text-[0.65rem] leading-relaxed text-subtle">
          Hidden preview harness. Renders real components with fabricated data — no session, no DB.
        </p>
      </aside>

      {/* Active view */}
      <div className="min-w-0 flex-1">{current.render()}</div>
    </div>
  );
}
