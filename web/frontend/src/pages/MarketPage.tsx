import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NearbyMandis } from '@/components/domain/NearbyMandis';
import { PageHeader } from '@/components/layout/AppLayout';

const RANGES = [30, 60, 90] as const;
type Range = (typeof RANGES)[number];

/**
 * Mandi prices, for the field selected in the sidebar.
 *
 * ## What changed, and why
 *
 * This page used to be a crop picker: tabs of the farmer's own crops, and under
 * the selected one a signal card, a chart and a comparison table. It answered
 * "how has soybean moved?" — a good question, but the second one. A farmer
 * opening *Mandi prices* is asking what their local markets are doing, and a
 * farmer whose one crop had no recent report got an empty screen while four
 * mandis nearby were publishing six other commodities.
 *
 * So the page is now farm-first: nearby mandis with their whole baskets, the
 * farmer's own crops highlighted inside them, and every other commodity still
 * visible. The per-crop view it replaced is not lost — a commodity row opens
 * that mandi's own screen (`/market/:market?commodity=`), which carries the
 * series, the recent reporting days and the engine's trace.
 *
 * Everything is scoped to `ActiveFarmContext`, so switching fields in the
 * sidebar switches the market.
 */
export default function MarketPage() {
  const { t } = useTranslation(['market', 'common']);
  const [days, setDays] = useState<Range>(30);

  return (
    <>
      <PageHeader
        title={t('market:pageTitle')}
        description={t('market:neverPredicts')}
        actions={
          <div className="flex gap-1" role="group" aria-label={t('market:rangeLabel')}>
            {RANGES.map((range) => (
              <button
                key={range}
                type="button"
                aria-pressed={days === range}
                onClick={() => setDays(range)}
                data-testid={`market-range-${range}`}
                className={
                  days === range
                    ? 'touch-target rounded-lg bg-brand-600 px-3 text-sm font-medium text-white'
                    : 'touch-target rounded-lg border border-line px-3 text-sm font-medium text-ink-700'
                }
              >
                {t(`market:range${range}`)}
              </button>
            ))}
          </div>
        }
      />

      <NearbyMandis days={days} />
    </>
  );
}
