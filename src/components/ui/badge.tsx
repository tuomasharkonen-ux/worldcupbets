import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Pill badge. Status colours use a translucent tint of the semantic colour
 * with the same colour as text — high contrast on the dark canvas, and the
 * fill stays subtle so it never competes with primary actions.
 */
const badge = cva(
  'inline-flex items-center gap-1 rounded-full font-semibold leading-none [&_svg]:size-[1.05em]',
  {
    variants: {
      variant: {
        open: 'bg-[color-mix(in_oklab,var(--color-success)_18%,transparent)] text-success',
        locked: 'bg-[color-mix(in_oklab,var(--color-danger)_18%,transparent)] text-danger',
        finished: 'bg-surface-3 text-muted',
        points: 'bg-[color-mix(in_oklab,var(--color-points)_18%,transparent)] text-points',
        primary: 'bg-[color-mix(in_oklab,var(--color-primary-bright)_22%,transparent)] text-primary-bright',
        neutral: 'bg-surface-2 text-muted',
      },
      size: {
        sm: 'px-2 py-0.5 text-[0.7rem]',
        md: 'px-2.5 py-1 text-xs',
      },
    },
    defaultVariants: { variant: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badge> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return <span className={cn(badge({ variant, size }), className)} {...props} />;
}
