import { useTranslation } from 'react-i18next';

import type { YieldEstimateResponse, YieldSpecificity } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { StatTile } from '@/components/ui/Stat';
import { Notice } from '@/components/ui/states';
import { IconAlertTriangle, IconInfo } from '@/components/ui/icons';
import { WhyTrace } from './WhyTrace';

/**
 * One crop's harvest estimate, in full.
 *
 * ## What this screen has to communicate, and why it is laid out this way
 *
 * The number itself is the least interesting thing here. A farmer can be told
 * "about 40 quintal" by anybody; what makes this trustworthy is that every
 * layer underneath is visible — which district's records, which years, which
 * rung of the fallback ladder answered, and what the estimate does *not*
 * account for. So the order is: the range, then its basis, then how specific
 * the evidence was, then the limitations, then the working.
 *
 * ## The range is the headline, never a single number
 *
 * `docs/yield/yield-estimation.md`: "never a single big number (range always)".
 * A point estimate reads as a promise. The mid figure is present but set
 * quieter than the range it sits inside, and the range is explicitly labelled
 * as the district's normal year-to-year variation rather than a confidence
 * interval — a distinction the API carries in `rangeMeaningKey` and this
 * component is not free to drop.
 *
 * ## Degradation is shown, not hidden
 *
 * When the ladder fell through to a state average, the badge says so and a
 * notice explains why. A farmer whose district did not match deserves to know
 * that the number describes their state rather than their district; quietly
 * presenting it as local would be the single most misleading thing this screen
 * could do.
 */
export function YieldEstimateView({
  estimate,
  cropName,
  className,
}: {
  estimate: YieldEstimateResponse;
  cropName: string;
  className?: string;
}) {
  const { t } = useTranslation(['yield', 'common', 'agri']);
  const { language } = useLanguage();

  const num = (value: number | null | undefined, digits = 1) =>
    value === null || value === undefined
      ? '—'
      : formatNumber(value, language, { maximumFractionDigits: digits });

  if (!estimate.estimated) {
    return <InsufficientEvidence estimate={estimate} cropName={cropName} className={className} />;
  }

  const basis = estimate.basis!;
  const production = estimate.production;
  const yearsLabel = t('yield:yearsRangeLabel', {
    from: basis.years[0],
    to: basis.years[basis.years.length - 1],
  });

  return (
    <div className={cn('space-y-4', className)} data-testid="yield-estimate">
      {/* ── The estimate itself ───────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="bg-leaf-900 px-5 py-5 text-white">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="kicker text-leaf-tint/80">{t('yield:estimateHeading')}</span>
              <p className="mt-1 truncate font-display text-lg font-bold">{cropName}</p>
            </div>
            <SpecificityBadge specificity={estimate.specificity} />
          </div>

          {production ? (
            <>
              <p
                className="mt-4 font-display text-4xl font-extrabold leading-none tracking-[-0.03em]"
                data-testid="yield-range"
              >
                {production.lowQuintals === null
                  ? `${num(production.midQuintals)}`
                  : t('yield:rangeLabel', {
                      low: num(production.lowQuintals),
                      high: num(production.highQuintals),
                    })}
              </p>
              <p className="mt-2 text-sm text-white/80">{t('yield:rangeTypicalYearToYear')}</p>
            </>
          ) : (
            <p className="mt-4 text-sm text-white/90" data-testid="yield-no-total">
              {t(`yield:${keyOf(estimate.productionUnavailableReasonKey)}`)}
            </p>
          )}

          {/* R12: the working is reachable from the verdict itself. */}
          <WhyTrace trace={estimate.trace} tone="onDark" className="mt-4" />
        </div>

        <div className="grid gap-3 px-5 py-4 sm:grid-cols-3">
          <StatTile
            label={t('yield:basisHeading')}
            value={t('yield:perHectareLabel', { value: num(basis.medianYieldTHa, 2) })}
            hint={t('yield:perAcreLabel', { value: num(basis.medianYieldQuintalPerAcre, 1) })}
            tone="quiet"
          />
          <StatTile
            label={t('yield:evidenceHeading')}
            value={t('yield:observationsLabel', { n: basis.observations })}
            hint={yearsLabel}
            tone="quiet"
          />
          <StatTile
            label={t('yield:areaLabel')}
            value={
              estimate.area.value === null
                ? '—'
                : `${num(estimate.area.value, 2)} ${t(`common:unit.${estimate.area.unit ?? 'acre'}`)}`
            }
            hint={
              production
                ? `${num(production.areaHectares, 2)} ${t('common:unit.hectare')}`
                : undefined
            }
            tone="quiet"
          />
        </div>
      </Card>

      {/* ── Where the number came from ────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="kicker">{t('yield:basisHeading')}</span>
          <FreshnessDot freshness={estimate.freshness} />
        </div>

        <p className="mt-2 text-sm text-ink-900">
          {estimate.basisKey
            ? t(`yield:${keyOf(estimate.basisKey)}`, {
                district: estimate.location.matchedDistrict ?? estimate.location.district ?? '',
                state: estimate.location.matchedState ?? estimate.location.state ?? '',
                season: t(`agri:season.${estimate.season.value}`),
              })
            : null}
        </p>

        {!estimate.location.districtMatched && estimate.location.district && (
          <Notice tone="warning" className="mt-3" data-testid="yield-unmatched-district">
            {t('yield:unmatchedDistrict', { district: estimate.location.district })}
          </Notice>
        )}

        <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <Row label={t('yield:seasonLabel')} value={t(`agri:season.${estimate.season.value}`)} />
          <Row label={t('yield:latestYearLabel')} value={String(basis.latestYear)} />
        </dl>

        <p className="mt-3 text-xs text-ink-500">{t('yield:notAPrediction')}</p>

        {estimate.source && (
          <p className="mt-2 text-xs text-ink-500" data-testid="yield-attribution">
            <span className="font-semibold">{t('yield:attributionLabel')}: </span>
            {estimate.source.attribution}
          </p>
        )}
      </Card>

      {/* ── What it does not account for ──────────────────────────────── */}
      {estimate.limitations.length > 0 && (
        <Card className="p-5" data-testid="yield-limitations">
          <span className="kicker">{t('yield:limitationsHeading')}</span>
          <ul className="mt-2 space-y-2">
            {estimate.limitations.map((limitation) => (
              <li key={limitation.key} className="flex items-start gap-2 text-sm text-ink-700">
                <IconAlertTriangle
                  size={15}
                  className="mt-0.5 shrink-0 text-clay-600"
                  aria-hidden
                />
                <span>
                  {t(`yield:${keyOf(limitation.key)}`, {
                    ...(limitation.data as Record<string, unknown>),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── The factors that were weighed and not applied ─────────────── */}
      <Card className="p-5" data-testid="yield-factors">
        <span className="kicker">{t('yield:factorsHeading')}</span>
        <p className="mt-2 text-sm text-ink-700">{t('yield:factorsNoneApplied')}</p>
        <ul className="mt-3 space-y-3">
          {estimate.factors.map((factor) => (
            <li
              key={factor.factor}
              className="border-t border-line pt-3 first:border-t-0 first:pt-0"
            >
              <div className="flex items-center gap-2">
                <Badge tone="neutral">{t('yield:factorNotAppliedBadge')}</Badge>
              </div>
              <p className="mt-1.5 text-sm text-ink-700">{t(`yield:${keyOf(factor.reasonKey)}`)}</p>
              {factor.sourceRef && (
                <p className="mt-1 text-xs text-ink-500">
                  {factor.sourceRef.org} — {factor.sourceRef.title}
                </p>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <p className="px-1 text-xs text-ink-500" data-testid="yield-disclaimer">
        {t('yield:disclaimer', {
          district: estimate.location.matchedDistrict ?? estimate.location.matchedState ?? '',
          years: yearsLabel,
        })}
      </p>
    </div>
  );
}

/**
 * The unavailable state.
 *
 * Deliberately a designed screen rather than an error: for cotton and tomato
 * this is the *correct, permanent* answer, and it is the one place where the
 * product's honesty rule is most visible to a farmer. It says what is missing
 * and why we will not guess, and it does not look broken.
 */
function InsufficientEvidence({
  estimate,
  cropName,
  className,
}: {
  estimate: YieldEstimateResponse;
  cropName: string;
  className?: string;
}) {
  const { t } = useTranslation(['yield', 'common', 'agri']);
  const reasonKey = estimate.reasonKey ?? estimate.evidence.reasonKey;

  return (
    <Card className={cn('p-6 text-center', className)} data-testid="yield-insufficient">
      <span
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-canvas text-ink-500"
        aria-hidden="true"
      >
        <IconInfo size={20} />
      </span>

      <p className="mt-3 font-display text-lg font-bold text-ink-900">
        {t('yield:insufficientTitle')}
      </p>
      <p className="mt-1 text-sm text-ink-700">{cropName}</p>

      {reasonKey && (
        <p className="mx-auto mt-3 max-w-prose text-sm text-ink-700" data-testid="yield-reason">
          {t(`yield:${keyOf(reasonKey)}`)}
        </p>
      )}

      <p className="mx-auto mt-3 max-w-prose text-sm text-ink-500">{t('yield:insufficientBody')}</p>

      {/* Even here the ladder is inspectable — it is evidence of the refusal. */}
      {estimate.evidence.attempts.length > 0 && (
        <WhyTrace trace={estimate.trace} className="mt-4 text-left" />
      )}
    </Card>
  );
}

/** How specific the evidence was. Never a confidence score — see the API type. */
function SpecificityBadge({ specificity }: { specificity: YieldSpecificity | null }) {
  const { t } = useTranslation('yield');
  if (!specificity) return null;

  return (
    <span
      className="shrink-0 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold"
      data-testid="yield-specificity"
    >
      {t(`specificity${specificity}`)}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 last:border-b-0 sm:border-b-0">
      <dt className="text-ink-500">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The API namespaces its keys (`yield.limitRainfed`); i18next is already scoped
 * to the `yield` namespace here, so the prefix is stripped rather than the
 * namespace being repeated. Keys that arrive unprefixed pass through unchanged.
 */
function keyOf(key: string | null): string {
  if (!key) return '';
  return key.startsWith('yield.') ? key.slice('yield.'.length) : key;
}
