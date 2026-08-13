/**
 * The failure taxonomy, not the happy path.
 *
 * What is being asserted here is that every way a location request can fail
 * gets its own name, because the farm form renders a different sentence for
 * each one and falls through to manual district entry in all of them. A hook
 * that collapsed "you refused" into "no fix right now" would send a farmer
 * looking for a signal instead of into their phone's settings — and one that
 * accepted a coordinate outside India would trade a legible refusal for a 422
 * from the server's own `INDIA_BOUNDS` check.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';

import { useGeolocation } from './useGeolocation';

jest.mock('expo-location', () => ({
  PermissionStatus: { GRANTED: 'granted', DENIED: 'denied', UNDETERMINED: 'undetermined' },
  Accuracy: { High: 4 },
  hasServicesEnabledAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
}));

const hasServices = jest.mocked(Location.hasServicesEnabledAsync);
const requestPermission = jest.mocked(Location.requestForegroundPermissionsAsync);
const getPosition = jest.mocked(Location.getCurrentPositionAsync);

/** Only the two fields this hook reads; the real object is far larger. */
const positionAt = (latitude: number, longitude: number) =>
  ({ coords: { latitude, longitude } }) as Awaited<ReturnType<typeof getPosition>>;

const granted = { status: Location.PermissionStatus.GRANTED, canAskAgain: true } as Awaited<
  ReturnType<typeof requestPermission>
>;

const refused = (canAskAgain: boolean) =>
  ({ status: Location.PermissionStatus.DENIED, canAskAgain }) as Awaited<
    ReturnType<typeof requestPermission>
  >;

beforeEach(() => {
  jest.clearAllMocks();
  hasServices.mockResolvedValue(true);
  requestPermission.mockResolvedValue(granted);
});

describe('a successful fix', () => {
  it('returns coordinates rounded to six decimals', async () => {
    // Nashik, with more precision than any handset actually has.
    getPosition.mockResolvedValue(positionAt(19.99727312, 73.78980121));

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.locate());

    await waitFor(() => expect(result.current.isLocating).toBe(false));

    expect(result.current.coordinates).toEqual({ lat: 19.997273, lon: 73.789801 });
    expect(result.current.error).toBeNull();
  });

  it('asks for the permission only after checking the device switch', async () => {
    getPosition.mockResolvedValue(positionAt(19.99, 73.78));

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.locate());

    await waitFor(() => expect(result.current.coordinates).not.toBeNull());
    expect(hasServices).toHaveBeenCalled();
    expect(requestPermission).toHaveBeenCalled();
  });
});

describe('each failure keeps its own name', () => {
  it('reports location services being off as unavailable, not as a refusal', async () => {
    hasServices.mockResolvedValue(false);

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.locate());

    await waitFor(() => expect(result.current.error).toBe('unavailable'));
    // Granting a permission the OS cannot honour would produce a spinner that
    // never resolves, so the permission is never requested in this branch.
    expect(requestPermission).not.toHaveBeenCalled();
    expect(result.current.coordinates).toBeNull();
  });

  it('reports a refusal as denied, without offering settings while it can re-ask', async () => {
    requestPermission.mockResolvedValue(refused(true));

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.locate());

    await waitFor(() => expect(result.current.error).toBe('denied'));
    expect(result.current.mustOpenSettings).toBe(false);
    expect(getPosition).not.toHaveBeenCalled();
  });

  it('offers settings only once Android has stopped asking', async () => {
    requestPermission.mockResolvedValue(refused(false));

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.locate());

    await waitFor(() => expect(result.current.mustOpenSettings).toBe(true));
    expect(result.current.error).toBe('denied');
  });

  it('reports a fix that never arrives as a timeout', async () => {
    jest.useFakeTimers();
    // Never settles — a GPS lock that cannot be had indoors.
    getPosition.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.locate());

    // Let the services + permission awaits flush before the clock moves.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(20_000);
    });

    await waitFor(() => expect(result.current.error).toBe('timeout'));
    expect(result.current.isLocating).toBe(false);
    jest.useRealTimers();
  });

  it('reports a provider error as unavailable', async () => {
    getPosition.mockRejectedValue(new Error('no provider'));

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.locate());

    await waitFor(() => expect(result.current.error).toBe('unavailable'));
    expect(result.current.coordinates).toBeNull();
  });
});

describe('the India bounds check', () => {
  it('refuses a position outside India rather than letting the server 422 it', async () => {
    /**
     * Dubai. Deliberately far outside, because `INDIA_BOUNDS` is a rectangle
     * rather than a border: Kathmandu, Colombo and most of Bangladesh all sit
     * *inside* it, so a neighbouring capital proves nothing about this check.
     * The rectangle is what the server enforces, and this asserts the client
     * agrees with it — not that it knows where India ends.
     */
    getPosition.mockResolvedValue(positionAt(25.2048, 55.2708));

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.locate());

    await waitFor(() => expect(result.current.error).toBe('outside-india'));
    expect(result.current.coordinates).toBeNull();
  });

  it('accepts a position on the boundary', async () => {
    getPosition.mockResolvedValue(positionAt(6, 68));

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.locate());

    await waitFor(() => expect(result.current.coordinates).toEqual({ lat: 6, lon: 68 }));
    expect(result.current.error).toBeNull();
  });
});

describe('clear', () => {
  it('drops the fix and the error together', async () => {
    getPosition.mockResolvedValue(positionAt(19.99, 73.78));

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.locate());
    await waitFor(() => expect(result.current.coordinates).not.toBeNull());

    act(() => result.current.clear());

    expect(result.current.coordinates).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('discards a fix that lands after it', async () => {
    let settle: (value: Awaited<ReturnType<typeof getPosition>>) => void = () => {};
    getPosition.mockReturnValue(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );

    const { result } = renderHook(() => useGeolocation());
    act(() => result.current.locate());
    act(() => result.current.clear());

    await act(async () => {
      settle(positionAt(19.99, 73.78));
      await Promise.resolve();
    });

    // A cleared field must not be refilled by a fix already dismissed.
    expect(result.current.coordinates).toBeNull();
  });
});
