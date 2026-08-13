/**
 * Locale-aware formatters.
 *
 * All of these take the active language explicitly rather than reading
 * i18next, so they stay pure and testable. Indian digit grouping (₹1,00,000)
 * comes free from the `en-IN`/`hi-IN` locales — it is not hand-rolled
 * (docs/i18n/architecture.md rule 4).
 */
import type { Language } from '@/api/types';

const INTL_LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN' };

export const intlLocale = (language: Language): string => INTL_LOCALE[language] ?? 'en-IN';

/** `null`/`undefined`/NaN render as an em dash, never as "null" or "NaN". */
export const EMPTY_VALUE = '—';

export function formatNumber(
  value: number | null | undefined,
  language: Language,
  options: Intl.NumberFormatOptions = {},
): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  return new Intl.NumberFormat(intlLocale(language), options).format(value);
}

export function formatCurrency(value: number | null | undefined, language: Language): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  return new Intl.NumberFormat(intlLocale(language), {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(
  value: number | null | undefined,
  language: Language,
  fractionDigits = 1,
): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_VALUE;
  return `${new Intl.NumberFormat(intlLocale(language), {
    maximumFractionDigits: fractionDigits,
    signDisplay: 'exceptZero',
  }).format(value)}%`;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(
  value: string | Date | null | undefined,
  language: Language,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  const date = toDate(value);
  if (!date) return EMPTY_VALUE;
  return new Intl.DateTimeFormat(intlLocale(language), options).format(date);
}

export function formatDayMonth(value: string | Date | null | undefined, language: Language): string {
  return formatDate(value, language, { day: 'numeric', month: 'short' });
}

export function formatDateTime(
  value: string | Date | null | undefined,
  language: Language,
): string {
  return formatDate(value, language, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** `<input type="date">` needs an unlocalised ISO day, never a formatted one. */
export function toDateInputValue(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '';
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
}

export interface RelativeAge {
  /** i18n key in the `common` namespace. */
  key: string;
  count: number;
}

/**
 * "3 hours ago" as a key + count, so the caller renders it through `t()` and
 * i18next applies Hindi's plural rules rather than this file guessing them.
 */
export function relativeAge(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): RelativeAge | null {
  const date = toDate(value);
  if (!date) return null;

  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return { key: 'time.justNow', count: 0 };
  if (minutes < 60) return { key: 'time.minutesAgo', count: minutes };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: 'time.hoursAgo', count: hours };

  return { key: 'time.daysAgo', count: Math.floor(hours / 24) };
}

/**
 * The bilingual label the registry attaches to a crop or disease.
 *
 * When the Hindi side is null — which is the whole disease knowledge base
 * today — the English name is shown and the caller is told, so the screen can
 * carry `agri:nameHindiMissing` instead of silently mixing scripts.
 */
export function localizedName(
  names: { en: string; hi?: string | null } | null | undefined,
  language: Language,
): { text: string; isFallback: boolean } | null {
  if (!names?.en) return null;
  if (language === 'hi') {
    return names.hi ? { text: names.hi, isFallback: false } : { text: names.en, isFallback: true };
  }
  return { text: names.en, isFallback: false };
}
