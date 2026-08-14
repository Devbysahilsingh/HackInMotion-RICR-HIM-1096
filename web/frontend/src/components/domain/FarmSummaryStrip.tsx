import { useTranslation } from 'react-i18next';

import type { DashboardResponse } from '@/api/types';
import { IconField, IconLeaf, IconLocation } from '@/components/ui/icons';

/**
 * The farm at a glance: how much land is on the account, how much of it is
 * growing something, and where.
 *
 * `farmSummary` has always been part of the `/dashboard` payload and was
 * rendered nowhere — the page went straight from its title to the feed, so a
 * farmer had no confirmation that the app was even looking at the right
 * holding. The reference opens every dashboard with exactly this orientation
 * strip, and it is the cheapest possible answer to "is this my farm?".
 *
 * Districts are shown rather than counted: a farmer recognises "Sehore" far
 * faster than "2 districts", and the list is naturally short because the
 * account is capped at ten farms.
 */
export function FarmSummaryStrip({ summary }: { summary: DashboardResponse['farmSummary'] }) {
  const { t } = useTranslation(['common', 'farm']);

  // Nothing to orient by yet. The onboarding payload covers that case with a
  // designed empty state, so rendering an all-zero strip here would be noise.
  if (summary.farmCount === 0) return null;

  const districts = summary.districts.filter(Boolean);

  return (
    <dl
      data-testid="farm-summary"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4"
      aria-label={t('farm:summaryLabel')}
    >
      <Stat
        icon={<IconField size={18} />}
        label={t('farm:summaryFarms')}
        value={String(summary.farmCount)}
      />
      <Stat
        icon={<IconLeaf size={18} />}
        label={t('farm:summaryActiveCrops')}
        value={String(summary.activeCropCount)}
      />
      <Stat
        icon={<IconLocation size={18} />}
        label={t('farm:summaryDistricts')}
        // Joined rather than truncated: the cap on farms keeps this short, and
        // an ellipsis here would hide the one word a farmer is checking for.
        value={districts.length > 0 ? districts.join(' · ') : t('common:state.empty')}
        // A district list is prose-length, so it must not sit on the same
        // oversized numeral scale as the two counts.
        wide
      />
    </dl>
  );
}

function Stat({
  icon,
  label,
  value,
  wide = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className="rounded-control border border-line bg-surface px-4 py-3.5">
      <dt className="kicker flex items-center gap-1.5">
        <span className="text-brand-500" aria-hidden="true">
          {icon}
        </span>
        {label}
      </dt>
      <dd
        className={
          wide
            ? 'mt-1.5 truncate font-display text-base font-extrabold tracking-tight text-ink-900'
            : 'mt-1.5 font-display text-2xl font-extrabold leading-none tracking-tight text-ink-900'
        }
      >
        {value}
      </dd>
    </div>
  );
}
