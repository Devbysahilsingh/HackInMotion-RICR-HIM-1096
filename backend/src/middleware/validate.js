/**
 * Zod request validation → canonical 422 envelope.
 *
 * Every endpoint validates before it touches a service (docs/database/
 * validation.md). Parsed output replaces the raw input, so handlers receive
 * only declared, coerced fields — an unknown property cannot ride along into
 * a Mongoose document.
 */
import { validationError } from '../utils/errors.js';

/**
 * Zod issues are reshaped into the documented `details: [{field, rule}]` form.
 * `rule` is the failure kind, not prose: the client renders from messageKey,
 * and echoing input back into an error body is how reflected data leaks.
 */
function toDetails(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    rule: issue.code,
  }));
}

/**
 * @param {{ body?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny }} schemas
 */
export function validate(schemas) {
  return (req, res, next) => {
    for (const source of ['params', 'query', 'body']) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (!result.success) {
        return next(validationError(toDetails(result.error)));
      }

      if (source === 'query') {
        // Express 5 exposes req.query through a getter — assign, do not mutate.
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else {
        req[source] = result.data;
      }
    }

    next();
  };
}
