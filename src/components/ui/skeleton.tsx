import { cn } from '@/lib/utils';

/**
 * A single shimmering placeholder block. Compose these inside a route's
 * `loading.tsx` to mirror the shape of the page that's streaming in. Decorative
 * only — hidden from the accessibility tree (the route announces its own loading
 * state via the document title swap during navigation).
 *
 * The shimmer lives in `.skeleton` (globals.css) and collapses to a static tint
 * under the global `prefers-reduced-motion` guard.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn('skeleton', className)} {...props} />;
}
