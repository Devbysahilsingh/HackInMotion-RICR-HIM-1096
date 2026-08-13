import { useTranslation } from 'react-i18next';

import type { FertilizerGuidance, FertilizerRecommendation, SourceRef } from '@/api/types';
import { translateMessageKey } from '@/i18n/messageKey';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Notice } from '@/components/ui/states';
import { EmptyState } from '@/components/ui/states';

/**
 * Published fertilizer guidance.
 *
 * Everything on this screen is a number somebody else published, shown in the
 * unit they published it in, with a link back to where it came from. Three
 * pieces are mandatory and unconditional (`fertilizerService.js` attaches them
 * before any early return): the disclaimer, the "general recommendation, not a
 * prescription" framing, and the soil-test nudge. They are rendered here for
 * the uncovered case too, which is exactly when a farmer is most likely to go
 * looking for a number somewhere less careful.
 */
export function FertilizerGuidanceView({ guidance }: { guidance: FertilizerGuidance }) {
  const { t } = useTranslation(['fertilizer', 'common', 'agri']);

  if (!guidance.covered) {
    return (
      <div className="space-y-4">
        <EmptyState
          title={translateMessageKey(t, guidance.reasonKey ?? 'fertilizer.notCovered')}
        />
        <Notice tone="info" data-testid="fertilizer-disclaimer">
          {translateMessageKey(t, guidance.disclaimerKey)}
        </Notice>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        {guidance.stage && <Badge tone="brand">{t(`agri:stage.${guidance.stage}`)}</Badge>}
        {guidance.guidanceTypeKey && (
          <Badge>{translateMessageKey(t, guidance.guidanceTypeKey)}</Badge>
        )}
      </div>

      {/*
        Three crops carry doses still awaiting a check against the original
        publication. Surfaced, never hidden — a farmer reading a number is
        entitled to know which tier of confidence it sits in.
      */}
      {guidance.verificationPending && guidance.verificationNoteKey && (
        <Notice tone="warning" data-testid="fertilizer-verification-pending">
          {translateMessageKey(t, guidance.verificationNoteKey)}
        </Notice>
      )}

      {guidance.recommendations.map((recommendation, index) => (
        <RecommendationCard key={index} recommendation={recommendation} />
      ))}

      {guidance.limitationsKey && (
        <Notice tone="info">{translateMessageKey(t, guidance.limitationsKey)}</Notice>
      )}

      {guidance.soilTestCtaKey && (
        <Notice tone="info" data-testid="fertilizer-soil-test-cta">
          {translateMessageKey(t, guidance.soilTestCtaKey)}
        </Notice>
      )}

      {guidance.sources.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t('fertilizer:scheduleHeading')}</h3>
          <SourceList sources={guidance.sources} />
        </section>
      )}

      <Notice tone="warning" data-testid="fertilizer-disclaimer">
        {translateMessageKey(t, guidance.disclaimerKey)}
      </Notice>
    </div>
  );
}

function RecommendationCard({ recommendation }: { recommendation: FertilizerRecommendation }) {
  const { t } = useTranslation(['fertilizer', 'common']);

  return (
    <Card data-testid="fertilizer-recommendation">
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">
            {recommendation.basis === 'stcr_soil_test'
              ? t('fertilizer:basisSoilTest')
              : t('fertilizer:basisBlanket')}
          </Badge>
          <span className="text-sm text-ink-500">
            {recommendation.varietyClass
              ? t('fertilizer:varietyClassLabel', { varietyClass: recommendation.varietyClass })
              : t('fertilizer:varietyClassUnspecified')}
          </span>
        </div>

        <DoseTable title={t('fertilizer:npkHeading')} dose={recommendation.totalNpk} />
        <DoseTable title={t('fertilizer:organicsHeading')} dose={recommendation.organics} />
        <DoseTable
          title={t('fertilizer:micronutrientsHeading')}
          dose={recommendation.micronutrients}
        />

        {recommendation.schedule.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-sm font-semibold">{t('fertilizer:scheduleHeading')}</h4>
            <ul className="space-y-2">
              {recommendation.schedule.map((step, index) => (
                <li
                  key={index}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    {step.labelKey ? translateMessageKey(t, step.labelKey) : String(step.stage ?? '')}
                  </span>
                  {step.due && <Badge tone="warning">{t('fertilizer:dueNow')}</Badge>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <SourceList sources={[recommendation.source]} />
      </div>
    </Card>
  );
}

/**
 * Doses are rendered exactly as published — the key names the nutrient and the
 * value carries its own unit. Nothing here converts, rounds or recombines a
 * number, because the published figure is the whole authority for it.
 */
function DoseTable({ title, dose }: { title: string; dose: Record<string, unknown> | null }) {
  const entries = dose ? Object.entries(dose).filter(([, value]) => value != null) : [];
  if (entries.length === 0) return null;

  return (
    <section className="space-y-1.5">
      <h4 className="text-sm font-semibold">{title}</h4>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
        {entries.map(([nutrient, value]) => (
          <div key={nutrient} className="contents">
            <dt className="truncate text-ink-500">{nutrient}</dt>
            <dd className="text-right font-medium tabular-nums">{formatDoseValue(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatDoseValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const amount = record.value ?? record.amount;
    const unit = record.unit;
    if (amount !== undefined) return `${String(amount)}${unit ? ` ${String(unit)}` : ''}`;
    return JSON.stringify(value);
  }
  return String(value);
}

export function SourceList({ sources }: { sources: SourceRef[] }) {
  if (sources.length === 0) return null;

  return (
    <ul className="space-y-1 text-xs text-ink-500" data-testid="source-list">
      {sources.map((source, index) => (
        <li key={`${source.org}-${index}`}>
          {source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-brand-700"
            >
              {source.org} — {source.title}
            </a>
          ) : (
            <span>
              {source.org} — {source.title}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
