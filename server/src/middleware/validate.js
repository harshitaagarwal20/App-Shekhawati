/**
 * Zod request validation.
 *
 * Replaces req.body / req.query / req.params with the PARSED result, so
 * controllers receive coerced, stripped values and never see an unexpected
 * field. A failure becomes a 422 with field-level detail the React forms can
 * map straight onto their inputs.
 */

import { ApiError } from '../utils/ApiError.js';

function formatIssues(error) {
  const fields = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    (fields[path] ??= []).push(issue.message);
  }
  return fields;
}

/**
 * @param {{body?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny,
 *          params?: import('zod').ZodTypeAny}} schemas
 */
export function validate(schemas) {
  return (req, _res, next) => {
    for (const key of ['params', 'query', 'body']) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key]);
      if (!result.success) {
        return next(
          ApiError.unprocessable(`Invalid request ${key}`, {
            in: key,
            fields: formatIssues(result.error),
          }),
        );
      }
      // req.query is a getter on Express 5; assign defensively.
      try {
        req[key] = result.data;
      } catch {
        Object.defineProperty(req, key, { value: result.data, writable: true, configurable: true });
      }
    }
    next();
  };
}

export default validate;
