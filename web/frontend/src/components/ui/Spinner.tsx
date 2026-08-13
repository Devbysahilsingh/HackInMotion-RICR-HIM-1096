import { cn } from '@/lib/cn';

const SIZE = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' } as const;

/**
 * Purely decorative: it is always accompanied by text elsewhere in the
 * component that owns it (a button label, a `QueryBoundary` skeleton), so it
 * is hidden from assistive technology rather than announcing "loading" twice.
 */
export function Spinner({
  size = 'md',
  className,
}: {
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <svg
      className={cn('animate-spin', SIZE[size], className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
