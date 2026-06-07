import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Text/number input. Inset well style: sits "below" the surface with a soft
 * inner shadow, lifts to a bright ring on focus.
 */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'w-full rounded-xl border border-border bg-surface-2 px-4 py-2.5',
          'text-foreground placeholder:text-subtle',
          'shadow-[inset_0_2px_4px_rgba(0,0,0,0.25)]',
          'transition-[border-color,box-shadow] duration-100',
          'focus:border-[var(--color-primary-bright)] focus:outline-none',
          'focus:ring-2 focus:ring-[color-mix(in_oklab,var(--color-primary-bright)_45%,transparent)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
