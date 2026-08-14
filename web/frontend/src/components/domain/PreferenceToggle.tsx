import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';

/**
 * A labelled on/off preference that saves as soon as it is changed.
 *
 * A real `<input type="checkbox">` under a styled track, rather than a
 * `role="switch"` div: the native control brings keyboard operation, the
 * accessibility tree entry and form semantics for free, and the label wraps it
 * so the whole row is a 44px target.
 *
 * There is no Save button on this page by design. Each toggle owns one field
 * and writes it immediately, which is why the pending state lives on the
 * control itself — a farmer needs to see *this* switch working, not a spinner
 * somewhere else on the page.
 */
export function PreferenceToggle({
  label,
  description,
  checked,
  onChange,
  isPending = false,
  disabled = false,
  testId,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  isPending?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start justify-between gap-4 rounded-card border border-line bg-surface p-4',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink-900">{label}</span>
        {description && <span className="mt-1 block text-sm text-ink-500">{description}</span>}
      </span>

      <span className="flex shrink-0 items-center gap-2">
        {isPending && <Spinner size="sm" />}
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled || isPending}
          data-testid={testId}
          onChange={(event) => onChange(event.target.checked)}
        />
        {/*
          The track. `peer-focus-visible` puts the focus ring here because the
          input itself is visually hidden — without it a keyboard user tabbing
          through Settings would see nothing move.
        */}
        {/*
          The knob's transform is driven from the *track*, not from the knob:
          `peer-*` compiles to a sibling combinator, and the knob is a
          descendant of a sibling rather than a sibling itself — so
          `peer-checked:translate-x-5` on the knob silently never matches.
        */}
        <span
          aria-hidden="true"
          className="relative h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-brand-600 peer-checked:[&>span]:translate-x-5 peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-leaf-500"
        >
          <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-surface shadow-sm transition-transform" />
        </span>
      </span>
    </label>
  );
}
