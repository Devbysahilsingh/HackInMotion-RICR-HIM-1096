import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseFormSetError, FieldValues, Path } from 'react-hook-form';

import { isApiError, validationDetails } from '@/api/errors';
import { translateMessageKey } from '@/i18n/messageKey';

/**
 * Turns any thrown value into a sentence a farmer can read.
 *
 * The API answers with a `messageKey`, never prose, so this is the only place
 * that mapping happens on the client — which is what keeps a raw `AxiosError`
 * or an `[object Object]` from ever reaching a screen.
 */
export function useApiErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation(['errors', 'common']);

  return useCallback(
    (error: unknown) => {
      if (isApiError(error)) return translateMessageKey(t, error.messageKey);
      return t('errors:unexpected');
    },
    [t],
  );
}

/**
 * Attaches a 422's `details` to the fields that caused them.
 *
 * The server sends `[{field, rule}]` — the failure *kind*, never an echo of
 * the submitted value (that echo is how reflected data leaks, so
 * `middleware/validate.js` deliberately omits it). The rule is mapped onto the
 * same `common:validation.*` strings client-side validation already uses, so a
 * field rejected by the server reads identically to one rejected in the
 * browser.
 *
 * @returns the fields it managed to place, so a caller can decide whether a
 *          top-level banner is still needed.
 */
export function useServerValidation<T extends FieldValues>(): (
  error: unknown,
  setError: UseFormSetError<T>,
  knownFields: readonly string[],
) => string[] {
  const { t } = useTranslation('common');

  return useCallback(
    (error, setError, knownFields) => {
      const placed: string[] = [];

      /** Zod issue code → the shared validation vocabulary. */
      const ruleMessage = (rule: string | undefined): string =>
        rule === 'invalid_string' ? t('validation.email') : t('validation.required');

      for (const detail of validationDetails(error)) {
        const field = detail.field ?? detail.path;
        if (!field || !knownFields.includes(field)) continue;

        setError(field as Path<T>, { type: 'server', message: ruleMessage(detail.rule) });
        placed.push(field);
      }

      return placed;
    },
    [t],
  );
}
