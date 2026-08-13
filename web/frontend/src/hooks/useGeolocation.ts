import { useCallback, useState } from 'react';

import { INDIA_BOUNDS } from '@/api/types';

export type GeolocationErrorKind =
  | 'not-supported'
  | 'denied'
  | 'unavailable'
  | 'timeout'
  | 'outside-india';

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface GeolocationState {
  isSupported: boolean;
  isLocating: boolean;
  coordinates: Coordinates | null;
  error: GeolocationErrorKind | null;
  locate: () => void;
  clear: () => void;
}

const TIMEOUT_MS = 15_000;

const withinIndia = ({ lat, lon }: Coordinates): boolean =>
  lat >= INDIA_BOUNDS.minLat &&
  lat <= INDIA_BOUNDS.maxLat &&
  lon >= INDIA_BOUNDS.minLon &&
  lon <= INDIA_BOUNDS.maxLon;

/**
 * Browser geolocation, with every failure named.
 *
 * The permission flow is one where "it just didn't work" is the usual outcome:
 * refused, no fix indoors, a slow GPS lock, or a VPN putting the device in
 * another country. Each of those gets its own error kind so the form can say
 * something a farmer can act on, and **all** of them fall through to the manual
 * district path rather than blocking the form (ux-flows.md: "GPS button …
 * + manual fallback").
 *
 * The India bounds check mirrors the server's: a coordinate outside them is
 * rejected by `INDIA_BOUNDS` in the farm schema, so catching it here turns a
 * 422 into an explanation.
 */
export function useGeolocation(): GeolocationState {
  const isSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

  const [isLocating, setIsLocating] = useState(false);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [error, setError] = useState<GeolocationErrorKind | null>(null);

  const locate = useCallback(() => {
    if (!isSupported) {
      setError('not-supported');
      return;
    }

    setIsLocating(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next: Coordinates = {
          // Six decimals is ~0.1m — more precision than a phone has, and more
          // than the 0.1° weather grid can use.
          lat: Number(position.coords.latitude.toFixed(6)),
          lon: Number(position.coords.longitude.toFixed(6)),
        };

        setIsLocating(false);

        if (!withinIndia(next)) {
          setCoordinates(null);
          setError('outside-india');
          return;
        }

        setCoordinates(next);
      },
      (positionError) => {
        setIsLocating(false);
        setCoordinates(null);
        setError(
          positionError.code === positionError.PERMISSION_DENIED
            ? 'denied'
            : positionError.code === positionError.TIMEOUT
              ? 'timeout'
              : 'unavailable',
        );
      },
      { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 60_000 },
    );
  }, [isSupported]);

  const clear = useCallback(() => {
    setCoordinates(null);
    setError(null);
  }, []);

  return { isSupported, isLocating, coordinates, error, locate, clear };
}
