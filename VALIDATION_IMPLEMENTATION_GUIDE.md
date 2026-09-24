# Data Validation Implementation Guide
## For Semi-Skilled Worker Error Prevention

---

## Quick Start

### Backend Validation (Enhanced Zod + Business Rules)

#### 1. Update Validator Schema
```javascript
// server/src/validators/grn.validator.js
import { createDuplicateBillCheck } from '../utils/businessRuleValidator.js';

export const createGrnSchema = z.object({
  billNo: requiredText(60, 'Bill number')
    .transform((v) => v.toUpperCase().trim())
    .refine((v) => /^[A-Z0-9\-\/\.]+$/.test(v), 'Invalid format'),
  receivingQty: decimal('Receiving quantity', { min: 0, allowZero: false })
    .refine((qty) => qty.lessThanOrEqualTo(999999), 'Unreasonably high'),
  grnDate: isoDate
    .optional()
    .refine((date) => !date || new Date(date) <= new Date(), 'Cannot be future date'),
});
```

#### 2. Add Business Rule Validation in Service
```javascript
// server/src/services/grn.service.js
import { validateGrnQtyVsPo, ValidationAccumulator } from '../utils/businessRuleValidator.js';
import { handleValidationError } from '../utils/errorHandler.js';

export async function create(input, userId) {
  try {
    // Schema validation first
    const validated = createGrnSchema.parse(input);

    // Get PO for business rule checks
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: validated.purchaseOrderId },
    });

    if (!po) throw ApiError.notFound('Purchase Order');

    // Business rule validation
    const errors = new ValidationAccumulator();

    // Check quantity against PO
    const qtyCheck = validateGrnQtyVsPo(
      validated.receivingQty,
      po.orderQty,
      5 // tolerance %
    );
    errors.add('receivingQty', qtyCheck);

    // Check duplicate bill
    const existing = await prisma.grn.findFirst({
      where: {
        purchaseOrderId: po.id,
        billNo: validated.billNo.toUpperCase(),
        grnDate: { gte: fiscalYearStart },
      },
    });
    if (existing) {
      errors.add('billNo', {
        isValid: false,
        message: `Bill number already used in ${existing.grnNo}`,
      });
    }

    errors.throwIfAny('GRN creation');

    // Safe to create
    const grn = await prisma.grn.create({
      data: {
        ...validated,
        postedById: userId,
      },
    });

    return grn;
  } catch (error) {
    handleValidationError(error, { operation: 'GRN.create' });
  }
}
```

---

### Frontend Validation (Real-Time Feedback)

#### 1. Import Validation Utilities
```javascript
// client/src/pages/GrnForm.jsx
import { ValidatedNumberInput, ValidatedTextInput, ValidatedDateInput, FieldErrors, ConfirmDialog } from '../components/ValidationHelper';
import { validateBillNumber, validateQtyComparison, validatePastDate } from '../utils/validation';
```

#### 2. Build Form with Real-Time Validation
```javascript
export function GrnForm() {
  const [formData, setFormData] = useState({
    poId: '',
    billNo: '',
    grnDate: '',
    receivingQty: '',
    inventoryRate: '',
  });
  const [errors, setErrors] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(false);

  // When PO changes, fetch it to know limits
  useEffect(() => {
    if (formData.poId) {
      purchaseOrders.get(formData.poId).then(setPo);
    }
  }, [formData.poId]);

  // Qty comparison for live feedback
  const qtyCheck = po ? validateQtyComparison(
    formData.receivingQty,
    po.orderQty,
    5 // tolerance %
  ) : null;

  // Handler for form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // If qty is in warning state, ask for confirmation
    if (qtyCheck && qtyCheck.severity === 'warning') {
      setShowConfirm(true);
      return;
    }

    await submitForm();
  };

  const submitForm = async () => {
    setLoading(true);
    try {
      const result = await reportsApi.grns.create(formData);
      // Success
      navigate(`/grns/${result.id}`);
    } catch (error) {
      // Show field-level errors
      if (error.response?.data?.fields) {
        setErrors(error.response.data.fields);
      } else {
        setErrors({ general: error.response?.data?.message || error.message });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Show all field errors at top */}
      <FieldErrors errors={errors} />

      {/* PO Selector */}
      <div>
        <label>Select PO *</label>
        <select 
          value={formData.poId}
          onChange={(e) => setFormData(prev => ({ ...prev, poId: e.target.value }))}
          required
        >
          <option value="">Choose a PO...</option>
          {/* Options from API */}
        </select>
        {po && <div style={{fontSize: '12px', color: '#666'}}>
          Ordered: {po.orderQty} | Rate: {po.rate}
        </div>}
      </div>

      {/* Bill Number with validation */}
      <ValidatedTextInput
        label="Bill Number"
        value={formData.billNo}
        onChange={(v) => setFormData(prev => ({ ...prev, billNo: v }))}
        validator={validateBillNumber}
        helperText="Vendor's invoice number"
        required
      />

      {/* Date with validation */}
      <ValidatedDateInput
        label="GRN Date"
        value={formData.grnDate}
        onChange={(v) => setFormData(prev => ({ ...prev, grnDate: v }))}
        validator={validatePastDate}
        helperText="Defaults to today"
      />

      {/* Quantity with live comparison */}
      <ValidatedNumberInput
        label="Receiving Qty"
        value={formData.receivingQty}
        onChange={(v) => setFormData(prev => ({ ...prev, receivingQty: v }))}
        validator={() => qtyCheck}
        max={po ? po.orderQty * 1.1 : undefined}
        helperText={po ? `Ordered: ${po.orderQty}, Tolerance: ±5%` : 'Select PO first'}
        required
      />

      {/* Rate */}
      <ValidatedNumberInput
        label="Inventory Rate (Optional)"
        value={formData.inventoryRate}
        onChange={(v) => setFormData(prev => ({ ...prev, inventoryRate: v }))}
        helperText="Defaults to PO rate if blank"
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showConfirm}
        title="Confirm Over-Tolerance Receipt"
        message={qtyCheck?.message}
        details={`
          PO Qty: ${po?.orderQty}
          Receiving: ${formData.receivingQty}
          Tolerance: ±5%
        `}
        confirmText="Acknowledge & Save"
        onConfirm={() => {
          setShowConfirm(false);
          submitForm();
        }}
        onCancel={() => setShowConfirm(false)}
      />

      <button type="submit" disabled={loading || !formData.poId || !formData.billNo}>
        {loading ? 'Saving...' : 'Save GRN'}
      </button>
    </form>
  );
}
```

---

## Implementation Checklist

### Phase 1: Core Validation (Week 1)
- [ ] Enhance GRN validator with bill number, qty, date checks
- [ ] Add business rule validation for GRN (duplicate bills, qty limits)
- [ ] Add error handler to format Zod errors
- [ ] Create ValidationHelper components
- [ ] Implement validation in GRN form

### Phase 2: Fabric Issue & Job Work (Week 2)
- [ ] Add qty balance validation for Fabric Issues
- [ ] Add return qty validation for Job Work
- [ ] Add shrinkage % validation
- [ ] Add confirmation dialogs for over-tolerance operations

### Phase 3: Cutting Operations (Week 3)
- [ ] Add cutting qty vs plan validation
- [ ] Add unit state validation
- [ ] Add variance limit enforcement

### Phase 4: UI/UX Polish (Week 4)
- [ ] Add field-level help text
- [ ] Add keyboard shortcuts for common operations
- [ ] Add batch operation validation
- [ ] Add audit trail for critical changes

---

## Key Files Created

| File | Purpose |
|------|---------|
| `DATA_VALIDATION_STRATEGY.md` | Overall strategy and rules |
| `server/src/utils/businessRuleValidator.js` | Reusable validation logic |
| `server/src/utils/errorHandler.js` | Error formatting and handling |
| `client/src/utils/validation.js` | Frontend validation helpers |
| `client/src/components/ValidationHelper.jsx` | Reusable UI components |
| `server/src/validators/grn.validator.js` | Enhanced GRN schema (UPDATED) |

---

## Testing Validation

### Backend Test
```javascript
// Test negative cases
test('rejects GRN with qty exceeding tolerance', async () => {
  const result = await grn.create({
    poId: po.id,
    billNo: 'INV-001',
    receivingQty: '150', // PO is 100, tolerance is ±5
  });
  expect(result).toHaveProperty('error');
  expect(result.error).toContain('exceeds ordered');
});
```

### Frontend Test
```javascript
// Test validation helper
test('validateQtyComparison detects overage', () => {
  const result = validateQtyComparison(110, 100, 5);
  expect(result.isValid).toBe(false);
  expect(result.message).toContain('Over');
});
```

---

## Common Patterns

### Pattern 1: Simple Field Validation
```javascript
const result = validateQuantity(userInput, maxAllowed, 'Quantity');
if (!result.isValid) {
  showError(result.message);
}
```

### Pattern 2: Cross-Field Validation
```javascript
const qtyCheck = validateQtyComparison(receiving, ordered, tolerance);
if (qtyCheck.severity === 'warning') {
  askUserConfirmation(qtyCheck.message);
}
```

### Pattern 3: Accumulate Multiple Errors
```javascript
const errors = new ValidationAccumulator();
errors.add('qty', validateQty(data.qty));
errors.add('billNo', validateBillNo(data.billNo));
errors.add('date', validateDate(data.date));
errors.throwIfAny(); // Throws if any failed
```

---

## Performance Tips

1. **Debounce real-time validation** to avoid excessive checks:
```javascript
const debouncedValidator = createDebouncedValidator(validator, 300);
```

2. **Cache dropdown options** to avoid repeated fetches

3. **Batch validate** complex forms instead of field-by-field:
```javascript
const errors = validateForm(formData, { qty: validator1, billNo: validator2 });
```

---

## Support & Maintenance

- Keep validators close to business logic
- Update validators when business rules change
- Test edge cases (zero, max, negative values)
- Document non-obvious validations
- Add warnings for unusual but valid entries (high shrinkage %, etc.)
