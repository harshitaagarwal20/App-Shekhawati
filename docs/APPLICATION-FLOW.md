# Application Flow

How work moves through the system, from a master record to the last document
the application will ever write.

Everything here is read out of the code, not out of a design deck. Where a
diagram states a rule, the file that enforces it is named beside it — so a
diagram that drifts from the application can be caught by opening one file.

**The pipeline ends at Cutting Issue.** Nothing downstream of it exists here —
no stitching, no hourly monitoring, no QC record, no alter, no packing, no
needle checking, no dispatch, no reconciliation. `npm run verify:scope` fails
the build if any of it appears.

- [1. Entry](#1-entry)
- [2. The pipeline](#2-the-pipeline)
- [3. Where the flow branches](#3-where-the-flow-branches)
- [4. The approval state machine](#4-the-approval-state-machine)
- [5. How stock moves](#5-how-stock-moves)
- [6. The ten gates on a Cutting Issue](#6-the-ten-gates-on-a-cutting-issue)
- [7. Screen, route, permission](#7-screen-route-permission)
- [8. The flows that cross every module](#8-the-flows-that-cross-every-module)

---

## 1. Entry

```
   Login  ──►  JWT + refresh session  ──►  mustChangePassword?
   (auth.service.js)                              │
                                       yes ───────┴─────── no
                                        │                   │
                                        ▼                   ▼
                              /change-password         Dashboard
                       (the API refuses every           attention
                        other route until this          approvals
                        is done)                        the pipeline
                                        │                   │
                                        └───────────────────┘
                                                  │
                                                  ▼
                                     sidebar filtered by permission
                                     (config/navigation.js)
```

Hiding a link is a convenience, never a control. `authenticate` re-reads the
user's roles from the database on **every** request, and `can()` checks the
same permission code again on the route — so a role change, a logout or a
disabled account takes effect on the next call, not at token expiry.

---

## 2. The pipeline

```
              ┌──────────────────────────── MASTERS ────────────────────────────┐
              │ List Masters · Buyers · Vendors · Employees · Styles + BOM      │
              │ Excess Rules  — every tolerance, as data                        │
              │ Tolerances    — dated per-category order/receipt limits (C2)    │
              └───────────────────────────────┬────────────────────────────────┘
                                              │  Head Office owns these
                                              ▼
   ┌─────────────────┐  excess above rule?  ┌──────────────────┐
   │  BUYER ORDER    │────────────────────► │ EXCESS APPROVAL  │──► Director
   │  Merchandising  │                      └────────┬─────────┘
   └────────┬────────┘                               │
            │        only an APPROVED excess raises the ceiling.
            │        A requested one buys the planner nothing.
            ▼                                        ▼
   ┌──────────────────────────────────────────────────────────┐
   │  PLANNING                                                │  Merch. & Planning
   │  plannedQty ≤ orderQty × (1 + APPROVED excess)           │  Planning GM
   │  lines: order allocation · unit · cutting pieces ·       │
   │         deliverable size · container                     │
   └────────────────────────────┬─────────────────────────────┘
                                │  submitted → Director approves
                                ▼
   ┌─────────────────┐        ┌─────────────────────────┐
   │ VENDOR QUOTATION│───────►│ QUOTATION AUTHORISATION │──► Director
   │ amount = qty×rate│        └────────────┬───────────┘
   │ (server-derived) │                     │
   └─────────────────┘                      ▼
   ┌──────────────────────────────────────────────────────────┐
   │  PURCHASE ORDER          per-vendor numbering            │  Store & Cutting Mgr
   │  mode: AS_PER_STYLE | BULK                        (C1)   │
   │  ceilings: the style requirement, and the category       │
   │            order tolerance — both checked on write and   │
   │            again at approval, because either can move    │
   │  the two tolerances are FROZEN onto the row       (C2)   │
   └───────────────────────────┬──────────────────────────────┘
                               │  Director approves ──► printable PO
                               ▼
   ┌─────────────────┐       ┌────────────────────────────────────────┐
   │  GATE PASS      │──────►│  GRN                                   │
   │  inward/outward │       │  cumulative receipts vs FROZEN receipt │
   │  variation      │       │  tolerance — three 1% deliveries       │
   │  clearing IS    │       │  against a 2% limit are caught         │
   │  its approval   │       │  born POSTED: no draft GRN exists      │
   └─────────────────┘       └───────────────┬────────────────────────┘
                                             │  one transaction
                                             ▼
                      ┌──────────────────────────────────────────┐
                      │  FABRIC ROLL   +   STOCK LEDGER (IN)     │
                      │  the ledger is append-only and is the    │
                      │  source of truth; balances are re-derived│
                      └──────────────────────┬───────────────────┘
                                             ▼
                      ┌──────────────────────────────────────────┐
                      │  INVENTORY   Stock · Ledger · Rolls      │
                      └──────────────────────┬───────────────────┘
                                             ▼
                      ┌──────────────────────────────────────────┐
                      │  FABRIC ISSUE     mobile-first, by roll  │
                      │  availability checked at two levels      │
                      └────────┬────────────────────┬────────────┘
                               │                    │
              to a JOB WORKER  │                    │  to the CUTTING FLOOR
       (authorised by the C3   │                    │  (must quote a cutting
        job work order)        │                    │   challan line — C5)
                               ▼                    │
   ┌────────────────────────────────────────────┐   │
   │  JOB WORK ORDER          (dye_issues)      │   │
   │  DYEING · PRINTING · WASHING · FINISHING   │   │
   │  approved BEFORE fabric moves        (C3)  │   │
   │  stock is a TRANSFER, not a disappearance: │   │
   │      OUT of MAIN STORE → IN at the vendor  │   │
   └───────────────────┬────────────────────────┘   │
                       │  the lot returns           │
                       ▼                            │
   ┌────────────────────────────────────────────┐   │
   │  RETURN / RECEIPT                          │   │
   │  shrinkage = issued − returned, judged     │   │
   │  against the dated ShrinkageRule for this  │   │
   │  process and vendor                        │   │
   │  a shortfall beyond tolerance REFUSES the  │   │
   │  posting; it is not recorded with a flag   │   │
   └───────────────────┬────────────────────────┘   │
                       ▼                            │
              within standard?                      │
        ┌──────────────┴───────────────┐            │
     yes│                              │no    (C4)  │
        │                              ▼            │
        │           ┌──────────────────────────┐    │
        │           │  FABRIC SCRUTINY         │    │
        │           │  QC records the findings │    │
        │           │  defect lines by category│    │
        │           │  the DIRECTOR decides:   │    │
        │           │   ACCEPT · REWORK · REJECT│   │
        │           │  then the report LOCKS   │    │
        │           └──┬─────────┬─────────┬───┘    │
        │       ACCEPT │  REWORK │  REJECT │        │
        │              │         │         ■ stops  │
        │              │         └──► to Job Work   │
        ▼              ▼                            │
   ┌────────────────────────────────────────────┐   │
   │  PLAN APPROVAL              versioned (C7) │   │
   │  lines: CUTTING · STITCHING · SHIPPING     │   │
   │  rejected ──► RECTIFICATION ──► version n+1│   │
   │  approving v2 demotes v1 in the SAME       │   │
   │  transaction; approved versions are        │   │
   │  immutable and demoted ones stay readable  │   │
   └───────────────────┬────────────────────────┘   │
                       ▼                            │
   ┌────────────────────────────────────────────┐   │
   │  CUTTING CHALLAN     the requirement  (C5) │───┘
   │  raised against an APPROVED plan version   │  authorises the issue;
   │  (checked, not merely foreign-keyed)       │  moves no stock itself
   │  issuedQty RE-DERIVED from the issues that │
   │  quote each line — never incremented       │
   │  partial fulfilment yes, over-fulfilment   │
   │  never; closing short is recorded as a     │
   │  decision, with who, when and why          │
   └───────────────────┬────────────────────────┘
                       ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  CUTTING ISSUE          ten gates, every one of them run     │
   │  posting appends to the ledger:                              │
   │      OUT of CUTTING FLOOR   the full issued quantity         │
   │      IN to MAIN STORE       the remainder, on the same roll  │
   │  then the document is permanently locked                     │
   └──────────────────────────────┬───────────────────────────────┘
                                  ▼
                              ■  END OF SCOPE
```

---

## 3. Where the flow branches

Every branch below is a real conditional in a service, not a convention.

| Branch | Decided by | If yes | If no |
|---|---|---|---|
| Order excess exceeds the resolved rule | `excess.service.js` | Excess approval workflow; the Director decides | The order proceeds at the standing tolerance |
| Plan allots more than the order permits | `planning.service.js` | Refused on write **and** again at approval | Plan proceeds to approval |
| PO quantity exceeds the style requirement or category order tolerance | `purchaseOrder.service.js` | Refused, or held for authorised excess | PO proceeds to approval |
| Cumulative receipts exceed the frozen receipt tolerance | `grn.service.js` | Refused; the breach must be acknowledged explicitly | GRN posts, stock exists |
| Fabric issue goes to a job worker or to cutting | `fabricIssue.service.js` | Job worker: transfer to the vendor location, needs an approved job work order | Cutting: must quote a cutting challan line |
| Job work return is outside the process/vendor shrinkage rule | `jobWork.service.js` | `requiresScrutiny` — a Fabric Scrutiny Report is demanded (C4) | `FABRIC_PROCESS_COMPLETE` passes as *no scrutiny was required* |
| Scrutiny decision | The Director, on `finalise()` | ACCEPT → onward · REWORK → back to job work · REJECT → stops | — |
| Plan approval rejected | `planApproval.service.js` | RECTIFICATION raises a numbered successor version | The approved version becomes current, and locks |
| Cutting challan line still short | `recomputeFulfilment()` | Stays open for the next issue | COMPLETED, or explicitly closed short |
| Any of the ten cutting gates fails | `cuttingIssue.service.js` | Posting refused; **every** failure is reported at once | Posted, stock moves, permanent lock |

---

## 4. The approval state machine

One transition table, one `transition()` function — the only code in the
application permitted to write `workflowState` — and eleven document types
registered against it (`services/approvalEngine.js`): buyer order, planning,
vendor quotation, purchase order, gate pass, GRN, job work order, cutting
challan, fabric scrutiny, plan approval and cutting issue.

```
  DRAFT ──► SUBMITTED ──► PENDING_APPROVAL ──► APPROVED ──► POSTED ──► COMPLETED ■
    ▲           │                 │                │                       ▲
    │           └──► DRAFT        │                └──► COMPLETED ─────────┘
    │                             │
    │                             ├──► REJECTED ──► DRAFT ────────► (round again)
    │                             │        │
    │                             │        └──► RECTIFICATION ──► RESUBMITTED ──┐
    │                             │                                             │
    └─────────────────────────────┴──────── PENDING_APPROVAL ◄──────────────────┘

  every non-terminal state ──► CANCELLED ■
```

Three things this shape is deliberately saying:

- **SUBMITTED and PENDING_APPROVAL are different facts.** A document can be
  handed in before the person who must decide it has it in front of them. The
  difference between "sent" and "on the approver's desk" is the difference
  between chasing the sender and chasing the approver.
- **RECTIFICATION is a state, not a gap.** A rejected document being corrected
  is not "pending again". Recording the correction lets a screen show that a
  plan is on its third attempt — and a third attempt is not the same risk as a
  first.
- **APPROVED never returns to DRAFT.** Approval is the point at which other
  people start acting on the document; quietly returning it to a draft would
  leave those actions standing on nothing. Undoing goes through a named
  mechanism instead: `reopen()` on a purchase order (refused once a gate pass
  or GRN exists), `amend()` on a scrutiny (keeps a before/after set),
  `rectify()` on a plan approval (raises a version; the old one locks).

Each type walks its own subset, which is what a progress bar is drawn from:

| Document | Lifecycle |
|---|---|
| Buyer order | DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → COMPLETED |
| Planning · Vendor quotation · Plan approval | DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED |
| Purchase order | DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → COMPLETED |
| Gate pass | SUBMITTED → APPROVED *(clearing it **is** its approval)* |
| GRN | DRAFT → POSTED *(there is no draft GRN between goods arriving and stock existing)* |
| Job work order | DRAFT → … → APPROVED → POSTED → COMPLETED |
| Cutting challan | DRAFT → … → APPROVED → COMPLETED |
| Fabric scrutiny | DRAFT → APPROVED *(the decision itself is ACCEPT/REWORK/REJECT, set by `finalise()`)* |
| Cutting issue | DRAFT → SUBMITTED → PENDING_APPROVAL → APPROVED → POSTED — all in one transaction |

---

## 5. How stock moves

`stock_ledger` is append-only and is the source of truth. `stock_balances`
holds the same numbers, but nothing in this application increments a balance in
place: every one is recomputed by aggregating the ledger, inside the same
transaction as the movement that changed it.

```
        DOCUMENT                     LEDGER                        WHERE

  GRN posted            ─────►  IN   qty_in                 MAIN STORE
                                     + a FabricRoll per roll

  Fabric Issue          ─────►  OUT  from MAIN STORE
    ...to a job worker  ─────►  IN   at the vendor location  (a transfer:
                                                              the company still
                                                              owns the cloth)
    ...to cutting       ─────►  IN   at CUTTING FLOOR

  Job work return       ─────►  OUT  the full issued qty     vendor location
                        ─────►  IN   what actually came back MAIN STORE
                                     the gap between the two IS the shrinkage

  Cutting Issue posted  ─────►  OUT  the full issued qty     CUTTING FLOOR
                        ─────►  IN   the remainder,          MAIN STORE
                                     on the SAME roll
```

Two rules hold this together:

- **`postMovement()` is the only way stock changes**, and it refuses an OUT
  larger than the balance available *at that location*. That is why fabric at a
  dye house counts towards total on-hand and is still not issuable from the
  store.
- **Wastage is typed, never inferred.** A cutting issue must satisfy
  `issued = consumed + remainder + wastage`. Deriving wastage as the leftover
  would make the identity true by construction and check nothing.

`POST /api/inventory/stock/reconcile` rebuilds every balance from the
movements; `?dryRun=true` reports the differences without writing.

---

## 6. The ten gates on a Cutting Issue

`verify()` runs all ten, always, and returns each with a pass or a fail and a
sentence saying why. It does not stop at the first failure: a supervisor on the
cutting floor should be told everything that is wrong in one go, not sent round
the loop ten times. `post()` re-runs the whole set **inside** the transaction,
so the preview and the posting cannot disagree.

| # | Code | What it refuses |
|---|---|---|
| 1 | `ORDER_EXISTS` | A challan against no order |
| 2 | `ORDER_VALID` | An order that is cancelled or already completed |
| 3 | `PLANNING_EXISTS` | Cutting with no plan for this order and container |
| 4 | `PLAN_APPROVAL_EXISTS` | A plan nobody ever submitted for approval |
| 5 | `APPROVAL_IS_APPROVED` | An approval that is not approved, or not the current version |
| 6 | `FABRIC_PROCESS_COMPLETE` | Cutting fabric still out at a dyer or printer; or a scrutiny that was required and is missing (`SCRUTINY_REQUIRED_MISSING`) |
| 7 | `STOCK_AVAILABLE` | Cutting more than the posted fabric issue behind it covers |
| 8 | `WITHIN_PERMITTED_QTY` | Cutting more than the approved plan permits |
| 9 | `EXCESS_AUTHORISED` | Exceeding 8 without an authorisation from the excess engine |
| 10 | `REMAINDER_RECONCILES` | `issued ≠ consumed + remainder + wastage` (C6) |

**Why this document is verified harder than any other:** there is nothing after
it to correct it with. A purchase order can be amended because a GRN comes
later. A plan can be rejected because a revision comes later. Cloth that has
been cut cannot be un-cut by anything inside or outside this system — so a
cutting issue is verified hard *before* it is posted, and is immutable the
moment it is.

---

## 7. Screen, route, permission

| Stage | Screen | Route | Permission |
|---|---|---|---|
| Masters | Buyers · Vendors · Employees · Styles & BOM · List Masters | `/masters/*` | `BUYER.VIEW` … `MASTER_LIST.VIEW` |
| Masters | Excess Rules · Tolerances | `/masters/excess-rules`, `/masters/tolerances` | `MASTER_LIST.VIEW` |
| Order | Buyer Orders | `/orders` | `BUYER_ORDER.VIEW` |
| Planning | Planning | `/planning` | `PLANNING.VIEW` |
| Procurement | Vendor Quotations | `/quotations` | `VENDOR_QUOTATION.VIEW` |
| Procurement | Purchase Orders | `/purchase-orders` | `PURCHASE_ORDER.VIEW` |
| Procurement | Approvals (cross-module queue) | `/approvals` | `REPORT.VIEW` |
| Stores | Gate Pass · GRN | `/gate-passes`, `/grns` | `GATE_PASS.VIEW`, `GRN.VIEW` |
| Stores | Inventory · Stock Ledger · Fabric Rolls | `/inventory/*` | `INVENTORY.VIEW`, `STOCK_LEDGER.VIEW`, `FABRIC_ROLL.VIEW` |
| Stores | Fabric Issue | `/fabric-issues` | `FABRIC_ISSUE.VIEW` |
| Processing | Dyeing · Printing *(one register, two doors: `?process=`)* | `/job-works` | `DYE_ISSUE.VIEW`, `PRINTING.VIEW` |
| Processing | Fabric Scrutiny | `/scrutinies` | `FABRIC_SCRUTINY.VIEW` |
| Planning Approval | Plan Approval | `/plan-approvals` | `PLAN_APPROVAL.VIEW` |
| Cutting | Cutting Challan | `/cutting-challans` | `CUTTING_CHALLAN.VIEW` — **see the note below** |
| Cutting | Cutting Issue | `/cutting-issues` | `CUTTING_ISSUE.VIEW`; posting needs `CUTTING_ISSUE.APPROVE` |
| Everywhere | Reports (fourteen) | `/reports` | `REPORT.VIEW`, then each report's own permission |
| Everywhere | Print | `/print/:kind/:id` | the source document's |
| Admin | Users · Roles · Audit | `/admin/*` | `USER.VIEW`, `ROLE.VIEW`, `AUDIT.VIEW` |

> **Closed — two permissions the routes demanded and the seeder never issued.**
>
> 1. **`CUTTING_CHALLAN` was absent from `MODULES`.** Eleven cutting-challan
>    routes demanded `CUTTING_CHALLAN.VIEW / CREATE / EDIT / DELETE / APPROVE`
>    and none of those rows existed, so no role pattern could match them — not
>    even the Director's `*.APPROVE`, which matches permissions that *exist*.
> 2. **`DYE_ISSUE` was absent from `APPROVABLE`.** The job work order is
>    registered with the approval engine and its routes demand
>    `DYE_ISSUE.APPROVE`, which was never generated. The Director could not
>    approve a job work order.
>
> In both cases only ADMIN got through, because `authenticate.js`
> short-circuits `has()` for that role — the same lockout the file's own
> comment describes for `CUTTING_ISSUE.APPROVE`.
>
> Both are fixed in `prisma/seed/data/rbac.js`: `CUTTING_CHALLAN` added to
> `MODULES`, `CUTTING_CHALLAN` and `DYE_ISSUE` added to `APPROVABLE`, and the
> challan granted to the role that raises it (Store & Cutting Manager) and the
> roles that read it (Merchandising & Planning, Planning GM). Approving a
> challan stays the Director's, like every other authorisation — and
> `assertNotSelfApproval` would refuse a raiser who tried to approve their own.
>
> **The class of bug is now guarded, not just the two instances.**
> `test/rbac.rules.test.js` parses every `can()` and `canAll()` in every route
> file and fails if any code they demand is one the seeder never issues. It
> needs no database, and it asserts a floor on the number of codes it found so
> that a broken parse cannot pass by checking nothing.

---

## 8. The flows that cross every module

These are not stages. They read or write across all of them.

```
  APPROVAL QUEUE   every document awaiting a decision, in one list, across
                   eleven document types — built from `workflowState`, so a
                   module cannot fail to appear by forgetting to register

  REPORTS (14)     one per implemented module, filtered by permission before
                   the catalogue is even sent, CSV export of the whole result

  PRINT (6)        purchase order · gate pass · GRN · purchase invoice ·
                   job work · cutting issue

  AUDIT            ApprovalHistory + DocumentAmendment. `transition()` writes
                   the trail itself, on every transition, so the trail cannot
                   be skipped by a module that forgot

  STAGE TIMING     `document_stage_events`, a view over that same trail.
                   The admin screen has been removed; the
                   `/workflow/stage-durations` endpoint remains

  EXCESS ENGINE    every tolerance is a row, resolved narrowest-scope-first:
                       order → buyer → item category → document type → global
                   `resolveRule()` REFUSES rather than falling back to a
                   hardcoded default — no match means the configuration is
                   wrong, and that is worth saying out loud
```

---

See also: [USE-CASE-DIAGRAM.md](USE-CASE-DIAGRAM.md) for who does each of
these, [BUSINESS-CONTROLS.md](BUSINESS-CONTROLS.md) for the twelve things the
system must prevent and where each is enforced, and
[EXCEL-RECONCILIATION.md](EXCEL-RECONCILIATION.md) for the workbook column
behind every field.
