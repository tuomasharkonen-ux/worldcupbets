'use client';

import { Trophy, Crown, Medal, Coins, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flag } from '@/components/ui/flag';
import { ScreenFrame } from './ScreenFrame';
import { MOCK_LEADERBOARD, MOCK_ME_ID } from '../mock';

const MEDAL = [
  { Icon: Crown, color: 'text-points' },
  { Icon: Medal, color: 'text-[#cbd5e1]' },
  { Icon: Medal, color: 'text-[#d9883e]' },
];

function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1] || full;
}

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
              const hasFavorites = m.favTeam || m.favPlayer;
              return (
                <li
                  key={m.id}
                  className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 transition-colors ${
                    isYou
                      ? 'bg-[color-mix(in_oklab,var(--color-primary-bright)_16%,transparent)] ring-1 ring-[var(--color-primary-bright)]/40'
                      : 'bg-surface-2/60'
                  }`}
                >
                  <span className="grid w-7 shrink-0 place-items-center">
                    {medal ? (
                      <medal.Icon className={`size-6 ${medal.color}`} aria-label={`Rank ${i + 1}`} />
                    ) : (
                      <span className="font-mono text-sm font-semibold text-subtle">{i + 1}</span>
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-display font-semibold text-foreground">
                        {m.display_name}
                      </span>
                      {isYou && (
                        <Badge variant="primary" size="sm" className="shrink-0">you</Badge>
                      )}
                    </div>
                    {hasFavorites && (
                      <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-subtle">
                        {m.favTeam && <Flag name={m.favTeam} size="sm" className="shrink-0" />}
                        {m.favPlayer && <span className="truncate">{lastName(m.favPlayer)}</span>}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="flex items-center gap-1 font-mono tabular-nums text-points">
                      <Sparkles className="size-4" aria-hidden />
                      <span className="text-lg font-bold leading-none">{m.glory}</span>
                      <span className="text-[0.7rem] text-points/70">pts</span>
                    </span>
                    <span className="flex items-center gap-1 font-mono text-[0.7rem] tabular-nums text-muted/80">
                      <Coins className="size-3" aria-hidden />
                      {m.coins}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      </main>
    </ScreenFrame>
  );
}
