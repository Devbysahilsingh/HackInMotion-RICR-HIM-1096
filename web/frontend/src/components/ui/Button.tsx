import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant =
  'primary' | 'secondary' | 'ghost' | 'danger' | 'onDark' | 'onDarkOutline';
export type ButtonSize = 'md' | 'lg';

/**
 * Tones follow the design reference's button family: a solid forest primary, a
 * white-on-line secondary that warms to leaf on hover, and a text-only ghost.
 * The secondary's leaf hover is the one deliberate borrowing — it is what keeps
 * a row of secondary buttons from reading as disabled.
 *
 * `onDark` / `onDarkOutline` are the reference's `.b-w` and the inline
 * white-bordered button, and they exist because the decision band, the farm and
 * crop heroes and the irrigation verdict are all deep forest surfaces. A
 * `primary` button on those is forest-on-forest — the shape disappears and the
 * farmer's main action with it. Pairing them (one filled, one outlined) is also
 * what keeps a band's two actions ranked instead of competing.
 */
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-500 active:bg-brand-800 border-brand-600',
  secondary: 'bg-surface text-ink-900 border-line hover:border-leaf-500 hover:bg-leaf-tint',
  ghost: 'bg-transparent text-brand-600 hover:underline border-transparent',
  danger: 'bg-danger-600 text-white hover:brightness-110 border-danger-600',
  onDark: 'bg-white text-brand-600 border-white hover:bg-leaf-tint',
  onDarkOutline: 'bg-transparent text-white border-white/45 hover:bg-white/10',
};

const SIZE: Record<ButtonSize, string> = {
  md: 'px-[18px] py-2.5 text-sm',
  lg: 'px-6 py-3 text-base',
};

/**
 * Fully rounded, and in the display face.
 *
 * Both come from the reference and both are load-bearing rather than
 * decorative: the pill is what distinguishes an action from the 14px-radius
 * cards it sits on, and the heavier display face at 600 is what lets a button
 * hold its own against headings set at 800. `touch-target` keeps the 44px
 * minimum regardless of the label's length (accessibility.md).
 */
const BASE =
  'touch-target inline-flex items-center justify-center gap-2 rounded-full border font-display ' +
  'font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Renders the spinner and disables the control. */
  isLoading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, CommonProps {}

/**
 * The one button.
 *
 * 44px minimum height comes from `.touch-target`, not from the padding, so a
 * short label cannot produce a control too small to hit with a work-worn thumb
 * (accessibility.md). The loading state keeps the label in place rather than
 * swapping it for a spinner — a button that changes width mid-press moves out
 * from under the finger.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    isLoading = false,
    fullWidth = false,
    leadingIcon,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(BASE, VARIANT[variant], SIZE[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {isLoading ? <Spinner size="sm" /> : leadingIcon}
      <span>{children}</span>
    </button>
  );
});

export interface ButtonLinkProps extends LinkProps, CommonProps {}

/** A link that looks like a button. Still a link — it navigates, so it is an `<a>`. */
export function ButtonLink({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  leadingIcon,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link
      className={cn(BASE, VARIANT[variant], SIZE[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {leadingIcon}
      <span>{children}</span>
    </Link>
  );
}
