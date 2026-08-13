import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { cropsApi } from '@/api/endpoints';
import { queryKeys } from '@/api/queryKeys';
import { QueryBoundary } from '@/components/QueryBoundary';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { EmptyState, Notice } from '@/components/ui/states';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDate, formatNumber, toDateInputValue } from '@/lib/format';

/**
 * Bounds mirror `irrigationLogSchema`: an amount in (0, 200] mm, or none at
 * all. An empty amount is not zero — the engine reads a log with no amount as
 * "refilled to field capacity" (rule R8), which is a completely different
 * statement from "applied 0mm", so the field stays genuinely optional.
 */
const schema = z.object({
  date: z.string().min(1),
  amountMm: z.union([z.string(), z.number()]).optional(),
});

type LogValues = z.input<typeof schema>;

export function IrrigationLogForm({ cropId }: { cropId: string }) {
  const { t } = useTranslation(['irrigation', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<LogValues>({
    resolver: zodResolver(schema),
    defaultValues: { date: toDateInputValue(new Date()), amountMm: '' },
  });

  const log = useMutation({
    mutationFn: (values: { date: string; amountMm?: number }) =>
      cropsApi.logIrrigation(cropId, values),
    onSuccess: () => {
      // The ledger anchors the water-balance replay, so the verdict changes
      // the moment a log lands — both have to be refetched, not just the list.
      void queryClient.invalidateQueries({ queryKey: queryKeys.crops.irrigation(cropId) });
      void queryClient.invalidateQueries({ queryKey: ['crops', 'irrigationLedger', cropId] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
      reset({ date: toDateInputValue(new Date()), amountMm: '' });
    },
    onError: (error) => setFormError(toMessage(error)),
  });

  const submit = handleSubmit((values) => {
    setFormError(null);
    const amount =
      values.amountMm === '' || values.amountMm === undefined ? undefined : Number(values.amountMm);

    log.mutate({
      date: new Date(`${values.date}T12:00:00`).toISOString(),
      ...(amount !== undefined && Number.isFinite(amount) && amount > 0
        ? { amountMm: amount }
        : {}),
    });
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-4" data-testid="irrigation-log-form">
      {formError && <Notice tone="danger">{formError}</Notice>}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t('irrigation:logDateLabel')}
          type="date"
          required
          max={toDateInputValue(new Date())}
          data-testid="irrigation-log-date"
          error={errors.date && t('common:validation.required')}
          {...register('date')}
        />
        <TextField
          label={t('irrigation:logAmountLabel')}
          type="number"
          step="1"
          min="1"
          max="200"
          inputMode="numeric"
          hint={t('irrigation:logAmountHint')}
          data-testid="irrigation-log-amount"
          {...register('amountMm')}
        />
      </div>

      <Button type="submit" isLoading={log.isPending} data-testid="irrigation-log-submit">
        {t('irrigation:logSubmit')}
      </Button>
    </form>
  );
}

export function IrrigationLedger({ cropId }: { cropId: string }) {
  const { t } = useTranslation(['irrigation', 'common']);
  const { language } = useLanguage();

  const query = useQuery({
    queryKey: queryKeys.crops.irrigationLedger(cropId, 1),
    queryFn: () => cropsApi.irrigationLedger(cropId, { page: 1, limit: 20 }),
  });

  return (
    <QueryBoundary
      query={query}
      loading={<SkeletonList count={2} />}
      isEmpty={(data) => data.data.logs.length === 0}
      empty={<EmptyState title={t('irrigation:ledgerEmpty')} />}
    >
      {(data) => (
        <ul className="space-y-2" data-testid="irrigation-ledger">
          {data.data.logs.map((entry) => (
            <li key={entry.id}>
              <Card className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-sm font-medium">{formatDate(entry.date, language)}</span>
                <Badge tone={entry.amountMm === null ? 'brand' : 'neutral'}>
                  {entry.amountMm === null
                    ? t('irrigation:logFullRefill')
                    : `${formatNumber(entry.amountMm, language)} ${t('common:unit.mm')}`}
                </Badge>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </QueryBoundary>
  );
}
