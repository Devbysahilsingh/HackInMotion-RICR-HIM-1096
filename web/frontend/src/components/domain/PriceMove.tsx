import { useTranslation } from 'react-i18next';

import type { MarketTrend } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * A price movement, in one line.
 *
 * `▲ 2.4%` / `▼ 3.2%` / `steady` — the design's own vocabulary, and the whole of
 * it. There is no fourth state that guesses: a commodity the signal engine could
 * not describe renders **nothing**, because "we cannot tell" and "it has not
 * moved" are different facts and only one of them is `steady`.
 *
 * The percentage is the engine's `changePct7d`, never recomputed here. A
 * `STABLE` verdict prints the word alone — it is a verdict about a window, not a
 * measurement of zero, and printing `0.0%` beside it would invent a precision
 * the engine never claimed.
 */
export function PriceMove({
  trend,
  changePct,
  className,
}: {
  trend: MarketTrend | null | undefined;
  changePct: number | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation('market');
  const { language } = useLanguage();

  if (!trend) return null;

  if (trend === 'STABLE' || changePct == null) {
    return (
      <span className={cn('text-xs font-medium text-ink-500', className)} data-trend={trend}>
        {t('steady')}
      </span>
    );
  }

  const rising = trend === 'RISING';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-semibold tabular-nums',
        rising ? 'text-leaf-700' : 'text-danger-600',
        className,
      )}
      data-trend={trend}
      data-testid="price-move"
    >
      {/*
        The arrow is decorative — the sign of the number and the colour both
        already carry the direction, and a screen reader announcing "black
        up-pointing triangle" adds nothing (accessibility.md).
      */}
      <span aria-hidden="true">{rising ? '▲' : '▼'}</span>
      {formatNumber(Math.abs(changePct), language, { maximumFractionDigits: 1 })}%
    </span>
  );
}
