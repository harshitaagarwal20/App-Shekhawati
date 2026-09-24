/**
 * Business rule validation for critical operations.
 *
 * These validators complement Zod schema validation by enforcing business logic
 * that requires database context (e.g., checking against ordered qty).
 *
 * Used to prevent semi-skilled worker errors in high-risk operations.
 */

import { ApiError } from './ApiError.js';
import { D } from './figures.js';

/**
 * Validates GRN receiving quantity against PO order quantity.
 * @param receivingQty - What the worker entered
 * @param orderedQty - What was on the PO
 * @param tolerancePct - Allowed over/under receipt % (e.g., 5 for ±5%)
 * @returns { valid: boolean, message?: string, breached: boolean }
 */
export function validateGrnQtyVsPo(receivingQty, orderedQty, tolerancePct = 5) {
  const receiving = D(receivingQty);
  const ordered = D(orderedQty);
  const tolerance = ordered.mul(D(tolerancePct).div(100));

  const minAllowed = ordered.minus(tolerance);
  const maxAllowed = ordered.plus(tolerance);

  const isValid = receiving.greaterThanOrEqualTo(minAllowed) && receiving.lessThanOrEqualTo(maxAllowed);
  const breached = !isValid;

  let message = null;
  if (receiving.lessThan(minAllowed)) {
    message = `Receiving qty ${receiving.toString()} is ${D(100).minus(receiving.div(ordered).mul(100)).toDecimalPlaces(1)}% below ordered qty ${ordered.toString()}`;
  } else if (receiving.greaterThan(maxAllowed)) {
    const overPct = receiving.div(ordered).minus(1).mul(100).toDecimalPlaces(1);
    message = `Receiving qty ${receiving.toString()} exceeds ordered qty by ${overPct}% (tolerance: ±${tolerancePct}%)`;
  }

  return { valid: isValid, message, breached };
}

/**
 * Validates fabric issue quantity against roll balance.
 * @param issueQty - What the worker wants to issue
 * @param balanceQty - Current roll balance
 * @returns { valid: boolean, message?: string }
 */
export function validateIssueQtyVsBalance(issueQty, balanceQty) {
  const issue = D(issueQty);
  const balance = D(balanceQty);

  const isValid = issue.lessThanOrEqualTo(balance);
  let message = null;

  if (!isValid) {
    const shortage = issue.minus(balance);
    message = `Cannot issue ${issue.toString()} - only ${balance.toString()} available (shortage: ${shortage.toString()})`;
  }

  return { valid: isValid, message };
}

/**
 * Validates cutting issue quantity against planned cutting.
 * @param issuedQty - What's being issued to the unit
 * @param plannedQty - What was approved in the plan
 * @param allowVariance - Allow slight variance % (e.g., 5 for ±5%)
 * @returns { valid: boolean, message?: string, variance: number }
 */
export function validateCuttingIssueVsPlan(issuedQty, plannedQty, allowVariance = 5) {
  const issued = D(issuedQty);
  const planned = D(plannedQty);

  const variance = issued.minus(planned);
  const variancePct = planned.isZero() ? 0 : variance.div(planned).mul(100).toNumber();

  const maxVariance = D(allowVariance);
  const isValid = Math.abs(variancePct) <= allowVariance;

  let message = null;
  if (!isValid) {
    if (variancePct > allowVariance) {
      message = `Issued qty exceeds plan by ${variancePct.toFixed(1)}% (max allowed: ±${allowVariance}%)`;
    } else {
      message = `Issued qty is ${Math.abs(variancePct).toFixed(1)}% below plan (max allowed: ±${allowVariance}%)`;
    }
  }

  return { valid: isValid, message, variance: variancePct };
}

/**
 * Validates job work return quantity against sent quantity.
 * @param returnedQty - What came back from vendor
 * @param sentQty - What was sent out
 * @returns { valid: boolean, message?: string, loss: number }
 */
export function validateJobWorkReturn(returnedQty, sentQty) {
  const returned = D(returnedQty);
  const sent = D(sentQty);

  const isValid = returned.lessThanOrEqualTo(sent);
  const loss = sent.minus(returned);
  const lossPct = sent.isZero() ? 0 : loss.div(sent).mul(100).toNumber();

  let message = null;
  if (!isValid) {
    message = `Return qty ${returned.toString()} exceeds sent qty ${sent.toString()} - would result in negative loss`;
  } else if (lossPct > 50) {
    // Warning, not blocking
    message = `Return qty results in ${lossPct.toFixed(1)}% loss - please verify`;
  }

  return { valid: isValid, message, loss: lossPct };
}

/**
 * Validates shrinkage percentage is within bounds.
 * @param shrinkagePct - Claimed shrinkage %
 * @param allowedPct - Tolerance %
 * @returns { valid: boolean, message?: string, breached: boolean }
 */
export function validateShrinkagePct(shrinkagePct, allowedPct) {
  const shrinkage = D(shrinkagePct);
  const allowed = D(allowedPct);

  const isValid = shrinkage.greaterThanOrEqualTo(0) && shrinkage.lessThanOrEqualTo(100);
  const notBreached = shrinkage.lessThanOrEqualTo(allowed);

  let message = null;
  if (!isValid) {
    message = 'Shrinkage percentage must be between 0 and 100%';
  } else if (!notBreached) {
    message = `Shrinkage ${shrinkage.toDecimalPlaces(2)}% exceeds allowed ${allowed.toDecimalPlaces(2)}%`;
  }

  return {
    valid: isValid,
    message,
    breached: !notBreached,
  };
}

/**
 * Checks for duplicate bill numbers within a fiscal period.
 * Only call this on new GRNs, not updates.
 */
export function createDuplicateBillCheck(prisma, poId, billNo, fiscalYearStart) {
  return async () => {
    const existing = await prisma.grn.findFirst({
      where: {
        purchaseOrderId: poId,
        billNo: billNo.toUpperCase(),
        grnDate: { gte: new Date(fiscalYearStart) },
      },
      select: { grnNo: true, grnDate: true },
    });

    if (existing) {
      throw ApiError.conflict(
        `Bill number "${billNo}" already used for this PO in ${existing.grnNo} (dated ${existing.grnDate.toDateString()})`,
        { field: 'billNo', existingGrn: existing.grnNo },
      );
    }
  };
}

/**
 * Validates order is in valid state for operations.
 */
export function validateOrderState(order, operation) {
  const validStates = {
    FABRIC_ISSUE: ['ACTIVE', 'IN_PROGRESS'],
    CUTTING_ISSUE: ['IN_PRODUCTION', 'READY_FOR_CUTTING'],
    JOB_WORK: ['IN_PRODUCTION'],
  };

  const allowed = validStates[operation] || ['ACTIVE'];
  if (!allowed.includes(order.status)) {
    throw ApiError.badRequest(
      `Cannot perform ${operation} on order in "${order.status}" state. Valid states: ${allowed.join(', ')}`,
      { field: 'orderId', currentState: order.status, operation },
    );
  }
}

/**
 * Validates document is not locked/posted.
 */
export function validateDocumentNotLocked(document, documentType) {
  if (document.postedAt) {
    throw ApiError.badRequest(
      `Cannot edit a posted ${documentType}. This document was locked on ${document.postedAt.toDateString()}`,
      { field: 'status', locked: true },
    );
  }
}

/**
 * Creates a structured error for validation failures.
 * Used to return clear field-level errors to the frontend.
 */
export function createValidationError(fieldErrors) {
  // fieldErrors format: { fieldName: 'error message', ... }
  return ApiError.badRequest('Validation failed. Check field errors.', {
    fields: fieldErrors,
  });
}

/**
 * Validates multiple fields and accumulates errors.
 * Returns null if all pass, otherwise error object.
 */
export function validateAndAccumulate(...checks) {
  const errors = {};

  checks.forEach(({ field, validator }) => {
    const result = validator();
    if (result && result.message) {
      errors[field] = result.message;
    }
  });

  return Object.keys(errors).length > 0 ? errors : null;
}
