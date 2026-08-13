import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { registryApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { RegistryDisease } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { localizedName } from '@/lib/format';

/**
 * A disease's name, from the registry.
 *
 * The health API returns a `diseaseCode` and no name — names live in
 * `cropRegistry.diseases[].names`, which is a public read. Looking it up here
 * costs one cached request per crop (7-day `staleTime`) and keeps the code out
 * of the farmer's face.
 *
 * ## The Hindi gap, shown rather than papered over
 *
 * Every disease name in the registry has `hi: null` today: no Hindi-language
 * official source has been fetched, and CLAUDE.md rule 8 forbids translating
 * agronomic terms without one. So on a Hindi screen the English name appears,
 * and it is **labelled** as an unverified fallback instead of quietly mixing
 * scripts as though it were translated. That label is the honest form of a
 * gap that a human reviewer has to close.
 */
export function DiseaseName({
  code,
  cropCode,
  showFallbackNote = false,
}: {
  code: string | null | undefined;
  /** Narrows the registry lookup; without it the code's own prefix is used. */
  cropCode?: string;
  showFallbackNote?: boolean;
}) {
  const { t } = useTranslation(['health', 'agri']);
  const { language } = useLanguage();

  const resolvedCropCode = cropCode ?? code?.split('_')[0] ?? '';

  const { data } = useQuery({
    queryKey: queryKeys.registry.crop(resolvedCropCode),
    queryFn: () => registryApi.get(resolvedCropCode),
    enabled: Boolean(resolvedCropCode) && Boolean(code) && code !== 'UNKNOWN',
    staleTime: STALE_TIME.registry,
    // A missing registry entry is not an error worth surfacing here: the code
    // itself is a usable fallback.
    retry: false,
  });

  if (!code || code === 'UNKNOWN') return <>{t('health:diseaseUnknownName')}</>;

  const diseases = (data?.crop?.diseases ?? []) as RegistryDisease[];
  const entry = diseases.find((disease) => disease.code === code);
  const name = localizedName(entry?.names ?? null, language);

  if (!name) return <>{code}</>;

  return (
    <>
      {name.text}
      {name.isFallback && showFallbackNote && (
        <span className="ml-2 text-xs font-normal text-ink-500">{t('agri:nameHindiMissing')}</span>
      )}
    </>
  );
}
