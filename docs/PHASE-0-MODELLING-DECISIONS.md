# Phase 0 — Modelling Decisions, Assumptions & Open Points

Shekhawati Impex ERP · database foundation

Source documents inspected before any modelling:

| File | Role |
|---|---|
| `Shekwati Impex formats.xlsx` | **Primary reference.** Latest format set; 33 sheets. Used for every field, dropdown, formula and role banner. |
| `Shekwati4.xlsx` | Supplementary. Earlier revision, but the only file carrying the **Dyeing Receipt** sheet, which the primary file omits. |
| `Current Process.xlsx` | Original captured process. Used to confirm intent where the newer sheets are terse (e.g. the Planning "Sum should match Order Qty" note). |
| `Sekhawati Impex Process Documentation.docx` | Narrative business rules — order types, tolerances, shrinkage, roles. |
| `current_flowchart.md` | **Ignored.** It documents a different company (Little Nap recliner manufacturing) and has no bearing on this ERP. |

---

## 1. Where the two workbooks disagree

`Shekwati Impex formats.xlsx` is treated as authoritative. It is the newer and
richer revision — its Buyer Master carries ten more columns (consignee, notify
party, ports, incoterm, freight terms) and its buyer codes follow the
"come from buyer initial letters" rule (`TWA#`, `GBL#`) rather than the earlier
`BUY-001`. Where `Shekwati4.xlsx` has a sheet the primary file lacks
(**Dyeing Receipt**), that sheet was taken as-is.

The primary file's plan-approval sheet is named `" Plan Approval"`; `Shekwati4`
calls the same sheet `"Cutting Plan Approval"`. Identical columns — modelled
once as `PlanApproval`.

---

## 2. Scope boundary

The pipeline ends at **Cutting Issue**. No table, enum or column models
Stitching Record, Hourly Monitoring, QC Size, QC Defects, Internal Quality
Check, Internal/Final Checker Report, Finished Checker, External Secondary
Checking, Alter Report, Spot Rectification-Scrap, Rejected, Packing, Needle
Checking, Dispatch or Reconciliation Report.

This is enforced mechanically by `npm run verify:scope`
(`server/prisma/verify-scope.js`), which fails if a forbidden module name
appears in a model name, `@@map` table name or field name. Comments may mention
them in order to record that they are deliberately absent.

Two values that *look* out of scope are kept, because they are dropdown values
rather than modules:

- `IssuePurpose.STITCHING` — Gate Pass GP-005/GP-006 in the workbook move cut
  pieces to and from a stitching unit. The gate pass is in scope; what the unit
  then does is not.
- `MasterList "StitchingUnit"` — the four contract units are the *destination*
  on Planning, Cutting Issue ("Firm Name") and Employee Master.

---

## 3. Dropdowns: enums vs. master-list tables

The workbook's own rule (`READ ME` sheet) is: *"Add a new row at the bottom of a
master and the dropdown picks it up automatically."* A Prisma enum cannot do
that without a migration, so lists split two ways:

**Prisma enums** — closed lists that drive workflow logic and must never grow
without a code change:
`StatusGeneral`, `StatusApproval`, `StatusActive`, `GatePassType`,
`StatusGatePass`, `ScrutinyDecision`, `StatusDyeReceipt`, `FabricStage`,
`JobWorkProcess`, `IssuePurpose`, `GrnPurpose`, `PlanDepartment`,
plus the internal `PoOrderType`, `StockDirection`, `RollStage`,
`ApprovalAction`, `DocumentType`.

**`MasterList` / `MasterListValue` tables** — 25 user-extensible lists:
Country, Currency, ShipMode, UOM, ItemCategory, FabricSubCat, AccessoriesItem,
ColorCode, FabricContent, GSM, Count, Construction, SizeGroup, Department,
Designation, StitchingUnit, ContainerNo, VendorCategory, StyleCategory,
AuthorisedBy, DefectType, PaymentTerms, FreightTerms, PriceTerms, StockLocation.

> **Decision (D1).** Transaction rows store the **exact dropdown text** (e.g.
> `"10 oz"`, `"320 GSM"`, `"Unit 1 - Anil Kumar"`) in a plain string column
> rather than a foreign key to `MasterListValue`. Reason: the stated priority is
> that a user familiar with the Excel can read the ERP screen and reconcile it
> against the workbook. A denormalised value column keeps the ERP row
> character-for-character comparable to the spreadsheet row and keeps reports
> simple. Membership is validated in the service layer from Phase 1 onward, and
> `prisma/seed/verify.js` already checks every seeded value against its list.
> Record-level masters (Buyer, Vendor, Employee, Style) use real foreign keys.

Lists **not** seeded, because they belong only to out-of-scope modules:
`Operation`, `InformTo`, `RejectReason`, `SentFor`, `StatusDispatch`,
`StatusRecon`, `StatusQC`, `YesNo`, `InspDefect26`.

Two lists were **added** (D2) — the Buyer Master marks both columns as
"Dropdown" but the Master Lists sheet has no column for them, so values were
taken from the sample rows: `FreightTerms` (Prepaid / Collect) and `PriceTerms`
(FOB Jaipur, India / CIF / CFR / EXW). A third, `StockLocation`, is entirely new
(D3) — the workbook has no inventory sheet, so it has no location list; the
minimum needed to hold a stock balance.

---

## 4. Model-by-model notes

### 4.1 Masters

**Buyer** — `buyerCode` follows the sheet note *"Come from buyer initial
letters"* (`Trade Word` → `TWA#`). Because that derivation is not deterministic
(3 letters + `#`, chosen by a human), the code is a stored, editable unique
column rather than a computed one.

**Vendor** — two columns added:
- `poInitials` (D4). The PO sheet's row-3 note is *"Vendor initial + no"*, and
  the sample data shows `Rajasthan Fabrics → RF-001`, `Metro Accessories →
  MA-001`. The initials are the scope key of the PO document sequence, so they
  must be stored rather than re-derived from the name each time.
- `pinCode` (D5). The Dye issue sheet prints a Pin Code per vendor; holding it
  on the vendor avoids re-keying it on every dye issue.

**Style / StyleBomLine** — the sheet is titled "Style Master (BOM)" but carries
only `Avg Fabric Utilization / Pc`. `StyleBomLine` is **new** (D6). The scope
list explicitly requires "Style BOM", and the Process Documentation requires the
system to compute an "Order as per Style" requirement from the style, which
needs a per-piece material breakdown (fabric + handles + labels + zips). The
fabric line's `qtyPerPc` always equals `avgFabricUtilizationPerPc`, so the
workbook column stays the single source of truth for fabric. The seeded
accessory lines are derived from what the sample POs actually buy for each
style; they are illustrative and expected to be replaced with real BOMs.

Also added: `Style.avgUtilizationUom` (D7), defaulting to `Mtrs`. The workbook
works in metres throughout but the UOM list contains Kg, and jute is often
bought by weight. Making the unit explicit costs nothing and avoids an
ambiguous number.

### 4.2 Buyer Order

Modelled one-for-one with the `Order` sheet, including `excessPct` (the sheet's
"Excess" column, stored as a fraction: `0.02` = 2%) and its note *"Approval from
dinesh sir"*. `orderNo` is manual and unique — the sheet says *"Buyer PO num is
their order no"*.

### 4.3 Planning

Two sheets describe one thing: `Planning_` is the form header (Planning
Department, Container No, Order No, Style No, Order Qty) over a grid of
Date / Deliverable Size / Status / Remark; `Planning` is the same data flattened.
Modelled as **`Planning` (header) + `PlanningLine` (day-wise allotment)** (D8).

`Planning.version` (D9) exists because the Plan Approval sheet records
resubmission after rejection ("Revised plan v2"). The unique key is
`(orderId, planDepartment, version)`.

> **Business rule not yet enforced.** `Current Process.xlsx` → Planning sheet
> carries the note *"Sum should match Order Qty"*. This is a cross-row rule and
> is left to the service layer in Phase 1; it is **not** a database CHECK.

### 4.4 Vendor Quotation → PO

`VendorQuotation.orderId` and `PurchaseOrder.orderId` / `styleId` /
`quotationId` are **added links** (D10). The workbook records these in the
Remarks column as free text ("For B9646IS", "Order as per Style - B9641IS").
Real foreign keys are required for the mandated traceability chain. The Remarks
column is retained verbatim alongside.

`PurchaseOrder.orderType` (D11) — the Process Documentation §5 defines two order
types, *Order as per Style* (quantity capped by the average-based requirement)
and *Bulk Order* (uncapped). The workbook encodes this in Remarks. Promoted to
an enum because it changes validation behaviour.

> **Decision (D12).** A Purchase Order is **flat — one item per PO** — with no
> header/line split, because that is exactly how the PO sheet is laid out
> (`RF-001` = 4500 Mtrs of 10 oz Natural canvas, one row). A header/line model
> would have made every PO screen differ structurally from the sheet it
> replaces. If multi-line POs are needed later, a `PurchaseOrderLine` table can
> be added without disturbing the existing rows.

### 4.5 Gate Pass

`linkedDocNo` keeps the free-text reference exactly as printed
(`RF-001`, `DY-001`, `CH-001`, `PR-001`), and three optional resolved foreign
keys (`purchaseOrderId`, `dyeIssueId`, `cuttingIssueId`) sit beside it so the
trace works. `variationPct` reproduces `IFERROR((Qty − Received Qty)/Qty, 0)`.

`partyName` (D13) is a plain string in addition to the optional `vendorId`,
because the sheet's "Vendor / Unit Name" column mixes vendor-master records with
stitching-unit names.

### 4.6 GRN

`grnNo` is **new** (D14). The workbook identifies a receipt only by PO ID + Bill
No, which is preserved as a unique constraint; the ERP additionally issues a
sequential `GRN-001` so the document can be referenced from the stock ledger and
the approval trail.

`variationPct` and `toleranceBreached` (D15) implement Process Documentation §5:
2% general receipt variation, accessories up to 3% and no more, payment on
quantity actually received. `toleranceBreached` flags **excess only** — a short
receipt (GRN-006 receives 2800 of 5600) is a partial delivery, not a breach.

### 4.7 Fabric Roll

`FabricRoll` is the spine of the second half of the pipeline: the workbook's
"Roll No" / "Fabric No" (`FAB-001`) is the key that Fabric Issue, Dye issue,
Dyeing Receipt and Fabric Scrutiny all join on. Created at GRN, followed to
Cutting Issue, with `stage` (`RollStage`) tracking where it is and `balanceQty`
tracking what is left.

> **Assumption (A1).** The GRN sheet's "Roll No" column is **blank in every
> sample row**, so there is no recorded roll↔GRN link. The seed infers it by
> matching each roll's fabric attributes (colour / GSM / count / content) to the
> GRN that bought that fabric. Four rolls (`FAB-005`, `FAB-007`, `FAB-008`,
> `FAB-010`) match no sample GRN and are seeded with `grnId = null` and a remark
> saying so. Real data will supply the link at GRN entry.

### 4.8 Inventory & Stock Ledger

Entirely new (D16) — the workbook has no inventory sheet; stock is implied by
GRN in and Fabric/Cutting Issue out. Three tables:

- `InventoryItem` — the SKU, identified by
  `(itemCategory, subCategory, accessoriesItem, colorCode, gsm, count, uom)`.
  Those five optional parts are `NOT NULL DEFAULT ''` rather than nullable,
  because PostgreSQL treats NULLs as distinct in a unique index and the identity
  would not actually be unique otherwise.
- `StockLedger` — append-only movements, each carrying the source
  `(documentType, documentId, documentNo)` and a running `balanceQty`.
- `StockBalance` — materialised current quantity and weighted-average rate per
  `(item, location)`.

### 4.9 Dyeing & Printing

`DyeIssue` covers job work of every kind (the sheet's "Process" column is
Dyeing / Printing / Washing / Finishing) and carries the separate job-work PO
number that Process Documentation §5 requires (*"Fabric for dyeing is issued to
the job worker under a separate PO"*).

> **Decision (D17).** Dyeing job-work issues keep the workbook's `DY-nnn`
> series. Printing job-work issues get a parallel `PJ-nnn` series, because the
> workbook prints no number for them at all (the Dye issue rows for printing
> just say "Panel print" / "Roll printing"), and the `DY-` counter is already
> consumed by the dyeing rows that the Dyeing Receipt sheet books against. Both
> series live in `DocumentSequence` under `DYE_ISSUE` with `scopeKey` =
> `DYEING` / `PRINTING`.

> **Assumption (A2).** The Dyeing Receipt sheet books returns against
> `DY-001…DY-007`, but the Dye issue sheet only sampled seven rows, five of
> which are dyeing (`DY-001…DY-005`). `DY-006` (FAB-009) and `DY-007` (FAB-010)
> were **added to the seed** so the receipt chain closes. They are marked as
> such in `transactions.js`.

`Printing` is modelled separately from `DyeIssue` because the Printing sheet is
a separate register owned by a different role (Printing Dept Manager) and covers
both *Before Stitching* (roll printing, in scope) and *After Stitching* (logo
printing on a finished bag). The after-stitching rows are kept because the sheet
records them and the sheet is in scope — the ERP does not model what happens
between the two.

### 4.10 Fabric Scrutiny

One-for-one with the sheet. `decision` is the enum `ACCEPT / REJECT / REWORK`;
`defectType` is a master-list string. `checkedByEmployeeId` resolves the sheet's
"Checked By" dropdown to Employee Master, with `checkedByName` kept for print
fidelity.

### 4.11 Plan Approval → Cutting Issue

`PlanApproval.planningId` (D18) is added so the approval actually gates the
plan; the sheet keys only on Order No + Container No. `round` records the
resubmission number (the sheet shows B9652IS and B9658IS each rejected once,
then approved on a "Revised plan v2").

`CuttingIssue.containerNo` is stored, not computed. The sheet uses
`=IFERROR(INDEX(Planning!$F..., MATCH($C7, Planning!$A..., 0)),"")` — a lookup
into Planning by Order No. In the ERP it is defaulted from the linked plan on
create; the seed verification asserts the two agree.

---

## 5. Cross-cutting decisions

**Soft deletion (D19).** Every business table carries `deleted_at` /
`deleted_by_id`; nothing is hard-deleted. Document numbers stay unique across
deleted rows so a number is never silently reused. `deletedAt` is indexed on
every soft-deletable table.

**Audit columns (D20).** Every business table carries `created_at`,
`created_by_id`, `updated_at`, `updated_by_id`, `deleted_at`, `deleted_by_id`.
The `*_by_id` columns are plain `uuid` scalars with **no foreign key to
`users`**, deliberately: three named relations to `User` on each of ~30 models
would add ~90 relation fields to the schema for no query benefit, and a user
must remain deletable without orphaning history. Resolution happens at the
service layer.

**Audit trail (D21).** Three separate tables, because they answer three
different questions:
- `AuditLog` — row-level before/after for any table (*what changed*).
- `ApprovalHistory` — polymorphic, time-stamped approval trail (*who decided
  what, when*). Replaces the workbook's single "Authorised By" /
  "Authorisation Status" / "Approved Date" columns, which are also retained on
  each document so the ERP screen still matches the sheet.
- `DocumentAmendment` — a numbered, reasoned change to an already-issued
  document (*why it was revised*), with a JSONB field-level diff.

**Document numbering (D22).** `DocumentSequence` is keyed on
`(documentType, scopeKey)`. `scopeKey` is what lets one document type run
several counters — required by the PO rule "vendor initial + no" (`RF-001` and
`MA-001` are independent series) and used again for the `DY-`/`PJ-` split.
22 sequences are seeded with `nextNumber` set past the sample data so the first
ERP-created document continues the workbook's numbering.

**Money and quantity precision (D23).** Quantities and rates are
`Decimal(18,4)`, amounts `Decimal(18,2)`, percentages `Decimal(9,6)` stored as
fractions (`0.02` = 2%, matching how the workbook stores them). No floats
anywhere.

**Formula columns are stored, not computed (D24).** `amount`, `variationPct`,
`shrinkagePct` and `variationFlag` are persisted columns recomputed on every
write, rather than generated columns or view expressions. Reason: an ERP must be
able to reproduce what a document said when it was issued, and generated columns
would silently rewrite history if a rate were corrected.

**CHECK constraints (D25).** Prisma has no CHECK syntax, so a second migration
(`20260825000100_check_constraints`) adds 50 of them: non-negative quantities
and rates, percentage ranges, `version`/`round`/`next_number` ≥ 1, and two
conditional rules (an `APPROVED` PO must have `approved_at`; a `REJECTED` PO or
plan approval must have a reason). Deliberately conservative — tolerance policy
lives in the service layer where it can produce a usable error message.

**Roles (D26).** The eleven seeded roles come from the "Role Acess — …" banner
printed on row 1 of each sheet. 119 permissions are generated as
`MODULE.ACTION` over 24 in-scope modules; `APPROVE` exists only on the eight
modules that actually carry a decision, and `INVENTORY` / `STOCK_LEDGER` /
`REPORT` are view/export only since they are projections of other documents.

---

## 6. Open points for the user

1. **`Style.avgFabricUtilizationPerPc` units.** Assumed metres per piece
   (`0.85` for a tote). Confirm, especially for the jute style `BS-0455-003`.
2. **Accessories ordering tolerance.** The Process Documentation says
   accessories may be ordered only **1%** over requirement and received up to
   **3%**; the PO sheet's "Excess Allowed" note says **2-3%**, and the sample
   accessory POs use 1%. Modelled as a per-PO `excessAllowed` with a
   GRN-side receipt tolerance of 3% for accessories / 2% otherwise. Confirm
   whether the ordering cap should be hard-blocked or warn-only.
3. **Buyer code derivation.** `TWA#`, `GBL#`, `ECO#`, `UTI#`, `NSA#`, `MSS#`,
   `ACP#` — is there a fixed rule, or is it chosen per buyer? Currently editable.
4. **Roll numbering at GRN.** Should one GRN create one roll, or should the
   checker enter a roll count / individual roll lengths? Currently the schema
   supports many rolls per GRN; the entry screen for it is a Phase-1 question.
5. **Dyeing Receipt DR-002** (3.5% shrinkage against a 3% standard) is marked
   `OK` in the workbook with the remark "3.5% - borderline". The seed reproduces
   it verbatim and `verify:seed` warns about it. Confirm whether the ERP should
   allow such a manual override, and whether it needs an approval.
6. **Planning "Sum should match Order Qty".** Hard block, or warning? Two of
   the workbook's own sample plans do not satisfy it.
7. **Printing "After Stitching" rows.** These sit downstream of the scope
   boundary in real life. The sheet is in scope so the rows are kept, but
   confirm the ERP should accept them.
