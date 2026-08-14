/**
 * Active-farm state — the sidebar's farm switcher and every farm-dependent
 * page share this one source of truth (routes.md pattern: same shape as
 * `LanguageContext`, ADR-014's "small context, not a store" rule).
 *
 * ## Why this is not authorization
 *
 * The selected id is a UI preference, persisted to `localStorage` purely so a
 * refresh does not silently jump back to a different farm. It is never sent
 * to the server as a claim of ownership — every farm-scoped request still
 * goes through the same `loadOwned`-guarded endpoints it always did, which
 * verify ownership from the access token on every call. A stale or foreign id
 * left over in storage (a shared device, a deleted farm) simply fails to
 * match anything in the account's own farm list below and is replaced —
 * never trusted as-is.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery } from '@tanstack/react-query';

import { farmsApi } from '@/api/endpoints';
import { queryKeys } from '@/api/queryKeys';
import type { Farm } from '@/api/types';

const ACTIVE_FARM_STORAGE_KEY = 'him1096.activeFarmId';

export interface ActiveFarmContextValue {
  /** The account's own farms — real data, not filtered or reordered here. */
  farms: Farm[];
  /** Null until the farm list has loaded and resolved to a real farm. */
  activeFarmId: string | null;
  activeFarm: Farm | null;
  setActiveFarmId: (farmId: string) => void;
  /** True only while the farm list itself is loading — not a per-page flag. */
  isLoading: boolean;
}

const ActiveFarmContext = createContext<ActiveFarmContextValue | null>(null);

const readStoredFarmId = (): string | null => {
  try {
    return window.localStorage.getItem(ACTIVE_FARM_STORAGE_KEY);
  } catch {
    // Private-mode Safari throws on localStorage access — same tolerance
    // LanguageContext gives this. No stored preference is recoverable.
    return null;
  }
};

export function ActiveFarmProvider({ children }: { children: ReactNode }) {
  const farmsQuery = useQuery({ queryKey: queryKeys.farms.list(), queryFn: farmsApi.list });
  const farms = useMemo(() => farmsQuery.data?.farms ?? [], [farmsQuery.data]);

  const [selectedId, setSelectedId] = useState<string | null>(() => readStoredFarmId());

  const setActiveFarmId = useCallback((farmId: string) => {
    setSelectedId(farmId);
    try {
      window.localStorage.setItem(ACTIVE_FARM_STORAGE_KEY, farmId);
    } catch {
      // Preference simply will not survive the tab. Switching still works.
    }
  }, []);

  // Recovers from the account's own list rather than trusting storage
  // outright: a persisted id naming a farm this account no longer has (it
  // was deleted, or the value is left over from a different account on a
  // shared device) falls back to the first farm instead of pointing at
  // nothing.
  useEffect(() => {
    if (farms.length === 0) return;
    if (selectedId && farms.some((farm) => farm.id === selectedId)) return;
    setSelectedId(farms[0]!.id);
  }, [farms, selectedId]);

  const activeFarm = useMemo(
    () => farms.find((farm) => farm.id === selectedId) ?? null,
    [farms, selectedId],
  );

  const value = useMemo<ActiveFarmContextValue>(
    () => ({
      farms,
      activeFarmId: activeFarm?.id ?? null,
      activeFarm,
      setActiveFarmId,
      isLoading: farmsQuery.isPending,
    }),
    [farms, activeFarm, setActiveFarmId, farmsQuery.isPending],
  );

  return <ActiveFarmContext.Provider value={value}>{children}</ActiveFarmContext.Provider>;
}

export function useActiveFarm(): ActiveFarmContextValue {
  const context = useContext(ActiveFarmContext);
  if (!context) throw new Error('useActiveFarm must be used inside <ActiveFarmProvider>');
  return context;
}
