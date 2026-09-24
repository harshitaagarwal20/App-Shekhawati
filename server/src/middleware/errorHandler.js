/**
 * Terminal error handling.
 *
 * Anything that is not an ApiError is treated as an unexpected fault: logged in
 * full, reported to the client as a bare 500. Prisma's known error codes are
 * translated into the ApiError the caller deserves (409 on a unique violation,
 * 404 on a missing record) rather than leaking a raw driver message.
 */

import { Prisma } from '@prisma/client';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';

export function notFound(req, _res, next) {
  next(new ApiError(404, `No route for ${req.method} ${req.originalUrl}`, { code: 'NO_ROUTE' }));
}

function translatePrisma(err) {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002': {
        const target = Array.isArray(err.meta?.target)
          ? err.meta.target.join(', ')
          : (err.meta?.target ?? 'field');
        return ApiError.conflict(`A record with this ${target} already exists`, { target });
      }
      case 'P2003':
        return ApiError.badRequest('Referenced record does not exist', {
          field: err.meta?.field_name,
        });
      case 'P2025':
        return ApiError.notFound('Record');
      case 'P2014':
        return ApiError.conflict('This record is referenced by other documents and cannot be changed');
      /*
       * The database went away underneath a request that had already started.
       *
       * PrismaClientInitializationError below covers a database that was
       * missing when the pool was built; these are the same condition arriving
       * mid-request, and they are KnownRequestErrors, so they used to miss that
       * branch and fall through to the bare 500. An outage reported as 500
       * "Something went wrong" reads as an application fault and sends whoever
       * is on call to the wrong place - a 503 says plainly that the dependency
       * is down and the request is worth retrying.
       */
      case 'P1001': // can't reach database server
      case 'P1002': // database server timed out
      case 'P1008': // operation timed out
      case 'P1017': // server has closed the connection
        return new ApiError(503, 'The database is unavailable. Try again shortly.', {
          code: 'DB_UNAVAILABLE',
          details: { prismaCode: err.code },
        });
      default:
        return null;
    }
  }
  if (err instanceof Prisma.PrismaClientValidationError) {
    return ApiError.badRequest('Malformed database query');
  }
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return new ApiError(503, 'Database is unavailable', { code: 'DB_UNAVAILABLE' });
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return translatePostgres(err);
  }
  return null;
}

/**
 * Driver-level faults that Prisma does not give a P-code to.
 *
 * These arrive as PrismaClientUnknownRequestError with the PostgreSQL SQLSTATE
 * buried in the message, and every one of them is the caller's input rather
 * than a fault in this server - a quantity too large for its column, a NUL byte
 * pasted into a remark. Reported as a 500 they read as "the ERP is broken",
 * which sends someone looking in the wrong place; the SQLSTATE says precisely
 * what was wrong with the request, so it is worth reading.
 *
 * Anything not listed here still falls through to the bare 500, logged in full.
 */
/**
 * A CHECK-constraint violation, in the language of the office.
 *
 * ---------------------------------------------------------------------------
 *  WHY THIS IS WORTH THE TROUBLE
 *
 *  There are over two hundred CHECK constraints in this schema, and every one
 *  of them encodes a business rule: a quantity that must be positive, a
 *  delivery that must follow its order, a receipt that cannot exceed what was
 *  issued. Reaching one is almost always the CALLER's mistake, not a fault in
 *  this server - but SQLSTATE 23514 arrives as a PrismaClientUnknownRequestError
 *  and used to fall straight through to the bare 500. An order typed with a
 *  quantity of 0.00001, or a delivery date before its order date, answered
 *  "Something went wrong", which sends somebody looking in the server logs for
 *  a problem that is sitting in the form in front of them.
 *
 *  WHY THE CONSTRAINT NAME IS ENOUGH
 *
 *  The names in this schema are written as sentences on purpose -
 *  `buyer_orders_delivery_after_order`, `dye_issues_received_within_issued`,
 *  `cutting_issues_remainder_reconciles`. Stripping the table prefix and
 *  replacing the underscores gets most of the way to a usable sentence without
 *  a lookup table that would have to be kept in step with 208 constraints and
 *  would rot the first time somebody added the 209th.
 *
 *  The handful below are spelled out because they are the ones an ordinary
 *  day's typing actually hits, and because "effective qty positive" is a worse
 *  sentence than the one a person would say.
 * ---------------------------------------------------------------------------
 */
const CHECK_MESSAGES = {
  buyer_orders_qty_positive: 'The order quantity must be greater than zero.',
  buyer_orders_effective_qty_positive:
    'The order quantity must be greater than zero. A quantity below 0.0001 rounds to zero at the '
    + 'precision quantities are stored to.',
  buyer_orders_delivery_after_order: 'The delivery date cannot be before the order date.',
  buyer_orders_excess_range: 'The excess percentage must be between 0 and 100.',
  buyer_orders_excess_approved_within_requested:
    'More excess cannot be granted than was asked for.',
  plannings_qty_positive: 'The planned quantity must be greater than zero.',
  // Zero is allowed on both of these and means "sampling has not decided it
  // yet" - see the C9 note in migrations/20260924000000_style_utilisation_zero_allowed.
  // A violation is therefore a NEGATIVE figure, and says so.
  styles_avg_utilization_non_negative:
    'The average fabric utilisation cannot be negative. Leave it at 0 if sampling has not '
    + 'decided it yet - the style saves, and the purchase order and cutting challan will ask '
    + 'for the figure when they need it.',
  style_bom_lines_utilisation_non_negative:
    'A BOM line\'s utilisation per piece cannot be negative. Leave it at 0 if it is not '
    + 'decided yet.',
  style_bom_lines_wastage_range:
    'Wastage must be a fraction between 0 and 1 - enter 0.05 for 5%, not 5.',
  stock_balances_qty_non_negative:
    'This movement would take the stock balance below zero.',
  fabric_rolls_balance_non_negative:
    'This would issue more from the roll than it has left.',
  fabric_rolls_balance_within_received:
    'A roll cannot hold more than it received.',
  dye_issues_received_within_issued:
    'More cannot be received back from the job worker than was sent out.',
  grns_invoice_total_is_the_sum:
    'The invoice total must equal the taxable value plus the tax on it.',
};

/** Turns `buyer_orders_delivery_after_order` into `delivery after order`. */
function ruleFromConstraint(constraint, relation) {
  if (!constraint) return null;
  const rule = relation && constraint.startsWith(`${relation}_`)
    ? constraint.slice(relation.length + 1)
    : constraint;
  return rule.replace(/_/g, ' ').trim() || null;
}

function describeCheckViolation(err) {
  const constraint = /check constraint\s+\\?"([a-z0-9_]+)\\?"/i.exec(err.message)?.[1] ?? null;
  const relation = /relation\s+\\?"([a-z0-9_]+)\\?"/i.exec(err.message)?.[1] ?? null;

  if (constraint && CHECK_MESSAGES[constraint]) {
    return { message: CHECK_MESSAGES[constraint], constraint, relation };
  }

  const rule = ruleFromConstraint(constraint, relation);
  return {
    message: rule
      ? `This document breaks a rule the system enforces: ${rule}. Check the figures and dates on it.`
      : 'A value on this document breaks one of the rules the system enforces.',
    constraint,
    relation,
  };
}

function translatePostgres(err) {
  const sqlstate = /code: "([0-9A-Z]{5})"/.exec(err.message)?.[1];
  switch (sqlstate) {
    case '23514': {
      // check_violation - a business rule, and therefore the caller's to fix.
      const { message, constraint, relation } = describeCheckViolation(err);
      return ApiError.badRequest(message, { sqlstate, constraint, relation });
    }
    case '22003': // numeric_value_out_of_range
      return ApiError.badRequest(
        'A number in this document is too large for the field it goes in.',
        { sqlstate },
      );
    case '22001': // string_data_right_truncation
      return ApiError.badRequest('A text field in this document is too long.', { sqlstate });
    case '22021': // character_not_in_repertoire
    case '22P05': // untranslatable_character
      return ApiError.badRequest(
        'This document contains a character the database cannot store. Retype or re-paste the text.',
        { sqlstate },
      );
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow
      return ApiError.badRequest('A date in this document is not a real date.', { sqlstate });
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return ApiError.conflict(
        'Someone else was changing the same records. Try again.',
        { sqlstate },
      );
    case '53300': // too_many_connections
      return new ApiError(503, 'Database is busy. Try again shortly.', { code: 'DB_UNAVAILABLE' });
    default:
      return null;
  }
}

/**
 * Errors raised by Express and its body parser before any of our code runs.
 *
 * They already carry the right status and a safe message - a 1MB body arriving
 * as PayloadTooLargeError(413), a truncated JSON body as SyntaxError(400) - and
 * only reached the bare-500 branch because nothing here was looking at them.
 * `expose` is body-parser's own signal that the message is safe to send on.
 */
function translateHttp(err) {
  const status = err.status ?? err.statusCode;
  if (!Number.isInteger(status) || status < 400 || status > 499) return null;

  if (err.type === 'entity.too.large' || status === 413) {
    return new ApiError(413, 'This request is too large.', { code: 'PAYLOAD_TOO_LARGE' });
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return ApiError.badRequest('The request body is not valid JSON.');
  }
  return err.expose ? new ApiError(status, err.message) : new ApiError(status, 'Request refused');
}

// `_next` is unused but must be declared: Express identifies an error
// handler by its arity of four.
export function errorHandler(err, req, res, _next) {
  let error = err instanceof ApiError ? err : (translatePrisma(err) ?? translateHttp(err));

  if (!error) {
    process.stderr.write(
      `\n[${new Date().toISOString()}] Unhandled error on ${req.method} ${req.originalUrl}\n${err?.stack ?? err}\n\n`,
    );
    error = new ApiError(500, 'Something went wrong', { code: 'INTERNAL_ERROR' });
  }

  // ONE SHAPE, TWO READINGS.
  //
  //   { success: false, code: "INSUFFICIENT_STOCK",
  //     message: "Cannot issue fabric because available stock is insufficient.",
  //     error: { code, message, details } }
  //
  // `code` and `message` are lifted to the top level because that is what a
  // caller reads first, and the nested `error` object is kept because the
  // React client already destructures it. Both are the same values - there
  // is no second source of truth, only a second reading of one.
  //
  // The message is written for a business user. Every ApiError raised by a
  // service in this application says what went wrong in the language of the
  // office - "Only 250 Mtrs of FAB-004 is available", not "constraint
  // violation" - and the raw driver message never reaches the client.
  const body = {
    success: false,
    code: error.code,
    message: error.message,
    error: {
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    },
  };

  // A CHECK-constraint violation surfaced in development is nearly always a
  // service-layer bug; surface the constraint name so it can be found fast.
  if (env.NODE_ENV === 'development' && err?.meta?.constraint) {
    body.error.constraint = err.meta.constraint;
  }

  res.status(error.status).json(body);
}

export default errorHandler;
