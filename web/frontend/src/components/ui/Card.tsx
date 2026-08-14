import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/**
 * The 14px radius and the two-part shadow both come from the design reference.
 * The shadow is what makes a white card read as *placed on* the cream canvas
 * rather than cut out of it: a 1px contact edge plus a wide, high-offset
 * ambient. A single flat `shadow-sm` on a warm ground looks like a border.
 */
export function Card({ className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn('rounded-card border border-line bg-surface shadow-card', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children, ...rest }: CardProps) {
  return (
    <div className={cn('flex flex-wrap items-start gap-3 px-4 pt-4 sm:px-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardBody({ className, children, ...rest }: CardProps) {
  return (
    <div className={cn('px-4 py-4 sm:px-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn('flex flex-wrap gap-2 border-t border-line px-4 py-3 sm:px-5', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * A titled section inside a result or detail page. Heading level is a prop
 * because these nest under different page structures and the document outline
 * has to stay in order (accessibility.md: "logical heading order").
 */
export function Section({
  title,
  as: Heading = 'h2',
  action,
  children,
  className,
}: {
  title: ReactNode;
  as?: 'h2' | 'h3' | 'h4';
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Heading className="text-base sm:text-lg">{title}</Heading>
        {action}
      </div>
      {children}
    </section>
  );
}
