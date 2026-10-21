# Phase 4: External QC and the Alteration Unit

After ironing, an external agency checks the pieces. Faulty pieces go to the
in-house Alteration Unit or back to ironing, and pieces that cannot be repaired
go into the Rejected Register. Earlier phases are unchanged except where noted
under **What changed in ironing**.

| Screen | Route | Tables | Permission |
|---|---|---|---|
| External QC | `/external-qc` | `external_qc_entries`, `external_qc_checker_lines`, `external_qc_attachments` | `EXTERNAL_QC.*` |
| Alteration Unit | `/alteration` (pending bags), `/alteration/entries` | `alteration_receipts` (bags), `alteration_entries` | `ALTERATION.*` |
| Rejected Register | `/rejected-register` | `rejected_register_entries` | `REJECTED_REGISTER.VIEW / EXPORT` (read-only) |

The APIs are `/api/external-qc`, `/api/alteration` and `/api/rejected-register`.
The arithmetic is in `server/src/domain/finishing.js`. The shared lock and check
are in `server/src/services/finishingFlow.service.js`.

## External QC

| Field | Rule |
|---|---|
| Date | AUTO (today). It can be moved back, never forward. |
| Order No / Style | DROPDOWN: orders ironing has pressed. The style comes with the order. |
| Agency | DROPDOWN: Vendor Master, category **External QC**. |
| Inspector | MANUAL, optional. |
| Ironed qty available | AUTO: everything ironed (from any source), less what External QC has already been offered. |
| Pcs Offered | MANUAL. **Cannot exceed the ironed qty available.** |
| Approved, Alteration, Rejected | MANUAL. **They must add up to Pcs Offered.** |
| Reasons (Alter, Iron, Defected, Spoiled, Other) | MANUAL, one count per reason for each faulty box. **Each box's reasons must add up to that box.** |
| Checker code(s) | Optional: a code and a piece count per line, read from the bag. The code is upper-cased; when it matches an Emp ID it is linked to that employee. The pieces traced cannot exceed Alteration + Rejected. |
| Inspection report | Optional photo or PDF, attached on the form or later on the detail page. |

The three rules are checked as you type, again on the server, and a third time
by `CHECK` constraints in the database.

### Where the pieces go

- **Approved:** they wait for Humidity Checking (Phase 5).
- **Reason Iron, in either box:** they go back to **Ironing**, source **Re-iron**.
- **Every other reason, in either box:** they go to the **Alteration Unit**, one
  bag per box and reason. Nothing goes back to a stitching unit. A bag has no
  unit to go to, and the Re-iron source names none.

## The Alteration Unit

The pending list is made of bags. Nobody types a bag in: each one is kept equal
to what its source sent.

- **External QC:** one bag per box and reason other than Iron.
- **Ironing (internal):** one bag per ironing entry, holding the pieces rejected
  at the ironing table.

An entry works one or more bags of one order and style:

| Field | Rule |
|---|---|
| Pcs Altered / Cleaned | MANUAL, per bag. These go back to Ironing (source **From Alteration Unit**), then through External QC again. |
| Pcs Not Repairable + reason | MANUAL, per bag. The reason is required. These make a **Rejected Register** row, stage **Alteration Unit**, carrying the bag's **original** reason (Defected, Spoiled, Ironing damage …) with the staff's note beside it. |
| Balance | AUTO: received − altered − not repairable. **Altered + not repairable cannot exceed what the bag received** (service and `CHECK`). |
| Alteration Staff | DROPDOWN: active employees in Department **Alteration**. |

A bag cannot be cut below what has already been worked out of it. For example,
External QC cannot lower its Alter count to 30 once 40 have been altered.

### Phase 3's pending sends

The migration converts every `PENDING` pending reject into a bag (source
`IRONING`, same reason, damage type, unit and quantity), points the bag back at
it (`pending_reject_id`), and marks the pending reject `TRANSFERRED`. Ironing
now sends its rejects straight to the Alteration Unit, so `pending_rejects` is
history. This conversion is covered by `test/externalQc.db.test.js`.

## No double counting

Every piece received at ironing from the stitching units is in exactly one of
these places:

```
at ironing (incl. damage undecided)   received (all sources) − ironed − damaged + re-ironed
ironed, waiting for External QC       ironed − offered
approved                              waiting for Humidity Checking
sent back to re-iron                  QC Iron − received at ironing as Re-iron
at the Alteration Unit                bags − altered − not repairable
altered, waiting to iron              altered − received at ironing From Alteration Unit
Rejected Register                     not repairable
------------------------------------------------------------------------------
= received at ironing from the units
```

A bag sent back leaves External QC (it is no longer "waiting for QC") and is
counted at ironing only once ironing receives it. Every write takes one advisory
lock per order and style and is rolled back if any balance would go negative.

- Ironing cannot cut its ironed count below what External QC was offered.
- Re-iron and altered receipts cannot exceed what was sent back.
- No lane can iron more than it received.

The **Finishing pipeline** report shows all of this per order and style, and its
**Difference** column is always 0.

## What changed in ironing

- New field **Source**: Stitching unit / Re-iron (from External QC) / From
  Alteration Unit. Only a stitching unit names From Unit (a `CHECK` enforces
  this). Each source has its own balance.
- **Rejected** at ironing now goes to the Alteration Unit (see above).
- The ironing screen's third tab is now **Sent to Alteration Unit**.

## Reports (Reports → Stitching & Finishing)

| Report | What it shows |
|---|---|
| External QC: by order | Offered, approved / alteration / rejected and their %, back to ironing, to Alteration Unit |
| External QC: by agency | The same, per agency |
| External QC: by reason | Each reason in each box, % of offered, % of faulty, and where it went |
| **Checker Report** | Per checker code: the external rejects traced to it, inspections, orders, and its share |
| Alteration Unit: pending and aging | Open bags, oldest first, with days waiting and a 0-2 / 3-7 / 8-15 / over 15 day bucket |
| Alteration Unit: summary | Per order and style: received, altered, not repairable, repaired %, pending, oldest pending |
| Finishing pipeline | The net stage balances above, with Difference = 0 |

Excel (CSV) export is available on every register: `external-qc`,
`alteration-bags`, `alteration-entries` and `rejected-register`.

## Roles

| Role | Can |
|---|---|
| **EXTERNAL_QC_COORDINATOR** (new) | Own External QC (view, create, edit, export; no delete). Read ironing, the Alteration Unit and the Rejected Register. |
| **ALTERATION_SUPERVISOR** (new) | Own the Alteration Unit (no delete). Read ironing, External QC and the Rejected Register. |
| FINISHING_SUPERVISOR | Also reads External QC, the Alteration Unit and the Rejected Register. |
| Director, Merchandising, Store | View and export all three. |
| Admin | Everything, including delete. |

Every write is in the audit trail. The inspection report files are not audited,
so the trail does not store every photo twice.

## Deploying

Run one migration, `20261020000500_external_qc_and_alteration`, with
`db:deploy`. It creates the tables and constraints, converts the pending
rejects, and adds the permissions, the two roles, the grants and the
**Alteration** department. **Do not seed production.**

After deploying:

- Make sure the agency is on the Vendor Master with category **External QC**.
- Add the alteration staff to the Employee Master with Department **Alteration**.
- Give the desks their roles.

## Open points

1. **Checker codes are free text**, because they are read off the bag. If the
   codes are always Emp IDs, the field could become a dropdown of Checkers.
2. **Checker lines carry one count per code**, not one per box. The Checker
   Report shows faulty pieces (alteration + rejected) per code. If you need the
   split by box per checker, a line would need two counts.
3. **Internal QC sends.** Today the internal sends into the Alteration Unit are
   the ironing table's rejects. If the QC phase adds a supervisor "send to
   alteration", it should create bags the same way: a new `AlterationSource`
   value plus `syncBag()`.
