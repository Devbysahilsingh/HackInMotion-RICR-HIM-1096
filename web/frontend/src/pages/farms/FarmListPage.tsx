import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { farmsApi } from '@/api/endpoints';
import { queryKeys } from '@/api/queryKeys';
import { MAX_FARMS_PER_USER } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { PageHeader } from '@/components/layout/AppLayout';
import { ButtonLink } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/states';
import { IconChevronRight, IconLocation, IconPlus } from '@/components/ui/icons';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatNumber } from '@/lib/format';

export default function FarmListPage() {
  const { t } = useTranslation(['farm', 'common', 'agri']);
  const { language } = useLanguage();

  const query = useQuery({ queryKey: queryKeys.farms.list(), queryFn: farmsApi.list });

  const farms = query.data?.farms ?? [];
  const atLimit = farms.length >= MAX_FARMS_PER_USER;

  return (
    <>
      <PageHeader
        title={t('farm:listTitle')}
        description={atLimit ? t('farm:limitHint', { max: MAX_FARMS_PER_USER }) : undefined}
        actions={
          <>
            {/* "What should I plant?" was reachable only from a feed item —
                give it a durable entry where the farmer thinks about land. */}
            {farms.length > 0 && (
              <ButtonLink to="/crop-recommendation" variant="ghost">
                {t('cropRec:pageTitle')}
              </ButtonLink>
            )}
            {!atLimit && (
              <ButtonLink to="/farms/new" leadingIcon={<IconPlus size={18} />}>
                {t('common:action.add')}
              </ButtonLink>
            )}
          </>
        }
      />

      <QueryBoundary
        query={query}
        isEmpty={(data) => data.farms.length === 0}
        empty={
          <EmptyState
            title={t('farm:listEmpty')}
            action={
              <ButtonLink to="/farms/new" leadingIcon={<IconPlus size={18} />}>
                {t('farm:listEmptyCta')}
              </ButtonLink>
            }
          />
        }
      >
        {(data) => (
          <ul className="space-y-3" data-testid="farm-list">
            {data.farms.map((farm) => (
              <li key={farm.id}>
                <Card>
                  <Link
                    to={`/farms/${farm.id}`}
                    className="flex items-center gap-3 p-4 hover:bg-canvas/60"
                    data-testid="farm-list-item"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <h2 className="truncate text-base font-semibold">{farm.name}</h2>
                      <p className="flex items-center gap-1.5 text-sm text-ink-500">
                        <IconLocation size={15} aria-hidden="true" />
                        {farm.location.district}, {farm.location.state}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Badge>
                          {formatNumber(farm.sizeValue, language)}{' '}
                          {t(`common:unit.${farm.sizeUnit}`)}
                        </Badge>
                        <Badge>{t(`agri:soil.${farm.soilType}`)}</Badge>
                        <Badge>{t(`agri:irrigationMethod.${farm.irrigationMethod}`)}</Badge>
                      </div>
                    </div>
                    <IconChevronRight
                      size={20}
                      className="shrink-0 text-ink-500"
                      aria-hidden="true"
                    />
                  </Link>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </QueryBoundary>
    </>
  );
}
