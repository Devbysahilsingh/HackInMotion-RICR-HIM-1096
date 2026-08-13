/**
 * Turns any thrown value into a sentence a farmer can read.
 *
 * The API answers with a `messageKey`, never prose, so this is the only place
 * that mapping happens on this client — which is what keeps a raw `AxiosError`
 * or an `[object Object]` from ever reaching a screen.
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { isApiError, validationDetails } from '@shared/client/errors';

import { translateMessageKey } from '../i18n/messageKey';

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

export type FieldErrors = Record<string, string>;

/**
 * Attaches a 422's `details` to the fields that caused them.
 *
 * The server sends `[{field, rule}]` — the failure *kind*, never an echo of
 * the submitted value (that echo is how reflected data leaks, so
 * `middleware/validate.js` deliberately omits it). The rule is mapped onto the
 * same `common:validation.*` strings the client-side checks use, so a field
 * rejected by the server reads identically to one rejected on the device.
 *
 * Returns a plain map rather than driving a form library: these screens use
 * `useState` forms, not react-hook-form, because the mobile forms are short
 * and a resolver stack is not worth its bundle here.
 */
export function useServerFieldErrors(): (
  error: unknown,
  knownFields: readonly string[],
) => FieldErrors {
  const { t } = useTranslation('common');

  return useCallback(
    (error, knownFields) => {
      const placed: FieldErrors = {};

      for (const detail of validationDetails(error)) {
        const field = detail.field ?? detail.path;
        if (!field || !knownFields.includes(field)) continue;

        placed[field] =
          detail.rule === 'invalid_string' ? t('validation.email') : t('validation.required');
      }

      return placed;
    },
    [t],
  );
}
