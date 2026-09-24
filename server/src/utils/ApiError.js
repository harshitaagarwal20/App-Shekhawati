/**
 * Application error with an HTTP status. Anything thrown that is NOT an
 * ApiError is treated by the error handler as an unexpected fault: it is
 * logged in full and reported to the client as a bare 500, so internal detail
 * never leaks.
 */
export class ApiError extends Error {
  /**
   * @param {number} status  HTTP status code
   * @param {string} message Client-safe message
   * @param {object} [opts]
   * @param {string} [opts.code]    Stable machine-readable code
   * @param {any}    [opts.details] Field-level detail (validation issues, etc.)
   */
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code ?? defaultCode(status);
    this.details = details;
    this.expected = true;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message, details) {
    return new ApiError(400, message, { code: 'BAD_REQUEST', details });
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHENTICATED') {
    return new ApiError(401, message, { code });
  }

  static forbidden(message = 'You do not have permission to perform this action', details) {
    return new ApiError(403, message, { code: 'FORBIDDEN', details });
  }

  static notFound(what = 'Resource') {
    return new ApiError(404, `${what} not found`, { code: 'NOT_FOUND' });
  }

  static conflict(message, details) {
    return new ApiError(409, message, { code: 'CONFLICT', details });
  }

  static unprocessable(message, details) {
    return new ApiError(422, message, { code: 'VALIDATION_FAILED', details });
  }
}

/**
 * Business-meaningful error codes.
 *
 * A 409 is not enough for a client to act on: "the roll number is taken" and
 * "there is not enough stock" are both conflicts, and a screen wants to do
 * different things about them. These are the codes the services raise, held
 * in one place so the client and the server agree on the spelling.
 *
 * The MESSAGE is what a user reads; the CODE is what the code branches on.
 * Neither is ever a raw database error.
 */
export const ERROR_CODES = {
  /** An issue or a movement larger than the ledger says is on hand. */
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  /** A roll number already in use. Roll numbers are never reused. */
  DUPLICATE_ROLL_NO: 'DUPLICATE_ROLL_NO',
  /** A document number already taken. */
  DUPLICATE_DOCUMENT_NO: 'DUPLICATE_DOCUMENT_NO',
  /** Over the permitted excess, and no authorisation was supplied. */
  EXCESS_APPROVAL_REQUIRED: 'EXCESS_APPROVAL_REQUIRED',
  /** Past the hard ceiling: no authorisation can permit it. */
  EXCESS_BEYOND_CEILING: 'EXCESS_BEYOND_CEILING',
  /** A posted or approved document that does not change. */
  DOCUMENT_LOCKED: 'DOCUMENT_LOCKED',
  /** A workflow move the transition table does not permit. */
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  /**
   * Two people decided the same document at the same moment, and this is the
   * one that lost. The other decision stands; this one was not applied.
   */
  CONCURRENT_DECISION: 'CONCURRENT_DECISION',
  /** The prerequisite approval has not been given. */
  APPROVAL_REQUIRED: 'APPROVAL_REQUIRED',
  /** A cutting issue that failed one or more of its nine checks. */
  VERIFICATION_FAILED: 'VERIFICATION_FAILED',
  /**
   * A roll of a different shade or dye lot issued against a cutting line
   * already started on another, with no reason given for mixing them.
   */
  SHADE_MIX: 'SHADE_MIX',
};

function defaultCode(status) {
  return (
    {
      400: 'BAD_REQUEST',
      401: 'UNAUTHENTICATED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'VALIDATION_FAILED',
    }[status] ?? 'INTERNAL_ERROR'
  );
}

export default ApiError;
