import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import type { HealthLogSummary } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { SourceLabel } from '@/components/ui/FreshnessDot';
import { IconChevronRight } from '@/components/ui/icons';
import { DiseaseName } from './DiseaseName';

/**
 * Photo-check history.
 *
 * Each row names which tier answered — Local AI, AI-assisted or Guided
 * assessment — because ai-safety rule 6 forbids blending them into one
 * anonymous "AI", and a farmer scrolling their own history should be able to
 * see that yesterday's answer came from a different place than today's.
 */
export function HealthLogList({ logs }: { logs: HealthLogSummary[] }) {
  const { t } = useTranslation(['health', 'agri', 'common']);
  const { language } = useLanguage();

  return (
    <ul className="space-y-3" data-testid="health-log-list">
      {logs.map((log) => (
        <li key={log.id}>
          <Card>
            <Link
              to={`/health/${log.id}`}
              className="flex items-center gap-3 p-3 hover:bg-canvas/60"
              data-testid="health-log-item"
            >
              {log.imageUrl && (
                <img
                  src={log.imageUrl}
                  alt={t('health:photoAlt')}
                  loading="lazy"
                  className="h-16 w-16 shrink-0 rounded-lg object-cover"
                />
              )}

              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="truncate text-sm font-semibold">
                  <DiseaseName code={log.analysis.diseaseCode} />
                </p>
                <p className="text-xs text-ink-500">{formatDateTime(log.createdAt, language)}</p>
                <div className="flex flex-wrap gap-1.5">
                  <SourceLabel sourceLabelKey={log.analysis.sourceLabelKey} />
                  {log.analysis.severityAssessment && (
                    <Badge tone={log.analysis.severityAssessment === 'SEVERE' ? 'danger' : 'neutral'}>
                      {t(`health:severity${toTitleCase(log.analysis.severityAssessment)}`)}
                    </Badge>
                  )}
                </div>
              </div>

              <IconChevronRight size={20} className="shrink-0 text-ink-500" aria-hidden="true" />
            </Link>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** `SEVERE` → `Severe`, to match the `health.severity*` key spelling. */
const toTitleCase = (value: string): string =>
  value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
