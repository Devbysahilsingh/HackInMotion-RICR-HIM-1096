import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TraceStep } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { IconChevronDown } from '@/components/ui/icons';

/**
 * The explainability UI.
 *
 * Engines are required to emit a trace with every verdict (rule R12: "no
 * recommendation without trace data"), and this is where that promise is
 * redeemed for a farmer: every number the engine used, grouped by the step
 * that used it.
 *
 * The trace is deliberately **not** typed per engine. Each engine names its own
 * fields, and a fixed schema here would have to be edited every time one of
 * them learned a new number — and would silently drop anything it did not know
 * about. So this walks whatever it is given: scalars become rows, nested
 * arrays become counts, and nothing is hidden.
 *
 * Field names stay in their engine spelling (`tawMm`, `rawMm`, `changePct7d`).
 * They are not translated, because translating a variable name would make the
 * trace impossible to check against the engine that produced it — and the
 * plain-language version of the same verdict is already on screen above,
 * rendered from the recommendation's own i18n keys.
 */
/**
 * What a caller may hand this component.
 *
 * Deliberately wider than `TraceStep[]`, because the feed's own `data.trace`
 * is **polymorphic** and the API is entitled to be: an irrigation item carries
 * the engine's array of steps, while a weather-risk item carries
 * `risk.data` — a flat object of the numbers that were compared against a
 * threshold (`feedComposer.js`: `trace: risk.data`). Both satisfy R12; only
 * one of them is an array. Accepting a bare object and presenting it as a
 * single step is what keeps a CRITICAL rain warning from claiming "no
 * calculation details were recorded" while its numbers sit in the payload.
 */
export type TraceInput = TraceStep[] | Record<string, unknown> | null | undefined;

export function WhyTrace({
  trace,
  className,
  defaultOpen = false,
}: {
  trace: TraceInput;
  className?: string;
  defaultOpen?: boolean;
}) {
  const { t } = useTranslation('common');
  const { language } = useLanguage();
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  const steps = normalizeTrace(trace);

  return (
    <div className={cn('rounded-lg border border-line bg-canvas', className)}>
      <button
        type="button"
        data-testid="why-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="touch-target flex w-full items-center justify-between gap-2 px-3 text-left text-sm font-medium text-ink-700"
      >
        <span>{open ? t('action.hideWhy') : t('action.showWhy')}</span>
        <IconChevronDown size={18} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div id={panelId} data-testid="why-trace" className="border-t border-line px-3 py-3">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-500">
            {t('why.heading')}
          </p>

          {steps.length === 0 ? (
            <p className="text-sm text-ink-500">{t('why.noTrace')}</p>
          ) : (
            <ol className="space-y-3">
              {steps.map((step, index) => (
                <TraceStepRow
                  key={`${String(step.step)}-${index}`}
                  step={step}
                  language={language}
                />
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Coerces whatever the API sent into a list of steps.
 *
 * An array passes through. A bare object becomes one step named `VALUES` —
 * it has no step name of its own, and inventing a specific-sounding one would
 * imply an engine phase that never existed. Anything else (a string, a number,
 * null) yields nothing, and the component says so honestly.
 */
function normalizeTrace(trace: TraceInput): TraceStep[] {
  if (Array.isArray(trace)) return trace;
  if (trace && typeof trace === 'object' && Object.keys(trace).length > 0) {
    return [{ step: 'VALUES', ...trace }];
  }
  return [];
}

function TraceStepRow({
  step,
  language,
}: {
  step: TraceStep;
  language: Parameters<typeof formatNumber>[1];
}) {
  const { step: name, ...fields } = step;
  const entries = Object.entries(fields);

  return (
    <li className="rounded-md bg-surface px-3 py-2">
      <p className="text-xs font-semibold text-brand-700">{String(name)}</p>

      {entries.length > 0 && (
        <dl className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs">
          {entries.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="truncate text-ink-500">{key}</dt>
              <dd className="text-right font-mono tabular-nums text-ink-900">
                {renderValue(value, language)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

function renderValue(value: unknown, language: Parameters<typeof formatNumber>[1]): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') {
    return formatNumber(value, language, { maximumFractionDigits: 3 });
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === 'object') return '{…}';
  return String(value);
}
