import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { registryApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { useLanguage } from '@/i18n/LanguageContext';
import { localizedName } from '@/lib/format';

/**
 * What the system can actually check for the crop about to be photographed.
 *
 * The single most useful thing to say before a farmer takes a picture, and it
 * is entirely real: `GET /registry/crops?code=` returns that crop's
 * `supportLevel`, whether a local model covers it (`mlSupported`), and the
 * conditions the sourced knowledge base holds for it (`diseases`). Counting
 * those is counting rows, not estimating coverage.
 *
 * It also sets expectations honestly, which matters more here than anywhere
 * else in the product: a crop with no registry entry gets a result the chain
 * can barely support, and saying so *before* the photograph is taken is worth
 * more than a coverage notice attached to a disappointing answer afterwards.
 */
export function ScanCoverage({ cropCode }: { cropCode: string | null }) {
  const { t } = useTranslation(['health', 'agri', 'common']);
  const { language } = useLanguage();

  const query = useQuery({
    queryKey: queryKeys.registry.crop(cropCode ?? ''),
    queryFn: () => registryApi.get(cropCode!),
    enabled: Boolean(cropCode),
    staleTime: STALE_TIME.registry,
    // A crop the registry does not carry is a real answer, not an error.
    retry: false,
  });

  if (!cropCode || query.isPending) return null;

  const registry = query.data?.crop ?? null;
  const name = localizedName(registry?.names ?? null, language)?.text ?? cropCode;
  const conditions = registry?.diseases?.length ?? 0;
  const supportLevel = registry?.supportLevel ?? 'UNSUPPORTED';

  return (
    <Card className="h-full p-5" data-testid="scan-coverage" data-crop-code={cropCode}>
      <p className="kicker">{t('health:coverageHeading', { crop: name })}</p>

      {conditions === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-ink-700">{t('health:coverageNone')}</p>
      ) : (
        <>
          <p className="mt-2.5 font-display text-[1.75rem] font-extrabold leading-none tracking-[-0.03em]">
            {t('health:coverageConditions', { count: conditions })}
          </p>
          <p className="mt-2.5 text-sm leading-relaxed text-ink-500">
            {registry?.mlSupported
              ? t('health:coverageLocalModel')
              : t('health:coverageNoLocalModel')}
          </p>
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={supportLevel === 'UNSUPPORTED' ? 'warning' : 'brand'}>
          {t(`agri:support.${supportLevel}`)}
        </Badge>
      </div>
    </Card>
  );
}
