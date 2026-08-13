import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';

import { AuthProvider } from '@/auth/AuthContext';
import { ToastProvider } from '@/components/ui/Toast';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { initI18n } from '@/i18n';
import type { Language } from '@/api/types';

/**
 * Mounts a component inside the same provider stack `providers.tsx` builds, so
 * a test exercises the real i18n instance, the real auth bootstrap and the real
 * Query client rather than a parallel arrangement that could drift from it.
 *
 * `MemoryRouter` replaces `BrowserRouter`: it is the only substitution, and it
 * exists so a test can start at any URL.
 */
export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  route?: string;
  language?: Language;
  queryClient?: QueryClient;
}

/**
 * Every client a test creates, so `resetTestQueryClients()` can cancel their
 * in-flight fetches at teardown. Without that, a query still resolving when
 * msw stops listening escapes to the real network and jsdom logs a connection
 * error that looks like a test failure but is not one.
 */
const testClients = new Set<QueryClient>();

export function createTestQueryClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: {
      // Deterministic and fast: a retrying query would make a failure test wait
      // through two backoffs before asserting the error state.
      queries: { retry: false, gcTime: Infinity, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  testClients.add(client);
  return client;
}

export function resetTestQueryClients(): void {
  for (const client of testClients) {
    client.cancelQueries();
    client.clear();
    client.unmount();
  }
  testClients.clear();
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', language = 'en', queryClient, ...options }: RenderWithProvidersOptions = {},
): RenderResult & { queryClient: QueryClient } {
  const client = queryClient ?? createTestQueryClient();
  testClients.add(client);
  const i18n = initI18n();
  void i18n.changeLanguage(language);

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <LanguageProvider>
              <ToastProvider>
                <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
              </ToastProvider>
            </LanguageProvider>
          </AuthProvider>
        </QueryClientProvider>
      </I18nextProvider>
    );
  }

  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient: client };
}
