import { useId, useRef, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

/**
 * A tab strip following the WAI-ARIA tabs pattern: arrow keys move between
 * tabs, Home/End jump to the ends, and only the active tab is in the tab
 * order. The panel is rendered by the caller so a tab can own a route.
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the tab list — what these tabs are *of*. */
  label: string;
  className?: string;
}) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const move = (delta: number) => {
    const index = items.findIndex((item) => item.value === value);
    if (index === -1) return;
    const next = items[(index + delta + items.length) % items.length];
    if (next) {
      onChange(next.value);
      listRef.current
        ?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${baseId}-${next.value}`)}`)
        ?.focus();
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          move(1);
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          move(-1);
        } else if (event.key === 'Home') {
          event.preventDefault();
          const first = items[0];
          if (first) onChange(first.value);
        } else if (event.key === 'End') {
          event.preventDefault();
          const last = items[items.length - 1];
          if (last) onChange(last.value);
        }
      }}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            id={`${baseId}-${item.value}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`${baseId}-${item.value}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              'touch-target -mb-px inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium',
              selected
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-ink-500 hover:text-ink-700',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  children,
  className,
}: {
  id: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="tabpanel" id={id} tabIndex={0} className={cn('pt-4', className)}>
      {children}
    </div>
  );
}
