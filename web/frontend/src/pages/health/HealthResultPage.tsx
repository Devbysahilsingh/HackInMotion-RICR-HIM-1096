import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { healthApi } from '@/api/endpoints';
import { queryKeys } from '@/api/queryKeys';
import { SPREAD_RATES, type SpreadRate } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { AnalysisResult } from '@/components/domain/AnalysisResult';
import { PageHeader } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import { RadioCardGroup, TextField } from '@/components/ui/Field';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { Notice } from '@/components/ui/states';
import { useApiErrorMessage } from '@/hooks/useApiError';

export default function HealthResultPage() {
  const { t } = useTranslation(['health', 'common']);
  const { logId = '' } = useParams();

  const query = useQuery({
    queryKey: queryKeys.health.log(logId),
    queryFn: () => healthApi.log(logId),
    enabled: Boolean(logId),
  });

  return (
    <>
      <PageHeader title={t('health:resultTitle')} />

      <QueryBoundary query={query} loading={<SkeletonCard />}>
        {({ log }) => (
          <div className="space-y-8">
            <AnalysisResult log={log} />

            {/*
              The follow-up only appears where it can change something: a
              named, non-healthy condition whose severity the engine could not
              settle from the photo alone. Asking about spread on an
              unidentified photo would be two questions with nowhere to go.
            */}
            {log.analysis.diseaseCode && log.analysis.diseaseCode !== 'UNKNOWN' && (
              <Section title={t('health:severityFollowUpHeading')} as="h2">
                <SeverityFollowUp
                  logId={log.id}
                  initialAffectedPct={log.severityFollowUp?.affectedAreaPct ?? null}
                  initialSpread={log.severityFollowUp?.spreadRate ?? null}
                />
              </Section>
            )}
          </div>
        )}
      </QueryBoundary>
    </>
  );
}

/**
 * The two follow-up answers.
 *
 * They are not a second opinion: they are inputs to the *same* severity engine
 * that ran on the photo, re-run with more evidence (`assessSeverity` is called
 * once, server-side). Nothing here computes a level, and the endpoint could
 * not accept one if this form tried to send it.
 */
function SeverityFollowUp({
  logId,
  initialAffectedPct,
  initialSpread,
}: {
  logId: string;
  initialAffectedPct: number | null;
  initialSpread: SpreadRate | null;
}) {
  const { t } = useTranslation(['health', 'agri', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const [affectedAreaPct, setAffectedAreaPct] = useState<string>(
    initialAffectedPct != null ? String(initialAffectedPct) : '',
  );
  const [spreadRate, setSpreadRate] = useState<SpreadRate | undefined>(initialSpread ?? undefined);
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: () => {
      const pct = affectedAreaPct === '' ? undefined : Number(affectedAreaPct);
      return healthApi.severity(logId, {
        ...(pct !== undefined && Number.isFinite(pct) ? { affectedAreaPct: pct } : {}),
        ...(spreadRate ? { spreadRate } : {}),
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.health.log(logId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.health.all() });
      toast.push(t('common:action.done'));
    },
    onError: (mutationError) => setError(toMessage(mutationError)),
  });

  // The endpoint requires at least one of the two answers.
  const canSubmit = affectedAreaPct !== '' || spreadRate !== undefined;

  return (
    <Card>
      <form
        className="space-y-5 p-4 sm:p-5"
        data-testid="severity-form"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          if (canSubmit) submit.mutate();
        }}
      >
        {error && <Notice tone="danger">{error}</Notice>}

        <TextField
          label={t('health:severityAffectedLabel')}
          type="number"
          min="0"
          max="100"
          step="1"
          inputMode="numeric"
          value={affectedAreaPct}
          onChange={(event) => setAffectedAreaPct(event.target.value)}
          data-testid="severity-affected"
        />

        <RadioCardGroup
          name="spreadRate"
          legend={t('health:severitySpreadLabel')}
          value={spreadRate}
          onChange={setSpreadRate}
          columns={3}
          options={SPREAD_RATES.map((rate) => ({
            value: rate,
            label: t(`agri:spread.${rate}`),
          }))}
        />

        <Button
          type="submit"
          disabled={!canSubmit}
          isLoading={submit.isPending}
          data-testid="severity-submit"
        >
          {t('health:severitySubmit')}
        </Button>
      </form>
    </Card>
  );
}
