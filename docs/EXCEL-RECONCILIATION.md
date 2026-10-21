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
| `SentFor`, `StatusDispatch`, `YesNo` | They belong to **packing and dispatch**, which are not built. `Operation`, `InformTo`, `RejectReason`, `StatusRecon`, `StatusQC` and `InspDefect26` are seeded for the registers in §14b. |
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
| — *(added; see §17)* | Manual | `containerNo` | `container_no` | `containerNo` | Container No |
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
| — *(added; see §17)* | Manual | `containerNo` | `container_no` | `containerNo` | Container No |
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

## 14b. After cutting — stitching, quality and reconciliation

Twelve sheets, one table each, built on one register engine
(`services/productionRegister.service.js`). Every *Formula* column is computed
by `domain/production.js`, stored beside what was typed, and held again by a
CHECK constraint in migration `20261021000100_after_cutting_registers`.
**Packing, Needle Checking and Dispatch are not built** — see §16.

Counts after cutting are whole pieces (`INTEGER`), not `DECIMAL`: a bag is not
divisible, and the validators refuse 2.5 rather than round it.

### 14b.1 Stiching Record  →  Stitching Record  *(Role Acess — Stitching Dept (Supervisor))*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Unit Name | Auto → L_StitchingUnit (from the challan) | `unitName` | `stitching_records.unit_name` | `unitName` | Unit Name |
| Date | Auto | `recordDate` | `stitching_records.record_date` | `recordDate` | Date |
| Order No | Auto → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Style No | Auto → Style Master | `styleId` | `style_id` | `style.styleNo` | Style No |
| Deliverable Size | Auto — the challan's Cutting Pcs Issued | `deliverableSize` | `stitching_records.deliverable_size` | `deliverableSize` | Deliverable Size |
| Actual | Manual | `actualQty` | `stitching_records.actual_qty` | `actualQty` | Actual |
| Remaining | Formula = Deliverable Size − Actual | `remainingQty` | `remaining_qty` | **derived** | Remaining |
| Remarks | Text | `remarks` | `stitching_records.remarks` | `remarks` | Remarks |

**Added beyond the sheet:** `cuttingIssueId` — the challan the lot arrived on, which is what makes Unit Name and Deliverable Size *Auto*.

### 14b.2 Hourly Monitoring  →  Hourly Monitoring  *(Role Acess — Stitching Dept (Supervisor))*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto Capture | `recordDate` | `hourly_monitorings.record_date` | `recordDate` | Date |
| order No | Auto → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Emp Id | Dropdown → Employee Master | `employeeId` | `employee_id` | `employee.empId` | Emp Id |
| 10 · 11 · 12 · 1 · 2 · 3 · 4 · 5:30 · 6:30 | Manual | `pcsAt10 … pcsAt1830` | `hourly_monitorings.pcs_at_10 … pcs_at_1830` | `pcsAt10 … pcsAt1830` | 10:00 … 6:30 |
| TIME AUTO CAPTURE | Auto | `slotCapturedAt` | `slot_captured_at` | **derived** — stamped per slot by the server | "Hours keyed at" |

**Added beyond the sheet:** `styleId` (from the order), `totalPcs` (**derived**, the day's sum). One row per operator, order and day — a partial unique index holds it, and the form offers to open the existing row.

### 14b.3 QC Size  →  QC Size  *(Role Acess — QC Dept (Checker))*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto | `recordDate` | `qc_size_records.record_date` | `recordDate` | Date |
| Order No | Dropdown → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Unit | Dropdown → L_StitchingUnit | `unitName` | `qc_size_records.unit_name` | `unitName` | Unit |
| Tailor Name | Dropdown → Employee Master | `tailorId` + `tailorName` | `tailor_id`, `tailor_name` | `tailor.empName` / `tailorName` | Tailor Name |
| Style No | Dropdown → Style Master | `styleId` | `style_id` | `style.styleNo` | Style No |
| Operation | Dropdown → L_Operation | `operation` | `qc_size_records.operation` | `operation` | Operation |
| Size | Manual (defaults to the order's size group) | `size` | `qc_size_records.size` | `size` | Size |
| Psc Checked/Reject | Manual | `pcsCheckedRejected` | `qc_size_records.pcs_checked_rejected` | `pcsCheckedRejected` | Psc Checked/Reject |
| Defects found | Dropdown → L_DefectType | `defectFound` | `qc_size_records.defect_found` | `defectFound` | Defects found |
| Inform To | Dropdown → L_InformTo | `informTo` | `qc_size_records.inform_to` | `informTo` | Inform To |

### 14b.4 QC Defects  →  QC Defects  *(Role Acess — QC Dept (Checker))*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto | `recordDate` | `qc_defect_records.record_date` | `recordDate` | Date |
| Order No | Dropdown → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Unit | Dropdown → L_StitchingUnit | `unitName` | `qc_defect_records.unit_name` | `unitName` | Unit |
| Tailor Name | Dropdown → Employee Master | `tailorId` + `tailorName` | `tailor_id`, `tailor_name` | `tailor.empName` / `tailorName` | Tailor Name |
| Style | Dropdown → Style Master | `styleId` | `style_id` | `style.styleNo` | Style |
| Pcs Checked/Reject | Manual | `pcsCheckedRejected` | `qc_defect_records.pcs_checked_rejected` | `pcsCheckedRejected` | Pcs Checked/Reject |
| Defects Found | Dropdown → L_DefectType | `defectFound` | `qc_defect_records.defect_found` | `defectFound` | Defects Found |
| Inform To | Dropdown → L_InformTo | `informTo` | `qc_defect_records.inform_to` | `informTo` | Inform To |

### 14b.5 Internal Quality Check  →  Internal Quality Check  *(Role Acess — QC Dept (Checker))*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto | `recordDate` | `internal_quality_checks.record_date` | `recordDate` | Date |
| Order No | Dropdown → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Style No | Auto | `styleId` | `style_id` | `style.styleNo` | Style No |
| Stitching Unit | Dropdown → L_StitchingUnit | `unitName` | `internal_quality_checks.unit_name` | `unitName` | Stitching Unit |
| Checker Code | Dropdown → Employee Master (Emp ID) | `checkerId` | `checker_id` | `checker.empId` | Checker Code |
| Total Pcs Checked | Manual | `totalPcsChecked` | `internal_quality_checks.total_pcs_checked` | `totalPcsChecked` | Total Pcs Checked |
| Total Defect Pcs | Manual — never more than checked | `totalDefectPcs` | `internal_quality_checks.total_defect_pcs` | `totalDefectPcs` | Total Defect Pcs |
| Defect Type | Dropdown → L_DefectType | `defectType` | `internal_quality_checks.defect_type` | `defectType` | Defect Type |
| Status | Dropdown → L_StatusQC | `qcStatus` | `internal_quality_checks.qc_status` | `qcStatus` | Status |
| Transferred Back To Unit | Dropdown, required if Rejected | `transferredBackToUnit` | `internal_quality_checks.transferred_back_to_unit` | `transferredBackToUnit` | Transferred Back To Unit |
| Remarks | Text | `remarks` | `internal_quality_checks.remarks` | `remarks` | Remarks |

### 14b.6 Final Checker Report  →  Final Checker Report  *(Role Acess — QC Dept (Checker))*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto | `recordDate` | `final_checker_reports.record_date` | `recordDate` | Date |
| Checker Code | Auto (from the name) | `checkerId` | `checker_id` | `checker.empId` | Checker Code |
| Name | Dropdown → Employee Master | `checkerId` | `checker_id` | `checker.empName` | Name |
| Style No | Auto | `styleId` | `style_id` | `style.styleNo` | Style No |
| Total Pcs Checked | Manual | `totalPcsChecked` | `final_checker_reports.total_pcs_checked` | `totalPcsChecked` | Total Pcs Checked |
| Total Defect | Manual | `totalDefect` | `final_checker_reports.total_defect` | `totalDefect` | Total Defect |
| (unlabelled L_DefectType dropdown, column G) | Dropdown | `defectType` | `final_checker_reports.defect_type` | `defectType` | Defect Type |

The sheet has no order column. `orderId` is optional and only fills the style. The "Checker code range: 1-25" note is informational and is not enforced.

### 14b.7 Finished Checker  →  Finished Checker  *(Role Acess — QC Dept (Checker))*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Order No | Dropdown → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Checker Code | Auto | `checkerId` | `checker_id` | `checker.empId` | Checker Code |
| Name | Dropdown → Employee Master | `checkerId` | `checker_id` | `checker.empName` | Name |
| Date | Auto | `recordDate` | `finished_checker_records.record_date` | `recordDate` | Date |
| Checked Psc | Manual | `checkedPcs` | `finished_checker_records.checked_pcs` | `checkedPcs` | Checked Psc |
| Untrimmed Thread … Alter (17 columns) | Manual, whole pieces | `untrimmedThread … alter` | `finished_checker_records.untrimmed_thread … alter` | `untrimmedThread … alter` | the sheet's captions |
| Total pieces passed | Formula = Checked − Projected | `piecesPassed` | `pieces_passed` | **derived** | Total pieces passed |
| Projected | Formula = SUM(defects) | `totalDefects` | `total_defects` | **derived** | Projected |
| Defects % | Formula = Projected / Checked | `defectPct` | `defect_pct` | **derived** | Defects % |

### 14b.8 External Secondary Checking  →  External Secondary Checking  *(Role Acess — QC Dept (External Agency))*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto | `recordDate` | `external_secondary_checks.record_date` | `recordDate` | Date |
| Order No | Dropdown → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Style No | Auto | `styleId` | `style_id` | `style.styleNo` | Style No |
| Particulars | Auto → L_InspDefect26 (one line each) | `lines[].particular` | `external_secondary_check_lines.particular` | `lines[].particular` | Particulars |
| Critical · Major · Minor | Manual | `lines[].critical / major / minor` | `external_secondary_check_lines.critical / major / minor` | `lines[].critical / major / minor` | Critical · Major · Minor |
| Total (per line) | Formula = Critical + Major + Minor | `lines[].total` | `external_secondary_check_lines.total` | **derived** | Total |
| Remark | Text | `lines[].remark` | `external_secondary_check_lines.remark` | `lines[].remark` | Remark |
| Total Inspection Qty | Manual | `inspectionQty` | `external_secondary_checks.inspection_qty` | `inspectionQty` | Total Inspection Qty |
| Total Critical / Major / Minor Problems | Formula = column sums | `criticalTotal / majorTotal / minorTotal` | `critical_total / major_total / minor_total` | **derived** | grid footer |
| Total Defect | Formula | `totalDefects` | `total_defects` | **derived** | Total Defect |
| Total Pass Quantity | Formula = Inspection − Defect | `passQty` | `pass_qty` | **derived** | Pass Qty |
| Total Defect Ratio | Formula = Defect / Inspection | `defectRatio` | `defect_ratio` | **derived** | Defect Ratio |
| Person Incharge | Signature | `personIncharge` | `external_secondary_checks.person_incharge` | `personIncharge` | Person Incharge |

**Added beyond the sheet:** `agencyName` — which agency inspected.

### 14b.9 Alter Report  →  Alter Report  *(Role Acess — Stitching Dept (Supervisor))*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Order No | Dropdown → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Style No | Auto | `styleId` | `style_id` | `style.styleNo` | Style No |
| Time | Auto Capture — on submit | `capturedAt` | `captured_at` | **derived** — stamped by the server, kept through edits | Time |
| Output | Manual | `outputPcs` | `alter_reports.output_pcs` | `outputPcs` | Output |
| Pass/ok | Manual | `passPcs` | `alter_reports.pass_pcs` | `passPcs` | Pass/ok |
| Alter piece | Manual — Pass + Alter ≤ Output | `alterPcs` | `alter_reports.alter_pcs` | `alterPcs` | Alter piece |
| Alter% | Formula = Alter / Output | `alterPct` | `alter_pct` | **derived** | Alter% |
| Remarks | Text | `remarks` | `alter_reports.remarks` | `remarks` | Remarks |

### 14b.10 Spot Rectification-Scrap  →  Spot Rectification & Scrap  *(Role Acess — QC / Packing Dept)*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto | `recordDate` | `spot_rectifications.record_date` | `recordDate` | Date |
| Order No | Dropdown → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Style No | Auto | `styleId` | `style_id` | `style.styleNo` | Style No |
| Qty Received for Rectification | Manual | `qtyReceived` | `spot_rectifications.qty_received` | `qtyReceived` | Qty Received for Rectification |
| Sold Online-Domestic Qty | Manual | `soldOnlineQty` | `spot_rectifications.sold_online_qty` | `soldOnlineQty` | Sold Online-Domestic Qty |
| Scrap Qty | Manual — Sold + Scrap ≤ Received | `scrapQty` | `spot_rectifications.scrap_qty` | `scrapQty` | Scrap Qty |
| Scrap % of Consignment | Formula = Scrap / Order Qty | `scrapPct` | `scrap_pct` | **derived** | Scrap % of Consignment |
| Authorised By | Dropdown → L_AuthorisedBy | `authorisedBy` | `spot_rectifications.authorised_by` | `authorisedBy` | Authorised By |
| Remarks | Text | `remarks` | `spot_rectifications.remarks` | `remarks` | Remarks |

**Added beyond the sheet:** `orderQty` — the Order sheet quantity the percentage divides by (the style's order lines), frozen on save.

### 14b.11 Rejected  →  Rejected  *(Role Acess — QC Dept (Checker))*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Date | Auto | `recordDate` | `rejected_records.record_date` | `recordDate` | Date |
| Order No | Dropdown → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Style No | Manual (defaults to the order's) | `styleId` | `style_id` | `style.styleNo` | Style No |
| Order Qty | Auto — from Order | `orderQty` | `order_qty` | **derived**, frozen on save | Order Qty |
| Cutting Qty | Manual — offered from Cutting Issue | `cuttingQty` | `rejected_records.cutting_qty` | `cuttingQty` | Cutting Qty |
| Packed Qty | Manual | `packedQty` | `rejected_records.packed_qty` | `packedQty` | Packed Qty |
| Rejected Qty | Formula = IF(Cutting=0, 0, Cutting − Packed) | `rejectedQty` | `rejected_qty` | **derived** | Rejected Qty |
| Check By | Dropdown → Employee Master | `checkedById` + `checkedByName` | `checked_by_id`, `checked_by_name` | `checkedBy.empName` / `checkedByName` | Check By |
| Reason of Defects | Dropdown → L_RejectReason | `rejectReason` | `rejected_records.reject_reason` | `rejectReason` | Reason of Defects |
| Remarks | Text | `remarks` | `rejected_records.remarks` | `remarks` | Remarks |

### 14b.12 Reconciliation Report  →  Reconciliation Report  *(Role Acess — Planning Dept (GM))*

| Excel field | Source | ERP field | Database column | API field | React field |
|---|---|---|---|---|---|
| Order No | Dropdown → Order | `orderId` | `order_id` | `order.orderNo` | Order No |
| Style No | Dropdown | `styleId` | `style_id` | `style.styleNo` | Style No |
| Cutting Pcs Issued | Auto — Cutting Issue | — | — | **derived** `figures.cuttingIssued` | Cutting Pcs Issued |
| Stitched Pcs Received | Auto — Stiching Record, Actual | — | — | **derived** `figures.stitched` | Stitched Pcs Received |
| Alter Pcs | Auto — Alter Report | — | — | **derived** `figures.alter` | Alter Pcs |
| Scrap Pcs | Auto — Spot Rectification-Scrap | — | — | **derived** `figures.scrap` | Scrap Pcs |
| Rejected Pcs | Auto — Rejected | — | — | **derived** `figures.rejected` | Rejected Pcs |
| Packed Pcs | Auto — Packing | — | — | **derived** `figures.packed` — the Rejected sheet's Packed Qty until Packing exists | Packed Pcs |
| Variance | Formula = Cutting − Stitched − Scrap − Rejected | — | — | **derived** `figures.variance` | Variance |
| Status | Dropdown → L_StatusRecon (proposed from the variance) | `reconStatus` | `reconciliation_reports.recon_status` | `reconStatus` | Status |
| Remarks | Text | `remarks` | `reconciliation_reports.remarks` | `remarks` | Remarks |

Only the decision is stored. Every count is read live from the registers each time, so the report can never disagree with them. One report per order and style.

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
| Every column of **Packing**, **Needle Checking** and **Dispatch** | those sheets | **Not built yet.** `npm run verify:scope` fails the build if any of them appears in the schema — including as a stray column name. The other post-cutting sheets are in §14b. |
| `SentFor`, `StatusDispatch`, `YesNo` | Master Lists | Dropdowns for the three sheets above. |
| Reconciliation Report — **Packed Pcs from Packing** | Reconciliation Report | Packing is not built, so the figure is read from the Rejected sheet's Packed Qty, the one place a packed count is written down today. It does not enter the variance, exactly as on the sheet. |
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

### Container No on the order and the purchase order

The workbook writes a Container No on **Planning**, **Plan Approval** and
**Cutting Issue** (§4, §13, §14) and nowhere earlier. So the number was first
*typed* at Planning — which is late. The container is agreed when the order is
taken, and the cloth and trims are bought against it, so a planner was
retyping it from an email.

| ERP field | DB column | Why it is not in the workbook |
|---|---|---|
| `BuyerOrder.containerNo` | `buyer_orders.container_no` | The Order sheet has no such column. The container is agreed with the buyer at order time, and this is the first place it can be recorded. |
| `PurchaseOrder.containerNo` | `purchase_orders.container_no` | The PO sheet has no such column. Materials are bought *for* a shipment; recording which one is what lets a buyer ask "what else is on this container". |
| `PurchaseOrderHeader.containerNo` | `purchase_order_headers.container_no` | The document-level default for its lines, exactly as `order_id` works. A multi-item PO is usually for one container but need not be. |

**It is free text, not a List Master value, and that is deliberate.** It was a
dropdown reading `L_ContainerNo` on the planning documents and was changed —
the reasoning is in `planning.service.js`:

> A container number belongs to ONE shipment and is never used again, so a
> master list of them could only grow into thousands of dead entries with the
> one needed today missing — and somebody would have to register a container
> in Masters before the order it carries could be planned.

All three columns are `VARCHAR(40)`, nullable and indexed, matching every other
`container_no` in the schema.

**What it does not do.** Planning still carries and types its own container and
does **not** inherit the order's; these columns do not feed the planning chain,
and nothing downstream is made to match them. The vendor's printed PO copy does
not show it either — that sheet already withholds *whose* buyer order the goods
are for, and a container number is the same kind of information.

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

