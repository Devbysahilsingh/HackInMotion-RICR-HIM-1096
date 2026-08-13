/**
 * The write guard's one job: never claim the farmer is offline until the
 * device has actually said so, and always carry the explanation with the
 * refusal.
 */
import type { ReactNode } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { I18nextProvider } from 'react-i18next';
import { renderHook, waitFor } from '@testing-library/react-native';

import enMobile from '@shared/i18n/en/mobile.json';

import { initI18n, i18next } from '../i18n';
import { useOfflineWriteGuard } from './useOfflineWriteGuard';

const state = (partial: Partial<NetInfoState>): NetInfoState => partial as NetInfoState;

function wrapper({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18next}>{children}</I18nextProvider>;
}

beforeAll(() => {
  initI18n('en');
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(NetInfo.addEventListener).mockReturnValue(jest.fn());
});

it('blocks nothing before the first NetInfo event', () => {
  jest.mocked(NetInfo.fetch).mockReturnValue(new Promise(() => undefined) as never);

  const { result } = renderHook(() => useOfflineWriteGuard(), { wrapper });

  expect(result.current.blocked).toBe(false);
  expect(result.current.reason).toBeNull();
});

it('blocks and explains once the device reports no internet', async () => {
  jest
    .mocked(NetInfo.fetch)
    .mockResolvedValue(state({ isConnected: true, isInternetReachable: false }) as never);

  const { result } = renderHook(() => useOfflineWriteGuard(), { wrapper });

  await waitFor(() => expect(result.current.blocked).toBe(true));
  // The sentence is the canonical one, not a literal written at the call site.
  expect(result.current.reason).toBe(enMobile['offline.writeBlocked']);
});

it('allows writes when the internet is reachable', async () => {
  jest
    .mocked(NetInfo.fetch)
    .mockResolvedValue(state({ isConnected: true, isInternetReachable: true }) as never);

  const { result } = renderHook(() => useOfflineWriteGuard(), { wrapper });

  await waitFor(() => expect(result.current.online).toBe(true));
  expect(result.current.blocked).toBe(false);
  expect(result.current.reason).toBeNull();
});
