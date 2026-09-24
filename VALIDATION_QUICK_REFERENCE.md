# Data Validation Quick Reference

## Backend Validation

### 1. **Zod Schema Validation** (First Line of Defense)
```javascript
// Simple field validation
const schema = z.object({
  billNo: requiredText(60, 'Bill number'),
  qty: decimal('Quantity', { min: 0, allowZero: false }),
  date: isoDate.optional().refine(d => !d || new Date(d) <= new Date(), 'No future dates'),
});

// Parse and catch errors
try {
  const data = schema.parse(input);
} catch (error) {
  handleValidationError(error); // Formats into user-friendly messages
}
```

### 2. **Business Rule Validation** (Second Line)
```javascript
import { validateGrnQtyVsPo, ValidationAccumulator } from './businessRuleValidator';

// Single check
const qtyCheck = validateGrnQtyVsPo(received, ordered, 5); // tolerance %
if (!qtyCheck.valid) throw ApiError.badRequest(qtyCheck.message);

// Multiple checks with accumulation
const errors = new ValidationAccumulator();
errors.add('qty', validateGrnQtyVsPo(received, ordered, 5));
errors.add('bill', checkDuplicateBill(billNo, poId));
errors.throwIfAny('GRN creation');
```

### 3. **Error Handling**
```javascript
import { handleValidationError, formatZodError } from './errorHandler';

try {
  const data = schema.parse(input);
  // business logic...
} catch (error) {
  // Converts ZodError to ApiError with formatted fields
  handleValidationError(error, { operation: 'GRN.create' });
}
```

---

## Frontend Validation

### 1. **Real-Time Quantity Validation**
```javascript
import { ValidatedNumberInput, validateQuantity } from '../components/ValidationHelper';

<ValidatedNumberInput
  label="Receiving Qty"
  value={qty}
  onChange={setQty}
  validator={(v) => validateQuantity(v, maxQty, 'Quantity')}
  helperText={`Max: ${maxQty}`}
  required
/>

// Returns: { isValid, message, severity, remaining }
// Severity: 'error' (red), 'warning' (orange), 'success' (green), 'info' (blue)
```

### 2. **Comparison Validation** (e.g., Received vs Ordered)
```javascript
import { validateQtyComparison } from '../utils/validation';

const result = validateQtyComparison(
  received,    // what user entered
  ordered,     // what was on PO
  5            // tolerance %
);

if (result.isValid && result.severity === 'warning') {
  // Qty is within bounds but exceeds tolerance - ask for confirmation
  showConfirmation(result.message);
}
```

### 3. **Displaying Errors**
```javascript
import { FieldErrors } from '../components/ValidationHelper';

// From API error
<FieldErrors errors={apiError.response?.data?.fields} />

// Output:
// ❌ Please fix the following errors:
// • billNo: Bill number already used in GRN-123
// • qty: Receiving qty exceeds ordered by 5%
```

### 4. **Confirmation Dialogs**
```javascript
import { ConfirmDialog } from '../components/ValidationHelper';

<ConfirmDialog
  isOpen={showConfirm}
  title="Confirm Over-Tolerance Receipt"
  message="Receiving qty exceeds PO by 5%"
  details={`PO: 100\nReceiving: 105\nTolerance: ±5%`}
  confirmText="Acknowledge & Save"
  onConfirm={handleSave}
  onCancel={() => setShowConfirm(false)}
/>
```

---

## Common Validations by Module

### **GRN (Receiving)**
```javascript
// Backend
const qtyResult = validateGrnQtyVsPo(receiving, ordered, 5);
const billResult = validateBillNumber(billNo);
const dateResult = validatePastDate(grnDate);

// Frontend
<ValidatedNumberInput validator={(v) => validateQuantity(v, po.orderQty)} />
<ValidatedTextInput validator={validateBillNumber} />
<ValidatedDateInput validator={(v) => validatePastDate(v, 'GRN Date')} />
```

### **Fabric Issue (Store)**
```javascript
// Backend
const balanceCheck = validateIssueQtyVsBalance(issuedQty, rollBalance);
const stateCheck = validateOrderState(order, 'FABRIC_ISSUE');

// Frontend
<ValidatedNumberInput validator={(v) => validateQuantity(v, roll.balance)} />
```

### **Cutting Issue**
```javascript
// Backend
const varianceCheck = validateCuttingIssueVsPlan(issued, planned, 5);

// Frontend - Show live variance %
const variance = calculateVariance(issued, planned);
{variance > 5 && <Warning>Exceeds variance limit</Warning>}
```

### **Job Work Return**
```javascript
// Backend
const returnCheck = validateJobWorkReturn(returned, sent);
const shrinkageCheck = validateShrinkagePct(shrinkage, allowed);

// Frontend
<ValidatedNumberInput validator={(v) => validateQuantity(v, sent)} />
<ValidatedNumberInput validator={(v) => validateShrinkagePct(v)} />
```

---

## Error Message Formats

### Field-Level Errors
```
{
  "billNo": "Bill number already used in GRN-001",
  "receivingQty": "Receiving qty exceeds ordered by 5% (tolerance: ±5%)",
  "grnDate": "GRN date cannot be in the future"
}
```

### Severity Levels
- **error** (❌): Blocks submission, must be fixed
- **warning** (⚠️): Allows submission after confirmation
- **info** (ℹ️): Information, doesn't block
- **success** (✅): Valid entry

---

## Validators Available

### Backend (server/src/utils/businessRuleValidator.js)
| Function | Purpose | Returns |
|----------|---------|---------|
| `validateGrnQtyVsPo` | Qty vs PO ordered | `{valid, breached, message}` |
| `validateIssueQtyVsBalance` | Qty vs roll balance | `{valid, message}` |
| `validateCuttingIssueVsPlan` | Qty vs plan | `{valid, message, variance}` |
| `validateJobWorkReturn` | Return vs sent | `{valid, message, loss}` |
| `validateShrinkagePct` | Shrinkage % bounds | `{valid, message, breached}` |
| `validateOrderState` | Order state check | throws if invalid |
| `validateDocumentNotLocked` | Doc not posted | throws if locked |

### Frontend (client/src/utils/validation.js)
| Function | Purpose | Returns |
|----------|---------|---------|
| `validateQuantity` | Qty vs limit | `{isValid, message, severity, remaining}` |
| `validateBillNumber` | Format check | `{isValid, message, severity}` |
| `validatePastDate` | Date in past | `{isValid, message, severity}` |
| `validateHsnCode` | 8-digit code | `{isValid, message, severity}` |
| `validateQtyComparison` | Received vs ordered | `{isValid, message, severity}` |
| `validateShrinkagePct` | % bounds | `{isValid, message, severity}` |
| `validateDecimal` | Decimal places | `{isValid, message, severity}` |
| `validateForm` | Multiple fields | `{isValid, errors}` |

---

## Step-by-Step: Add Validation to a Form

### Step 1: Import Components
```javascript
import { ValidatedNumberInput, FieldErrors } from '../components/ValidationHelper';
import { validateQuantity } from '../utils/validation';
```

### Step 2: Set Up State
```javascript
const [formData, setFormData] = useState({ qty: '', billNo: '', date: '' });
const [errors, setErrors] = useState(null);
```

### Step 3: Add Validated Input
```javascript
<ValidatedNumberInput
  label="Receiving Qty"
  value={formData.qty}
  onChange={(v) => setFormData({...formData, qty: v})}
  validator={(v) => validateQuantity(v, MAX_QTY)}
  required
/>
```

### Step 4: Handle Submission with Error Display
```javascript
const handleSubmit = async (e) => {
  e.preventDefault();
  try {
    const result = await api.create(formData);
    // Success
  } catch (error) {
    // Show field errors
    setErrors(error.response?.data?.fields);
  }
};

return (
  <form onSubmit={handleSubmit}>
    <FieldErrors errors={errors} />
    {/* inputs */}
  </form>
);
```

---

## Best Practices

✅ **DO:**
- Validate early (frontend for UX, backend for security)
- Show specific error messages ("Bill number 'INV-001' already exists" not just "Invalid")
- Use dropdowns for restricted values (no free text)
- Accumulate multiple errors before throwing
- Confirm risky operations (over-tolerance receipts, high shrinkage)
- Log validation failures for audit
- Keep validators close to business logic

❌ **DON'T:**
- Trust frontend validation alone (backend must validate)
- Show generic errors ("Invalid entry")
- Allow free-text for controlled fields (bill no, purpose, etc.)
- Validate one field at a time in submission
- Silently accept unusual but valid data
- Bury error messages in scrollable content
- Change validation rules without updating tests

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Validation runs but doesn't show | Make sure component returned from validator |
| Error message appears twice | Check if both Zod and business rule validate same thing |
| Dropdown value not validating | Ensure value matches exact enum value |
| "Field X is required" but field has value | Check if validator expects different type/format |
| Over-tolerance not requiring confirmation | Set `severity: 'warning'` in validator, not `error` |

---

## Testing

### Test a Validator
```javascript
test('rejects qty exceeding tolerance', () => {
  const result = validateGrnQtyVsPo('105', '100', 5);
  expect(result.valid).toBe(false);
  expect(result.message).toContain('exceeds');
  expect(result.breached).toBe(true);
});
```

### Test a Component
```javascript
test('shows error for negative qty', () => {
  render(<ValidatedNumberInput validator={validateQuantity} />);
  const input = screen.getByRole('textbox');
  userEvent.type(input, '-10');
  expect(screen.getByText(/cannot be negative/i)).toBeInTheDocument();
});
```

---

## Performance Optimization

### Debounce Real-Time Validation
```javascript
const debouncedCheck = createDebouncedValidator(
  (qty) => validateQuantity(qty, maxQty),
  500 // ms delay
);
```

### Memoize Validator Results
```javascript
const qtyCheck = useMemo(
  () => validateQuantity(qty, maxQty),
  [qty, maxQty]
);
```

### Lazy Load Dropdowns
```javascript
const [options, setOptions] = useState([]);
useEffect(() => {
  if (poId) fetchPODetails(poId).then(po => setOptions(po));
}, [poId]);
```
