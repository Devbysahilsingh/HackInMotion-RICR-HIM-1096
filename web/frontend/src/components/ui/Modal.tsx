import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { Button } from './Button';
import { IconX } from './icons';

/**
 * A modal dialog / bottom sheet.
 *
 * Focus is moved into the dialog on open and returned to whatever opened it on
 * close; ESC closes; Tab is trapped inside. All three are requirements
 * (accessibility.md: "focus management", "ESC-closable modals"), and doing
 * them here once is what keeps every confirm dialog in the app correct.
 *
 * On narrow screens it renders as a bottom sheet, which is where a thumb is.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  labelledByTitle = true,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  labelledByTitle?: boolean;
}) {
  const { t } = useTranslation('common');
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    openerRef.current = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    // The first control, or the dialog itself when it holds only text.
    (focusables()[0] ?? dialogRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) return;

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/*
        The backdrop closes on click but is not a button: a screen-reader user
        has ESC and the labelled close control, and announcing a full-screen
        "close" target would be noise.
      */}
      <div className="absolute inset-0 bg-ink-900/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledByTitle ? titleId : undefined}
        tabIndex={-1}
        data-testid="modal"
        className={cn(
          'relative z-10 max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-surface shadow-xl',
          'sm:max-w-lg sm:rounded-2xl',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('action.close')}
            className="touch-target -mr-2 -mt-2 inline-flex items-center justify-center rounded-lg text-ink-500 hover:bg-canvas"
          >
            <IconX size={20} />
          </button>
        </div>

        <div className="px-5 py-4">{children}</div>

        {footer && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The destructive-action confirm. Used for farm and crop deletion, both of
 * which cascade, so the body text always says what else goes with it.
 */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  body,
  confirmLabel,
  isPending = false,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: ReactNode;
  body: ReactNode;
  confirmLabel?: ReactNode;
  isPending?: boolean;
}) {
  const { t } = useTranslation('common');

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={isPending}>
            {t('action.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm} isLoading={isPending}>
            {confirmLabel ?? t('action.delete')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink-700">{body}</p>
    </Modal>
  );
}
