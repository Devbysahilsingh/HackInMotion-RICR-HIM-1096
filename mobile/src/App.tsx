/**
 * Application root: providers, boot sequence, and nothing else.
 *
 * The boot order is deliberate. Language is resolved *before* the first render
 * so a Hindi-speaking farmer never sees a frame of English — the stored choice
 * lives in AsyncStorage, which is asynchronous, so the app holds on a neutral
 * splash rather than rendering twice. Only then does i18n initialise, and only
 * then do the session and cache providers mount.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { I18nextProvider } from 'react-i18next';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { QueryClient } from '@tanstack/react-query';

import type { Language } from '@shared/types/api';

import {
  CACHE_MAX_AGE_MS,
  createQueryClient,
  queryPersister,
  shouldPersistQuery,
} from './api/queryClient';
import { deviceLanguage, i18next, initI18n, loadStoredLanguage } from './i18n';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { OfflineBanner } from './components/OfflineBanner';
import { RootNavigator } from './navigation/RootNavigator';
import { AuthProvider } from './store/AuthContext';
import { LanguageProvider } from './store/LanguageContext';
import { useAppStateRefetch } from './hooks/useAppStateRefetch';
import { useOnlineManager } from './hooks/useOnlineManager';
import { usePrefetchRegistry } from './hooks/usePrefetchRegistry';
import { colors } from './theme';

interface Boot {
  language: Language;
  /** False on the very first launch — the language screen leads in that case. */
  languageChosen: boolean;
  queryClient: QueryClient;
}

export default function App() {
  const [boot, setBoot] = useState<Boot | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await loadStoredLanguage();
      const language = stored ?? deviceLanguage();
      initI18n(language);

      if (!cancelled) {
        setBoot({ language, languageChosen: stored !== null, queryClient: createQueryClient() });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!boot) {
    // Brand-coloured, wordless: there is no language yet, so there is nothing
    // honest to say here.
    return (
      <View style={styles.splash}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={colors.brand600} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <I18nextProvider i18n={i18next}>
        <PersistQueryClientProvider
          client={boot.queryClient}
          persistOptions={{
            persister: queryPersister,
            maxAge: CACHE_MAX_AGE_MS,
            dehydrateOptions: {
              shouldDehydrateQuery: (query) => shouldPersistQuery(query.state.status),
            },
          }}
        >
          <LanguageProvider initialLanguage={boot.language}>
            <AuthProvider>
              <AppErrorBoundary>
                <NetworkBridge />
                <StatusBar style="dark" />
                <NavigationContainer>
                  <OfflineBanner />
                  <RootNavigator languageChosen={boot.languageChosen} />
                </NavigationContainer>
              </AppErrorBoundary>
            </AuthProvider>
          </LanguageProvider>
        </PersistQueryClientProvider>
      </I18nextProvider>
    </SafeAreaProvider>
  );
}

/**
 * The three app-global cache behaviours, mounted once, rendering nothing.
 *
 * - `useOnlineManager` teaches React Query what "online" means on a phone.
 *   Without it the library assumes the browser's `navigator.onLine`, which on
 *   React Native is always true — so a query would keep retrying into a dead
 *   radio instead of pausing and resuming on reconnect (RES-12).
 * - `useAppStateRefetch` is the foregrounding equivalent of the web's
 *   refetch-on-window-focus, which `api/queryClient.ts` switches off and defers
 *   to here.
 * - `usePrefetchRegistry` warms the crop registry into the persisted cache once
 *   per signed-in session, so the in-field screens have it with no signal.
 *
 * It sits inside `AuthProvider` because the prefetch is scoped to a session.
 */
function NetworkBridge() {
  useOnlineManager();
  useAppStateRefetch();
  usePrefetchRegistry();
  return null;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.canvas,
  },
});
