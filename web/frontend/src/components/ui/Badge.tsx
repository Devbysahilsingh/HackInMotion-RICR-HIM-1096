import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type BadgeTone = 'neutral' | 'brand' | 'warning' | 'danger' | 'success';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-canvas text-ink-700 border-line',
  brand: 'bg-brand-50 text-brand-700 border-brand-200',
  warning: 'bg-priority-medium-soft text-priority-medium border-priority-medium/30',
  danger: 'bg-danger-50 text-danger-600 border-danger-600/30',
  success: 'bg-priority-info-soft text-priority-info border-priority-info/30',
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
