/**
 * Enhanced error handling for data validation errors.
 *
 * Converts validation failures into user-friendly error messages that guide
 * semi-skilled workers to fix data entry mistakes.
 */

import { ApiError } from './ApiError.js';
import { ZodError } from 'zod';

/**
 * Formats Zod validation errors into user-friendly field-level messages.
 *
 * Instead of: "Expected number, received string"
 * We show: "Receiving Qty must be a number"
 *
 * @param {ZodError} zodError - Error from Zod validation
 * @returns {object} Formatted errors: { fieldName: 'message', ... }
 */
export function formatZodError(zodError) {
  const formatted = {};

  zodError.issues.forEach((issue) => {
    const path = issue.path.join('.');
    const message = formatZodIssue(issue);
    formatted[path] = message;
  });

  return formatted;
}

/**
 * Converts a single Zod issue into a user-friendly message.
 */
function formatZodIssue(issue) {
  // Custom message takes priority
  if (issue.message && issue.message.length > 0 && issue.message !== 'Invalid input') {
    return issue.message;
  }

  // Fallback based on error code
  const typeMessages = {
    invalid_type: (issue) => {
      const field = issue.path.join('.');
      if (issue.expected === 'string') return `${field} must be text`;
      if (issue.expected === 'number') return `${field} must be a number`;
      if (issue.expected === 'boolean') return `${field} must be true or false`;
      return `${field} is invalid`;
    },
    too_small: (issue) => {
      const field = issue.path.join('.');
      if (issue.type === 'string') return `${field} is too short (min ${issue.minimum} chars)`;
      if (issue.type === 'number') return `${field} must be at least ${issue.minimum}`;
      return `${field} is too small`;
    },
    too_big: (issue) => {
      const field = issue.path.join('.');
      if (issue.type === 'string') return `${field} is too long (max ${issue.maximum} chars)`;
      if (issue.type === 'number') return `${field} must be at most ${issue.maximum}`;
      return `${field} is too large`;
    },
    invalid_enum_value: (issue) => {
      const field = issue.path.join('.');
      return `${field} must be one of: ${issue.options.join(', ')}`;
    },
    invalid_union: () => `Invalid value - check your entry`,
  };

  const formatter = typeMessages[issue.code];
  return formatter ? formatter(issue) : issue.message || 'Invalid entry';
}

/**
 * Handles validation errors and converts them to ApiError.
 * @param {Error} error - Caught error (ZodError or other)
 * @param {object} context - Additional context (operation, document type, etc.)
 * @throws {ApiError} Always throws a formatted ApiError
 */
export function handleValidationError(error, context = {}) {
  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const fields = formatZodError(error);
    const firstError = Object.values(fields)[0];

    throw ApiError.unprocessable(
      `Data validation failed. ${firstError || 'Please check your entries.'}`,
      { fields, context },
    );
  }

  // Re-throw if already an ApiError
  if (error instanceof ApiError) {
    throw error;
  }

  // Generic error - log it, don't expose details
  console.error('Unexpected error:', error);
  throw ApiError.badRequest(
    'An error occurred while processing your request. Please try again.',
    { context },
  );
}

/**
 * Wraps a controller function to catch and format validation errors.
 *
 * Usage:
 *   export const createGrn = validateAndHandle(async (req, res) => {
 *     const data = createGrnSchema.parse(req.body);
 *     // ... rest of logic
 *   }, 'GRN Creation');
 */
export function validateAndHandle(handler, operationName = 'Operation') {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      try {
        handleValidationError(error, { operation: operationName, path: req.path });
      } catch (formattedError) {
        next(formattedError);
      }
    }
  };
}

/**
 * Accumulates validation errors and throws when done.
 *
 * Usage:
 *   const errors = new ValidationAccumulator();
 *   errors.add('qty', validateQty(data.qty));
 *   errors.add('billNo', validateBillNo(data.billNo));
 *   errors.throwIfAny('data validation');
 */
export class ValidationAccumulator {
  constructor() {
    this.errors = {};
  }

  add(field, result) {
    if (result && result.message) {
      this.errors[field] = result.message;
    }
    return this;
  }

  throwIfAny(operation = 'validation') {
    if (Object.keys(this.errors).length > 0) {
      throw ApiError.unprocessable(`${operation} failed. Check field errors.`, {
        fields: this.errors,
      });
    }
  }

  hasErrors() {
    return Object.keys(this.errors).length > 0;
  }

  getErrors() {
    return this.errors;
  }
}

/**
 * Safe parsing with automatic error handling.
 *
 * Usage:
 *   const data = safeParse(createGrnSchema, req.body, 'GRN creation');
 */
export function safeParse(schema, data, operation = 'Data validation') {
  try {
    return schema.parse(data);
  } catch (error) {
    handleValidationError(error, { operation });
  }
}

/**
 * Creates a user-friendly error message from business rule violations.
 *
 * @param {string} type - Error type (QTY_EXCEEDED, DUPLICATE, etc.)
 * @param {object} context - Error context with specific details
 * @returns {string} User-friendly message
 */
export function formatBusinessError(type, context = {}) {
  const messages = {
    QTY_EXCEEDED: () =>
      `Receiving quantity ${context.received} exceeds ordered ${context.ordered} by ${context.excess} (tolerance: ±${context.tolerance}%)`,

    QTY_SHORTAGE: () =>
      `Receiving quantity ${context.received} is short of ordered ${context.ordered} by ${context.shortage}`,

    DUPLICATE_BILL: () =>
      `Bill number "${context.billNo}" already used for this PO in ${context.existingGrn} on ${context.existingDate}`,

    INSUFFICIENT_STOCK: () =>
      `Cannot issue ${context.requested} - only ${context.available} available on roll ${context.rollNo}`,

    INVALID_STATE: () =>
      `Cannot perform this operation on ${context.documentType} in "${context.currentState}" state`,

    DOCUMENT_LOCKED: () =>
      `This document is locked and cannot be edited (posted on ${context.postedDate})`,

    SHRINKAGE_BREACH: () =>
      `Shrinkage ${context.actual}% exceeds allowed ${context.allowed}%`,

    OVER_PLAN: () =>
      `Cutting qty ${context.issued} exceeds planned ${context.planned} by ${context.variance}%`,
  };

  const formatter = messages[type];
  if (!formatter) {
    return `Validation failed: ${type}`;
  }

  try {
    return formatter();
  } catch {
    return `Validation failed: ${type}`;
  }
}

/**
 * Logs validation errors for debugging (optional, remove in production if needed).
 */
export function logValidationError(error, context = {}) {
  console.error({
    timestamp: new Date().toISOString(),
    error: error.message,
    fields: error.details?.fields,
    context,
  });
}
