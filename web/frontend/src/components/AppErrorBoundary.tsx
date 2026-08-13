import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';

/**
 * The last line of defence: a rendering bug anywhere below this becomes a
 * localized page with a way out, not a white screen.
 *
 * The error itself is logged to the console for a developer and is **never**
 * put on screen — a stack trace tells a farmer nothing and can leak internal
 * paths (docs/security/api-security.md keeps the same rule server-side).
 *
 * A class component because React offers no hook equivalent of
 * `componentDidCatch`.
 */
interface State {
  hasError: boolean;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled rendering error', error, info.componentStack);
  }

  private readonly reset = () => this.setState({ hasError: false });

  override render(): ReactNode {
    if (this.state.hasError) return <CrashScreen onReset={this.reset} />;
    return this.props.children;
  }
}

function CrashScreen({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation(['errors', 'common']);

  return (
    <main
      role="alert"
      data-testid="app-crash"
      className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 className="text-xl font-semibold">{t('common:state.error')}</h1>
      <p className="text-sm text-ink-500">{t('errors:unexpected')}</p>
      <div className="flex gap-2">
        <Button onClick={onReset}>{t('common:action.retry')}</Button>
        <Button variant="secondary" onClick={() => window.location.assign('/')}>
          {t('common:nav.dashboard')}
        </Button>
      </div>
    </main>
  );
}
