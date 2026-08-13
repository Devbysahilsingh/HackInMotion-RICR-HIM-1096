import type { ReactNode } from 'react';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { BrowserRouter } from 'react-router-dom';

import { createQueryClient } from '@/api/queryClient';
import { AuthProvider } from '@/auth/AuthContext';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { ToastProvider } from '@/components/ui/Toast';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { initI18n } from '@/i18n';

/**
 * Provider composition, in one place so tests can mount the same stack the app
 * runs in (`src/test/render.tsx` reuses this).
 *
 * Nesting order is load-bearing:
 *   ErrorBoundary  — must be outermost to catch a provider's own crash
 *   i18n           — every layer below it renders text
 *   Query          — AuthProvider clears the cache on sign-out, so it needs it
 *   Auth           — LanguageProvider adopts `user.language`
 *   Language
 *   Router         — guards read auth state, so it comes after Auth
 */
export function AppProviders({
  children,
  queryClient,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
}) {
  const i18n = initI18n();
  const client = queryClient ?? defaultClient();

  return (
    <AppErrorBoundary>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <LanguageProvider>
              <ToastProvider>
                <BrowserRouter>{children}</BrowserRouter>
              </ToastProvider>
            </LanguageProvider>
          </AuthProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </AppErrorBoundary>
  );
}

let singleton: QueryClient | null = null;

/** One client per page load; re-creating it on a re-render would drop the cache. */
function defaultClient(): QueryClient {
  singleton ??= createQueryClient();
  return singleton;
}
