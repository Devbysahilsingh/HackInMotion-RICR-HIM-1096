/**
 * Device location, with every failure named.
 *
 * The mobile counterpart of `web/frontend/src/hooks/useGeolocation.ts`, and
 * deliberately the same shape: one `locate()`, one `coordinates`, one named
 * `error`, and no path where a failure blocks the form. The farm form's manual
 * district entry is the primary route — this hook only ever fills two fields
 * that stay editable afterwards.
 *
 * Three things differ from the browser version, and all three come from the
 * platform rather than from taste:
 *
 *  - **The permission is requested here, in context.** The browser prompts as
 *    a side effect of `getCurrentPosition`; Android needs an explicit request,
 *    and docs/mobile asks for the rationale to be on screen *before* the OS
 *    sheet appears. The screen renders that rationale; this hook is what the
 *    button then calls.
 *  - **The device switch is checked first.** A phone with location services
 *    turned off will happily grant the permission and then never produce a
 *    fix, which reads to a farmer as the app hanging. That is reported as
 *    `unavailable`, not as a denial they could fix in the app.
 *  - **There is no `not-supported`.** Every Android handset this ships to has
 *    a location provider; the browser's "this browser cannot" case has no
 *    honest mobile equivalent, so it is absent rather than mistranslated.
 *
 * `getCurrentPositionAsync` carries no timeout of its own, so one is imposed:
 * indoors, under a tin roof, a GPS lock can simply never arrive, and a spinner
 * that never resolves is worse than a named failure with a manual fallback.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

import { INDIA_BOUNDS } from '@shared/types/api';

export type GeolocationErrorKind = 'denied' | 'unavailable' | 'timeout' | 'outside-india';

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface GeolocationState {
  isLocating: boolean;
  coordinates: Coordinates | null;
  error: GeolocationErrorKind | null;
  /**
   * True only when Android has stopped asking — the one case where the app
   * cannot re-prompt and the OS settings screen is genuinely the way out.
   * Offering "open settings" on a first, recoverable refusal would send a
   * farmer into a system menu they never needed.
   */
  mustOpenSettings: boolean;
  locate: () => void;
  clear: () => void;
}

const TIMEOUT_MS = 15_000;

const withinIndia = ({ lat, lon }: Coordinates): boolean =>
  lat >= INDIA_BOUNDS.minLat &&
  lat <= INDIA_BOUNDS.maxLat &&
  lon >= INDIA_BOUNDS.minLon &&
  lon <= INDIA_BOUNDS.maxLon;

class LocationTimeout extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LocationTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function useGeolocation(): GeolocationState {
  const [isLocating, setIsLocating] = useState(false);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [error, setError] = useState<GeolocationErrorKind | null>(null);
  const [mustOpenSettings, setMustOpenSettings] = useState(false);

  /*
   * A fix can take the full timeout to arrive, which is long enough for the
   * farmer to press Back. Writing state into an unmounted screen is harmless
   * but noisy; the generation counter also discards the result of a stale
   * attempt when `locate()` is pressed twice.
   */
  const attempt = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const locate = useCallback(() => {
    const current = ++attempt.current;
    const isCurrent = () => alive.current && attempt.current === current;

    setIsLocating(true);
    setError(null);
    setMustOpenSettings(false);

    void (async () => {
      try {
        if (!(await Location.hasServicesEnabledAsync())) {
          if (isCurrent()) {
            setIsLocating(false);
            setCoordinates(null);
            setError('unavailable');
          }
          return;
        }

        const permission = await Location.requestForegroundPermissionsAsync();

        if (permission.status !== Location.PermissionStatus.GRANTED) {
          if (isCurrent()) {
            setIsLocating(false);
            setCoordinates(null);
            setError('denied');
            setMustOpenSettings(!permission.canAskAgain);
          }
          return;
        }

        const position = await withTimeout(
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
          TIMEOUT_MS,
        );

        if (!isCurrent()) return;

        const next: Coordinates = {
          // Six decimals is ~0.1m — more precision than a phone has, and more
          // than the 0.1° weather grid can use.
          lat: Number(position.coords.latitude.toFixed(6)),
          lon: Number(position.coords.longitude.toFixed(6)),
        };

        setIsLocating(false);

        if (!withinIndia(next)) {
          // The same bounds the server's farm schema enforces, so catching it
          // here turns a 422 into an explanation.
          setCoordinates(null);
          setError('outside-india');
          return;
        }

        setCoordinates(next);
      } catch (thrown) {
        if (!isCurrent()) return;
        setIsLocating(false);
        setCoordinates(null);
        setError(thrown instanceof LocationTimeout ? 'timeout' : 'unavailable');
      }
    })();
  }, []);

  const clear = useCallback(() => {
    // Also invalidates any in-flight attempt: a cleared field must not be
    // refilled a moment later by a fix the farmer has already dismissed.
    attempt.current += 1;
    setIsLocating(false);
    setCoordinates(null);
    setError(null);
    setMustOpenSettings(false);
  }, []);

  return { isLocating, coordinates, error, mustOpenSettings, locate, clear };
}
