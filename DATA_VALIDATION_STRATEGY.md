# Data Validation & Restriction Strategy
## For Semi-Skilled Worker Error Prevention

### 1. VALIDATION LAYERS

#### Layer 1: Frontend (Client-Side) - UX Prevention
- Real-time field validation with immediate feedback
- Type-restricted inputs (numeric, decimal, date)
- Dropdown constraints (no free text for controlled values)
- Quantity validation with visual indicators
- Cross-field validation (e.g., received qty <= ordered qty)

#### Layer 2: Backend (Server-Side) - Data Integrity
- Strict Zod schema validation
- Business rule enforcement
- Stock availability checks
- Order/PO authorization checks
- Quantity tolerance validation

#### Layer 3: Database - Last Resort
- NOT NULL constraints
- UNIQUE constraints
- Foreign key constraints
- Check constraints for valid values

---

## 2. HIGH-RISK AREAS & RULES

### A. INVENTORY OPERATIONS (GRN - Critical)
**Common Errors:**
- Entering qty > PO ordered qty
- Wrong units of measure
- Negative quantities
- Duplicate bill numbers per PO
- Wrong location assignment

**Rules to Enforce:**
```
1. Receiving Qty ≤ Ordered Qty (with tolerance ±%)
2. Bill No must be unique per PO per fiscal year
3. Inventory Rate must be ≥ 0
4. GST rate must be from approved list
5. Location must be an active store location
6. GRN Date cannot be in future
7. Only one roll per single-roll receipt
```

### B. FABRIC ISSUE (Shop Floor - High Risk)
**Common Errors:**
- Issuing more than available balance
- Wrong purpose selection (CUTTING vs DYEING)
- Duplicate issue numbers
- Missing issuer name

**Rules to Enforce:**
```
1. Issue Qty ≤ Roll Balance (check real-time)
2. Roll must be in correct stage for purpose
3. Location must match roll's current location
4. Issue Date ≤ Today (no future dates)
5. Purpose must match order requirements
6. Issuer name from approved user list
```

### C. CUTTING OPERATIONS (Challan/Issue)
**Common Errors:**
- Issuing qty > Challan qty
- Wrong unit assignment
- Exceeding planned quantities
- Unit (firm) closed/inactive

**Rules to Enforce:**
```
1. Cutting Qty Issued ≤ Planned Cutting Qty
2. Unit must be active and approved
3. Cannot issue after approval expires
4. Variance limit enforced with warning
5. Order must be in active state
```

### D. JOB WORK (Dyeing/Printing - Quality Critical)
**Common Errors:**
- Receiving qty > sent qty (ghost receipts)
- Wrong vendor assignment
- Duplicate job numbers
- Shrinkage % impossible (>100%)

**Rules to Enforce:**
```
1. Return Qty ≤ Sent Qty
2. Shrinkage % must be 0-100%
3. Job must be in pending state
4. Vendor must match issue record
5. Can only receive once
```

---

## 3. IMPLEMENTATION APPROACH

### Phase 1: Frontend Controls (Immediate - Best UX)
- Add masked inputs for quantities (decimals, no negatives)
- Add dropdown selects for all restricted fields
- Add real-time qty validation displays
- Add confirmation dialogs for over-tolerance receipts
- Add helpful error messages

### Phase 2: Backend Validation Enhancement
- Strengthen Zod schemas with more rules
- Add business logic validation layer
- Add cross-field validation checks
- Implement tolerance breach detection

### Phase 3: Data Restrictions
- Lock certain fields based on document state
- Prevent edits on critical fields (qty, rate)
- Add approval gates for risky operations
- Implement audit trail for critical changes

### Phase 4: User Training
- Add field-level help text
- Add warning badges for critical fields
- Add inline confirmations for major operations
- Add data entry templates/defaults

---

## 4. FIELD-LEVEL STRATEGIES

### Quantity Fields
```
✓ Numeric input only, decimal allowed
✓ Show comparison with limit (Ordered: 100, Entering: __)
✓ Highlight if exceeds (red background)
✓ Show remaining/available in real-time
✓ Min: 0, Max: [calculated from PO/Challan]
```

### Selection Fields (Dropdowns)
```
✓ No free-text entry - only predefined values
✓ Group by status (Active first, Inactive grayed)
✓ Show additional info (Code + Name)
✓ Filter based on context (Order → only for that order)
✓ Search enabled for large lists
```

### Date Fields
```
✓ Date picker (no free text)
✓ Cannot be future date (except planned dates)
✓ Must be ≥ document reference date
✓ Show calendar to prevent typos
```

### Text Fields
```
✓ Auto-trim whitespace
✓ Enforce max length with char counter
✓ Reject NUL bytes (from clipboard pastes)
✓ For Bill No: uppercase, no spaces
✓ For Remarks: spell-check optional
```

---

## 5. CONFIRMATION REQUIREMENTS

Require explicit confirmation for:
- GRN receiving over tolerance
- Qty issued exceeding balance (with override reason)
- Job work receiving < sent qty
- Canceling documents with pending operations
- Editing locked/posted documents

---

## 6. DASHBOARD WARNINGS

Show real-time badges:
- 🔴 "GRN over tolerance waiting for approval"
- 🟡 "Stock below reorder level"
- 🟡 "Pending receipts aging"
- 🔴 "Duplicate bill numbers detected"

---

## 7. AUDIT & MONITORING

Log and alert on:
- Multiple failed validation attempts
- Receipt over large tolerance %
- Unusual qty patterns
- After-hours data entry (if applicable)

---

## Implementation Priority

1. **CRITICAL (Week 1)**: GRN validation, Fabric Issue qty check
2. **HIGH (Week 2)**: Cutting operations, Job Work returns
3. **MEDIUM (Week 3)**: UI enhancements, Help text
4. **LOW (Week 4)**: Audit dashboard, Advanced warnings
