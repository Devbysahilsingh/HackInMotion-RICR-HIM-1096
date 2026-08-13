import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { IconAlertTriangle, IconCheck, IconX } from './icons';

export type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  /** Returns the toast id, so a caller can dismiss it early if it needs to. */
  push: (message: string, tone?: ToastTone) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DISMISS_AFTER_MS = 6000;

const TONE: Record<ToastTone, { className: string; Icon: typeof IconCheck }> = {
  success: { className: 'border-brand-300 bg-brand-50 text-brand-800', Icon: IconCheck },
  error: { className: 'border-danger-600/30 bg-danger-50 text-danger-600', Icon: IconAlertTriangle },
  info: { className: 'border-line bg-surface text-ink-700', Icon: IconCheck },
};

/**
 * Transient confirmations ("watering recorded", "advice dismissed").
 *
 * Deliberately not used for anything a farmer must act on: a toast disappears,
 * and a recommendation, an error that blocks a form, or a coverage notice all
 * have to stay on screen. Those render inline.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = 'success') => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current, { id, tone, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_AFTER_MS),
      );
      return id;
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  const { t } = useTranslation('common');

  return (
    <div
      // Polite: a confirmation should not interrupt whatever is being read.
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6"
    >
      {toasts.map((toast) => {
        const { Icon } = TONE[toast.tone];
        return (
          <div
            key={toast.id}
            data-testid="toast"
            data-tone={toast.tone}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border px-4 py-3 text-sm shadow-lg',
              TONE[toast.tone].className,
            )}
          >
            <Icon size={18} />
            <span className="min-w-0 flex-1">{toast.message}</span>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label={t('action.close')}
              className="shrink-0 rounded p-0.5 hover:opacity-70"
            >
              <IconX size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
