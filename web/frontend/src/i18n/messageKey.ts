/**
 * Backend `messageKey` → rendered text.
 *
 * The API speaks in `namespace.key` (`errors.validation`,
 * `irrigation.titleIRRIGATE_TODAY`, `fertilizer.schedule.basal.full`) while
 * i18next addresses namespaces with a colon. The split is on the **first** dot
 * only, because everything after it is part of the flat key.
 */
import type { TFunction } from 'i18next';

import { NAMESPACES } from './resources';

const KNOWN = new Set<string>(NAMESPACES);

export interface ResolvedMessageKey {
  namespace: string;
  key: string;
  /** i18next-addressable form, e.g. `fertilizer:schedule.basal.full`. */
  full: string;
  /** False when the API named a namespace this client does not ship. */
  known: boolean;
}

export function resolveMessageKey(messageKey: string): ResolvedMessageKey {
  const dot = messageKey.indexOf('.');

  if (dot === -1) {
    return { namespace: 'common', key: messageKey, full: `common:${messageKey}`, known: false };
  }

  const namespace = messageKey.slice(0, dot);
  const key = messageKey.slice(dot + 1);

  return { namespace, key, full: `${namespace}:${key}`, known: KNOWN.has(namespace) };
}

/**
 * Renders a `messageKey` with its interpolation params.
 *
 * A key from an unknown namespace, or one with no translation, falls back to
 * the generic internal-error string rather than printing a raw identifier at a
 * farmer — the exact failure the backend's key-scanner test exists to prevent,
 * caught a second time here at the render edge.
 */
export function translateMessageKey(
  t: TFunction,
  messageKey: string | null | undefined,
  params?: Record<string, unknown>,
): string {
  if (!messageKey) return t('errors:internal');

  const resolved = resolveMessageKey(messageKey);
  if (!resolved.known) return t('errors:internal');

  const value = t(resolved.full, { ...params, defaultValue: '' });
  return value || t('errors:internal');
}
