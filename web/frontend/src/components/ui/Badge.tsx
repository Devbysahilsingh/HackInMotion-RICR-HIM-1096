import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'brand' | 'warning' | 'danger' | 'success' | 'earth';

/**
 * The reference's tag family, one tone per meaning: growth (success), ripening
 * (warning), alarm (danger), the app itself (brand), land and area (earth), and
 * a quiet default. Each pairs a tint background with a text colour dark enough
 * to clear 4.5:1 on it — the tint alone is never the signal, because `Badge` is
 * always given a word and usually an icon too.
 */
const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-canvas text-ink-700 border-line',
  brand: 'bg-brand-50 text-brand-600 border-brand-200',
  warning: 'bg-harvest-tint text-harvest-700 border-harvest-500/40',
  danger: 'bg-danger-50 text-danger-600 border-danger-600/30',
  success: 'bg-leaf-tint text-leaf-700 border-leaf-500/40',
  earth: 'bg-earth-100 text-earth-700 border-earth-600/25',
};

/**
 * A neutral label. Unlike `PriorityChip` this carries no ranked meaning, so it
 * is safe to use for a status word, a count, or a tag.
 */
export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
  ...rest
}: {
  tone?: BadgeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        TONE[tone],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}
