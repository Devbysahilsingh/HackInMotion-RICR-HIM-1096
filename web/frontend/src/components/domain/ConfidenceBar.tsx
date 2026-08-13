import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/i18n/LanguageContext';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

export type ConfidenceKind = 'CALIBRATED' | 'BAND' | 'MATCH_SCORE';

/**
 * How sure the system is — and, just as importantly, *what kind* of sureness
 * it is.
 *
 * The three kinds are not interchangeable and are deliberately rendered
 * differently:
 *
 * - `CALIBRATED` — a temperature-scaled probability from the local model. This
 *   is the only one a number may be printed for.
 * - `BAND` — the AI tier's HIGH/MEDIUM/LOW, which the backend maps onto 0.85 /
 *   0.65 / 0.4 purely so the value is comparable internally. Those numbers are
 *   **not measurements** (constants.js: "These are NOT measured probabilities
 *   and must never be presented as one"), so this component shows the band's
 *   words and no percentage at all.
 * - `MATCH_SCORE` — the rule engine's weighted symptom score. Also not a
 *   probability; shown as a proportion of the match, labelled as such.
 */
export function ConfidenceBar({
  confidence,
  kind,
  band,
  className,
}: {
  confidence: number | null | undefined;
  kind: ConfidenceKind | string | null | undefined;
  band?: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  className?: string;
}) {
  const { t } = useTranslation(['health', 'common']);
  const { language } = useLanguage();

  if (confidence == null && !band) return null;

  const showsNumber = kind === 'CALIBRATED' && confidence != null;
  const fraction = Math.max(0, Math.min(1, confidence ?? 0));

  const bandLabel = band ? t(`health:confidenceBand${band}`) : null;

  const tone =
    fraction >= 0.75 ? 'bg-brand-600' : fraction >= 0.5 ? 'bg-priority-medium' : 'bg-priority-high';

  return (
    <div className={cn('space-y-1.5', className)} data-testid="confidence-bar">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink-700">{t('health:confidenceHeading')}</span>
        <span className="text-sm font-semibold text-ink-900" data-testid="confidence-value">
          {showsNumber
            ? `${formatNumber(fraction * 100, language, { maximumFractionDigits: 0 })}%`
            : (bandLabel ?? '—')}
        </span>
      </div>

      <div
        className="h-2 w-full overflow-hidden rounded-full bg-line"
        role="meter"
        aria-valuenow={Math.round(fraction * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('health:confidenceHeading')}
      >
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${fraction * 100}%` }} />
      </div>

      {/*
        Said out loud rather than implied by the absence of a number: a band is
        not a probability, and a farmer reading "medium" deserves to know that
        is a category and not a measurement.
      */}
      {!showsNumber && (
        <p className="text-xs text-ink-500">{t('health:confidenceNotProbability')}</p>
      )}
    </div>
  );
}
