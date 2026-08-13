import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';

import { cropRecApi, farmsApi } from '@/api/endpoints';
import { queryKeys } from '@/api/queryKeys';
import { SEASONS, type CropRecResponse, type Season } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { SourceList } from '@/components/domain/FertilizerGuidanceView';
import { WhyTrace } from '@/components/domain/WhyTrace';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import { RadioCardGroup } from '@/components/ui/Field';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { EmptyState, Notice } from '@/components/ui/states';
import { IconPlus } from '@/components/ui/icons';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { formatNumber, localizedName } from '@/lib/format';

type Preference = 'food' | 'cash' | 'any';

const STEPS = ['farm', 'season', 'preference'] as const;
type Step = (typeof STEPS)[number];

/**
 * "What should I plant?"
 *
 * Three questions, one request, one ranked answer. The engine is a pure
 * function over the registry and the farm — no external call at request time —
 * so the result is deterministic and its whole derivation is in the trace.
 *
 * What this is **not** is a yield or income forecast. It ranks published
 * suitability, every reason names the registry field it rests on, and crops
 * that were ruled out are listed with their reason rather than silently
 * vanishing.
 */
export default function CropRecommendationPage() {
  const { t } = useTranslation(['cropRec', 'common', 'farm', 'agri']);
  const { language } = useLanguage();
  const toMessage = useApiErrorMessage();

  const [stepIndex, setStepIndex] = useState(0);
  const [farmId, setFarmId] = useState<string>();
  const [season, setSeason] = useState<Season>();
  const [preference, setPreference] = useState<Preference>('any');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CropRecResponse | null>(null);

  const farmsQuery = useQuery({ queryKey: queryKeys.farms.list(), queryFn: farmsApi.list });

  const run = useMutation({
    mutationFn: () =>
      cropRecApi.run({ farmId: farmId!, season: season!, preference }),
    onSuccess: setResult,
    onError: (mutationError) => setError(toMessage(mutationError)),
  });

  const step: Step = STEPS[stepIndex]!;
  const canAdvance =
    (step === 'farm' && Boolean(farmId)) ||
    (step === 'season' && Boolean(season)) ||
    step === 'preference';

  if (result) {
    return (
      <>
        <PageHeader title={t('cropRec:pageTitle')} description={t('cropRec:notAPrediction')} />
        <ResultView
          result={result}
          onRestart={() => {
            setResult(null);
            setStepIndex(0);
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={t('cropRec:pageTitle')}
        description={t('cropRec:stepOf', { current: stepIndex + 1, total: STEPS.length })}
      />

      <QueryBoundary
        query={farmsQuery}
        loading={<SkeletonCard />}
        isEmpty={(data) => data.farms.length === 0}
        empty={
          <EmptyState
            title={t('farm:listEmpty', { ns: 'farm' })}
            action={
              <ButtonLink to="/farms/new" leadingIcon={<IconPlus size={18} />}>
                {t('farm:listEmptyCta', { ns: 'farm' })}
              </ButtonLink>
            }
          />
        }
      >
        {(data) => (
          <div className="space-y-6" data-testid="croprec-wizard">
            {error && <Notice tone="danger">{error}</Notice>}

            {step === 'farm' && (
              <RadioCardGroup
                name="farmId"
                legend={t('cropRec:farmStep')}
                value={farmId}
                onChange={setFarmId}
                options={data.farms.map((farm) => ({
                  value: farm.id,
                  label: farm.name,
                  description: `${farm.location.district}, ${farm.location.state} · ${formatNumber(farm.sizeValue, language)} ${t(`common:unit.${farm.sizeUnit}`)}`,
                }))}
                columns={1}
              />
            )}

            {step === 'season' && (
              <RadioCardGroup
                name="season"
                legend={t('cropRec:seasonStep')}
                value={season}
                onChange={setSeason}
                columns={3}
                options={SEASONS.map((value) => ({
                  value,
                  label: t(`agri:season.${value}`, { ns: 'agri' }),
                }))}
              />
            )}

            {step === 'preference' && (
              <RadioCardGroup
                name="preference"
                legend={t('cropRec:preferenceStep')}
                value={preference}
                onChange={setPreference}
                columns={3}
                options={[
                  { value: 'any', label: t('cropRec:preferenceAny') },
                  { value: 'food', label: t('cropRec:preferenceFood') },
                  { value: 'cash', label: t('cropRec:preferenceCash') },
                ]}
              />
            )}

            <div className="flex flex-wrap justify-between gap-2">
              <Button
                variant="secondary"
                disabled={stepIndex === 0}
                onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                data-testid="croprec-back"
              >
                {t('common:action.back')}
              </Button>

              {stepIndex < STEPS.length - 1 ? (
                <Button
                  disabled={!canAdvance}
                  onClick={() => setStepIndex((current) => current + 1)}
                  data-testid="croprec-next"
                >
                  {t('common:action.next')}
                </Button>
              ) : (
                <Button
                  disabled={!farmId || !season}
                  isLoading={run.isPending}
                  onClick={() => {
                    setError(null);
                    run.mutate();
                  }}
                  data-testid="croprec-run"
                >
                  {t('cropRec:runCta')}
                </Button>
              )}
            </div>
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

function ResultView({ result, onRestart }: { result: CropRecResponse; onRestart: () => void }) {
  const { t } = useTranslation(['cropRec', 'common', 'agri']);
  const { language } = useLanguage();

  return (
    <div className="space-y-6" data-testid="croprec-result">
      <Section title={t('cropRec:resultHeading')} as="h2">
        {result.recommendations.length === 0 ? (
          <EmptyState title={t('cropRec:resultEmpty')} />
        ) : (
          <ol className="space-y-4">
            {result.recommendations.map((item, index) => (
              <li key={item.cropCode}>
                <Card>
                  <div className="space-y-3 p-4 sm:p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ink-500">#{index + 1}</span>
                      <h3 className="text-base font-semibold">
                        {localizedName(item.names, language)?.text ?? item.cropCode}
                      </h3>
                      <Badge tone="brand">
                        {t('cropRec:scoreLabel')}:{' '}
                        {formatNumber(item.score * 100, language, { maximumFractionDigits: 0 })}
                      </Badge>
                      <Badge>
                        {t('cropRec:evidenceLabel', {
                          pct: formatNumber(item.evidenceRatio * 100, language, {
                            maximumFractionDigits: 0,
                          }),
                        })}
                      </Badge>
                    </div>

                    {item.reasons.length > 0 && (
                      <section>
                        <h4 className="text-sm font-semibold">{t('cropRec:reasonsHeading')}</h4>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-700">
                          {item.reasons.map((reason) => (
                            <li key={reason.key}>{translateMessageKey(t, reason.key, reason.data)}</li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {item.cautions.length > 0 && (
                      <section>
                        <h4 className="text-sm font-semibold">{t('cropRec:cautionsHeading')}</h4>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-ink-700">
                          {item.cautions.map((caution, cautionIndex) => (
                            <li key={`${caution.key}-${cautionIndex}`}>
                              {translateMessageKey(t, caution.key, caution.data)}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}

                    {item.sources.length > 0 && (
                      <section>
                        <h4 className="text-sm font-semibold">{t('cropRec:sourcesHeading')}</h4>
                        <SourceList sources={item.sources} />
                      </section>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* What the ranking could not take into account — stated, not omitted. */}
      {result.limitations.length > 0 && (
        <Section title={t('cropRec:limitationsHeading')} as="h2">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">
            {result.limitations.map((limitation, index) => (
              <li key={`${limitation.key}-${index}`}>
                {translateMessageKey(t, limitation.key, limitation.data)}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Excluded crops carry their reason: never a silent disappearance. */}
      {result.excluded.length > 0 && (
        <Section title={t('cropRec:excludedHeading')} as="h2">
          <ul className="space-y-2">
            {result.excluded.map((entry) => (
              <li
                key={entry.cropCode}
                className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              >
                <span className="font-medium">
                  {localizedName(entry.names, language)?.text ?? entry.cropCode}
                </span>
                <span className="ml-2 text-ink-500">
                  {translateMessageKey(t, entry.reasonKey, entry.data)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <WhyTrace trace={result.trace} />

      <Button variant="secondary" onClick={onRestart}>
        {t('cropRec:startOver')}
      </Button>
    </div>
  );
}
