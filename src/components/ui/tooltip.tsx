'use client';

import * as React from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Tap-to-toggle info bubble. Hover tooltips don't exist on touch, so this is a
 * small ⓘ button that opens a dismissable bubble instead — tap anywhere else
 * (or Escape) to close. Anchor it inside a `relative` parent if the default
 * right-aligned placement needs adjusting via `bubbleClassName`.
 */
export function InfoTip({
  label,
  children,
  bubbleClassName,
}: {
  /** Accessible name for the trigger, e.g. "What do these stats mean?" */
  label: string;
  children: React.ReactNode;
  bubbleClassName?: string;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => e.key === 'Escape' && setOpen(false)}
        className="grid size-9 shrink-0 place-items-center rounded-xl text-subtle transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
      >
        <Info className="size-4" aria-hidden />
      </button>
      {open && (
        <>
          {/* Invisible scrim — reliable outside-tap dismissal on touch. */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="status"
            className={cn(
              'absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-border-strong bg-surface-3 px-3.5 py-3 text-xs leading-relaxed text-muted shadow-lg',
              bubbleClassName,
            )}
          >
            {children}
          </div>
        </>
      )}
    </span>
  );
}
