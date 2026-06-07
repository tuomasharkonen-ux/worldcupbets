import { cn } from '@/lib/utils';
import { toFlagCode } from '@/lib/country-flags';

const SIZE_PX = { sm: 14, md: 18, lg: 24, xl: 30 } as const;

interface FlagProps {
  /** Team / country name — the primary resolver. */
  name: string;
  /** Stored 3-letter code, used as a fallback when the name can't be resolved. */
  countryCode?: string | null;
  size?: keyof typeof SIZE_PX;
  className?: string;
}

/**
 * Country flag (flag-icons SVG). Renders nothing when the country can't be
 * resolved, so it degrades gracefully on unexpected names.
 * Height is driven by font-size (flag-icons sizes itself in `em`).
 */
export function Flag({ name, countryCode, size = 'md', className }: FlagProps) {
  const code = toFlagCode(name, countryCode);
  if (!code) return null;
  return (
    <span
      role="img"
      aria-label={`${name} flag`}
      style={{ fontSize: SIZE_PX[size] }}
      className={cn(
        `fi fi-${code}`,
        'shrink-0 rounded-[3px] align-middle shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]',
        className,
      )}
    />
  );
}
