import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'brand' | 'warning' | 'danger' | 'success' | 'earth' | 'info';

/**
 * The reference's tag family, one tone per meaning: growth (success), ripening
 * (warning), alarm (danger), water and forecast (info), the app itself (brand),
 * land and area (earth), and a quiet default. Each pairs a tint background with
 * a text colour dark enough to clear 4.5:1 on it — the tint alone is never the
 * signal, because `Badge` is always given a word and usually an icon too.
 *
 * Borderless, per the reference's `.tg`. The earlier version outlined every tag
 * in its own tone, which at a glance turned a row of tags into a row of small
 * buttons; the tint alone is enough separation against both the white card and
 * the cream canvas, and it is what makes the design's dense stat rows read as
 * data rather than as controls.
 */
const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-mute text-ink-500',
  brand: 'bg-brand-50 text-brand-600',
  warning: 'bg-harvest-tint text-harvest-700',
  danger: 'bg-danger-50 text-danger-600',
  success: 'bg-leaf-tint text-leaf-700',
  earth: 'bg-earth-100 text-earth-700',
  info: 'bg-sky-tint text-sky-700',
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
        'inline-flex items-center gap-1.5 rounded-full px-[11px] py-1 text-[0.719rem] font-semibold',
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
