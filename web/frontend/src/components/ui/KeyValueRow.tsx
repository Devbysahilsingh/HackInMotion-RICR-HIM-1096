import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * The design's `.lrow`: a label on the left, a value hard right, a hairline
 * underneath — except on the last one.
 *
 * It is the workhorse of the whole design ("Farm at a glance", the crop record,
 * mandi observations, the settings list). Rendering it as a `<dl>` pair rather
 * than a flex div means a screen reader announces the pairing instead of reading
 * two unrelated runs of text.
 *
 * The trailing border is dropped with `last:border-b-0` rather than by the
 * caller counting rows, so a list that grows or filters cannot end on a stray
 * line against the card edge.
 */
export function KeyValueRow({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-line py-3.5 last:border-b-0',
        className,
      )}
    >
      <dt className="min-w-0 flex-1 text-sm">{label}</dt>
      <dd className="shrink-0 text-right text-sm font-semibold">{value}</dd>
    </div>
  );
}

/** Wrapper that gives a run of `KeyValueRow`s their list semantics. */
export function KeyValueList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={className}>{children}</dl>;
}
