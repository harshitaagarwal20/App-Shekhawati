# Phases 6–18 — decisions, assumptions and open points

Purchase Order through Cutting Issue, plus the two engines the whole pipeline
leans on: configurable excess control and the shared approval workflow.

The pipeline now runs end to end:

```
MASTERS → BUYER ORDER → PLANNING → VENDOR QUOTATION → PURCHASE ORDER
       → PO APPROVAL → GATE PASS → GRN → INVENTORY → FABRIC ISSUE
       → JOB WORK (dyeing / printing / washing / finishing) → FABRIC SCRUTINY
       → PLAN APPROVAL → CUTTING ISSUE → END
```

---

## 1. The rules this phase is built on

### 1.1 Every derived number is the server's

| Figure | Formula | Where it lives | Backed by |
|---|---|---|---|
| PO amount | `orderQty × rate` | `purchaseOrder.service.js` | `purchase_orders_amount_is_qty_x_rate` |
| Gate pass variation | `(qty − receivedQty) / qty` | `gatePass.service.js` | `gate_passes_variation_is_the_formula` |
| GRN amount | `receivingQty × inventoryRate` | `grn.service.js` | `grns_amount_is_qty_x_rate` |
| GRN variance | `(receivingQty − orderQty) / orderQty` | `grn.service.js` | `grns_variation_is_the_formula` |
| Job work amount | `qty × rate` | `jobWork.service.js` | — |
| Shrinkage | `(qty − receivedQty) / qty` | `jobWork.service.js` | `dye_issues_shrinkage_is_the_formula` |
| Ledger value | `qty × rate` | `inventory.service.js` | `stock_ledger_value_is_qty_x_rate` |
| Excess figures | see §4 | `excess.service.js` | four CHECKs on `excess_approvals` |

None of these appears in any Zod input schema. Zod strips unknown keys, so a
client that posts a total has it discarded before the service runs.

**Why some CHECKs are equalities and some are tolerances.** Multiplication of
two decimals is exact, so the amount checks are `=`. Division is not: decimal.js
in the service and `numeric` in Postgres need not agree on the twentieth
significant digit before rounding to the stored scale. The variation and
shrinkage checks therefore allow one unit in the last stored place. They still
catch a total that was made up rather than derived.

### 1.2 Decimals, never floats

Every quantity, rate, money value and percentage is `Prisma.Decimal` on the
server and `DECIMAL` in the database. There is no `Number` arithmetic on a
business quantity anywhere in `server/src`.

The client renders these values and does not compute them. The one arithmetic
it does is a fraction → percentage conversion for display; the newer endpoints
send a `…Display` field so even that is unnecessary.

### 1.3 Multi-table operations are one transaction

| Operation | What commits together |
|---|---|
| GRN posting | GRN · inventory item · fabric rolls · ledger IN per roll · balance · PO received qty · gate pass clearing · approval trail |
| Fabric Issue | availability re-check · issue · ledger OUT · roll balance · roll stage and location · balance |
| Job work return | receipt · ledger IN · roll balance and stage · hold flag · job running totals |
| PO approval | decision · stamp · workflow state · legacy status column · approval trail |
| Cutting Issue posting | nine checks · excess authorisation consumed · stamp · lock · two workflow transitions |
| Scrutiny finalise | decision · lock · roll stage and hold |
| Plan rectification | predecessor locked · successor created |

If any part fails, `prisma.$transaction` rolls back all of it — including the
document number, because `nextNumber()` runs on the same transaction client.

---

## 2. Purchase Order (Phase 6)

### 2.1 Numbering follows the sheet

The PO sheet notes "Vendor initial + no" beside the PO ID column, so PO numbers
come from a **per-vendor counter**: RF-001 and MA-001 are independent series.
`vendor.service.js` creates the sequence row when a vendor is created, from
`poInitials`, which is derived from the vendor name and editable.

### 2.2 Two ceilings on the quantity

1. **Excess Allowed.** The sheet says "2-3%"; the process document says
   accessories may be ordered only 1% over requirement. Both are now rows in
   `excess_rules` (§4), resolved per line.

2. **Order type.** `ORDER_AS_PER_STYLE` bounds the quantity by the style:
   fabric by the header's average utilisation, everything else by the matching
   BOM line with wastage. `BULK_ORDER` is exempt — that is what choosing it
   means — but it is recorded as a decision rather than left as an absence of
   one.

   What other POs have already claimed against the same order and item is
   subtracted, so two POs cannot each be "within the ceiling" while together
   exceeding it.

   **An item the BOM says nothing about is reported UNBOUNDED, not bounded at
   zero.** Buying a material the style does not mention is legitimate; refusing
   it silently would be wrong.

### 2.3 Traceability

`getById` returns `traceability`: Order → Quotation → PO, with each link marked
present or absent. A PO raised without a quotation is legitimate and looks
different from one whose quotation was deleted. The chain also flags a PO whose
rate differs from the rate that was actually approved.

Only an **APPROVED** quotation can become a PO, and it must be a quotation on
the same vendor — otherwise a PO would borrow another vendor's approved rate.

---

## 3. Gate Pass, GRN and Inventory (Phases 7–8)

### 3.1 A gate pass is always about something else

`linkedDocNo` holds RF-001, DY-001, CH-001. `resolveReference()` tries all three
document types and stores the resolved foreign key beside the printed text. A
number that resolves to nothing is **refused** — a gate pass that references a
typo references nothing.

The expected quantity comes from the linked document (the PO's outstanding
balance), which is what the sheet's "(Auto)" note means. A pass may narrow it
for a part load but never widen it.

Goods cannot pass the gate against a PO that has not been approved.

### 3.2 The ledger is the truth; the balance is a cache

`stock_ledger` is append-only and is the source of truth. `stock_balances` holds
the same numbers but is **never incremented in place** — `recomputeBalance()`
re-derives it by aggregating the ledger, inside the same transaction as the
movement. There is deliberately no `{ increment: … }` anywhere in
`inventory.service.js`.

`POST /api/inventory/stock/reconcile` rebuilds every balance from the ledger;
`?dryRun=true` reports the differences without writing. A derived cache that
cannot be rebuilt was never really derived.

The ledger carries every column the brief asks for — date, item, category, roll,
colour, GSM, content, UOM, quantity in, quantity out, rate, order, reference
type, reference id, location, user. The item-describing columns are **snapshots,
not joins**: a stock register printed next year must read the way it read on the
day, even after the inventory master is edited underneath it.

There is **no endpoint that writes a movement directly.** Stock moves only as a
consequence of a document.

### 3.3 Issuing more than is available is refused

`postMovement()` reads availability from the **ledger**, not from the cache, and
refuses any OUT larger than it before writing anything. Because every caller
passes its own transaction client, that refusal rolls the whole caller back.

Fabric Issue checks at **two levels**, because they can disagree and both
matter: the roll's own balance (you cannot issue 300 m off a roll with 250 on
it) and the ledger's total for that item and location. Both run again inside the
posting transaction, so two storemen reaching for the same roll cannot both
succeed.

### 3.4 Roll control

`roll_no` is `UNIQUE`. `assertRollNoAvailable()` turns the constraint violation
into a sentence naming which GRN already owns the number — before the write
rather than after it. Roll numbers are never reused, including after deletion.

`rollTraceability()` walks roll → GRN → vendor → PO → buyer order, plus the
fabric characteristics, the current location and stage, and every movement the
roll has been part of. Six tables, one call.

### 3.5 An over-receipt is recorded, not refused

The goods are in the yard either way, and a system that refuses to record them
just moves the problem off the books. What the system does is mark it and refuse
to let it pass **silently**: the first attempt comes back with the numbers and a
`409`, and the checker must resend with `acknowledgeToleranceBreach` to say they
know.

Tolerance is measured on the **cumulative** receipt against the PO, not on one
delivery — three 1% receipts against a 2% tolerance are a 3% over-delivery.

---

## 4. Excess control (Phase 17) — nothing is hardcoded

**No percentage is compiled into this application.** Every threshold is a row in
`excess_rules`, resolved narrowest-scope-first:

```
ORDER  ►  BUYER  ►  ITEM_CATEGORY  ►  DOCUMENT_TYPE  ►  GLOBAL
```

The seeded rows reproduce the workbook exactly, so behaviour is unchanged on day
one; every one of them is editable on the **Masters → Excess Rules** screen.

| Scope | Key | Document | Permitted | Ceiling | Basis |
|---|---|---|---|---|---|
| GLOBAL | — | any | 2% | 5% | Process Doc s.5 default |
| DOCUMENT_TYPE | PURCHASE_ORDER | PO | 3% | 5% | PO sheet: "2-3%" |
| ITEM_CATEGORY | Accessories | PO | 1% | 3% | Process Doc: accessories 1% over requirement |
| DOCUMENT_TYPE | GRN | GRN | 2% | 5% | Process Doc: 2% on material |
| ITEM_CATEGORY | Accessories | GRN | 3% | 3% | Process Doc: accessories up to 3% and no more |
| DOCUMENT_TYPE | DYE_ISSUE | job work | 3% | 10% | 2-3% shrinkage; **advisory** |
| DOCUMENT_TYPE | BUYER_ORDER | order | 2% | 10% | Order sheet: "Approval from dinesh sir" |
| DOCUMENT_TYPE | CUTTING_ISSUE | challan | 2% | 5% | cutting beyond the plan needs the same authority |

`assess()` returns all nine figures the brief asks to be identified — base
quantity, permitted %, permitted quantity, maximum permitted, actual quantity,
actual excess, excess %, over-limit quantity — and one verdict: `WITHIN`,
`NEEDS_APPROVAL` or `REFUSED`.

**A hard ceiling is the point past which no authorisation can help.** Above the
permitted excess but below the ceiling, an `ExcessApproval` is required; above
the ceiling the quantity has to come down.

`ExcessApproval` rows are written when the excess is **detected**, not when it is
approved, so an over-limit transaction that was refused still leaves a trace of
having been attempted. An authorisation is checked against the numbers actually
being posted — one raised for 350 pieces cannot authorise 900 — and is
**consumed** on use, so it cannot be spent twice.

`resolveRule()` **refuses** rather than falling back to a hardcoded default if no
rule matches. If the configuration is wrong, that is worth saying out loud.

---

## 5. The approval engine (Phase 18)

```
DRAFT ──► SUBMITTED ──► PENDING_APPROVAL ──► APPROVED
                              │
                              ▼
                          REJECTED ──► RECTIFICATION ──► RESUBMITTED
                                                              │
                                                              ▼
                                                     PENDING_APPROVAL
```

Nine document types share this: buyer order, planning, quotation, purchase
order, gate pass, GRN, scrutiny, plan approval, cutting issue.

**`workflowState` is the authority.** Each module's own column —
`approvalStatus`, `authorisationStatus`, `excessApprovalStatus`, `status` — is
what the workbook prints and what the existing CHECK constraints refer to, so it
stays. `transition()` writes **both in one update** through the module's `legacy`
mapping, so they cannot drift.

**SUBMITTED and PENDING_APPROVAL are deliberately distinct.** A document can be
handed in before the approver has it. The difference between "sent" and "on the
approver's desk" is the difference between chasing the sender and chasing the
approver.

**RECTIFICATION is a state, not a gap.** A rejected document being corrected is
not "pending again", and recording it lets a screen show that a plan is on its
third attempt.

`GET /api/workflow/queue` answers "what is waiting on a decision, anywhere" in
one call. Without one shared engine that question needs six.

---

## 6. Locking — what stops moving, and when

| Document | Locks when | Corrected by |
|---|---|---|
| Vendor Quotation | decided | raise a fresh quotation |
| Purchase Order | approved or rejected | reopen (only if nothing was raised on it) |
| Gate Pass | cleared | reopen (only if no GRN) |
| GRN | posted | a reversal — never an edit |
| Fabric Issue | posted | a return |
| Fabric Scrutiny | finalised | **amendment** (before/after set kept) |
| Plan Approval | approved, permanently | a **new version** |
| Plan Approval | rejected **and rectified** | its successor |
| Cutting Issue | posted, permanently | nothing — see §7 |

**Fabric Scrutiny amendments** are the one place a locked record changes. The
before/after set is written to `document_amendments` **first**, with a reason,
and only then is the change applied — so what the record said when the decision
was taken stays recoverable. A changed decision re-applies its effect to the
roll in the same transaction, because an amendment that said "actually, reject"
and left the roll released would be worse than no amendment at all.

**Why REJECT does not write the stock off.** A rejected quantity is a claim
against a vendor before it is a stock adjustment, and the workbook settles it
with a debit note this system does not model. Writing the fabric out of the
ledger would destroy the evidence the claim rests on. The roll is **held**
instead — visible, unusable, still on the books.

---

## 7. Cutting Issue (Phase 16) — the last document

There is nothing downstream of a cutting issue in this system, and nothing
outside it can un-cut cloth. So it is verified hard **before** posting and is
immutable **the moment** it is.

`verify()` runs all nine checks, **always**, and returns every one with a pass or
a fail and a sentence saying why. It does not stop at the first failure: a
supervisor should be told everything that is wrong in one go.

| # | Check | What it means |
|---|---|---|
| 1 | Order exists | |
| 2 | Order is valid | not cancelled, not already completed |
| 3 | Planning exists | for this order and container |
| 4 | Plan approval exists | for this order and container |
| 5 | Approval is APPROVED | **and it is the latest version** |
| 6 | Fabric process complete | job work returned; roll not held or rejected |
| 7 | Stock and availability | the fabric issue exists, posted, for this order |
| 8 | Within permitted quantity | against the approved plan, cumulative |
| 9 | Excess authorised | where 8 is exceeded, through the excess engine |

`post()` re-runs the whole set **inside the transaction**, so the preview and the
post cannot disagree and two supervisors cannot both post against the same plan.

**Check 5 requires the LATEST version to be the approved one.** An order whose v1
was approved and whose v2 is pending is an order somebody has changed their mind
about; cutting to v1 would cut to a plan nobody now believes in.

There is no `unpost` and no `amend`, and no force flag for either.

---

## 8. Job Work (Phase 13) — one register, four processes

`dye_issues` already carried a `process` column reading Dyeing / Printing /
Washing / Finishing. That **is** the job-work register. The table keeps its
Phase 0 name because there are migrations and seed data behind it; everywhere a
person can see — the API path `/api/job-works`, the screens, the printed slip —
it is Job Work.

What must not be shared is the **presentation**. `processMeta()` gives each
process its own document name, vendor label, vendor category, loss label,
default allowance, roll stage and location, so a printing job never appears
labelled as a dyeing job.

**Stock flow.** The fabric left the store on a Fabric Issue, which wrote the
ledger OUT. A job-work issue does **not** move stock again — it records the job.
The **return** writes the ledger IN for what actually came back; the shrinkage is
a real loss and never re-enters stock. That is the flow the workbook implies and
the one the seeder replays.

A return larger than what was sent is refused: fabric shrinks, it does not
multiply. An out-of-tolerance return sets the receipt to `SENT_TO_SCRUTINY` and
**holds the roll** — the sheet's own rule.

---

## 9. Dates and times

Stored as `timestamptz` in **UTC**. Displayed as **DD-MM-YYYY** in
**Asia/Kolkata**, converted at the last possible moment in
`client/src/utils/format.js`.

Nothing stores Indian local time as a database timestamp — a server restarting in
a different timezone would otherwise shift every historical date by five and a
half hours.

`toDateInput()` deliberately does **not** use `toISOString().slice(0, 10)`: that
converts to UTC first, so an Indian evening becomes the previous day.

The wire format is always ISO. `DD-MM-YYYY` is a display format only, because
"03-04-2026" is ambiguous the moment it leaves this country.

---

## 10. Errors

```json
{
  "success": false,
  "code": "INSUFFICIENT_STOCK",
  "message": "Cannot issue: only 250.0000 Mtrs of ITM-0001 (Fabric / 10 oz / Natural) is available at MAIN STORE. 300.0000 was requested.",
  "error": { "code": "…", "message": "…", "details": { "field": "qty", "available": "250.0000", "short": "50.0000" } }
}
```

`code` and `message` are lifted to the top level because that is what a caller
reads first; the nested `error` object is kept because the React client already
destructures it. Both carry the same values.

Business codes: `INSUFFICIENT_STOCK`, `DUPLICATE_ROLL_NO`, `DUPLICATE_DOCUMENT_NO`,
`EXCESS_APPROVAL_REQUIRED`, `EXCESS_BEYOND_CEILING`, `DOCUMENT_LOCKED`,
`INVALID_TRANSITION`, `APPROVAL_REQUIRED`, `VERIFICATION_FAILED`.

Every message is written for a business user. Raw driver errors are logged on the
server and never reach the client.

---

## 11. Assumptions

1. **`round` is the version number on a plan approval.** The schema already had
   it; the API also exposes it as `version` so nobody has to guess.

2. **A gate pass "Item" is free text.** The workbook's own sample rows read
   "Dyed Fabric", "Cut Panels", "Cutting Pieces" — none of which is an
   `L_ItemCategory` value. It is not validated against a list.

3. **Job work fabric stage defaults to BEFORE_STITCHING.** Every sampled row in
   the Dye issue sheet routes whole rolls; after-stitching work appears on the
   Printing sheet, which has its own register.

4. **Item codes come from `document_sequences`,** which required adding
   `INVENTORY_ITEM` to `DocumentType`. A bare Postgres `SEQUENCE` survives a
   rollback by design, which would leave gaps that look like deleted stock.

5. **Clearing a gate pass IS its approval** in the workflow engine — taken by
   whoever counted the goods. There is no separate approval step for one.

6. **Posting a GRN IS its approval.** A GRN that has not reached the ledger is
   not a state this system is willing to hold, so there is no draft GRN.

---

## 12. Open points

1. **The workbook's own sample data issues fabric before the GRN that received
   it.** FAB-003, FAB-007 and FAB-009 are issued for printing on 15 and 25
   August against GRN-006, dated the 20th. Replaying the sheets in date order
   drives two items transiently negative.

   Consequence: the "never issue more than available" rule is enforced in
   `inventory.service.js` on every new movement, and **not** as a CHECK on
   `stock_ledger.balance_qty` — a CHECK would refuse to load the company's own
   history. Worth confirming whether those sheet dates are simply wrong.

2. **GRN-007 is received against MA-003, whose approval is still PENDING.** The
   service refuses a GRN against an unapproved PO. The seeded row is inserted
   directly and predates the control. Worth confirming the intended rule.

3. **DR-002 shows 3.5% shrinkage against a 3% allowance but is marked OK** in
   the workbook. `verify:seed` reports this as a warning. New returns would go
   to scrutiny.

4. **Excess rules for ORDER and BUYER scope take an id as the scope key.** Usable
   through the API today; the screen offers no picker for them yet.

5. **`inProcessQty` on `stock_balances` is not yet maintained.** The column
   exists for stock sitting at a dyeing or printing vendor. Rolls carry their
   own stage and location, which covers the operational question today.

6. **No barcode/QR generation.** `ScanBox` accepts a hardware wedge scanner
   today — that covers reading. Printing scannable codes on the PO, gate pass
   and challan is a separate piece of work.

---

## 13. What is deliberately absent

Nothing after Cutting Issue: no stitching record, no hourly monitoring, no QC
records, no alter, no packing, no needle checking, no dispatch, no
reconciliation. `npm run verify:scope` fails the build if any of it appears in
the schema.

`CuttingIssue` is terminal, and its service says so in the file header rather
than leaving a reader to infer it.
