import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 border-brand-600',
  secondary: 'bg-surface text-brand-700 hover:bg-brand-50 border-brand-300',
  ghost: 'bg-transparent text-ink-700 hover:bg-brand-50 border-transparent',
  danger: 'bg-danger-600 text-white hover:brightness-110 border-danger-600',
};

const SIZE: Record<ButtonSize, string> = {
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3 text-base',
};

const BASE =
  'touch-target inline-flex items-center justify-center gap-2 rounded-lg border font-medium ' +
  'transition-colors disabled:cursor-not-allowed disabled:opacity-60';

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
