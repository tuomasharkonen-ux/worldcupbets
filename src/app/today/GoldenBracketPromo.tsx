import Link from 'next/link';
import { Pencil, Trophy } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Countdown } from '@/components/Countdown';

export type GoldenBracketPromoState = 'open' | 'submitted' | 'locked';

// The Golden Bracket call-to-action on the Today screen (migration 016). Purely
// presentational — the page decides visibility and state — so the admin gallery can
// render every variant off mock props. Shown from the moment the QF field is known:
// full-size until the manager has a bracket in, compact once they do, and a quiet
// "view" row after the lock (hidden entirely for managers who never placed one).
export function GoldenBracketPromo({
  state,
  lockAt,
}: {
  state: GoldenBracketPromoState;
  lockAt: string;
}) {
  if (state === 'open') {
    return (
      <Card
        variant="glass"
        padding="lg"
        className="space-y-3 border-points/40 bg-gradient-to-br from-points/10 to-transparent text-center"
      >
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-points text-[#0a1e12] shadow-[0_4px_0_0_var(--color-points-press)]">
          <Trophy className="size-6" aria-hidden />
        </span>
        <div>
          <p className="text-glow font-display text-xl font-bold text-foreground">The Golden Bracket</p>
          <p className="mt-1 text-sm text-muted">
            One free shot for everyone: call the top four and the tournament’s top scorer. Underdog picks pay
            up to ×5.
          </p>
        </div>
        <Countdown target={lockAt} label="Locks in" liveLabel="Locked" />
        <Button asChild size="lg" variant="points" className="w-full">
          <Link href="/golden-bracket">
            <Trophy aria-hidden />
            Make your bracket
          </Link>
        </Button>
      </Card>
    );
  }

  return (
    <Card
      variant="glass"
      padding="md"
      className="flex items-center gap-3 border-points/40 bg-gradient-to-br from-points/10 to-transparent"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-points text-[#0a1e12]">
        <Trophy className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-semibold text-foreground">
          {state === 'submitted' ? 'Golden Bracket’s in' : 'Golden Bracket locked'}
        </p>
        <p className="text-xs text-muted">
          {state === 'submitted' ? 'Edit until the first quarter-final kicks off.' : 'Points land when the tournament wraps.'}
        </p>
      </div>
      {state === 'submitted' ? (
        <Button asChild size="sm" variant="glass" className="shrink-0">
          <Link href="/golden-bracket">
            <Pencil className="size-4" aria-hidden />
            View / edit
          </Link>
        </Button>
      ) : (
        <Button asChild size="sm" variant="ghost" className="shrink-0">
          <Link href="/golden-bracket">
            View
            <Badge variant="locked" size="sm">Locked</Badge>
          </Link>
        </Button>
      )}
    </Card>
  );
}
