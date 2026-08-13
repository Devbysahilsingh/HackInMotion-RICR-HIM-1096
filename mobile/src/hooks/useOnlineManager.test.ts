/**
 * What "online" means on a phone.
 *
 * The case worth a test is the one a boolean `isConnected` gets wrong: a
 * handset attached to a Wi-Fi access point with no upstream, or camped on a
 * tower that will not carry data. `isConnected` is true and the device is
 * useless — and this is the ordinary shape of rural connectivity, not an
 * exotic edge case. If React Query believed it, every query would burn its
 * full retry budget into nothing instead of pausing and resuming on reconnect
 * (RES-12).
 */
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';

import { useNetworkStatus, useOnlineManager } from './useOnlineManager';

type Listener = (state: NetInfoState) => void;

/** The callback `useOnlineManager` hands to NetInfo. */
function capturedListener(): Listener {
  const calls = jest.mocked(NetInfo.addEventListener).mock.calls;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('useOnlineManager never subscribed to NetInfo');
  return last[0] as Listener;
}

const state = (partial: Partial<NetInfoState>): NetInfoState => partial as NetInfoState;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(NetInfo.addEventListener).mockReturnValue(jest.fn());
  onlineManager.setOnline(true);
});

afterEach(() => {
  onlineManager.setEventListener(() => () => undefined);
  onlineManager.setOnline(true);
});

describe('useOnlineManager', () => {
  it('treats an unreachable internet as offline even while connected', () => {
    renderHook(() => useOnlineManager());

    capturedListener()(state({ isConnected: true, isInternetReachable: false }));

    expect(onlineManager.isOnline()).toBe(false);
  });

  it('reports online when the internet is reachable', () => {
    renderHook(() => useOnlineManager());

    capturedListener()(state({ isConnected: true, isInternetReachable: true }));

    expect(onlineManager.isOnline()).toBe(true);
  });

  it('falls back to isConnected when the platform cannot say', () => {
    renderHook(() => useOnlineManager());

    capturedListener()(state({ isConnected: false, isInternetReachable: null }));
    expect(onlineManager.isOnline()).toBe(false);

    capturedListener()(state({ isConnected: true, isInternetReachable: null }));
    expect(onlineManager.isOnline()).toBe(true);
  });
});

describe('useNetworkStatus', () => {
  it('starts unknown, so nothing claims the farmer is offline before NetInfo answers', () => {
    jest.mocked(NetInfo.fetch).mockReturnValue(new Promise(() => undefined) as never);

    const { result } = renderHook(() => useNetworkStatus());

    expect(result.current).toEqual({ online: true, known: false });
  });

  it('marks the status known once NetInfo answers, and honours isInternetReachable', async () => {
    jest
      .mocked(NetInfo.fetch)
      .mockResolvedValue(state({ isConnected: true, isInternetReachable: false }) as never);

    const { result } = renderHook(() => useNetworkStatus());

    await waitFor(() => expect(result.current.known).toBe(true));
    expect(result.current.online).toBe(false);
  });
});
