import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const card = cva('rounded-2xl', {
  variants: {
    variant: {
      /** Frosted glass over the ambient backdrop — the default look. */
      glass: 'glass-strong',
      /** Opaque panel — for dense content where blur would hurt legibility. */
      solid: 'bg-surface border border-border shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)]',
      /** Subtle inset well — e.g. a nested section inside a card. */
      well: 'bg-surface-2 border border-border',
    },
    padding: {
      none: '',
      sm: 'p-4',
      md: 'p-5',
      lg: 'p-6',
    },
  },
  defaultVariants: { variant: 'glass', padding: 'md' },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof card> {}

export function Card({ className, variant, padding, ...props }: CardProps) {
  return <div className={cn(card({ variant, padding }), className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2
      className={cn('font-display text-lg font-semibold tracking-tight text-foreground', className)}
      {...props}
    />
  );
}
