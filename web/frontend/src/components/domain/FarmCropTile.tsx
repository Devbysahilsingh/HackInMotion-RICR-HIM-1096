import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { CropWithStage } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDayMonth, formatNumber, localizedName } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { IconChevronRight } from '@/components/ui/icons';
import { CropStageTimeline } from './CropStageTimeline';

/** `CropCard.healthFlag` carries the engine's own severity code. */
const SEVERITY_KEY: Record<string, string> = {
  MILD: 'severityMild',
  MODERATE: 'severityModerate',
  SEVERE: 'severitySevere',
};

const SEVERITY_TONE: Record<string, 'warning' | 'danger'> = {
  MILD: 'warning',
  MODERATE: 'warning',
  SEVERE: 'danger',
};

/**
 * One crop on the farm's own screen.
 *
 * Distinct from `CropCardTile`, which renders the dashboard's `CropCard` DTO —
 * a different payload with different fields. This one renders the farm detail
 * route's `CropWithStage`, so it can show what that record actually carries and
 * the dashboard's does not: the sowing date, the area with its unit, and the
 * stage's position in the published calendar.
 *
 * The photograph is the farmer's own (`Crop.photoUrl`), never a stock picture
 * of somebody else's field (rule 7); without one the design's `.ph` gradient
 * keeps the tile's proportions rather than leaving a hole.
 */
export function FarmCropTile({
  crop,
  healthFlag = null,
}: {
  crop: CropWithStage;
  /** The engine's severity for this crop, from the dashboard payload. */
  healthFlag?: string | null;
}) {
  const { t } = useTranslation(['crop', 'farm', 'agri', 'common', 'health']);
  const { language } = useLanguage();

  const names = crop.registry.names;
  const primary = localizedName(names, language)?.text ?? crop.freeTextLabel ?? crop.cropCode;
  /*
   * The design sets the crop's other-language name beside the primary one —
   * "Soybean सोयाबीन". Both come from the registry document, so this is two
   * real fields shown together, not a transliteration invented here. It is
   * omitted when the registry has only one (free-text crops, and every disease
   * name whose Hindi is still null).
   */
  const secondary = language === 'hi' ? names?.en : names?.hi;

  const sownLabel =
    crop.status === 'planned'
      ? t('farm:wizardCropPlanned', { date: formatDayMonth(crop.sowingDate, language) })
      : t('farm:wizardCropSown', { date: formatDayMonth(crop.sowingDate, language) });

  const meta = [
    crop.stage.stage ? t(`agri:stage.${crop.stage.stage}`) : null,
    sownLabel,
    crop.areaValue != null
      ? `${formatNumber(crop.areaValue, language)} ${t(`common:unit.${crop.areaUnit ?? 'acre'}`)}`
      : null,
  ].filter(Boolean);

  return (
    <Card
      className="h-full overflow-hidden"
      data-testid="farm-crop-tile"
      data-crop-code={crop.cropCode}
    >
      <Link to={`/crops/${crop.id}`} className="flex h-full flex-col hover:bg-canvas/60">
        {crop.photoUrl ? (
          <img
            src={crop.photoUrl}
            alt=""
            className="h-40 w-full shrink-0 object-cover"
            loading="lazy"
          />
        ) : (
          <div className="ph h-40 shrink-0" aria-hidden="true" />
        )}

        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-[1.0625rem]">
              {primary}
              {secondary && (
                <span className="ml-2 font-sans text-sm font-normal text-ink-500">{secondary}</span>
              )}
            </h3>

            {healthFlag && SEVERITY_KEY[healthFlag] ? (
              <Badge tone={SEVERITY_TONE[healthFlag] ?? 'warning'} data-testid="farm-crop-health">
                {t(`health:${SEVERITY_KEY[healthFlag]}`)}
              </Badge>
            ) : (
              <Badge tone={crop.status === 'active' ? 'success' : 'neutral'}>
                {t(`agri:cropStatus.${crop.status}`)}
              </Badge>
            )}
          </div>

          <p className="text-sm text-ink-500">{meta.join(' · ')}</p>

          <CropStageTimeline stage={crop.stage} variant="compact" className="mt-0.5" />

          <span className="mt-auto inline-flex items-center gap-1 pt-2 font-display text-sm font-semibold text-brand-600">
            {t('farm:openCropCta')}
            <IconChevronRight size={16} aria-hidden="true" />
          </span>
        </div>
      </Link>
    </Card>
  );
}
