/**
 * Token custody.
 *
 * The property being asserted is not "the getters work" — it is the storage
 * *split* docs/mobile/authentication.md commits to: the refresh token only ever
 * reaches SecureStore (Keystore-backed), and the access token only ever reaches
 * JS memory. AsyncStorage holds the Query cache and is plain text in the app
 * sandbox; a long-lived credential landing there is the whole threat this
 * module exists to prevent, so it is tested rather than assumed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

import {
  clearRefreshToken,
  emitSessionLost,
  getAccessToken,
  getRefreshToken,
  onSessionLost,
  setAccessToken,
  setRefreshToken,
} from './session';

const REFRESH_TOKEN_KEY = 'him1096.refreshToken';

beforeEach(() => {
  jest.clearAllMocks();
  setAccessToken(null);
});

describe('access token custody', () => {
  it('lives in memory and is never written to AsyncStorage', async () => {
    setAccessToken('access-abc');

    expect(getAccessToken()).toBe('access-abc');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it('is cleared by setAccessToken(null)', () => {
    setAccessToken('access-abc');
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });
});

describe('refresh token custody', () => {
  it('round-trips through SecureStore only', async () => {
    await setRefreshToken('refresh-abc');

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      REFRESH_TOKEN_KEY,
      'refresh-abc',
      expect.objectContaining({ keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }),
    );
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    await expect(getRefreshToken()).resolves.toBe('refresh-abc');
  });

  it('clears', async () => {
    await setRefreshToken('refresh-abc');
    await clearRefreshToken();

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(REFRESH_TOKEN_KEY);
    await expect(getRefreshToken()).resolves.toBeNull();
  });

  it('reads a Keystore failure as "no token" rather than throwing', async () => {
    jest
      .mocked(SecureStore.getItemAsync)
      .mockRejectedValueOnce(new Error('keystore unwrap failed'));

    await expect(getRefreshToken()).resolves.toBeNull();
  });

  it('swallows a delete failure — there is nothing left to clear either way', async () => {
    jest.mocked(SecureStore.deleteItemAsync).mockRejectedValueOnce(new Error('unreadable'));
    await expect(clearRefreshToken()).resolves.toBeUndefined();
  });
});

describe('session-lost broadcast', () => {
  it('drops the access token and notifies every listener with the reason', () => {
    const first = jest.fn();
    const second = jest.fn();
    const offFirst = onSessionLost(first);
    const offSecond = onSessionLost(second);

    setAccessToken('access-abc');
    emitSessionLost('refresh_failed');

    expect(getAccessToken()).toBeNull();
    expect(first).toHaveBeenCalledWith('refresh_failed');
    expect(second).toHaveBeenCalledWith('refresh_failed');

    offFirst();
    offSecond();
  });

  it('stops notifying after unsubscribe', () => {
    const listener = jest.fn();
    onSessionLost(listener)();

    emitSessionLost('logout');

    expect(listener).not.toHaveBeenCalled();
  });
});
