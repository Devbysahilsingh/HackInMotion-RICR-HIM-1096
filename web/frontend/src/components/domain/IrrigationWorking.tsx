import { useTranslation } from 'react-i18next';

import type { IrrigationAdvice, TraceStep } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { formatDayMonth, formatNumber } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { KeyValueList, KeyValueRow } from '@/components/ui/KeyValueRow';

/**
 * The reasoning behind a watering verdict, shown on the page rather than hidden
 * behind a disclosure.
 *
 * The product's earlier answer to "why?" was `WhyTrace` — a collapsed dump of
 * every step the engine took, in the engine's own field names. That is the
 * right artefact for an auditor and the wrong one for a farmer: it is closed by
 * default, so the reasoning was effectively absent, and open it reads as
 * telemetry. This shows the handful of figures that actually moved the verdict,
 * named in the farmer's language, always visible.
 *
 * Nothing is computed here. Every number is lifted from the advice payload or
 * from a named step of the engine's own trace, and a figure the engine did not
 * produce is a row that does not render — never a zero, never an estimate.
 * (`WhyTrace` still exists on the crop screen for the full audit trail; this is
 * the readable summary, not a replacement for provenance.)
 */
export function IrrigationWorking({
  advice,
  et0Mm = null,
  variant = 'full',
  className,
}: {
  advice: IrrigationAdvice;
  /**
   * Today's reference evapotranspiration, from the weather snapshot. The
   * irrigation response does not carry it at the top level — it is an input to
   * the balance, not an output of it — so the weather screen passes its own.
   */
  et0Mm?: number | null;
  /**
   * `compact` is the weather screen's five-row summary; `full` is the
   * irrigation screen's soil-to-verdict working.
   */
  variant?: 'full' | 'compact';
  className?: string;
}) {
  const { t } = useTranslation(['irrigation', 'weather', 'crop', 'agri', 'common']);
  const { language } = useLanguage();

  const soil = traceStep(advice.trace, 'SOIL');
  const reservoir = traceStep(advice.trace, 'RESERVOIR');
  const depletionFraction = traceStep(advice.trace, 'DEPLETION_FRACTION');

  const mm = (value: number) =>
    `${formatNumber(value, language, { maximumFractionDigits: 0 })} ${t('common:unit.mm')}`;

  const rows: Array<{ label: string; value: string } | null> = [];

  if (variant === 'full') {
    const soilType = readString(soil, 'soilType');
    const awc = readNumber(soil, 'awcMmPerM');
    if (soilType) {
      rows.push({
        label: t('irrigation:soilWaterLabel'),
        value: [
          t(`agri:soil.${soilType}`),
          awc != null
            ? `${formatNumber(awc, language, { maximumFractionDigits: 0 })} ${t('common:unit.mm')}/m`
            : null,
        ]
          .filter(Boolean)
          .join(' · '),
      });
    }

    const rootDepth = readNumber(soil, 'effectiveRootDepthM');
    if (rootDepth != null && advice.stage) {
      rows.push({
        label: t('irrigation:rootDepthLabel', { stage: t(`agri:stage.${advice.stage}`) }),
        value: `${formatNumber(rootDepth, language, { maximumFractionDigits: 2 })} m`,
      });
    }

    const taw = advice.tawMm ?? readNumber(reservoir, 'tawMm') ?? readNumber(soil, 'tawMm');
    if (taw != null) rows.push({ label: t('irrigation:tawLabel'), value: mm(taw) });

    const p = readNumber(depletionFraction, 'p') ?? readNumber(reservoir, 'p');
    if (p != null) {
      rows.push({
        label: t('irrigation:pLabel'),
        value: formatNumber(p, language, { maximumFractionDigits: 2 }),
      });
    }
  }

  const raw = advice.rawMm ?? readNumber(reservoir, 'rawMm');
  if (raw != null) rows.push({ label: t('irrigation:rawLabel'), value: mm(raw) });

  if (advice.depletionMm != null) {
    rows.push({ label: t('irrigation:deficitTodayLabel'), value: mm(advice.depletionMm) });
  }

  if (advice.rain) {
    rows.push({
      label: t('irrigation:forecastRainLabel'),
      value: `${mm(advice.rain.mm)} · ${formatDayMonth(advice.rain.date, language)}`,
    });
  }

  if (variant === 'compact') {
    if (et0Mm != null) {
      rows.push({
        label: t('weather:et0Reference'),
        value: `${formatNumber(et0Mm, language, { maximumFractionDigits: 1 })} ${t('weather:et0PerDay')}`,
      });
    }
    if (advice.kc != null) {
      rows.push({
        label: t('crop:kcLabel'),
        value: formatNumber(advice.kc, language, { maximumFractionDigits: 2 }),
      });
    }
  }

  const verdict = advice.verdict ?? 'UNAVAILABLE';
  const params = {
    ...advice,
    days: advice.days ?? 0,
    amountMm: advice.amountMm ?? 0,
    amountLitersPerAcre: advice.amountLitersPerAcre ?? 0,
    rainMm: advice.rain?.mm ?? 0,
    date: advice.rain?.date ? formatDayMonth(advice.rain.date, language) : '',
  };

  /*
   * The plain-language sentence is the engine's own `body{VERDICT}` string —
   * the same one the verdict card shows. Writing a second explanation here
   * would be the UI authoring agronomy (rule 6), and the two would drift.
   */
  const explanation = translateMessageKey(t, `irrigation.body${verdict}`, params);

  const shown = rows.filter((row): row is { label: string; value: string } => row !== null);
  if (shown.length === 0 && !advice.hasVerdict) return null;

  return (
    <Card className={className} data-testid="irrigation-working">
      <div className="p-5">
        <h3 className="kicker">
          {variant === 'compact' ? t('irrigation:whyHeading') : t('irrigation:howWorkedOut')}
        </h3>

        <KeyValueList className="mt-2">
          {shown.map((row) => (
            <KeyValueRow key={row.label} label={row.label} value={row.value} />
          ))}

          {advice.hasVerdict && (
            <KeyValueRow
              label={
                <span className="font-semibold text-ink-900">{t('irrigation:verdictLabel')}</span>
              }
              value={
                <span className="text-brand-600">
                  {translateMessageKey(t, `irrigation.title${verdict}`, params)}
                </span>
              }
            />
          )}
        </KeyValueList>

        <p className="mt-3.5 text-sm leading-relaxed text-ink-700" data-testid="irrigation-plain">
          {explanation}
        </p>

        {/*
          Provenance, in one line rather than a table: which provider the
          forecast behind this came from, and how old it is (rule 9).
        */}
        {advice.freshness.source && (
          <p className="mt-2 text-xs text-ink-500">
            {t('weather:sourceCaption', { source: advice.freshness.source })}
          </p>
        )}

        {advice.soilUncertaintyWide && (
          <p className="mt-1.5 text-xs text-ink-500" data-testid="irrigation-soil-uncertain">
            {t('irrigation:soilUnknown')}
          </p>
        )}
      </div>
    </Card>
  );
}

/** The named step of an engine trace, or null when the branch never pushed it. */
function traceStep(trace: TraceStep[] | undefined, step: string): TraceStep | null {
  return trace?.find((entry) => entry.step === step) ?? null;
}

function readNumber(step: TraceStep | null, field: string): number | null {
  const value = step?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readString(step: TraceStep | null, field: string): string | null {
  const value = step?.[field];
  return typeof value === 'string' ? value : null;
}
