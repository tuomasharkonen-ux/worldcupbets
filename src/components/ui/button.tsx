import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * Chunky 3D button. The depth is a hard-edged bottom "lip" drawn with a
 * coloured box-shadow; on :active the button drops into its lip
 * (translate-y) and the lip shrinks — so it physically presses.
 * Disabled buttons flatten and stop responding.
 */
const button = cva(
  [
    'relative inline-flex items-center justify-center gap-2 select-none',
    'font-display font-semibold tracking-tight whitespace-nowrap',
    'rounded-2xl transition-[transform,box-shadow,background-color] duration-100 ease-out',
    'active:translate-y-[3px]',
    'disabled:pointer-events-none disabled:opacity-50 disabled:translate-y-0 disabled:shadow-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]',
    '[&_svg]:shrink-0 [&_svg]:size-[1.1em]',
  ],
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-on-primary hover:bg-primary-hover shadow-[0_5px_0_0_var(--color-primary-press)] active:shadow-[0_2px_0_0_var(--color-primary-press)]',
        points:
          'bg-points text-[#0a1e12] hover:brightness-105 shadow-[0_5px_0_0_var(--color-points-press)] active:shadow-[0_2px_0_0_var(--color-points-press)]',
        success:
          'bg-success text-[#0a1e12] hover:brightness-105 shadow-[0_5px_0_0_var(--color-success-press)] active:shadow-[0_2px_0_0_var(--color-success-press)]',
        accent:
          'bg-accent text-[#0a1e12] hover:brightness-105 shadow-[0_5px_0_0_var(--color-accent-press)] active:shadow-[0_2px_0_0_var(--color-accent-press)]',
        glass:
          'glass text-foreground hover:bg-[color-mix(in_oklab,var(--color-surface)_85%,transparent)] active:translate-y-[1px]',
        ghost:
          'text-muted hover:text-foreground hover:bg-[rgba(255,255,255,0.06)] active:translate-y-[1px]',
      },
      size: {
        sm: 'h-9 px-4 text-sm',
        md: 'h-11 px-5 text-[0.95rem]',
        lg: 'h-14 px-7 text-lg',
        icon: 'size-11 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(button({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { button as buttonVariants };
