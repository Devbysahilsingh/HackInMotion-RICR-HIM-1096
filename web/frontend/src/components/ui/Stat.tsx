import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The design's `.stat` tile: a bordered box holding one number and its name.
 *
 * Used in rows of two to four — mandi min/modal/max, a farm's crop counts, the
 * season summary. The number is set in the display face at 24px so a row of
 * these reads as data at a glance; the label stays small and quiet underneath
 * rather than above, which is what keeps the figures on one optical line.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  className,
}: {
  label: string;
  value: ReactNode;
  /** Optional third line — a delta, a date, a unit note. */
  hint?: ReactNode;
  tone?: 'default' | 'quiet';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-control border border-line px-4 py-3.5',
        tone === 'quiet' ? 'bg-canvas' : 'bg-surface',
        className,
      )}
    >
      <p className="font-display text-2xl font-extrabold leading-none tracking-[-0.03em]">
        {value}
      </p>
      <p className="kicker mt-2">{label}</p>
      {hint && <p className="mt-1 text-xs text-ink-500">{hint}</p>}
    </div>
  );
}
