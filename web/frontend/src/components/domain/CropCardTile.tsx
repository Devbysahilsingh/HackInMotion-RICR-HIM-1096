import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { CropCard } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { localizedName } from '@/lib/format';
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

/**
 * A crop at a glance: stage, today's irrigation verdict, the market direction,
 * and how fresh the weather behind all of it is.
 *
 * Every value is read from the dashboard payload — the card refetches nothing
 * (component-map: "domain components take API DTOs, no refetching inside"),
 * which is what keeps a dashboard with twelve crops to one request.
 */
export function CropCardTile({ card }: { card: CropCard }) {
  const { t } = useTranslation(['crop', 'agri', 'irrigation', 'market', 'common']);
  const { language } = useLanguage();

  const name = localizedName(card.names, language);

  return (
    <Card data-testid="crop-card" data-crop-code={card.cropCode}>
      <Link
        to={`/crops/${card.cropId}`}
        className="flex items-start gap-3 p-4 hover:bg-canvas/60"
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{name?.text ?? card.cropCode}</h3>
            {card.stage && (
              <Badge tone="brand">{t(`agri:stage.${card.stage}`)}</Badge>
            )}
          </div>

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
          </div>

          <FreshnessDot freshness={card.freshness} />
        </div>

        <IconChevronRight size={20} className="mt-1 shrink-0 text-ink-500" aria-hidden="true" />
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
