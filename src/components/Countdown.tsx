'use client';

import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

function format(ms: number): string {
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (d > 0) return `${d}d ${h}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

/**
 * Live countdown to a kickoff. Ticks every second on the client; the dynamic time
 * carries `suppressHydrationWarning` since the server-rendered value is a second stale.
 */
export function Countdown({
  target,
  label = 'First kickoff in',
  liveLabel = 'First match is under way',
  className,
}: {
  target: string;
  label?: string;
  liveLabel?: string;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ms = new Date(target).getTime() - now;
  const ticking = ms > 0;

  return (
    <div
      className={cn(
        'mx-auto flex w-fit items-center gap-2 rounded-full border border-border bg-surface-2/60 px-4 py-1.5 text-sm font-medium text-muted',
        className,
      )}
    >
      <Timer className="size-4 text-points" aria-hidden />
      {ticking ? (
        <span>
          {label}{' '}
          <span suppressHydrationWarning className="font-mono font-semibold tabular-nums text-foreground">
            {format(ms)}
          </span>
        </span>
      ) : (
        <span className="text-foreground">{liveLabel}</span>
      )}
    </div>
  );
}
