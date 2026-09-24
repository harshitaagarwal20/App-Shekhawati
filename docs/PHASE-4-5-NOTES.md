# Phase 4 & 5 — Implementation Notes

Shekhawati Impex ERP · Planning, and Vendor Quotation

---

## Phase 4 — Planning

Sheets: `Planning_` (header block) + `Planning` (allotment rows), and
` Plan Approval` for the decision log.
Role access: Planning Dept (Operator / GM), approved by Vinay ji (GM) / Dinesh Sir.

### The ceiling rule

This is the rule the phase turns on, so it is stated once, here, and enforced in
exactly one function.

```
permittedQty = BuyerOrder.effectiveQty = orderQty × (1 + APPROVED excess)
plannedQty   = Σ PlanningLine.deliverableSize

plannedQty MUST NOT exceed permittedQty
```

Phase 3 already made `effectiveQty` the ceiling on what an order may produce, and
made it follow `excessApprovedPct` rather than `excessPct`. Phase 4 does not
re-derive any of that — it reads `effectiveQty` and refuses anything above it.
The consequence, which is the point of the requirement:

| Excess on the order | Requested | Approved | A 5,000-pc order may be planned up to |
|---|---|---|---|
| None | — | — | 5,000 |
| Asked for, not yet decided | 2% | — | **5,000** |
| Asked for, rejected | 2% | — | **5,000** |
| Asked for, granted in full | 2% | 2% | 5,100 |
| Asked for, partly granted | 5% | 2% | **5,100** |

An excess that is merely *requested* buys the planner nothing. That is not a
separate rule bolted on here; it falls straight out of reading `effectiveQty`.

> **P4-D1 — The refusal names the reason, not just the arithmetic.**
> A plan of 5,100 against a 5,000 order with a pending 2% is not told "over by
> 100". It is told that the order requested 2%, that the Director has not
> approved it, and that the ceiling is therefore 5,000. The message is built in
> `assertWithinPermitted()` from the order's actual excess state, so the planner
> knows whether to cut the plan or chase the approval.

### Where the rule is checked

Either side of the inequality can move independently, so the check is re-run at
every point where either can:

| Point | Why it can change |
|---|---|
| `create` | first statement of the plan |
| `update` (header or grid) | the planner edits the deliverable sizes |
| `submit` | the order may have been amended since the plan was drawn |
| `approve` | **the important one** — see below |
| `POST /plannings/preview` | the same code, run against an unsaved grid |

The check at **approve** is the one that matters most. Phase 3 returns an
approved excess to `PENDING` whenever an order's quantity or excess moves, so a
plan that was legal when drawn can be illegal by the time it reaches the GM.
Approving it would push unauthorised pieces through to Cutting Issue, so it is
refused instead, and the plan detail screen shows the breach in red at the top.

> **P4-D2 — The cross-table rule is not a CHECK constraint.**
> Phase 0 flagged the workbook note *"Sum should match Order Qty"* as a
> cross-row rule for the service layer. It spans `plannings` and `buyer_orders`
> and cannot be expressed as a row-local CHECK. What *can* be checked
> row-locally is: `planned_qty >= 0`, a decision needs its evidence, nothing is
> decided that was never submitted, and no day may allot more cutting pieces
> than it is due to deliver. Those are in
> `20260825000400_planning/migration.sql`. The ceiling itself lives in
> `planning.service.js` and `prisma/seed/verify.js` also asserts it, so the seed
> can never ship a plan the API would refuse.

### "Sum should match" vs. "sum may not exceed"

The workbook says *match*. The requirement says *may not exceed*. These differ
for an under-planned order, and the difference is deliberate:

- **Over** the ceiling is refused outright — it is the rule.
- **Under** is permitted and reported (`unplannedQty`). A plan is built up over
  several sittings, and refusing to save a half-built grid would make the screen
  unusable. The detail page shows the shortfall on every visit, and the
  allocation panel says "matches the order exactly" only when it truly does.

### Server-calculated fields

`plannedQty` and `plannedCuttingPcs` are summed from the lines on every write and
appear in **no** input schema — Zod strips them. The client sends the rows a
planner typed and renders the totals the server sent back. `Planning.styleNo` and
`Planning.orderQty` are the sheet's "Auto" columns and are likewise re-synced from
the order on every write rather than accepted.

### The approval flow

Four states, **derived** rather than stored, so "draft" has one definition:

```
DRAFT     approvalStatus PENDING  + submittedAt NULL     planner is building it
SUBMITTED approvalStatus PENDING  + submittedAt set      with the GM / Director
APPROVED  approvalStatus APPROVED                        gates Cutting Issue
REJECTED  approvalStatus REJECTED                        back with the planner
```

```
create ──▶ DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED
             ▲                   │
             │                   ├──reject───▶ REJECTED ──revise──▶ DRAFT (v+1)
             └────recall─────────┘
```

- **submit** opens a `PlanApproval` round (the ` Plan Approval` sheet) and needs
  a "Submitted To" from `L_AuthorisedBy`.
- **reject** carries a reason and optional rectification remarks
  ("Shift 1500 pcs to Unit 4" — straight from the workbook).
- **revise** bumps `Planning.version`. That is what the sheet's "Revised plan v2"
  records, and the seed's B9652IS and B9658IS are exactly this: rejected at
  round 1, approved at round 2, sitting at version 2.
- **recall** lets the planner pull an *undecided* plan back; the open round is
  soft-deleted so the round number is not burned.

> **P4-D3 — A revision edits the plan in place; it does not create a second row.**
> `@@unique([orderId, planDepartment, version])` reads as though versions were
> separate rows, but the seed shows otherwise: one plan per order per
> department, carrying its current version. Creating a row per revision would
> need a "which one is live" flag and would let two versions of the same plan
> both claim the order. So `revise` increments `version` on the one row, and
> `create` refuses a second plan for an (order, department) that already has one.

> **P4-D4 — Approving and preparing are different permissions.**
> `submit`, `recall` and `revise` sit behind `PLANNING.EDIT` / `PLANNING.CREATE`;
> `approve` and `reject` sit behind `PLANNING.APPROVE`, which
> `PLANNING_OPERATOR` does not hold. A planner cannot approve their own plan.
> No seed change was needed — the Phase 1 RBAC already drew this line.

### Order allocation and unit allocation

- **Order allocation** — each department (Cutting / Stitching / Shipping) plans
  the order independently, and each is capped at the same ceiling. The detail
  page lists the other departments' plans; the form warns before you start a
  department that already has one.
- **Unit allocation** — the grid rolled up per `L_StitchingUnit`: days, date
  span, deliverable size, cutting pieces. This is what Cutting Issue's
  "Unit wise Cutting Pcs to be issued" will later draw from.

### One assumption

> **P4-A1 — `cuttingPcsAllotted` may not exceed that line's `deliverableSize`.**
> The workbook fills "Cutting Pcs alloted" for one order only (212 and 246
> against 2,500-piece days), which reads like a daily cutting rate rather than a
> share of the order — the column does not sum to the order quantity. Both
> readings agree that a day cannot allot more cutting pieces than it is due to
> deliver, so that is enforced (service *and* CHECK constraint) and nothing
> stronger is. **The workbook does not settle what this column means; if it is
> something other than a per-day figure, say so and the rule changes in one
> place.**

---

## Phase 5 — Vendor Quotation

Sheet: `Vendor Quotation-Approval`.
Role access: Procurement Dept (Manager), approved by Dinesh Sir.

### Amount is a server formula

```
amount = qty × rateQuoted        rounded to 2 dp (the stored scale)
```

The workbook holds Amount as a spreadsheet formula. Here it is recomputed on
every write, and there are **three** independent barriers against a
client-supplied figure:

1. `amount` appears in no input schema, so Zod strips it from the request body
   before the service runs.
2. `create` and `update` compute it from `qty` and `rateQuoted` unconditionally
   — `update` recomputes even when neither of those two fields moved, so the
   stored amount can never drift away from the numbers behind it.
3. `CHECK (amount = ROUND(rate_quoted * qty, 2))` on the table refuses any row
   that disagrees, whatever wrote it.

`approve` recomputes and re-stamps it one final time, so what the Director
authorises is provably `rate × qty` and not whatever a stale row happened to
hold. The create form calls `POST /quotations/preview` rather than multiplying
in the browser — the figure on screen and the figure in the database come from
one function.

The arithmetic is `Prisma.Decimal` throughout, never JavaScript numbers. The
rule tests pin this: `3 × 0.1` is `0.30`, not `0.30000000000000004`.

### The decision

```
PENDING ──approve──▶ APPROVED ──▶ may become a purchase order
   │
   └────reject───▶ REJECTED  ──▶ never becomes a purchase order

APPROVED / REJECTED ──reopen──▶ PENDING   (blocked once a PO exists)
```

- **Approval and rejection sit behind `VENDOR_QUOTATION.APPROVE`**, which
  Procurement — who raise the quotations — do not hold.
- **A decided quotation does not change.** It is the record of a decision;
  editing it would rewrite what was approved. The vendor is asked for a fresh
  quotation instead. Delete is refused for the same reason.
- **Reopen is refused once a purchase order exists.** That PO was raised on the
  strength of this approval; withdrawing the approval underneath it would leave
  the PO standing on nothing.
- `authorisationStatus` cannot be set through create or update at all — only the
  three decision endpoints move it.

> **P5-D1 — A rejection gets its own reasoned field.**
> The sheet records a rejection only in Remarks ("Rate higher"). A decision that
> blocks procurement deserves a field of its own, so `rejection_reason` was
> added, along with `approved_by_name` (stamped from the account that decided,
> not typed) and `decided_at`. This mirrors how `buyer_orders` carries the
> Director's excess decision beside `approval_history`. The migration backfills
> existing rows from Remarks and the "Authorised By" column.

> **P5-D2 — "Authorised By" is who it goes to; `approvedByName` is who decided.**
> The sheet's single column conflates the two. On create, `authorisedBy` records
> who the quotation is being put in front of. The decision endpoints stamp
> `approvedByName` from the signed-in account. A CHECK enforces that nothing is
> decided anonymously, and that a PENDING row carries no decision at all.

### Competing quotations

The sheet's "Lowest of 3 quotes" remark is the whole reason this document exists
in triplicate — QT-001 and QT-002 are the same 4,500 metres of 10 oz from two
vendors. Rather than leave the approver to eyeball it, the comparison is
computed on the server from the stored amounts:

- The detail page lists every other quotation for the same item on the same
  order, marks the lowest rate, and — when the one being viewed is *not* the
  cheapest — says exactly what choosing it costs on this quantity.
- `GET /quotations/order/:orderId/compare` groups every quote on an order by
  what was being bought, for the approver's overview.

This informs the decision; it does not gate it. Paying more than the lowest rate
is often right (lead time, quality, capacity) and is the Director's call.

---

## What was NOT built, and why

- **No Plan Approval screen of its own.** Phase 4 asked for the *planning
  approval flow*, and that flow drives `PlanApproval` rows — every submission
  opens a round, every decision closes one, and the rounds are shown on the plan
  detail page. A standalone Plan Approval register was not in the phase list, so
  the records exist and are readable but have no separate module.
- **No purchase-order conversion.** `canConvertToPo` is reported on an approved
  quotation because the client needs to know, but the conversion itself is a
  later phase.
- **Nothing past Cutting Issue.** `npm run verify:scope` still passes.

---

## Verification

| Check | Result |
|---|---|
| `npm run lint` | **0 problems** |
| `npm run build` | **clean** — 130 modules |
| `prisma validate` | valid — 35 models |
| `prisma generate` | client generated |
| `npm run verify:scope` | no out-of-scope module; `CuttingIssue` still terminal |
| `npm run verify:seed` | all cross-references resolve, ceiling rule asserted against every seeded plan |
| `npm run test:rules` | **20/20 pass** — no database needed |
| `npm test` | **not run** — needs a live database (see below) |

Two end-to-end suites were added alongside the rule tests and are ready to run
the moment a database is available:

- `test/planning.test.js` — plan creation and the derived Auto columns, a posted
  `plannedQty` being discarded, the ceiling in every excess state, the sum being
  capped rather than each line, the draft → submitted → approved → rejected →
  revised flow with its approval rounds, a planner being refused
  `PLANNING.APPROVE`, and the case the approval-time re-check exists for: a plan
  drawn while an excess was approved, refused at approval once that excess is
  revoked by an amendment.
- `test/quotations.test.js` — a posted `amount` and a posted `APPROVED` status
  both discarded, the amount recomputed when either qty or rate moves, the
  decision flow, a store manager refused `VENDOR_QUOTATION.APPROVE`, and the
  competing-quotation comparison.

`npm run test:rules` drives the exported calculation functions directly, so the
two rules these phases turn on are verified with nothing installed but Node:
every row of the excess table above is a test, as is `amount = qty × rate`
including its decimal-precision behaviour.

> **The migrations have not been run against a live database.** `server/.env`
> still holds the placeholder credentials, so `prisma migrate deploy` and the
> end-to-end `npm test` could not be executed. `20260825000400_planning` and
> `20260825000500_vendor_quotation` are written, backfill existing rows, and are
> consistent with a schema that `prisma validate` accepts — but they are
> unapplied, and their CHECK constraints are therefore unproven against real
> data. Point `DATABASE_URL` at a live server and run `npm run db:setup`.

### A defect fixed in passing

`prisma/verify-scope.js` split the schema on `'\n'` and then stripped comments
with a `$`-anchored regex. The working tree is CRLF, so the trailing `\r`
defeated the anchor, the comment strip became a no-op, and the guard flagged the
word "Reconciliation" in its own header prose — the very thing the comment strip
exists to permit. It now splits on `/\r?\n/`. This is why the guard reports a
pass here where it would have failed before, and it is unrelated to Phases 4
and 5 beyond blocking `npm run verify`.
