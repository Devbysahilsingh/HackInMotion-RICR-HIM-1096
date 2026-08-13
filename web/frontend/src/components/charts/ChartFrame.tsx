import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/cn';
import { CHART } from './theme';

/**
 * The frame every chart sits in: title, legend, the plot, and a table view.
 *
 * The table is not a fallback for a broken chart — it is the accessible
 * equivalent, always available. An SVG plot is unreadable to a screen reader
 * and to anyone who needs the actual numbers, so the same data is one button
 * away in a real `<table>` (accessibility.md; dataviz check 6).
 */
export function ChartFrame({
  title,
  subtitle,
  legend,
  children,
  table,
  isEmpty = false,
  emptyMessage,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Required for ≥2 series; omitted for one, where the title names the series. */
  legend?: { label: string; color: string }[];
  children: ReactNode;
  table: { columns: string[]; rows: (string | number)[][] };
  isEmpty?: boolean;
  emptyMessage?: string;
}) {
  const { t } = useTranslation('common');
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  if (isEmpty) {
    return (
      <figure className="rounded-xl border border-line bg-surface p-4">
        <figcaption className="text-sm font-semibold">{title}</figcaption>
        <p className="py-10 text-center text-sm text-ink-500">
          {emptyMessage ?? t('state.empty')}
        </p>
      </figure>
    );
  }

  return (
    <figure className="rounded-xl border border-line bg-surface p-4" data-testid="chart-frame">
      <figcaption className="mb-1 text-sm font-semibold">{title}</figcaption>
      {subtitle && <p className="mb-3 text-xs text-ink-500">{subtitle}</p>}

      {legend && legend.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-700">
          {legend.map((entry) => (
            <li key={entry.label} className="flex items-center gap-1.5">
              {/* Identity is the coloured mark beside the text, never coloured text. */}
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.label}
            </li>
          ))}
        </ul>
      )}

      <div className="h-56 w-full sm:h-64">{children}</div>

      <button
        type="button"
        aria-expanded={showTable}
        aria-controls={tableId}
        onClick={() => setShowTable((current) => !current)}
        className="mt-2 text-xs font-semibold text-brand-700 underline underline-offset-2"
        data-testid="chart-table-toggle"
      >
        {showTable ? t('action.hideWhy') : t('action.viewAll')}
      </button>

      {showTable && (
        <div id={tableId} className="mt-3 overflow-x-auto" data-testid="chart-table">
          <table className="w-full min-w-max border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-line">
                {table.columns.map((column) => (
                  <th key={column} scope="col" className="px-2 py-1.5 font-semibold">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index} className="border-b border-line/60">
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={cn('px-2 py-1.5', cellIndex > 0 && 'tabular-nums')}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}

/**
 * Tooltip body. Recharts' default renders raw keys and unformatted numbers, so
 * every chart passes its own formatter through this instead.
 */
export function ChartTooltip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: ReactNode;
  rows: { name: string; value: string; color: string }[];
}) {
  if (!active || rows.length === 0) return null;

  return (
    <div
      className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
      style={{ backgroundColor: CHART.surface }}
    >
      {label != null && <p className="mb-1 font-semibold text-ink-900">{label}</p>}
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.name} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="text-ink-500">{row.name}</span>
            <span className="ml-auto font-medium tabular-nums text-ink-900">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
