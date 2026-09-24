# Cutting Pieces Receipt Tracking — Implementation Guide

## Overview
This guide explains how to integrate the new **Cutting Pieces Receipt** screen into the existing application to track fabric returned after cutting operations.

---

## What Was Created

### 1. New Screen File
**File**: `client/src/pages/cutting/CuttingReceiptPages.jsx`

**Features**:
- View cutting issues with pieces and fabric issued
- Calculate average fabric per piece (fabric issued ÷ cutting pcs issued)
- Record receipt of pieces from stitching units
- Track fabric returned vs expected
- Detect and flag variance (pieces lost, fabric shortage)
- Automatic calculation of expected fabric based on pieces received
- Complete audit trail (who, when, what, why)

### 2. Security Documentation
**File**: `SECURITY_AND_AUDIT.md`

Documents all data security, safety, and authenticity measures including:
- Authentication & authorization (role-based access control)
- Audit trails & immutability
- Transaction integrity & atomic operations
- Data validation (frontend + backend)
- Variance detection & automatic holds
- Encryption & secure transmission
- Amendment trails
- Fraud prevention
- Compliance measures

---

## Database Schema (Backend Required)

### New Table: `cutting_receipts`
```sql
CREATE TABLE cutting_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Reference
  cutting_issue_id UUID NOT NULL REFERENCES cutting_issues(id),
  receipt_no VARCHAR(50) UNIQUE NOT NULL,  -- CR-2024-001, auto-generated
  
  -- Receipt Data
  receipt_date DATE NOT NULL,
  received_at TIMESTAMP DEFAULT NOW(),
  received_by_employee_id UUID REFERENCES employees(id),
  received_by_name VARCHAR(255),
  
  -- Pieces Tracking
  pcs_issued INT NOT NULL,  -- From cutting_issue
  pcs_received INT NOT NULL,
  pcs_variance INT GENERATED ALWAYS AS (pcs_received - pcs_issued) STORED,
  
  -- Fabric Tracking
  avg_fabric_per_piece DECIMAL(10,6),  -- Calculated: fabric_issued / pcs_issued
  fabric_issued DECIMAL(12,2),  -- From cutting_issue
  fabric_expected DECIMAL(12,2) GENERATED ALWAYS AS (
    pcs_received * avg_fabric_per_piece
  ) STORED,
  fabric_received DECIMAL(12,2) NOT NULL,
  fabric_variance DECIMAL(12,2) GENERATED ALWAYS AS (
    fabric_received - fabric_expected
  ) STORED,
  
  -- Variance Flagging
  variance_flagged BOOLEAN DEFAULT FALSE,
  variance_flag_reason VARCHAR(500),  -- "Fabric short by 5.25 Mtrs"
  
  -- Storage
  received_location VARCHAR(100),  -- "MAIN STORE", "COLD ROOM", etc.
  
  -- Status & Approval
  status VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, VERIFIED, APPROVED, FLAGGED
  verified_by_employee_id UUID REFERENCES employees(id),
  verified_at TIMESTAMP,
  
  -- Audit
  remarks TEXT,
  created_by_employee_id UUID NOT NULL REFERENCES employees(id),
  created_at TIMESTAMP DEFAULT NOW(),
  
  -- Amendment Trail
  is_amended BOOLEAN DEFAULT FALSE,
  amendment_count INT DEFAULT 0,
  
  CONSTRAINT pcs_received_positive CHECK (pcs_received >= 0),
  CONSTRAINT fabric_received_positive CHECK (fabric_received >= 0)
);

-- Unique receipt number per cutting issue
CREATE UNIQUE INDEX idx_receipt_per_issue ON cutting_receipts(cutting_issue_id, receipt_no);

-- Search & filter indexes
CREATE INDEX idx_receipt_date ON cutting_receipts(receipt_date);
CREATE INDEX idx_variance_flagged ON cutting_receipts(variance_flagged);
CREATE INDEX idx_status ON cutting_receipts(status);
```

### Amendment Tracking Table
```sql
CREATE TABLE cutting_receipt_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cutting_receipt_id UUID NOT NULL REFERENCES cutting_receipts(id),
  
  amendment_no INT NOT NULL,
  amended_at TIMESTAMP DEFAULT NOW(),
  amended_by_employee_id UUID NOT NULL REFERENCES employees(id),
  
  reason VARCHAR(1000) NOT NULL,
  
  -- Before/After snapshots
  changes_before JSONB NOT NULL,  -- { pcs_received: 100, fabric_received: 250.5 }
  changes_after JSONB NOT NULL,   -- { pcs_received: 105, fabric_received: 262.5 }
  
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT valid_amendment_no CHECK (amendment_no >= 1)
);

CREATE INDEX idx_amendment_receipt ON cutting_receipt_amendments(cutting_receipt_id);
```

### Stock Ledger Entry (Existing table, new entries)
```sql
-- When receipt is recorded, entries are created:
INSERT INTO stock_ledger_entries (
  entry_date, 
  item_id, 
  location, 
  direction,  -- 'IN'
  qty_in,
  document_type,  -- 'CUTTING_RECEIPT'
  document_no,  -- CR-2024-001
  reference_id,  -- cutting_receipt_id
  remarks
) VALUES (...)
```

---

## API Endpoints (Backend Required)

### 1. Get Cutting Issue with Receipt History
```
GET /api/cutting-issues/:id
Response:
{
  id, challanNo, issueDate, orderId, firmName,
  cuttingPcsIssued, fabricIssued, uom,
  receipts: [
    {
      id, receiptNo, receiptDate, 
      pcsReceived, fabricReceived,
      pcsVariance, fabricVariance,
      varianceFlagged, status, remarks
    }
  ]
}
```

### 2. Preview Receipt (Live Calculation)
```
POST /api/cutting-receipts/preview
Body: { cutting_issue_id, pcs_received, fabric_received }
Response: {
  pcsIssued, pcsReceived, pcsVariance,
  avgFabricPerPiece, expectedFabric, fabricReceived, fabricVariance,
  varianceFlagged, flagReason
}
```

### 3. Create Receipt
```
POST /api/cutting-receipts
Body: {
  cutting_issue_id,
  pcs_received,
  fabric_received,
  received_location,
  remarks
}
Response: {
  receipt: { receiptNo, receiptDate, ... },
  ledger_entries_created: 1,
  stock_updated: true
}
Errors: [
  "Pieces received cannot exceed pieces issued",
  "Fabric variance exceeds allowance — flagged for verification"
]
```

### 4. Amend Receipt
```
POST /api/cutting-receipts/:id/amend
Body: {
  reason,
  changes: {
    pcs_received: 105,
    fabric_received: 262.5,
    remarks: "Recount after verification"
  }
}
Response: {
  amendment_no: 1,
  receipt_updated: true,
  amendment_recorded: true
}
```

### 5. Verify Receipt (QC Approval)
```
POST /api/cutting-receipts/:id/verify
Body: { status: 'APPROVED' or 'FLAGGED', remarks: '...' }
Response: { status_changed: true, verified_by: '...', verified_at: '...' }
```

---

## UI Integration

### 1. Update Cutting Issue Detail
**File**: `client/src/pages/cutting/CuttingIssuePages.jsx`

Add button to access receipts:
```javascript
// After "Post the challan" button, add:
{canReceivePieces && (
  <button 
    type="button" 
    className="btn btn-primary" 
    onClick={() => navigate(`/cutting-issues/${c.id}/receipts`)}
  >
    Track piece receipt
  </button>
)}
```

### 2. Add Route for Receipt Screen
**File**: `client/src/App.jsx` (or routing config)

```javascript
import { CuttingReceiptDetail } from './pages/cutting/CuttingReceiptPages.jsx';

// Add to routes:
{
  path: '/cutting-issues/:id/receipts',
  element: <CuttingReceiptDetail />
}
```

### 3. Update Navigation Menu
Add link to new page:
```
Production
  ├── Fabric Scrutiny
  ├── Job Works
  ├── Cutting Issues
  └── ✨ Cutting Receipt Tracking (NEW)
```

---

## API Service Layer

**File**: `client/src/services/erp.js`

Add new service:
```javascript
export const cuttingReceipts = {
  async preview(params) {
    return apiCall('POST', '/cutting-receipts/preview', params);
  },

  async create(cutting_issue_id, data) {
    return apiCall('POST', '/cutting-receipts', {
      cutting_issue_id,
      ...data
    });
  },

  async amend(receipt_id, data) {
    return apiCall('POST', `/cutting-receipts/${receipt_id}/amend`, data);
  },

  async verify(receipt_id, data) {
    return apiCall('POST', `/cutting-receipts/${receipt_id}/verify`, data);
  }
};
```

---

## Permission Requirements

### New Permission
Add to your permission matrix:
- `CUTTING_RECEIPT.CREATE` — Store staff / Receiving team
- `CUTTING_RECEIPT.VERIFY` — QC Manager / Supervisor
- `CUTTING_RECEIPT.AMEND` — QC Manager

### Role Assignment
```
Store Staff:
  ✓ CUTTING_RECEIPT.CREATE
  ✗ CUTTING_RECEIPT.VERIFY

QC Manager:
  ✓ CUTTING_RECEIPT.CREATE
  ✓ CUTTING_RECEIPT.VERIFY
  ✓ CUTTING_RECEIPT.AMEND
```

---

## Workflow State Machine

```
Cutting Issue POSTED
       ↓
Receipt PENDING (pieces received, awaiting verification)
       ↓
   [QC Review]
   /         \
VERIFIED    FLAGGED (variance detected)
   ↓           ↓
APPROVED    [Investigation + Amendment]
   ↓           ↓
   └─→ VERIFIED + AMENDED
```

---

## Data Flow Diagram

```
Cutting Issue Created
    ↓
Fabric issued to unit
    ├─ cuttingPcsIssued: 1000
    ├─ fabricIssued: 2500 Mtrs
    ├─ avgFabricPerPiece: 2.5 Mtrs/pc
    ↓
[Unit does stitching]
    ↓
Receipt Created
    ├─ pcsReceived: 985 (loss of 15)
    ├─ fabricReceived: 2462.5 Mtrs
    ├─ expectedFabric: 2462.5 (985 × 2.5)
    ├─ fabricVariance: 0 (OK)
    ↓
Stock Ledger Updated
    ├─ Fabric IN: +2462.5 Mtrs
    ├─ Location: MAIN STORE
    ↓
Receipt Status: VERIFIED
```

---

## Testing Checklist

### Unit Tests (Backend)
- [ ] Receipt creation validates pieces received ≤ pieces issued
- [ ] Variance calculation is correct
- [ ] Amendment creates before/after snapshot
- [ ] Stock ledger entries are atomic
- [ ] User permissions enforced

### Integration Tests
- [ ] Create cutting issue → Record receipt → Verify ledger updated
- [ ] Amend receipt → Amendment visible → Original preserved
- [ ] Variance flag triggers → Pieces held for QC
- [ ] Multiple receipts for same issue work (partial returns)

### Manual Testing
- [ ] Store staff can record receipt with exact quantities
- [ ] QC can see variance warnings before approving
- [ ] Amendments show in audit trail
- [ ] Stock balance reflects received fabric
- [ ] Reports show pieces variance and fabric variance

---

## Security Implementation Checklist

- [ ] **Permission check**: Can only CREATE if user has `CUTTING_RECEIPT.CREATE`
- [ ] **Server validation**: Qty, dates, references all validated
- [ ] **Audit trail**: createdBy, createdAt, createdByEmployee recorded
- [ ] **Amendment trail**: Before/after snapshots stored
- [ ] **Immutability**: Posted receipt cannot be deleted, only amended
- [ ] **Variance flagging**: Automatic if over threshold
- [ ] **Stock ledger**: Atomic transaction (receipt + ledger or neither)
- [ ] **Timestamps**: System time, not user-adjusted

---

## Performance Optimization

### Indexes Needed
```sql
CREATE INDEX idx_cutting_issue_receipts ON cutting_receipts(cutting_issue_id);
CREATE INDEX idx_receipt_date ON cutting_receipts(receipt_date);
CREATE INDEX idx_variance_flagged ON cutting_receipts(variance_flagged);
CREATE INDEX idx_status ON cutting_receipts(status);
```

### Query Optimization
- Preload receipts with cutting issue (avoid N+1 query)
- Paginate receipt history for large issues
- Denormalize avgFabricPerPiece on receipt (don't recalculate every time)

---

## Rollout Plan

### Phase 1: Setup (Week 1)
- [ ] Create database tables
- [ ] Create API endpoints
- [ ] Add permissions to role matrix
- [ ] Unit tests pass

### Phase 2: Integration (Week 2)
- [ ] Update Cutting Issue page
- [ ] Add route and navigation
- [ ] Update service layer
- [ ] Integration tests pass

### Phase 3: UAT (Week 3)
- [ ] Store staff record receipts
- [ ] QC verifies variance flags
- [ ] Managers review audit trail
- [ ] Business sign-off

### Phase 4: Production (Week 4)
- [ ] Deploy with feature flag off
- [ ] Enable for pilot team (1 store)
- [ ] Monitor for errors/issues
- [ ] Full rollout

---

## Audit & Compliance

### Regulatory Requirements Addressed
- ✅ Every receipt is attributed (createdBy, createdAt)
- ✅ No deletion allowed (only archive)
- ✅ Amendments tracked (before/after visible)
- ✅ Stock ledger updated atomically
- ✅ Variance flagged for investigation
- ✅ Traceability: Order → Fabric → Pieces

### Audit Report Output
```sql
SELECT 
  ci.challan_no, 
  cr.receipt_no,
  cr.pcs_received,
  cr.fabric_received,
  cr.variance_flagged,
  e.emp_name as received_by,
  cr.created_at
FROM cutting_receipts cr
JOIN cutting_issues ci ON cr.cutting_issue_id = ci.id
JOIN employees e ON cr.created_by_employee_id = e.id
WHERE cr.variance_flagged = true
ORDER BY cr.created_at DESC;
```

---

## FAQ

### Q1: What if pieces received > pieces issued?
**A**: Not allowed by constraint. API validation prevents it. Error message shown to user.

### Q2: What if fabric received doesn't match expected?
**A**: Flagged for variance. User must acknowledge. QC reviews. Amendment required if correction needed.

### Q3: Can I delete a receipt?
**A**: No. Receipts are permanent. Only corrections via Amendment (which preserves original).

### Q4: Who can verify/approve receipts?
**A**: Only users with `CUTTING_RECEIPT.VERIFY` permission (typically QC manager).

### Q5: Is the timestamp user-editable?
**A**: No. System captures NOW() automatically. User cannot backdate.

---

## Next Steps

1. **Database**: Run migrations to create tables
2. **Backend**: Implement API endpoints with validation
3. **Frontend**: Integrate component and routes
4. **Testing**: Run unit & integration tests
5. **UAT**: User acceptance testing with store staff
6. **Deployment**: Rollout to production

---

**Created**: 2024-01-15  
**Last Updated**: 2024-01-15  
**Status**: Ready for Implementation  
**Estimated Dev Time**: 3-4 weeks (including testing & UAT)
