import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';

import { dashboardApi, healthApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import { SPREAD_RATES, type SymptomAnswers, type SymptomCheckResponse } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { DiseaseName } from '@/components/domain/DiseaseName';
import { WhyTrace } from '@/components/domain/WhyTrace';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import { SelectField } from '@/components/ui/Field';
import { SourceLabel } from '@/components/ui/FreshnessDot';
import { EmptyState, Notice } from '@/components/ui/states';
import { IconCamera, IconPlus } from '@/components/ui/icons';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { formatNumber, localizedName } from '@/lib/format';

/**
 * The answer vocabulary, transcribed from
 * `backend/src/engines/symptom/constants.js`.
 *
 * It is a **closed** list on the server: an answer outside it is rejected and
 * recorded in the trace rather than guessed at, so the picker must offer
 * exactly these values and nothing else.
 */
const AXES = {
  part: ['LEAF', 'STEM', 'FRUIT', 'FLOWER', 'ROOT', 'WHOLE_PLANT'],
  pattern: [
    'SPOTS',
    'BLOTCHES',
    'POWDER',
    'CURL',
    'WILT',
    'HOLES',
    'YELLOWING',
    'STREAKS',
    'LESIONS',
    'MOSAIC',
    'ROT',
    'STUNTING',
    'WEBBING',
    'RINGS',
  ],
  color: ['YELLOW', 'BROWN', 'BLACK', 'WHITE', 'GREY', 'RED', 'ORANGE', 'PURPLE', 'TAN'],
  distribution: ['LOWER_LEAVES', 'UPPER_LEAVES', 'ALL_LEAVES', 'SCATTERED', 'MARGINS', 'VEINS'],
} as const;

type Axis = keyof typeof AXES;

const AXIS_LABEL: Record<Axis | 'spread', string> = {
  part: 'health:symptomAxisPart',
  pattern: 'health:symptomAxisPattern',
  color: 'health:symptomAxisColor',
  distribution: 'health:symptomAxisDistribution',
  spread: 'health:symptomAxisSpread',
};

/**
 * The no-photo route.
 *
 * Reachable both on its own and from an uncertain photo result. Every axis is
 * optional: the engine treats a skipped axis as neither evidence for nor
 * against, so a farmer who only knows two things about the problem still gets
 * a scored answer rather than a form that refuses to submit.
 */
export default function SymptomCheckPage() {
  const { t } = useTranslation(['health', 'agri', 'crop', 'common']);
  const { language } = useLanguage();
  const toMessage = useApiErrorMessage();
  const [searchParams] = useSearchParams();

  const [cropId, setCropId] = useState(searchParams.get('cropId') ?? '');
  const [answers, setAnswers] = useState<SymptomAnswers>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SymptomCheckResponse | null>(null);

  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  const crops = useMemo(() => dashboardQuery.data?.cropCards ?? [], [dashboardQuery.data]);

  const check = useMutation({
    mutationFn: () => healthApi.symptomCheck({ cropId, answers }),
    onSuccess: setResult,
    onError: (mutationError) => setError(toMessage(mutationError)),
  });

  const answeredCount = Object.values(answers).filter(Boolean).length;

  return (
    <>
      <PageHeader title={t('health:symptomCheckTitle')} />

      <QueryBoundary
        query={dashboardQuery}
        isEmpty={() => crops.length === 0}
        empty={
          <EmptyState
            title={t('health:scanNoCrops')}
            action={
              <ButtonLink to="/farms" leadingIcon={<IconPlus size={18} />}>
                {t('common:nav.farms')}
              </ButtonLink>
            }
          />
        }
      >
        {() => (
          <div className="space-y-6">
            <form
              className="space-y-5"
              data-testid="symptom-form"
              onSubmit={(event) => {
                event.preventDefault();
                setError(null);
                if (cropId) check.mutate();
              }}
            >
              {error && <Notice tone="danger">{error}</Notice>}

              <SelectField
                label={t('health:scanCropLabel')}
                required
                value={cropId}
                onChange={(event) => setCropId(event.target.value)}
                data-testid="symptom-crop"
              >
                <option value="">{t('crop:cropCodePlaceholder')}</option>
                {crops.map((crop) => (
                  <option key={crop.cropId} value={crop.cropId}>
                    {localizedName(crop.names, language)?.text ?? crop.cropCode}
                  </option>
                ))}
              </SelectField>

              {(Object.keys(AXES) as Axis[]).map((axis) => (
                <SelectField
                  key={axis}
                  label={t(AXIS_LABEL[axis])}
                  value={answers[axis] ?? ''}
                  data-testid={`symptom-${axis}`}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [axis]: event.target.value || undefined,
                    }))
                  }
                >
                  <option value="">{t('health:symptomAxisSkip')}</option>
                  {AXES[axis].map((value) => (
                    <option key={value} value={value}>
                      {t(`agri:${axis}.${value}`)}
                    </option>
                  ))}
                </SelectField>
              ))}

              <SelectField
                label={t('health:symptomAxisSpread')}
                value={answers.spread ?? ''}
                data-testid="symptom-spread"
                onChange={(event) =>
                  setAnswers((current) => ({
                    ...current,
                    spread: (event.target.value || undefined) as SymptomAnswers['spread'],
                  }))
                }
              >
                <option value="">{t('health:symptomAxisSkip')}</option>
                {SPREAD_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {t(`agri:spread.${rate}`)}
                  </option>
                ))}
              </SelectField>

              <Button
                type="submit"
                size="lg"
                fullWidth
                disabled={!cropId || answeredCount === 0}
                isLoading={check.isPending}
                data-testid="symptom-submit"
              >
                {t('health:symptomCheckSubmit')}
              </Button>
            </form>

            {result && <SymptomResult result={result} cropId={cropId} />}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

function SymptomResult({ result, cropId }: { result: SymptomCheckResponse; cropId: string }) {
  const { t } = useTranslation(['health', 'common']);

  return (
    <Section title={t('health:symptomCandidatesHeading')} as="h2">
      <div className="space-y-4" data-testid="symptom-result">
        <SourceLabel sourceLabelKey={result.guidance.sourceLabelKey} />

        {result.guidance.coverageNoticeKey && (
          <Notice tone="info">{translateMessageKey(t, result.guidance.coverageNoticeKey)}</Notice>
        )}

        {/*
          The engine routes to a human below its own threshold rather than
          naming a low-scoring guess. That referral is the result, not a
          consolation prize for one.
        */}
        {result.guidance.expertReferral && (
          <Notice tone="warning" data-testid="symptom-referral">
            {t('health:expertReferral')}
          </Notice>
        )}

        {result.candidates.length === 0 ? (
          <EmptyState
            title={t('health:symptomNoCandidates')}
            action={
              <ButtonLink to={`/scan?cropId=${cropId}`} leadingIcon={<IconCamera size={18} />}>
                {t('health:scanTitle')}
              </ButtonLink>
            }
          />
        ) : (
          <ul className="space-y-3">
            {result.candidates.map((candidate) => (
              <li key={candidate.diseaseCode}>
                <CandidateCard candidate={candidate} />
              </li>
            ))}
          </ul>
        )}

        <WhyTrace trace={result.trace} />
      </div>
    </Section>
  );
}

function CandidateCard({ candidate }: { candidate: SymptomCheckResponse['candidates'][number] }) {
  const { t } = useTranslation(['health', 'common']);
  const { language } = useLanguage();

  return (
    <Card data-testid="symptom-candidate">
      <div className="flex flex-wrap items-center justify-between gap-2 p-4">
        <p className="text-base font-semibold">
          <DiseaseName code={candidate.diseaseCode} showFallbackNote />
        </p>
        <div className="flex items-center gap-2">
          {/*
            "Possible" or "Likely" — never "Diagnosed"
            (docs/ai/fallback-strategy.md).
          */}
          <Badge tone={candidate.band === 'LIKELY' ? 'warning' : 'neutral'}>
            {t(`health:band${candidate.band === 'LIKELY' ? 'Likely' : 'Possible'}`)}
          </Badge>
          <span className="text-sm tabular-nums text-ink-500">
            {formatNumber(candidate.matchScore * 100, language, { maximumFractionDigits: 0 })}%
          </span>
        </div>
      </div>
    </Card>
  );
}
