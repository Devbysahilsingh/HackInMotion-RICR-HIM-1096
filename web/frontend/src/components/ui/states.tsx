import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { Button } from './Button';
import { IconAlertTriangle, IconInfo, IconLeaf } from './icons';

/**
 * The designed empty state — guidance plus a way forward, never a blank panel
 * (docs/frontend/ux-flows.md: "empty = designed guidance + CTA").
 */
export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-testid="empty-state"
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center',
        className,
      )}
    >
      <span className="text-brand-500" aria-hidden="true">
        {icon ?? <IconLeaf size={32} />}
      </span>
      <p className="text-base font-semibold text-ink-900">{title}</p>
      {body && <p className="max-w-prose text-sm text-ink-500">{body}</p>}
      {action}
    </div>
  );
}

/**
 * The designed error state — a localized message and a retry, never a stack
 * trace and never a raw status code (ux-flows.md, and the "no blank/cryptic
 * failures" requirement in docs/i18n/translation-strategy.md).
 */
export function ErrorState({
  title,
  message,
  onRetry,
  className,
}: {
  title?: ReactNode;
  message: ReactNode;
  onRetry?: () => void;
  className?: string;
}) {
  const { t } = useTranslation('common');

  return (
    <div
      data-testid="error-state"
      role="alert"
      className={cn(
        'flex flex-col items-start gap-3 rounded-xl border border-danger-600/30 bg-danger-50 px-5 py-5',
        className,
      )}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-danger-600">
        <IconAlertTriangle size={18} />
        {title ?? t('state.error')}
      </p>
      <p className="text-sm text-ink-700">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t('action.retry')}
        </Button>
      )}
    </div>
  );
}

export type NoticeTone = 'info' | 'warning' | 'danger';

const NOTICE_TONE: Record<NoticeTone, string> = {
  info: 'border-brand-200 bg-brand-50 text-brand-800',
  warning: 'border-priority-medium/30 bg-priority-medium-soft text-priority-medium',
  danger: 'border-danger-600/30 bg-danger-50 text-danger-600',
};

/**
 * An inline notice. Carries the coverage notices, the stale-cache banner and
 * the mandatory fertilizer disclaimer — all content the product is required to
 * show rather than optional decoration, so it is never dismissible.
 */
export function Notice({
  tone = 'info',
  icon,
  children,
  className,
  ...rest
}: {
  tone?: NoticeTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-testid="notice"
      data-tone={tone}
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm',
        NOTICE_TONE[tone],
        className,
      )}
      {...rest}
    >
      <span className="mt-0.5 shrink-0" aria-hidden="true">
        {icon ?? (tone === 'info' ? <IconInfo size={16} /> : <IconAlertTriangle size={16} />)}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
