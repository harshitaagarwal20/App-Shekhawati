/**
 * Frontend validation helpers for semi-skilled worker error prevention.
 *
 * These provide real-time feedback on data entry to prevent common mistakes.
 */

/**
 * Validates a quantity against a limit, returning structured feedback.
 * @param value - User entered value
 * @param limit - Maximum allowed
 * @param label - Field label for messages
 * @returns { isValid, message, severity }
 */
export function validateQuantity(value, limit, label = 'Quantity') {
  if (!value && value !== 0) {
    return { isValid: false, message: `${label} is required`, severity: 'error' };
  }

  const num = Number(value);
  if (Number.isNaN(num)) {
    return { isValid: false, message: `${label} must be a number`, severity: 'error' };
  }

  if (num < 0) {
    return { isValid: false, message: `${label} cannot be negative`, severity: 'error' };
  }

  if (num === 0) {
    return { isValid: false, message: `${label} must be greater than 0`, severity: 'error' };
  }

  if (num > limit) {
    const excess = (num - limit).toFixed(2);
    return {
      isValid: false,
      message: `${label} exceeds limit by ${excess}`,
      severity: 'error',
      excess,
    };
  }

  if (num === limit) {
    return {
      isValid: true,
      message: `${label} matches limit exactly ✓`,
      severity: 'success',
    };
  }

  const remaining = (limit - num).toFixed(2);
  return {
    isValid: true,
    message: `${remaining} remaining`,
    severity: 'info',
    remaining,
  };
}

/**
 * Validates bill number format.
 * Bill numbers should be uppercase, alphanumeric with -/.
 */
export function validateBillNumber(value) {
  if (!value) {
    return { isValid: false, message: 'Bill number is required', severity: 'error' };
  }

  const trimmed = value.trim().toUpperCase();

  if (trimmed.length > 60) {
    return { isValid: false, message: 'Bill number too long (max 60 chars)', severity: 'error' };
  }

  if (!/^[A-Z0-9\-/.]+$/.test(trimmed)) {
    return {
      isValid: false,
      message: 'Use only letters, numbers, and -/. characters',
      severity: 'error',
    };
  }

  return { isValid: true, message: 'Bill number format OK ✓', severity: 'success' };
}

/**
 * Validates date is not in the future.
 */
export function validatePastDate(value, label = 'Date') {
  if (!value) {
    return { isValid: false, message: `${label} is required`, severity: 'error' };
  }

  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (date > today) {
    return { isValid: false, message: `${label} cannot be in the future`, severity: 'error' };
  }

  return { isValid: true, message: `${label} is valid ✓`, severity: 'success' };
}

/**
 * Validates HSN code format (8 digits).
 */
export function validateHsnCode(value) {
  if (!value) {
    return { isValid: true, message: 'HSN code optional', severity: 'info' };
  }

  if (!/^[0-9]{8}$/.test(value)) {
    return { isValid: false, message: 'HSN code must be 8 digits', severity: 'error' };
  }

  return { isValid: true, message: 'HSN code valid ✓', severity: 'success' };
}

/**
 * Validates quantity comparison (e.g., received vs ordered).
 * @param received - What came in
 * @param ordered - What was expected
 * @param tolerancePct - Allowed variance %
 */
export function validateQtyComparison(received, ordered, tolerancePct = 5) {
  const r = Number(received);
  const o = Number(ordered);

  if (Number.isNaN(r) || Number.isNaN(o)) {
    return { isValid: false, message: 'Invalid numbers', severity: 'error' };
  }

  const tolerance = (o * tolerancePct) / 100;
  const minAllowed = o - tolerance;
  const maxAllowed = o + tolerance;

  if (r < minAllowed) {
    const shortfall = o - r;
    const pct = ((shortfall / o) * 100).toFixed(1);
    return {
      isValid: false,
      message: `Short by ${shortfall.toFixed(2)} (${pct}%) - tolerance limit: ±${tolerancePct}%`,
      severity: 'error',
    };
  }

  if (r > maxAllowed) {
    const excess = r - o;
    const pct = ((excess / o) * 100).toFixed(1);
    return {
      isValid: false,
      message: `Over by ${excess.toFixed(2)} (${pct}%) - tolerance limit: ±${tolerancePct}%`,
      severity: 'warning',
    };
  }

  return {
    isValid: true,
    message: `Within tolerance ✓ (±${tolerancePct}%)`,
    severity: 'success',
  };
}

/**
 * Validates shrinkage percentage (0-100).
 */
export function validateShrinkagePct(value) {
  if (!value && value !== 0) {
    return { isValid: false, message: 'Shrinkage % is required', severity: 'error' };
  }

  const num = Number(value);
  if (Number.isNaN(num)) {
    return { isValid: false, message: 'Must be a number', severity: 'error' };
  }

  if (num < 0 || num > 100) {
    return { isValid: false, message: 'Shrinkage must be between 0-100%', severity: 'error' };
  }

  if (num > 50) {
    return {
      isValid: true,
      message: `⚠️ High shrinkage (${num}%) - verify with supervisor`,
      severity: 'warning',
    };
  }

  return { isValid: true, message: `${num}% shrinkage`, severity: 'success' };
}

/**
 * Validates decimal number with specific places.
 */
export function validateDecimal(value, decimalPlaces = 4, label = 'Value') {
  if (value === null || value === undefined || value === '') {
    return { isValid: false, message: `${label} is required`, severity: 'error' };
  }

  const num = Number(value);
  if (Number.isNaN(num)) {
    return { isValid: false, message: `${label} must be a number`, severity: 'error' };
  }

  const parts = String(num).split('.');
  if (parts[1] && parts[1].length > decimalPlaces) {
    return {
      isValid: false,
      message: `${label} can have max ${decimalPlaces} decimal places`,
      severity: 'error',
    };
  }

  return { isValid: true, message: `${label} valid ✓`, severity: 'success' };
}

/**
 * Creates user-friendly error messages from API error responses.
 */
export function formatApiError(error) {
  if (error.response?.data?.fields) {
    // Field-level errors
    return error.response.data.fields;
  }

  if (error.response?.data?.message) {
    return error.response.data.message;
  }

  return error.message || 'An error occurred';
}

/**
 * Validates entire form data against a schema.
 * @param data - Form data object
 * @param validators - Map of field -> validator function
 * @returns { isValid, errors }
 */
export function validateForm(data, validators) {
  const errors = {};

  Object.entries(validators).forEach(([field, validator]) => {
    const result = validator(data[field]);
    if (!result.isValid) {
      errors[field] = result.message;
    }
  });

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Debounced validation for real-time feedback (avoid spam).
 */
export function createDebouncedValidator(validator, delayMs = 500) {
  let timeoutId;

  return (value) => {
    return new Promise((resolve) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        resolve(validator(value));
      }, delayMs);
    });
  };
}

/**
 * Format validation error as user-friendly message.
 */
export function formatValidationResult(result) {
  if (!result) return '';

  const icons = {
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
    success: '✅',
  };

  const icon = icons[result.severity] || '';
  return `${icon} ${result.message}`.trim();
}
