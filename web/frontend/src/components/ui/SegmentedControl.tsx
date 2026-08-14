import { cn } from '@/lib/cn';

/**
 * The design's `.seg2`: two or three mutually exclusive choices in a pill track,
 * the selected one lifted onto a white chip.
 *
 * A radio group, not a row of buttons. There are only ever a handful of options,
 * all worth seeing at once, and a native `<select>` on Android opens a modal
 * sheet for what should be a single tap. `role="radio"` + `aria-checked` is what
 * makes the selection audible; the raised chip is the visual half of the same
 * fact, never the only half.
 *
 * Kept generic over the option value so callers get their own union back rather
 * than a bare string.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  className,
  testId,
}: {
  /** Names the group for assistive tech. Required — this is a control. */
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-busy={disabled || undefined}
      data-testid={testId}
      className={cn('inline-flex gap-0.5 rounded-full bg-mute p-[3px]', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            data-testid={testId ? `${testId}-${option.value}` : undefined}
            onClick={() => !selected && onChange(option.value)}
            className={cn(
              'min-h-[38px] rounded-full px-4 font-display text-[0.813rem] font-semibold transition-colors disabled:opacity-50',
              selected
                ? 'bg-surface text-brand-600 shadow-card'
                : 'text-ink-500 hover:text-ink-900',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
