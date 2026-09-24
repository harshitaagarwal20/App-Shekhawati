# Excel reconciliation map

Every business column in the workbook, traced through the system:

```
Excel field  →  ERP field  →  Database column  →  API field  →  React field
```

The purpose of this document is that somebody holding the original workbook can
find any figure in the ERP, and vice versa — and that any column which is
**deliberately** not implemented says so, with a reason, rather than being
quietly dropped.

## How to read it

- **ERP field** is the Prisma model property.
- **Database column** is the physical column (Prisma `@map`).
- **API field** is the JSON key. Where it differs from the ERP field it is a
  *derived* value computed on the server — those are marked **`derived`**.
- **React field** is where it appears on screen.
- **Source** in the Excel column shows the workbook's own annotation:
  *(Auto)*, *(Manual)*, *(Dropdown)*, *(Formula)*.

Every `Decimal` column is `DECIMAL` in Postgres and `Prisma.Decimal` in the
service layer. No business quantity is ever a JavaScript `Number` on the server.

A companion cross-check lives in the schema itself: every business column in
`schema.prisma` carries an `/// Excel:` comment naming the sheet and the exact
column caption, so the mapping is verifiable from either direction.

---

## 1. Master Lists

| Excel field | ERP field | Database column | API field | React field |
|---|---|---|---|---|
| Column caption (row 4) | `MasterList.code` | `master_lists.code` | `code` | List Master → list name |
| Column values (rows 5+) | `MasterListValue.value` | `master_list_values.value` | `value` | every business dropdown |

Twenty-five lists are seeded verbatim from the sheet. Lists whose values drive
**workflow logic** — `StatusGeneral`, `StatusApproval`, `StatusActive`,
`GatePassType`, `Decision`, `StatusGatePass`, `StatusDyeRecv`, `FabricStage`,
`Process`, `Purpose`, `GRNPurpose`, `PlanDept` — are Prisma enums instead, and
are therefore **not** editable on the List Master screen. That is deliberate:
adding a value to `StatusApproval` would mean nothing without code that knows
what to do with it.

### Not implemented, and why

| Excel list | Why |
|---|---|
| `Operation`, `InformTo`, `RejectReason`, `SentFor`, `StatusDispatch`, `StatusRecon`, `StatusQC`, `YesNo`, `InspDefect26` | Each belongs to a **post-Cutting-Issue module** — stitching, QC records, dispatch, reconciliation — which is explicitly out of scope. Seeding them would imply a module that does not exist. |
| `ShipMode` → "Courier" | Not in the reference specification (Ship / Air / Road). Removed rather than left as invented master data. Nothing referenced it. If the office does courier shipments, the value is added on the List Master screen — which is where master values belong. |

---

## 2. Buyer Master · Vendor Master · Employee Master · Style Master

These four are documented in **[PHASE-1-2-NOTES.md](PHASE-1-2-NOTES.md)** and
were delivered in Phase 2. Later additions are worth recording here:

| Excel field | ERP field | Database column | API field | React field |
|---|---|---|---|---|
| — (implied by "Vendor initial + no" on the PO sheet) | `Vendor.poInitials` | `vendors.po_initials` | `poInitials` | Vendors → PO Initials |
| — (printed per vendor on the Dye issue sheet) | `Vendor.pinCode` | `vendors.pin_code` | `pinCode` | Vendors → Pin Code |
| `Color:` inside Remarks → Dropdown → L_ColorCode | `Style.colorCode` | `styles.color_code` | `colorCode` | Styles → Color |
| `Qty/ctn:` inside Remarks | `Style.qtyPerCarton` | `styles.qty_per_carton` | `qtyPerCarton` | Styles → Qty / Ctn |

The last two arrived packed into the Style Master's free-text Remarks column,
alongside two facts that stay there:

> `Fabric: 10 oz Fabric; Color: Natural; Qty/ctn: 200; Source: TWA03 Requirement Sheet 14.07.2022`

**Colour** is what the style number identifies — the buyer numbers a colourway
as its own style, TP-0007-008 Natural against TP-0007-009 Black — so it is
neither the BOM line's colour nor the order line's. **Qty/ctn** is a
specification the buyer states per style, held so that whoever eventually
builds packing reads it off the style; it does **not** open a packing module,
and there is still no packing list, carton or packed quantity anywhere here.

`Fabric:` and `Source:` stay in Remarks and are right to. The fabric grade is
the **Fabric BOM line's** sub-category and belongs on the grid; the source sheet
with its date is provenance, which is what a remark is for.

---

## 3. Order  →  Buyer Orders

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Order No | Manual — "Buyer PO num is their order no" | `BuyerOrder.orderNo` | `buyer_orders.order_no` | `orderNo` | Order No |
| Date | Auto | `orderDate` | `order_date` | `orderDate` | Date |
| Buyer Name | Dropdown → Buyer Master | `buyerId` | `buyer_id` | `buyer.buyerName` | Buyer |
| Style No | Dropdown → Style Master | `styleId` | `style_id` | `style.styleNo` | Style No |
| Order Qty | Manual | `orderQty` | `order_qty` | `orderQty` | Order Qty |
| Excess | Manual — "Approval from dinesh sir" | `excessPct` | `excess_pct` | `excessPct` | Excess |
| — | — | `excessApprovedPct` | `excess_approved_pct` | `excessApprovedPct` | Excess approved |
| — (implied) | Formula | `effectiveQty` | `effective_qty` | `effectiveQty` **`derived`** | Permitted Qty |
| Color code | Dropdown → L_ColorCode | `colorCode` | `color_code` | `colorCode` | Colour |
| Size Group | Dropdown → L_SizeGroup | `sizeGroup` | `size_group` | `sizeGroup` | Size Group |
| Currency | Dropdown → L_Currency | `currency` | `currency` | `currency` | Currency |
| Ship Mode | Dropdown → L_ShipMode | `shipMode` | `ship_mode` | `shipMode` | Ship Mode |
| Delivery Date | Manual | `buyerDeliveryDate` | `buyer_delivery_date` | `buyerDeliveryDate` | Delivery |
| Status | Dropdown → L_StatusGeneral | `status` | `status` | `status` | Status |
| Remarks | Text | `remarks` | `remarks` | `remarks` | Remarks |

`effectiveQty` is `orderQty × (1 + excessApprovedPct)` — the **approved** excess,
never the requested one. It is the ceiling every later module measures against.

---

## 4. Planning_ + Planning  →  Planning

Documented in **[PHASE-4-5-NOTES.md](PHASE-4-5-NOTES.md)**. The rule that matters
downstream: `Planning.plannedQty` is recomputed from the lines on every write and
may never exceed the order's `effectiveQty`.

---

## 5. Vendor Quotation-Approval  →  Vendor Quotations

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Quotation No | Auto — QT-001 | `quotationNo` | `quotation_no` | `quotationNo` | Quotation No |
| Date | Auto | `quotationDate` | `quotation_date` | `quotationDate` | Date |
| Item | Dropdown → L_ItemCategory | `item` | `item` | `item` | Item |
| Vendor Name | Dropdown → Vendor Master | `vendorId` | `vendor_id` | `vendor.vendorName` | Vendor |
| Rate Quoted | Manual | `rateQuoted` | `rate_quoted` | `rateQuoted` | Rate Quoted |
| UOM | Dropdown → L_UOM | `uom` | `uom` | `uom` | UOM |
| Qty | Manual | `qty` | `qty` | `qty` | Qty |
| Amount | **Formula: Rate × Qty** | `amount` | `amount` | `amount` **`derived`** | Amount |
| Authorised By | Auto → L_AuthorisedBy | `authorisedBy` | `authorised_by` | `authorisedBy` | Authorised By |
| Authorisation Status | Dropdown | `authorisationStatus` | `authorisation_status` | `authorisationStatus` | Status |
| Remarks — *"For B9646IS"* | Text | `orderId` | `order_id` | `order.orderNo` | Order No |
| Remarks | Text | `remarks` | `remarks` | `remarks` | Remarks |

**Added beyond the sheet:** `rejectionReason`, `approvedByName`, `decidedAt`. The
workbook records a rejection only in Remarks; a decision that blocks procurement
deserves its own reasoned field and a name that was stamped rather than typed.

---

## 6. PO  →  Purchase Orders

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| PO ID | Auto — "Vendor initial + no" | `poId` | `purchase_orders.po_id` | `poId` | PO ID |
| Date | Auto | `poDate` | `po_date` | `poDate` | Date |
| Item | Dropdown → L_ItemCategory | `item` | `item` | `item` | Item |
| sub - category | Dropdown → L_FabricSubCat | `subCategory` | `sub_category` | `subCategory` | Sub Category |
| Accessories item | Dropdown → L_AccessoriesItem | `accessoriesItem` | `accessories_item` | `accessoriesItem` | Accessories Item |
| Excess Allowed | Manual — "2-3%" | `excessAllowed` | `excess_allowed` | `excessAllowedPct` **`derived`** | Excess Allowed (%) |
| Vender Name | Dropdown → Vendor Master | `vendorId` | `vendor_id` | `vendor.vendorName` | Vendor |
| Address | Auto, from Vendor Master | `address` | `address` | `address` | Address |
| UOM | Dropdown → L_UOM | `uom` | `uom` | `uom` | UOM |
| Order Qty | Manual | `orderQty` | `order_qty` | `orderQty` | Order Qty |
| Rate | Manual | `rate` | `rate` | `rate` | Rate |
| Amount | **Formula: Order Qty × Rate** | `amount` | `amount` | `amount` **`derived`** | Amount |
| HSN Code | Manual | `hsnCode` | `hsn_code` | `hsnCode` | HSN Code |
| GSM | Dropdown → L_GSM | `gsm` | `gsm` | `gsm` | GSM |
| Content | Text → L_FabricContent | `content` | `content` | `content` | Content |
| Color code | Dropdown → L_ColorCode | `colorCode` | `color_code` | `colorCode` | Colour |
| Count | Manual → L_Count | `count` | `count` | `count` | Count |
| Status | Dropdown → L_StatusGeneral | `status` | `status` | `status` | Status |
| Remarks — *"Order as per Style - B9641IS"* | Text | `orderType` + `orderId` | `order_type`, `order_id` | `orderType`, `order.orderNo` | Order type, Order No |
| Remarks | Text | `remarks` | `remarks` | `remarks` | Remarks |

The **Address** is snapshotted onto the PO rather than joined from the vendor: a
PO is a document that was *sent*, and a later vendor edit must not silently
rewrite where the goods were once asked to go.

**Added beyond the sheet:** `approvalStatus`, `approvedByName`, `approvedAt`,
`decidedAt`, `rejectionReason` (the PO Approval stage the process document
requires but the sheet has no column for), `receivedQty` (maintained by GRN
posting), and `quotationId` / `styleId` (the chain the Remarks column encodes in
prose).

---

## 7. Gate Pass (Inward / Outward)  →  Gate Passes

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Gate Pass No | Auto — GP-001 | `gatePassNo` | `gate_passes.gate_pass_no` | `gatePassNo` | Gate Pass No |
| Date | Auto | `gatePassDate` | `gate_pass_date` | `gatePassDate` | Date |
| Type | Dropdown — Inward/Outward | `type` | `type` | `type` | Type |
| Linked PO / Challan No | Dropdown | `linkedDocNo` | `linked_doc_no` | `linkedDocNo` | Reference |
| — (the resolved link) | — | `purchaseOrderId` / `dyeIssueId` / `cuttingIssueId` | `purchase_order_id`, … | `reference` **`derived`** | Reference document panel |
| Item | Dropdown | `item` | `item` | `item` | Item |
| Vendor / Unit Name | Dropdown | `vendorId` + `partyName` | `vendor_id`, `party_name` | `vendor.vendorName`, `partyName` | Party |
| Qty | **Auto — from the linked document** | `qty` | `qty` | `qty` | Qty |
| Received Qty | Manual | `receivedQty` | `received_qty` | `receivedQty` | Received Qty |
| Variation % | **Formula: (Qty − Received) / Qty** | `variationPct` | `variation_pct` | `variationPctDisplay` **`derived`** | Variation |
| UOM | Auto → L_UOM | `uom` | `uom` | `uom` | UOM |
| Purpose | Dropdown → L_Purpose | `purpose` | `purpose` | `purpose` | Purpose |
| Authorised By | Auto → L_AuthorisedBy | `authorisedBy` | `authorised_by` | `authorisedBy` | Authorised by |
| Status | Dropdown — Pending/Cleared | `status` | `status` | `status` | Status |
| Remarks | Text | `remarks` | `remarks` | `remarks` | Remarks |

The sheet's `Item` column reads "Fabric", "Dyed Fabric", "Cut Panels", "Cutting
Pieces" — **none of which is an `L_ItemCategory` value**. It is therefore free
text, not validated against a list. That is the workbook's own usage, not an
omission.

**Added beyond the sheet:** `authorisedEmployeeId` (resolving the printed name to
an Employee Master record where one matches), `clearedAt` / `clearedById` /
`clearedByName` (a cleared pass is evidence goods moved, so the clearing is
stamped rather than typed).

---

## 8. GRN  →  Goods Receipts

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| PO ID | Dropdown → PO | `purchaseOrderId` | `grns.purchase_order_id` | `purchaseOrder.poId` | PO ID |
| Bill No | Manual | `billNo` | `bill_no` | `billNo` | Bill No |
| Roll No | Manual | `rollNo` + `FabricRoll[]` | `roll_no` | `rolls[]` **`derived`** | Fabric rolls created |
| Date | Auto | `grnDate` | `grn_date` | `grnDate` | Date |
| purpose | Dropdown → L_GRNPurpose | `purpose` | `purpose` | `purpose` | Purpose |
| Item | Auto, from PO | `item` | `item` | `item` | Item |
| HSN Code | Auto, from PO | `hsnCode` | `hsn_code` | `hsnCode` | HSN Code |
| Vender | Auto, from PO | `vendorId` | `vendor_id` | `vendor.vendorName` | Vendor |
| UOM | Auto | `uom` | `uom` | `uom` | UOM |
| Order Qty | Auto, from PO | `orderQty` | `order_qty` | `orderQty` | Order Qty |
| Receiving Qty | Manual | `receivingQty` | `receiving_qty` | `receivingQty` | Receiving Qty |
| Inventory Rate | Formula | `inventoryRate` | `inventory_rate` | `inventoryRate` | Inventory Rate |
| Amount | **Formula: Receiving Qty × Inventory Rate** | `amount` | `amount` | `amount` **`derived`** | Amount |
| Status | Dropdown → L_StatusGeneral | `status` | `status` | `status` | Status |
| Remarks | Text | `remarks` | `remarks` | `remarks` | Remarks |

The workbook's **Roll No** column is blank in every sample row. Where a receipt
covers several rolls the ERP creates one `FabricRoll` per roll and leaves
`grns.roll_no` for the single-roll case, so the printed field still reconciles.

**Added beyond the sheet:** `variationPct` and `toleranceBreached` (the process
document's 2% / 3% rule, which the sheet has no column for), `location`,
`inventoryItemId`, and `postedAt` / `postedById` / `postedByName` — the last
being the proof that the GRN, the rolls and the ledger entry committed together.

---

## 9. Fabric Issue  →  Fabric Issue

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto | `issueDate` | `fabric_issues.issue_date` | `issueDate` | Date |
| Vendor | Dropdown | `vendorId` | `vendor_id` | `vendor.vendorName` | Job worker |
| Roll No | Manual → FabricRoll | `rollId` | `roll_id` | `roll.rollNo` | Roll No |
| Purpose | Dropdown → L_Purpose | `purpose` | `purpose` | `purpose` | Purpose |
| Order No | Dropdown → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Style No | Dropdown → Style Master | `styleId` | `style_id` | `style.styleNo` | Style No |
| Name | Auto → Employee Master | `issuedByEmployeeId` + `issuedByName` | `issued_by_employee_id`, `issued_by_name` | `issuedByName` | Issued by |
| Fabric Qty Issued | Manual | `fabricQtyIssued` | `fabric_qty_issued` | `fabricQtyIssued` | Qty issued |
| Fabric name | Dropdown — "eg- 10 oz" | `fabricName` | `fabric_name` | `fabricName` | Fabric |
| Color Code | Dropdown → L_ColorCode | `colorCode` | `color_code` | `colorCode` | Colour |
| Status | Auto → L_StatusGeneral | `status` | `status` | `status` | Status |
| Remarks | Text | `remarks` | `remarks` | `remarks` | Remarks |

The sheet has **no document number** — rows are keyed by Roll No. The ERP issues
`issueNo` (FI-001) so every movement in the stock ledger can name the document
that caused it.

---

## 10. Dye issue + Dyeing Receipt  →  Job Work

The workbook keeps the issue and the return on two sheets. The ERP keeps them as
`DyeIssue` and `DyeingReceipt`, one-to-many, because a lot can come back in
parts.

### Dye issue

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Remark — "PO DY-001" | Text | `dyeIssueNo` | `dye_issues.dye_issue_no` | `dyeIssueNo` | Job No |
| Date | Auto | `issueDate` | `issue_date` | `issueDate` | Date |
| Process | Manual → L_Process | `process` | `process` | `process`, `meta.label` **`derived`** | Process |
| Roll No | Auto-Dropdown → FabricRoll | `rollId` | `roll_id` | `roll.rollNo` | Roll No |
| Colour Code | Auto-Dropdown → L_ColorCode | `colourCode` | `colour_code` | `colourCode` | Colour |
| Content | Manual → L_FabricContent | `content` | `content` | `content` | Content |
| Count | Manual → L_Count | `count` | `count` | `count` | Count |
| Construction | Manual → L_Construction | `construction` | `construction` | `construction` | Construction |
| Width | Manual, inches | `width` | `width` | `width` | Width |
| GSM | Manual → L_GSM | `gsm` | `gsm` | `gsm` | GSM |
| Vendor Name | Auto-Dropdown → Vendor Master | `vendorId` | `vendor_id` | `vendor.vendorName` | Vendor |
| Address | Text | `address` | `address` | `address` | Address |
| Pin Code | Number | `pinCode` | `pin_code` | `pinCode` | Pin code |
| Qty | Manual | `qty` | `qty` | `qty` | Sent |
| UOM | Auto → L_UOM | `uom` | `uom` | `uom` | UOM |
| Rate | Manual | `rate` | `rate` | `rate` | Rate |
| Amount | **Formula: Qty × Rate** | `amount` | `amount` | `amount` **`derived`** | Amount |
| Remark | Text | `remark` | `remark` | `remark` | Remark |

### Dyeing Receipt *(Shekwati4.xlsx)*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto | `receiptDate` | `dyeing_receipts.receipt_date` | `receiptDate` | Date |
| Dye Issue PO No | Dropdown → Dye issue | `dyeIssueId` | `dye_issue_id` | `dyeIssue.dyeIssueNo` | Job No |
| Fabric No | Auto → FabricRoll | `rollId` | `roll_id` | `roll.rollNo` | Roll No |
| Qty Issued | Auto, from the dye issue | `qtyIssued` | `qty_issued` | `qtyIssued` | Qty issued |
| Qty Received | Manual | `qtyReceived` | `qty_received` | `qtyReceived` | Qty received |
| Shrinkage % | **Formula** | `shrinkagePct` | `shrinkage_pct` | `shrinkagePctDisplay` **`derived`** | Shrinkage % |
| Standard Shrinkage Allowed | Manual — "2-3%" | `standardShrinkageAllowed` | `standard_shrinkage_allowed` | `standardShrinkagePctDisplay` **`derived`** | Allowed % |
| Variation Flag | **Formula: Shrinkage > Standard** | `variationFlag` | `variation_flag` | `variationFlag` **`derived`** | Flag |
| Status | Dropdown — OK / Sent to Scrutiny | `status` | `status` | `status` | Status |
| Remarks | Text | `remarks` | `remarks` | `remarks` | Remarks |

**Added beyond the sheets:** `styleId`, `fabricStage`, and the running totals
`receivedQty` / `shrinkagePct` on the issue — derived from the receipts on every
return, never typed.

---

## 11. Printing  →  Job Work (printing register)

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto | `printingDate` | `printings.printing_date` | `printingDate` | Date |
| Order No | Auto → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Style No. | Auto → Style Master | `styleId` | `style_id` | `style.styleNo` | Style |
| Vendor | Dropdown → Vendor Master | `vendorId` | `vendor_id` | `vendor.vendorName` | Vendor |
| Fabric Stage | Dropdown | `fabricStage` | `fabric_stage` | `fabricStage` | Fabric stage |
| Qty | Manual | `qty` | `qty` | `qty` | Qty |
| UOM | Dropdown → L_UOM | `uom` | `uom` | `uom` | UOM |
| Remarks | Text | `remarks` | `remarks` | `remarks` | Remarks |

The Printing sheet records **no return quantity**, so its rows carry no loss
figure. The Printing-status report shows both registers and says so, because the
office reconciles against both.

---

## 12. Fabric Scrutiny Report  →  Fabric Scrutiny

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto | `scrutinyDate` | `fabric_scrutinies.scrutiny_date` | `scrutinyDate` | Date |
| Fabric No | Dropdown → FabricRoll | `rollId` | `roll_id` | `roll.rollNo` | Roll No |
| Order No | Dropdown → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Style No | Dropdown → Style Master | `styleId` | `style_id` | `style.styleNo` | Style No |
| Defect Type | Dropdown → L_DefectType | `defectType` | `defect_type` | `defectType` | Defect type |
| Qty Affected | Manual | `qtyAffected` | `qty_affected` | `qtyAffected` | Qty affected |
| Checked By | Dropdown → Employee Master | `checkedByEmployeeId` + `checkedByName` | `checked_by_employee_id`, `checked_by_name` | `checkedByName` | Checked by |
| Authorised By | Dropdown → L_AuthorisedBy | `authorisedBy` | `authorised_by` | `authorisedBy` | Authorised by |
| Decision | Dropdown — Accept/Reject/Rework | `decision` | `decision` | `decision` | Decision |
| Remarks | Text | `remarks` | `remarks` | `remarks` | Remarks |

**Added beyond the sheet:** `isLocked` / `lockedAt` / `lockedById` /
`amendmentCount` and `decidedByName`. A roll gets released or written off on the
strength of this record, so once the decision is taken it stops moving, and
corrections go through `DocumentAmendment` with a before/after set.

---

## 13. Plan Approval  →  Plan Approvals

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto | `submittedDate` | `plan_approvals.submitted_date` | `submittedDate` | Submitted |
| Order No | Auto → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Container No | Auto → L_ContainerNo | `containerNo` | `container_no` | `containerNo` | Container |
| Prepared By | Auto / Dropdown | `preparedBy` | `prepared_by` | `preparedBy` | Prepared by |
| Submitted To | Auto / Dropdown | `submittedTo` | `submitted_to` | `submittedTo` | Submitted to |
| Approval Status | Auto | `approvalStatus` | `approval_status` | `approvalStatus` | Approval |
| Rejection Reason | Text | `rejectionReason` | `rejection_reason` | `rejectionReason` | Rejection reason |
| Rectification Remarks — *"Revised plan v2"* | Text | `rectificationRemarks` + `round` | `rectification_remarks`, `round` | `rectificationRemarks`, `version` **`derived`** | Rectification, Version |
| Approved Date | Auto | `approvedDate` | `approved_date` | `approvedDate` | Approved |

The sheet encodes the version in prose — "Revised plan v2". The ERP makes it a
number (`round`, exposed as `version`) and a link (`supersedesId`), so the chain
of attempts can be walked in either direction.

**Added beyond the sheet:** `supersedesId`, `rectifiedAt`, `decidedAt`,
`isLocked` / `lockedAt`, `approvedByName`.

---

## 14. Cutting Issue  →  Cutting Issue

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Challan No | Manual — CH-001 | `challanNo` | `cutting_issues.challan_no` | `challanNo` | Challan No |
| Date | Auto | `issueDate` | `issue_date` | `issueDate` | Date |
| Order No | Auto → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Style No | Auto → Style Master | `styleId` | `style_id` | `style.styleNo` | Style |
| Planned Cutting | Auto, from the plan | `plannedCutting` | `planned_cutting` | `plannedCutting` | Planned |
| Firm Name | Auto → L_StitchingUnit | `firmName` | `firm_name` | `firmName` | Unit |
| Unit wise Cutting Pcs to be issued | Auto, from the plan | `unitWiseCuttingPcsToBeIssued` | `unit_wise_cutting_pcs_to_be_issued` | `unitWiseCuttingPcsToBeIssued` | Unit allotment |
| Cutting Pcs Issued | Manual | `cuttingPcsIssued` | `cutting_pcs_issued` | `cuttingPcsIssued` | Issued |
| Handle issued | Manual | `handleIssued` | `handle_issued` | `handleIssued` | Handles |
| Container No | Formula → Planning | `containerNo` | `container_no` | `containerNo` | Container |
| Status | Dropdown → L_StatusGeneral | `status` | `status` | `status` | Status |
| Remarks — "Lot 1" | Text | `remarks` | `remarks` | `remarks` | Remarks |

**Added beyond the sheet:** `planningId`, `planApprovalId`, `fabricIssueId`
(the four documents the nine checks verify against), `excessApprovalId`, and
`postedAt` / `isLocked` / `lockedAt`.

---

## 15. Tables the workbook has no sheet for

These exist because the workbook's process **implies** them without recording
them. Each is listed with what in the workbook it stands in for.

| Table | Stands in for | Why the workbook has no sheet |
|---|---|---|
| `InventoryItem` | the item-defining columns PO and GRN share | Stock is implied by GRN-in and Issue-out; there is no inventory sheet. |
| `StockLedger` | every movement | Same — the workbook has the documents but never totals them. |
| `StockBalance` | "what have we got" | A cache of the ledger, rebuildable from it. |
| `FabricRoll` | the "Roll No" / "Fabric No" column that four sheets key on | The rolls exist in the sheets as a *reference*, never as records. |
| `DocumentSequence` | the "(Auto)" annotation on every number | The sheet says a number is automatic; this is what makes it so. |
| `ApprovalHistory` | "Authorised By" / "Authorisation Status" / "Approved Date" | Three columns that hold only the *latest* decision. This holds all of them. |
| `DocumentAmendment` | — | The workbook overwrites. This keeps the before/after set. |
| `ExcessRule`, `ExcessApproval` | "2-3%", "Approval from dinesh sir" | Percentages written in cell notes, now data. |
| `UserSession` | — | The workbook has no login. |
| `AuditLog` | — | The workbook has no audit trail. |

---

## 16. Fields deliberately NOT implemented

Nothing important is silently omitted. This is the complete list.

| Excel field | Sheet | Why |
|---|---|---|
| Every column of **Stitching Record**, **Hourly Monitoring**, **QC Size**, **QC Defects**, **Internal Quality Check**, **Internal / Final Checker Report**, **Finished Checker**, **External Secondary Checking**, **Alter Report**, **Spot Rectification-Scrap**, **Rejected**, **Packing**, **Needle Checking**, **Dispatch**, **Reconciliation Report** | those sheets | **Out of scope.** The application ends at Cutting Issue. `npm run verify:scope` fails the build if any of these appears in the schema — including as a stray column name. |
| `Operation`, `InformTo`, `RejectReason`, `SentFor`, `StatusDispatch`, `StatusRecon`, `StatusQC`, `YesNo`, `InspDefect26` | Master Lists | Dropdowns for the sheets above. Seeding them would imply modules that do not exist. |
| Gate Pass — validating **Item** against `L_ItemCategory` | Gate Pass | The sheet's own values ("Dyed Fabric", "Cut Panels") are not category values. Kept as free text, matching the workbook. |
| Printing — a **return quantity** | Printing | The sheet has no such column. Job-work returns are recorded on the Dyeing Receipt sheet, which does. |
| GRN — **Roll No** as a single value on multi-roll receipts | GRN | Blank in every sample row. Superseded by one `FabricRoll` per roll; the column is kept for single-roll receipts so the printed field still reconciles. |

---

## 17. Reconciling a figure

To check any ERP number against the workbook:

1. **Reports → the module's status report** gives the figures for a date range,
   with an Excel-sheet reference in its footer.
2. **Download CSV** renders the same figures server-side — the export and the
   screen cannot disagree, because one piece of code produces both.
3. Every derived figure carries the formula beside it on screen
   (`amountCalculation`, `variationCalculation`, the excess `explanation`), so a
   disagreement can be traced to an input rather than argued about.
4. `POST /api/inventory/stock/reconcile?dryRun=true` reports any stock balance
   that disagrees with its own movements, without writing.

---

## 17. Fields the ERP adds that the workbook does not have

§33 asks for deliberate omissions to be documented. The reverse is worth
recording too: places where the ERP carries something the workbook never did,
and why.

### GST on the purchase invoice

| ERP field | DB column | Why it is not in the workbook |
|---|---|---|
| `gstRatePct` | `grns.gst_rate_pct` | The workbook tracks cloth, not tax. It records "Amount" and stops. |
| `supplyType` | `grns.supply_type` | Derived from the vendor GSTIN against `COMPANY_STATE_CODE`, then frozen onto the receipt. |
| `vendorGstin` | `grns.vendor_gstin` | The GSTIN as it stood when the receipt posted. Correcting a vendor master next year must not re-tax a settled receipt. |
| `cgstAmount` / `sgstAmount` / `igstAmount` | same | The split actually charged. |
| `invoiceTotal` | `grns.invoice_total` | The sum of the rounded parts, which is what gets paid. |

**No workbook receipt was given a rate.** Every column above is nullable or
zero-defaulted, and the seeded rows carry no tax at all. Inventing a rate for a
historical receipt would put a figure on a legal document that nobody ever
charged - so a receipt with no rate prints "No GST rate was recorded on this
receipt", which is true, rather than a zero, which would not be.

The rate itself is **not** in the source either. It comes from the `GST Rate`
master list, seeded with the statutory slabs (0, 5, 12, 18, 28) - published
rates, not invented data - with the fraction in `attributes.rate` so that no
percentage is written into code. Head Office edits the list when a slab changes.

The invoice number is the **vendor's own bill number** (`grns.bill_no`). This
system issues no invoice number: the invoice is the vendor's document, and a
number of our own would appear in nobody else's books.

