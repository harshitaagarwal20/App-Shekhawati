/**
 * Reusable validation helper components.
 *
 * These components make it easy to add real-time validation feedback to forms,
 * helping semi-skilled workers avoid data entry errors.
 */

/**
 * Displays validation result with icon and color coding.
 * @param {object} result - Result from validation helper
 * @returns JSX
 */
export function ValidationMessage({ result }) {
  if (!result) return null;

  const severityStyles = {
    error: { color: '#d32f2f', icon: '❌' },
    warning: { color: '#f57c00', icon: '⚠️' },
    info: { color: '#1976d2', icon: 'ℹ️' },
    success: { color: '#388e3c', icon: '✅' },
  };

  const style = severityStyles[result.severity] || severityStyles.info;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '4px',
        fontSize: '12px',
        color: style.color,
      }}
    >
      <span>{style.icon}</span>
      <span>{result.message}</span>
    </div>
  );
}

/**
 * Validated number input with real-time feedback.
 *
 * Example:
 *   <ValidatedNumberInput
 *     label="Receiving Qty"
 *     value={qty}
 *     onChange={setQty}
 *     validator={(v) => validateQty(v, maxQty)}
 *     required
 *   />
 */
export function ValidatedNumberInput({
  label,
  value,
  onChange,
  validator,
  required = false,
  min = 0,
  max,
  step = '0.01',
  disabled = false,
  helperText,
  ...props
}) {
  const result = validator ? validator(value) : null;

  const inputStyle = {
    padding: '8px',
    borderRadius: '4px',
    border: `2px solid ${
      result && !result.isValid ? '#d32f2f' : result && result.isValid ? '#388e3c' : '#ccc'
    }`,
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: result && !result.isValid ? '#ffebee' : result && result.isValid ? '#f1f8e9' : '#fff',
  };

  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
        {label}
        {required && <span style={{ color: '#d32f2f' }}> *</span>}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        style={inputStyle}
        {...props}
      />
      {helperText && <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>{helperText}</div>}
      <ValidationMessage result={result} />
    </div>
  );
}

/**
 * Validated text input with format checking.
 */
export function ValidatedTextInput({
  label,
  value,
  onChange,
  validator,
  required = false,
  maxLength = 120,
  disabled = false,
  helperText,
  ...props
}) {
  const result = validator ? validator(value) : null;

  const inputStyle = {
    padding: '8px',
    borderRadius: '4px',
    border: `2px solid ${
      result && !result.isValid ? '#d32f2f' : result && result.isValid ? '#388e3c' : '#ccc'
    }`,
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: result && !result.isValid ? '#ffebee' : result && result.isValid ? '#f1f8e9' : '#fff',
  };

  const remaining = maxLength - (value?.length || 0);

  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
        {label}
        {required && <span style={{ color: '#d32f2f' }}> *</span>}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        maxLength={maxLength}
        disabled={disabled}
        style={inputStyle}
        {...props}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '12px' }}>
        {helperText && <span style={{ color: '#666' }}>{helperText}</span>}
        <span style={{ color: remaining < 10 ? '#f57c00' : '#999' }}>
          {remaining}/{maxLength}
        </span>
      </div>
      <ValidationMessage result={result} />
    </div>
  );
}

/**
 * Validated date input that prevents future dates.
 */
export function ValidatedDateInput({
  label,
  value,
  onChange,
  validator,
  required = false,
  disabled = false,
  helperText,
  ...props
}) {
  const result = validator ? validator(value) : null;

  const inputStyle = {
    padding: '8px',
    borderRadius: '4px',
    border: `2px solid ${
      result && !result.isValid ? '#d32f2f' : result && result.isValid ? '#388e3c' : '#ccc'
    }`,
    fontSize: '14px',
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: result && !result.isValid ? '#ffebee' : result && result.isValid ? '#f1f8e9' : '#fff',
  };

  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={{ display: 'block', marginBottom: '4px', fontWeight: 500 }}>
        {label}
        {required && <span style={{ color: '#d32f2f' }}> *</span>}
      </label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={inputStyle}
        {...props}
      />
      {helperText && <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>{helperText}</div>}
      <ValidationMessage result={result} />
    </div>
  );
}

/**
 * Displays all field errors from API response.
 *
 * Example:
 *   <FieldErrors errors={apiError.response.data.fields} />
 */
export function FieldErrors({ errors }) {
  if (!errors || Object.keys(errors).length === 0) return null;

  return (
    <div
      style={{
        padding: '12px',
        marginBottom: '16px',
        borderRadius: '4px',
        backgroundColor: '#ffebee',
        border: '1px solid #d32f2f',
      }}
    >
      <div style={{ fontWeight: 500, marginBottom: '8px', color: '#d32f2f' }}>
        ❌ Please fix the following errors:
      </div>
      <ul style={{ margin: '0', paddingLeft: '20px' }}>
        {Object.entries(errors).map(([field, message]) => (
          <li key={field} style={{ marginBottom: '4px', color: '#c62828' }}>
            <strong>{field}:</strong> {message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Confirmation dialog for risky operations.
 *
 * Example:
 *   <ConfirmDialog
 *     isOpen={showConfirm}
 *     title="Confirm Over-Tolerance Receipt"
 *     message="Receiving qty exceeds by 5%. This requires manager approval."
 *     onConfirm={handleConfirm}
 *     onCancel={handleCancel}
 *   />
 */
export function ConfirmDialog({ isOpen, title, message, details, onConfirm, onCancel, confirmText = 'Confirm' }) {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.5)',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '8px',
          padding: '24px',
          maxWidth: '500px',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
        }}
      >
        <h3 style={{ margin: '0 0 12px 0', color: '#f57c00' }}>⚠️ {title}</h3>
        <p style={{ margin: '0 0 12px 0', color: '#333', fontSize: '14px' }}>{message}</p>

        {details && (
          <div
            style={{
              padding: '12px',
              marginBottom: '12px',
              backgroundColor: '#fff3e0',
              borderRadius: '4px',
              fontSize: '13px',
              fontFamily: 'monospace',
            }}
          >
            {details}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#e0e0e0',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 16px',
              borderRadius: '4px',
              border: 'none',
              backgroundColor: '#f57c00',
              color: 'white',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shows help tooltip for a field.
 */
export function FieldHelp({ title, children }) {
  return (
    <div
      style={{
        marginTop: '4px',
        padding: '8px',
        borderLeft: '3px solid #1976d2',
        backgroundColor: '#e3f2fd',
        fontSize: '12px',
        color: '#0d47a1',
      }}
    >
      <strong>{title}:</strong> {children}
    </div>
  );
}
