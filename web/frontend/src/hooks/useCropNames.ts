import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

import { registryApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import { useLanguage } from '@/i18n/LanguageContext';
import { localizedName } from '@/lib/format';

/**
 * Canonical crop/commodity code → display name in the active language.
 *
 * Codes like `ONION` are identifiers, never labels (CLAUDE.md rule 4): a Hindi
 * screen must say प्याज. The bilingual names live in the crop registry, which
 * is public, cached for a week, and already fetched by the crop form — so this
 * lookup costs nothing extra in practice.
 *
 * A code the registry does not carry falls back to title case ("Green
 * Chilli") — a formatting of the provider's own id, never an invented
 * translation.
 */
export function useCropNames(): (code: string) => string {
  const { language } = useLanguage();

  const registryQuery = useQuery({
    queryKey: queryKeys.registry.list(),
    queryFn: registryApi.list,
    staleTime: STALE_TIME.registry,
  });

  const crops = registryQuery.data?.data.crops;

  return useCallback(
    (code: string) => {
      const names = crops?.find((crop) => crop.cropCode === code)?.names ?? null;
      return localizedName(names, language)?.text ?? titleCaseCode(code);
    },
    [crops, language],
  );
}

/**
 * Replaces a canonical `cropCode` interpolation param with its display name,
 * if present — feed/history strings say "reported this on {{cropCode}}", and
 * ids never reach a farmer's screen.
 */
export function localizeCropParams(
  data: Record<string, unknown> | null | undefined,
  cropName: (code: string) => string,
): Record<string, unknown> | undefined {
  if (typeof data?.cropCode !== 'string') return data ?? undefined;
  return { ...data, cropCode: cropName(data.cropCode) };
}

/** `GREEN CHILLI` → `Green Chilli` — a readable form of an unknown code. */
export function titleCaseCode(code: string): string {
  return code
    .toLowerCase()
    .replace(/[_]+/g, ' ')
    .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}
