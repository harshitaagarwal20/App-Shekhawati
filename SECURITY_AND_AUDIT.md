# Data Security, Safety & Authenticity Framework
## Shekhawati Impex — ERP System

---

## 1. AUTHENTICATION & AUTHORIZATION

### 1.1 User Authentication
- **JWT Token-based**: User sessions authenticated via JWT tokens (AuthContext)
- **Role-based Access Control (RBAC)**: Every action requires specific permissions
- **Permission Checks**: Frontend validates permissions before showing UI; backend enforces server-side
  ```
  Example: can('CUTTING_RECEIPT.CREATE') — user must have this permission
  ```

### 1.2 Permission Matrix
Permissions segregate operations by role:
- `FABRIC_SCRUTINY.CREATE` — QC staff only (record findings)
- `FABRIC_SCRUTINY.APPROVE` — Director only (finalize decisions)
- `CUTTING_ISSUE.CREATE/APPROVE` — Supervisors only
- `CUTTING_RECEIPT.CREATE` — Store staff only
- `PLANNING.EDIT/APPROVE` — Planning dept only
- `DYEING_RECEIPT.CREATE` — Receiving staff only

**Result**: No user can perform an action outside their role, preventing unauthorized changes.

---

## 2. AUDIT TRAIL & IMMUTABILITY

### 2.1 Complete Audit Logging
Every transaction records:
- **Who**: User ID, employee name, designation
- **When**: Exact timestamp (ISO 8601 format)
- **What**: Document number, action taken, fields changed
- **Where**: Location (store, unit, department)
- **Why**: Reason (for rejections, amendments, holds)

### 2.2 Immutable Records
Once posted/finalized, documents cannot be deleted or directly edited:
- ✅ **Fabric Scrutiny**: Locked after decision; changes only via Amendment
- ✅ **Cutting Issue**: Locked after posting; permanent
- ✅ **Material Plan**: Frozen at creation; BOM changes don't affect existing plans
- ✅ **Job Work Returns**: Recorded permanently; corrections via new receipt

**Pattern**: Change = NEW RECORD + AMENDMENT TRAIL
```
Original Record: "Qty Affected = 50"
Amendment #1:   "Changed to 60" (Before: 50 → After: 60) + reason + timestamp + user
Both visible forever
```

### 2.3 Amendment Trail
When a locked record is amended:
1. **Before/After snapshot** stored (what it said before, what it says now)
2. **Reason recorded** (why the change)
3. **User ID & timestamp** captured
4. **Original visible** forever (not overwritten)

Example from Fabric Scrutiny Amendment:
```
Amendment #1 (2024-01-15 10:30 by Rajesh)
Reason: "Checker miscounted defects"
Changed:
  - qtyAffected: 50 → 60
  - remarks: "Old notes" → "Recounted at 60"
```

---

## 3. TRANSACTION INTEGRITY

### 3.1 Atomic Transactions
Critical operations are atomic — all or nothing:

**Receipt Example** (Job Work or Cutting):
```
ONE TRANSACTION includes:
  ✓ Create Receipt record (receipt number, timestamp)
  ✓ Update Job Work totals (qty received, shrinkage %)
  ✓ Stock Ledger IN (fabric/pcs returned to inventory)
  ✓ Roll balance update (balance qty)
  ✓ Audit log entry (who, when, what)

If ANY step fails → ENTIRE transaction rolls back
No partial records exist
```

**Result**: Stock ledger always matches the business reality.

### 3.2 Database Constraints
Constraints prevent bad data at the database level:
- **Check constraints**: `fabric_scrutinies_decision_needs_defects`
  - REWORK or REJECT can ONLY be posted WITH at least one defect line recorded
  - Prevents: "Sending fabric back for rework" with no defect recorded
  
- **Foreign key constraints**: Referential integrity
  - Receipt MUST reference a valid Cutting Issue
  - Cutting Issue MUST reference a valid Plan Approval
  - Cannot delete a parent without orphaning children

- **Unique constraints**: Duplicate prevention
  - Receipt No is globally unique
  - Cutting Issue No is globally unique
  - Same user cannot post same document twice

---

## 4. DATA VALIDATION

### 4.1 Frontend Validation
Real-time feedback as users type:
- **Zod schema validation** (TypeScript schemas)
- **Required fields**: Prevents incomplete submissions
- **Numeric ranges**: Min/max constraints
- **Pattern validation**: ISO date formats, email patterns

Example (Cutting Receipt):
```javascript
const schema = z.object({
  pcsReceived: z.number().positive('Must be > 0'),
  fabricReceived: z.number().min(0),
  receiptDate: z.string().datetime(),
  remarks: z.string().max(2000),
});
```

### 4.2 Server-side Validation
Backend re-validates EVERYTHING (never trust client):
- User permission check (does this user have CUTTING_RECEIPT.CREATE?)
- Business logic validation (pieces received ≤ pieces issued?)
- Numeric precision (no rounding errors)
- Referential integrity (does the Cutting Issue exist?)
- State validation (can only receive if issue is POSTED?)

**Result**: Frontend can be bypassed, but server refuses invalid data.

### 4.3 Calculation Verification
Complex calculations are verified server-side:
```
Fabric Variance = Actual Received - (Pieces Received × Avg Per Piece)
Avg Per Piece = Fabric Issued ÷ Cutting Pcs Issued

Server recalculates, not trusting browser math.
```

---

## 5. VARIANCE DETECTION & HOLDS

### 5.1 Automatic Flagging
Anomalies detected and flagged automatically:

**Cutting Receipt Variance**:
- Pieces received ≠ pieces issued → Flag (detect loss/overage)
- Fabric variance > allowance → Flag for QC
- Shrinkage % > standard → Roll held for scrutiny

**Fabric Scrutiny Variance**:
- Qty affected on a roll exceeds cumulative → Warning
- Defect cumulative > roll size → Cannot finalize without review

### 5.2 QC Holds
Flagged records trigger holds:
- Roll is held (stage = HELD)
- Status badge shows (row-warn styling)
- Amendment reason required to unlock
- Director must approve changes

---

## 6. ENCRYPTION & SECURE TRANSMISSION

### 6.1 In Transit
- **HTTPS Only**: All API calls over TLS 1.3
- **No sensitive data in URLs**: Credentials/IDs in request body, not query string
- **CORS headers**: Cross-origin requests validated

### 6.2 At Rest
- **Database**: Sensitive fields encrypted at DB level
  - Employee mobile numbers
  - Vendor bank details
  - User passwords (hashed via bcrypt)
- **Audit logs**: Not encrypted (need to be searchable), but read-restricted

### 6.3 Session Security
- **JWT expiration**: Tokens expire (typical: 24 hours)
- **Refresh tokens**: Long-lived tokens to get new JWTs
- **No localStorage for credentials**: Only JWT stored, never passwords
- **HttpOnly cookies** (if applicable): Prevents XSS theft

---

## 7. DATA ACCURACY & RECONCILIATION

### 7.1 Dual-Entry Verification
Critical figures checked twice:

**Cutting to Stitching Pipeline**:
```
Planning says:     "100 pcs for stitching"
Cutting Challan:   "100 pcs issued"  ← Must match planning
Stitching Receipt: "100 pcs received" ← Must match challan

Any variance = Warning + Hold
```

### 7.2 Inventory Reconciliation
Stock ledger trails every movement:
```
Fabric Issue:     -1000 Mtrs (out of MAIN STORE)
Job Work Return:  +950 Mtrs  (back to MAIN STORE)
Shrinkage:        50 Mtrs    (calculated)
Balance:          Always accurate
```

### 7.3 Three-Way Match
Purchase Order → Receipt → Invoice
- Qty ordered vs qty received vs qty invoiced must align
- Variance requires approval/reason

---

## 8. FIELD-LEVEL SECURITY

### 8.1 Read Restrictions
Not all users see all data:
- Employee salaries: HR only
- Vendor costs: Finance only
- Quality issues: QC & Management only
- Buyer sensitive info: Order management only

### 8.2 Write Restrictions
Only certain users can modify certain fields:

**Fabric Scrutiny**:
- QC creates with: scrutinyDate, rollId, defectType, qtyAffected ✓
- QC cannot modify: decision (read-only until Director finalizes) ✗

**Planning**:
- Once approved, only line status can change (PENDING → COMPLETED)
- Quantities are frozen (no editing, only revise to v2) ✓

**Cutting Challan**:
- Once posted, entire document is locked
- No corrections, only reason for closing short

---

## 9. DOCUMENT LIFECYCLE & STATE MANAGEMENT

### 9.1 State Machine Pattern
Every document follows a strict workflow:

**Fabric Scrutiny**:
```
DRAFT (open) 
  ↓ [Take Decision]
LOCKED (finalized)
  ↓ [Amend if needed]
LOCKED + AMENDMENTS (trail visible)
```

**Cutting Issue**:
```
DRAFT 
  ↓ [10 checks]
POSTED (permanent)
```

**Material Plan**:
```
DRAFT 
  ↓ [Submit]
SUBMITTED 
  ↓ [Approve/Reject]
APPROVED or REJECTED
  ↓ [If rejected, Revise]
v2 DRAFT (new version)
```

### 9.2 Workflow Validation
Actions blocked if state is wrong:
- Cannot post a Cutting Issue that's already posted ✗
- Cannot receive pieces for an issue that's not posted ✗
- Cannot amend a fabric scrutiny if user lacks APPROVE permission ✗

---

## 10. INTENTIONAL DESIGN DECISIONS FOR SAFETY

### 10.1 No Bulk Operations
- Cannot delete 50 records in one click
- Each deletion confirmed individually
- Prevents accidental mass changes

### 10.2 Pessimistic Assumptions
- Unknown data is treated as invalid
- Missing permissions = deny, not allow
- Unrecognized states = error, not pass through

### 10.3 Visibility Over Convenience
- Old data stays visible (not archived away)
- Amendments shown inline (not hidden in versions)
- Variance warnings shown on same screen (not buried in reports)
- Trail of every change always accessible

### 10.4 No Undo, Only Amendment
- Delete is hidden (only archiving, not erasure)
- Can't click "Undo" for a posted Cutting Issue
- Must formally amend with reason
- Forces accountability

---

## 11. COMPLIANCE & LEGAL REQUIREMENTS

### 11.1 GST/Tax Compliance
- **Invoice numbers**: Sequential, never reused
- **Date tracking**: Invoice date vs posting date separate
- **Audit trail**: Who posted, when, from where
- **Reversals**: Never delete invoices, only reverse with new invoice

### 11.2 Import/Export
- **Commodity tracking**: Fabric movements logged
- **Gate passes**: Physical goods tracked with digital receipts
- **Vendor details**: Validated business addresses

### 11.3 Buyer Requirements
- **Traceability**: Order → Fabric → Cutting → Stitching visible in one chain
- **Measurement verification**: Average fabric per piece calculated from buyer BOM
- **Quality evidence**: Scrutiny reports attached to every roll

---

## 12. OPERATIONAL SAFETY MEASURES

### 12.1 Pre-Flight Checks
Before posting/finalizing:
```
✓ Permission check
✓ Stock availability
✓ Ceiling compliance (qty ≤ approved order qty)
✓ Numeric validation (no negative quantities)
✓ Referential integrity (all linked docs exist)
✓ Workflow state (can this action happen now?)
✓ User identity (who is doing this?)
✓ Timestamp (system time, not user-adjusted)
```

### 12.2 Warnings, Not Blocks
Variance detected = Warning + Hold, not complete failure:
- If shrinkage is 5% over: WARN, hold roll, but allow receipt
- If fabric required exceeds ceiling: WARN, disallow posting
- If pieces > issued: WARN, flag for QC, but record receipt

### 12.3 Approval Gates
Key decisions need approval:
- Director approves Fabric Scrutiny decisions
- Manager approves Plan Approvals
- Finance approves excess allowances on orders

---

## 13. RECONCILIATION & AUDIT REPORTS

### 13.1 Daily Reconciliation
- Stock ledger vs physical count
- Order qty vs planned qty vs issued qty
- Cutting pcs issued vs expected stitching pcs received

### 13.2 Monthly Audit
- Variance analysis (why are pieces short?)
- Shrinkage trends (which vendors exceed allowance?)
- Role-based action audit (who is rejecting plans most?)

### 13.3 Traceability Report
Any product can be traced:
```
Order No (PO-001)
  → Buyer requirement (1000 pcs @ avg 2.5 Mtrs/pc)
  → Material Plan (2500 Mtrs to buy)
  → Fabric Issue (2400 Mtrs to Unit A)
  → Cutting Issue (950 cutting pcs)
  → Stitching Receipt (940 finished pcs)
  → Why 10 lost? (Shrinkage detail, date, who recorded)
```

---

## 14. PREVENTING COMMON FRAUD SCHEMES

### Scheme | Detection | Prevention
---|---|---
**Duplicate Receipt** | Unique receipt numbers | Cannot post same receipt twice
**Qty Manipulation** | Before/after snapshots | Amendments show change
**Unauthorized Access** | Permission matrix | API rejects unprivileged users
**Backdated Records** | System timestamp | User cannot adjust timestamp
**Deleted Evidence** | Archiving not deletion | All records searchable forever
**Collusion** | Segregation of duties | Approver ≠ Preparer ≠ Verifier
**Silent Changes** | Amendment trail | Visible in UI, logged to audit table

---

## 15. TECHNICAL SECURITY MEASURES

### 15.1 Frontend Security
- **No credentials in code**: API keys in env vars
- **Input sanitization**: HTML escaped, no inline scripts
- **XSS prevention**: React auto-escapes, no `dangerouslySetInnerHTML`
- **CSRF tokens**: Passed with every state-changing request

### 15.2 Backend Security
- **SQL injection prevention**: Parameterized queries
- **API rate limiting**: Prevent brute force attacks
- **Request validation**: Zod schemas on every endpoint
- **Logging**: Every access logged (not just failures)

### 15.3 Infrastructure
- **Secrets management**: API keys, DB passwords in vault (not repo)
- **Database backups**: Daily automated backups, encrypted
- **Network**: VPN required for production access
- **Monitoring**: Alerts for unusual activity (bulk deletes, after-hours access)

---

## 16. AUDIT TRAIL STRUCTURE

### Every record includes:
```
{
  id: "UUID",
  createdAt: "2024-01-15T10:30:00Z",
  createdBy: { empId: "E101", name: "Rajesh", designation: "QC Manager" },
  postedAt: "2024-01-15T11:45:00Z",
  postedBy: { empId: "E102", name: "Director", ... },
  amendedAt: ["2024-01-16T09:00:00Z"],
  amendments: [
    {
      amendmentNo: "1",
      amendedAt: "2024-01-16T09:00:00Z",
      amendedBy: "E102",
      reason: "Qty recounted",
      changes: {
        before: { qtyAffected: 50 },
        after: { qtyAffected: 60 }
      }
    }
  ]
}
```

---

## 17. USER EDUCATION & PROCESS

### 17.1 Role-Specific Training
- QC staff trained on defect classification
- Stitching units trained on acceptance/rejection criteria
- Finance trained on reconciliation procedures

### 17.2 Process Documentation
- Written SOPs for each workflow
- Clear escalation paths (what happens if shrinkage is 10%?)
- Role descriptions (QC checks ONLY defects, not planning)

---

## 18. CONTINUOUS MONITORING

### 18.1 System Health
- Database integrity checks (foreign keys, constraints)
- API latency monitoring (slow queries flagged)
- Error rate tracking (fails investigated within 1 hour)

### 18.2 User Behavior Analytics
- Unusual access patterns (accessing someone else's orders?)
- Bulk operations (deleting many records suddenly?)
- After-hours activity (when normal staff don't work?)

---

## Summary: Three Pillars

| Pillar | How It Works | Example |
|--------|-------------|---------|
| **Authenticity** | Every change is attributed & timestamped | "Rajesh on 2024-01-15 10:30 changed qty from 50 to 60 because of recount" |
| **Integrity** | Atomic transactions, constraints, validation | Receipt writes to ledger IN same transaction; if one fails, both rollback |
| **Traceability** | Full audit trail, amendments visible, nothing deleted | Click any receipt → see all amendments → see who changed what when |

---

**Document Last Updated**: 2024-01-15  
**Author**: System Design Team  
**Next Review**: 2024-07-15
