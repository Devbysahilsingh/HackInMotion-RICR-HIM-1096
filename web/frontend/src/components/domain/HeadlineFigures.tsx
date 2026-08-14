import { useTranslation } from 'react-i18next';

import type { FeedItem } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * The three big numbers under a decision.
 *
 * The design puts a row of large figures directly beneath the verdict —
 * *94% rain probability · 31 mm expected by Friday · Sat next review*. It is the
 * band's evidence at a glance, for a farmer who will not open the full trace.
 *
 * The mockup's figures were chosen by a designer for one imagined item. Nothing
 * generic can reproduce that judgement, and inventing a "headline figures"
 * concept the API does not have would mean this component deciding what matters
 * — so instead it reads the fields the feed composer genuinely emits
 * (`backend/src/engines/feedComposer`): the irrigation depth and interval, the
 * lead time on a weather risk, the market momentum.
 *
 * Consequences of doing it this way, all deliberate:
 *
 *   - A field the engines stop emitting simply stops rendering. No hole, no
 *     stale label, no "—" pretending a number was measured.
 *   - A field this map does not know about is **not** shown rather than being
 *     shown under its raw engine spelling. The full trace below is where every
 *     field appears verbatim; this row is the curated surface and is allowed to
 *     be small.
 *   - Nothing is derived, rounded into a different meaning, or combined. Each
 *     figure is one number the engine put in the payload.
 *
 * This is a map over *field names*, not over crop codes — rule 4 is untouched.
 */

/** Fields worth enlarging, with the unit each is expressed in. */
const FIGURES = [
  { field: 'amountMm', labelKey: 'figure.amountMm', unitKey: 'unit.mm' },
  { field: 'amountLitersPerAcre', labelKey: 'figure.litersPerAcre', unitKey: null },
  { field: 'days', labelKey: 'figure.days', unitKey: null },
  { field: 'daysAhead', labelKey: 'figure.daysAhead', unitKey: null },
  { field: 'changePct7d', labelKey: 'figure.changePct7d', unitKey: 'unit.percent' },
  { field: 'changePct30d', labelKey: 'figure.changePct30d', unitKey: 'unit.percent' },
] as const;

/** How many fit on the band before the row stops being scannable. */
const MAX_FIGURES = 3;

export function HeadlineFigures({
  item,
  className,
  tone = 'onDark',
}: {
  item: FeedItem;
  className?: string;
  /** `onDark` sits on a coloured band; `light` on a white card. */
  tone?: 'onDark' | 'light';
}) {
  const { t } = useTranslation('common');
  const { language } = useLanguage();

  const data = item.data;

  const shown = FIGURES.filter((figure) => typeof data[figure.field] === 'number')
    .slice(0, MAX_FIGURES)
    .map((figure) => {
      const value = data[figure.field] as number;
      return {
        key: figure.field,
        // Percentages keep one decimal; depths and counts read better whole.
        value: formatNumber(value, language, {
          maximumFractionDigits: figure.unitKey === 'unit.percent' ? 1 : 0,
        }),
        unit: figure.unitKey ? t(figure.unitKey) : null,
        label: t(figure.labelKey),
      };
    });

  if (shown.length === 0) return null;

  return (
    <dl data-testid="headline-figures" className={cn('flex flex-wrap gap-x-7 gap-y-4', className)}>
      {shown.map((figure) => (
        <div key={figure.key}>
          <dd
            className={cn(
              'font-display text-[1.875rem] font-extrabold leading-none tracking-[-0.03em]',
              tone === 'onDark' ? 'text-white' : 'text-ink-900',
            )}
          >
            {figure.value}
            {figure.unit && <span className="ml-1 text-[1.25rem]">{figure.unit}</span>}
          </dd>
          <dt
            className={cn(
              'mt-1.5 text-[0.781rem] font-medium',
              tone === 'onDark' ? 'text-white/70' : 'text-ink-500',
            )}
          >
            {figure.label}
          </dt>
        </div>
      ))}
    </dl>
  );
}
