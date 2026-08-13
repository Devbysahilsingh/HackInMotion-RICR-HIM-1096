import { useTranslation } from 'react-i18next';

import type { Freshness, FreshnessStatus } from '@/api/types';
import { cn } from '@/lib/cn';
import { relativeAge } from '@/lib/format';

/**
 * The honesty label (CLAUDE.md rule 9).
 *
 * Every data-bearing surface in this app carries one of these, and it means
 * exactly the same thing on every screen: `live` is inside its TTL, `cached`
 * is the last good value, `historical` is archived rather than current, and
 * `pending` is "we have never managed to fetch this". The status comes from
 * the API's own `freshness` block — the client never decides it, because the
 * server's cache is what actually governs it.
 *
 * Colour is a second signal only. The dot is always followed by a translated
 * word, and the whole control carries a title so a hover explains the age.
 */
const STYLE: Record<FreshnessStatus, string> = {
  live: 'text-fresh-live',
  cached: 'text-fresh-cached',
  historical: 'text-fresh-historical',
  pending: 'text-fresh-pending',
};

/** Beyond this a cached snapshot gets an explicit warning (WEATHER_STALE_WARNING_MS). */
const STALE_WARNING_HOURS = 48;

export interface FreshnessDotProps {
  freshness: Freshness | null | undefined;
  /** Hides the word, leaving the dot. Only for dense rows that repeat a label. */
  compact?: boolean;
  className?: string;
}

export function FreshnessDot({ freshness, compact = false, className }: FreshnessDotProps) {
  const { t } = useTranslation('common');

  if (!freshness?.status) return null;

  const status = freshness.status;

  // Weather stamps when it was fetched; market stamps the newest price it
  // holds. Both answer "how old is this?", so whichever is present is used.
  const age = relativeAge(freshness.fetchedAt ?? freshness.latestDate);
  const ageText = age ? t(age.key, { count: age.count }) : null;

  const label =
    status === 'cached' && ageText
      ? t('freshness.cachedAge', { age: ageText })
      : t(`freshness.${status}`);

  const tooltip =
    status === 'live' && ageText
      ? t('freshness.tooltipLive', { age: ageText })
      : status === 'cached' && ageText
        ? t('freshness.tooltipCached', { age: ageText })
        : status === 'historical'
          ? t('freshness.tooltipHistorical')
          : status === 'pending'
            ? t('freshness.tooltipPending')
            : label;

  /*
   * The server's own verdict wins where it gives one: `staleWarning` is
   * computed against `WEATHER_STALE_WARNING_MS`, and a client that decided
   * staleness independently would eventually disagree with it. The local
   * calculation is the fallback for responses that carry no such flag.
   */
  const hoursOld =
    freshness.ageHours ??
    (freshness.fetchedAt
      ? (Date.now() - new Date(freshness.fetchedAt).getTime()) / 3_600_000
      : null);

  const isStale =
    freshness.staleWarning ??
    (status === 'cached' && hoursOld !== null && hoursOld > STALE_WARNING_HOURS);

  return (
    <span
      data-testid="freshness-dot"
      data-status={status}
      title={tooltip}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium',
        STYLE[status],
        className,
      )}
    >
      {/*
        The dot is decorative — the word beside it carries the meaning, and a
        screen reader that announced "●" would only add noise.
      */}
      <span aria-hidden="true" className="text-[0.9em] leading-none">
        ●
      </span>
      {compact ? (
        <span className="sr-only">{label}</span>
      ) : (
        <span>{label}</span>
      )}
      {isStale && (
        <span className="sr-only" data-testid="freshness-stale-warning">
          {t('freshness.staleWarning')}
        </span>
      )}
    </span>
  );
}

/**
 * The tier label for AI-produced content ("Local AI" / "AI-assisted" /
 * "Guided assessment"). Separate from freshness because it answers a different
 * question — *who* produced this, not *when* — and ai-safety rule 6 forbids
 * blending the tiers into one anonymous "AI".
 */
export function SourceLabel({
  sourceLabelKey,
  className,
}: {
  sourceLabelKey: string | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();

  if (!sourceLabelKey) return null;
  const dot = sourceLabelKey.indexOf('.');
  const full = dot === -1 ? `common:${sourceLabelKey}` : `${sourceLabelKey.slice(0, dot)}:${sourceLabelKey.slice(dot + 1)}`;

  return (
    <span
      data-testid="source-label"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700',
        className,
      )}
    >
      <span aria-hidden="true" className="text-[0.9em] leading-none">
        ●
      </span>
      {t(full)}
    </span>
  );
}
