'use client';

import { Trophy, Crown, Medal, Coins, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScreenFrame } from './ScreenFrame';
import { MOCK_LEADERBOARD, MOCK_ME_ID } from '../mock';

const MEDAL = [
  { Icon: Crown, color: 'text-points' },
  { Icon: Medal, color: 'text-[#cbd5e1]' },
  { Icon: Medal, color: 'text-[#d9883e]' },
];

export function LeaderboardScreen() {
  const rows = MOCK_LEADERBOARD;
  return (
    <ScreenFrame>
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2.5">
          <Trophy className="size-7 text-points" aria-hidden />
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">Leaderboard</h1>
        </div>

        <Card variant="glass" padding="sm">
          <ul className="space-y-1.5">
            {rows.map((m, i) => {
              const isYou = m.id === MOCK_ME_ID;
              const medal = MEDAL[i];
              return (
                <li
                  key={m.id}
                  className={`flex items-center gap-3 rounded-xl px-3 py-3 transition-colors ${
                    isYou
                      ? 'bg-[color-mix(in_oklab,var(--color-primary-bright)_16%,transparent)] ring-1 ring-[var(--color-primary-bright)]/40'
                      : 'bg-surface-2/60'
                  }`}
                >
                  <span className="grid w-8 shrink-0 place-items-center">
                    {medal ? (
                      <medal.Icon className={`size-6 ${medal.color}`} aria-label={`Rank ${i + 1}`} />
                    ) : (
                      <span className="font-mono text-sm font-semibold text-subtle">{i + 1}</span>
                    )}
                  </span>

                  <span className="min-w-0 flex-1 truncate font-display font-semibold text-foreground">
                    {m.display_name}
                    {isYou && (
                      <Badge variant="primary" size="sm" className="ml-2 align-middle">you</Badge>
                    )}
                  </span>

                  <span className="flex items-center gap-1.5 font-mono tabular-nums text-points">
                    <Sparkles className="size-4" aria-hidden />
                    <span className="font-semibold">{m.glory}</span>
                    <span className="text-xs text-points/70">pts</span>
                  </span>

                  <span className="flex w-20 items-center justify-end gap-1.5 font-mono tabular-nums text-muted">
                    <Coins className="size-4" aria-hidden />
                    {m.coins}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </main>
    </ScreenFrame>
  );
}
