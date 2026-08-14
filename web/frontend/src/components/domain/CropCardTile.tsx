import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { CropCard } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatNumber, localizedName } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import {
  IconChevronRight,
  IconDroplet,
  IconTrendDown,
  IconTrendFlat,
  IconTrendUp,
} from '@/components/ui/icons';

/** `CropCard.healthFlag` carries the engine's own severity code — MILD/MODERATE/SEVERE. */
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
 * A crop at a glance: stage, today's irrigation verdict, the market direction,
 * and how fresh the weather behind all of it is.
 *
 * Every value is read from the dashboard payload — the card refetches nothing
 * (component-map: "domain components take API DTOs, no refetching inside"),
 * which is what keeps a dashboard with twelve crops to one request.
 */
export function CropCardTile({ card }: { card: CropCard }) {
  const { t } = useTranslation(['crop', 'agri', 'irrigation', 'market', 'common', 'health']);
  const { language } = useLanguage();

  const name = localizedName(card.names, language);

  return (
    /*
      `h-full` + a column layout so a tile with three status badges and one with
      a single badge end the same height. Without it the grid was visibly ragged,
      which is the one thing a row of crop tiles must not be.
    */
    <Card data-testid="crop-card" data-crop-code={card.cropCode} className="h-full overflow-hidden">
      <Link to={`/crops/${card.cropId}`} className="flex h-full flex-col hover:bg-canvas/60">
        {/*
          The design tops each tile with a photograph of the crop. When the
          farmer added one, it's their own real photo of this planting
          (`Crop.photoUrl`) — never a stock photo of somebody else's field
          (rule 7). Absent one, the slot falls back to the design's own `.ph`
          gradient, which keeps the tile's proportions and the grid's rhythm
          exactly as before.
        */}
        {card.photoUrl ? (
          <img
            src={card.photoUrl}
            alt=""
            className="h-24 w-full shrink-0 object-cover"
            loading="lazy"
          />
        ) : (
          <div className="ph h-24 shrink-0" aria-hidden="true" />
        )}

        <div className="flex flex-1 flex-col gap-2 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[0.938rem] font-semibold">{name?.text ?? card.cropCode}</h3>
            {card.stage && <Badge tone="brand">{t(`agri:stage.${card.stage}`)}</Badge>}
          </div>

          {card.areaValue != null && card.areaUnit && (
            <p className="text-xs text-ink-500">
              {formatNumber(card.areaValue, language)} {t(`common:unit.${card.areaUnit}`)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {card.irrigationVerdict && (
              <Badge
                tone={card.irrigationVerdict === 'IRRIGATE_TODAY' ? 'warning' : 'neutral'}
                icon={<IconDroplet size={14} />}
                data-testid="crop-card-irrigation"
              >
                {t(`irrigation:title${card.irrigationVerdict}`, {
                  days: 0,
                  defaultValue: card.irrigationVerdict,
                })}
              </Badge>
            )}

            {card.marketSignal && <MarketBadge signal={card.marketSignal} />}

            {card.healthFlag && SEVERITY_KEY[card.healthFlag] && (
              <Badge
                tone={SEVERITY_TONE[card.healthFlag] ?? 'warning'}
                data-testid="crop-card-health"
              >
                {t(`health:${SEVERITY_KEY[card.healthFlag]}`)}
              </Badge>
            )}
          </div>

          {/* `mt-auto` pins the footer to the bottom of an equal-height tile. */}
          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <FreshnessDot freshness={card.freshness} />
            <IconChevronRight size={18} className="shrink-0 text-ink-500" aria-hidden="true" />
          </div>
        </div>
      </Link>
    </Card>
  );
}

function MarketBadge({ signal }: { signal: NonNullable<CropCard['marketSignal']> }) {
  const { t } = useTranslation('market');

  const Icon =
    signal === 'RISING' ? IconTrendUp : signal === 'FALLING' ? IconTrendDown : IconTrendFlat;

  return (
    <Badge tone="neutral" icon={<Icon size={14} />} data-testid="crop-card-market">
      {t(`title${signal}`)}
    </Badge>
  );
}
