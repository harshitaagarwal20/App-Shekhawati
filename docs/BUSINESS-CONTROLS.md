# Business controls

The twelve things the system must prevent, and where each one is actually
enforced. Every row names the code that refuses, and — where there is one — the
database constraint that would refuse even a direct `psql` session.

The pattern throughout: **the service is the rule, the constraint is the last
line of defence, and the UI is a convenience.** Hiding a button prevents
nothing.

---

## 1. Duplicate documents

| Where | What |
|---|---|
| Database | `UNIQUE` on `order_no`, `quotation_no`, `po_id`, `gate_pass_no`, `grn_no`, `issue_no`, `dye_issue_no`, `receipt_no`, `printing_no`, `scrutiny_no`, `approval_no`, `challan_no`, `roll_no`, `item_code`, `planning_no` |
| Database | `UNIQUE (purchase_order_id, bill_no)` on `grns` — one vendor bill is receipted once |
| Database | `UNIQUE (order_id, COALESCE(container_no,''), round)` on `plan_approvals` — one order cannot have two version 2s |
| Service | Every `create()` checks for the clash first and raises a sentence naming the document that already holds the number, rather than letting a constraint violation surface |
| Numbering | `nextNumber()` uses `UPDATE … RETURNING` inside the caller's transaction, so two concurrent documents cannot take the same number |

Numbers are **never generated in React**. `documentNumber.service.js` is the
only place a document number comes from, and it is server-side by construction.

---

## 2. Duplicate roll numbers

| Where | What |
|---|---|
| Database | `UNIQUE` on `fabric_rolls.roll_no` |
| Service | `assertRollNoAvailable()` — checked before the write, and again inside the GRN transaction |
| Service | `normaliseRolls()` refuses a single receipt that lists the same roll number twice |
| Message | Names the GRN and vendor that already own the number, and says the number is never reused — including after deletion |

---

## 3. Negative inventory

| Where | What |
|---|---|
| Service | `postMovement()` reads availability **from the ledger**, not the cache, and refuses any OUT larger than it before writing anything |
| Service | `fabricIssue.checkAvailability()` checks **two levels**: the roll's own balance and the item's ledger total. Both run again inside the posting transaction |
| Database | `stock_balances_qty_non_negative` |
| Database | `fabric_rolls_balance_non_negative`, `fabric_rolls_balance_within_received` |
| Error code | `INSUFFICIENT_STOCK`, with the available quantity, the requested quantity and the shortfall |

**Not** enforced as a `CHECK` on `stock_ledger.balance_qty` — see
[PHASE-6-18-NOTES.md §12.1](PHASE-6-18-NOTES.md): the workbook's own sample data
issues fabric before the GRN that received it, and a `CHECK` would refuse to
load the company's own history. The rule applies to new movements, which is
where the service applies it.

---

## 4. Unauthorised approval

| Where | What |
|---|---|
| Route | `can('<MODULE>.APPROVE')` on every approve / reject / finalise / post endpoint |
| Roles | Only `DIRECTOR` (and `ADMIN`) hold `*.APPROVE`. Procurement raises purchase orders and cannot approve them; QC records scrutinies and cannot decide them |
| Middleware | `authenticate` re-reads the user's roles from the database on **every** request, so a role change or a disabled account takes effect on the next call, not at token expiry |
| Stamping | The approver's name comes from the authenticated session, never from the request body — `approvedByName` is in no input schema |

---

## 5. Editing approved documents

| Document | Refused by | Locked when |
|---|---|---|
| Vendor Quotation | `editability().canEdit` | decided |
| Purchase Order | `editability().canEdit` | approved or rejected |
| Gate Pass | `editability().canEdit` | cleared |
| GRN | `editability().canEditQuantities` | posted — only remarks stay open |
| Fabric Issue | `editability().canEditQuantities` | posted |
| Fabric Scrutiny | `assertOpen()` | finalised — **permanently** |
| Plan Approval | `assertOpen()` / `lockState()` | approved, or rejected-and-rectified |
| Cutting Issue | `assertUnlocked()` | posted — **permanently** |

Database backstops: `plan_approvals_approved_is_locked`,
`cutting_issues_posted_is_locked`, `fabric_scrutinies_locked_is_decided`.

There is **no force flag and no admin override** on the two permanent locks.
Corrections go through `DocumentAmendment` (scrutiny) or a new version (plan
approval); a cutting issue has neither, because nothing downstream of it exists.

---

## 6. Deleting posted documents

| Where | What |
|---|---|
| Service | `remove()` on GRN, Fabric Issue and Cutting Issue refuses when `postedAt` is set, and says what depends on it |
| Service | Every module's `remove()` counts downstream usage first and names it in the refusal |
| Everywhere | Deletion is **soft** — `deletedAt` / `deletedById`. Nothing in this application issues a physical `DELETE` on a business transaction |
| Numbering | A deleted document's number is never reused |

---

## 7. Fabric issue without stock

Covered by control 3, at both levels. The mobile screen additionally disables
the Post button while the server's availability preview says no — a
convenience, on top of a refusal that happens regardless.

---

## 8. PO approval without required information

| Where | What |
|---|---|
| Service | `assertApprovable()` — a PO must specify a delivery address and an HSN code, plus GSM, content, colour and sub-category on fabric, and an accessory item on accessories |
| Behaviour | Reports **every** missing field at once, so a buyer is not sent round the loop |
| Service | Approval is also refused when the PO's quotation is no longer approved |
| API | `editable.missingForApproval` tells the screen what is still needed |
| Report | *Pending PO approvals* has a "Ready" column and a "Still needs" column |

An approved PO is an instruction sent to a vendor. A vendor cannot act on one
that does not say where to deliver or what the tax code is.

---

## 9. GRN without a valid PO

| Where | What |
|---|---|
| Schema | `grns.purchase_order_id` is **not null** — a GRN cannot exist without one |
| Service | `resolvePurchaseOrder()` refuses a PO that is not `APPROVED`, and one that is cancelled |
| Service | The gate pass, if named, must be inward and must belong to the same PO |
| Database | `grns_posted_has_item` — a posted receipt must name the item it stocked |

---

## 10. Cutting Issue without an approved plan

| Where | What |
|---|---|
| Service | Checks 3, 4 and 5 of nine: planning exists, plan approval exists, and the **latest** version is the approved one |
| Service | All nine run again inside the posting transaction, against rows it has locked |
| Database | `cutting_issues_needs_plan_approval` — a posted challan must carry a `plan_approval_id` |
| UI | Only approved plan approvals are offered in the picker |

Check 5 requires the *latest* version to be approved. An order whose v1 was
approved and whose v2 is pending is an order somebody has changed their mind
about.

---

## 11. Excess quantity without approval

| Where | What |
|---|---|
| Service | `excess.assertPostable()` — refuses an over-limit transaction with no authorisation, and refuses one past the hard ceiling regardless |
| Service | The authorisation is checked against the numbers **actually being posted**: one raised for 350 pieces cannot authorise 900, and a changed base quantity invalidates it |
| Service | `excess.consume()` marks it spent inside the same transaction, so it cannot be used twice |
| Database | `excess_approvals_only_approved_is_consumed`, plus four CHECKs on the derived figures |
| Configurable | Every threshold is a row in `excess_rules`. No percentage is compiled into the application |
| Error codes | `EXCESS_APPROVAL_REQUIRED`, `EXCESS_BEYOND_CEILING` |

GRN over-receipts are the one deliberate exception: the goods are physically in
the yard, so they are **recorded** rather than refused — but never silently. The
first attempt is refused with the numbers, and the checker must resend with
`acknowledgeToleranceBreach`.

---

## 12. Invalid status transitions

| Where | What |
|---|---|
| Service | `approvalEngine.transition()` is the only function that writes a workflow state, and it refuses any move the transition table does not permit |
| Message | Names what the document *can* do from where it is |
| Table | `COMPLETED` and `CANCELLED` are terminal. A draft cannot be approved without being submitted; a rejection cannot be approved without being rectified and resubmitted |
| §38 | `APPROVED` never returns to `DRAFT`. It moves forward only - to `POSTED`, `COMPLETED` or `CANCELLED`. Undoing an approval goes through an explicit amendment mechanism, never through the table: `purchaseOrder.reopen()`, `fabricScrutiny.amend()`, `planApproval.rectify()`, `gatePass.reopen()` |
| §38 | `REJECTED → DRAFT` **is** allowed - a refused document is reworked |
| §38 | No status is settable from a request body. `status` is absent from every update schema; a change goes through `POST /:id/status` or a named act (`/clear`, `/reopen`, `/approve`) |
| Consistency | The workflow state and the module's own status column are written in **one update**, so they cannot drift |
| UI | `allowedFrom()` drives the buttons, so a screen cannot offer an action the server would refuse |
| Error code | `INVALID_TRANSITION` |
| Tests | 12 cases in `phase6-18.rules.test.js` assert the table directly |

---

## 13. A change nobody can account for

Not one of the twelve, but the thing that makes the other twelve auditable.

| Where | What |
|---|---|
| `config/prisma.js` | A Prisma client extension records every create, update and delete on an audited table, with the row before and after. It is in the client rather than in the services so that it cannot be forgotten |
| `config/auditedTables.js` | The audited list. `sessions`, `doc_sequences` and `stock_ledger` are deliberately excluded - the first two are machinery, and the ledger is already an append-only audit of itself |
| Rollback | Entries written inside a transaction are buffered and flushed only after it commits. A rolled-back GRN posting leaves no trail claiming the rolls were created |
| Secrets | `passwordHash` and every token hash are dropped from the snapshot entirely, not masked |
| Read-only | There is no create, update or delete endpoint, and no service function behind one. A trail the application can rewrite is not evidence |
| Permission | `AUDIT.VIEW`, separate from `USER.VIEW`: the trail carries the before-and-after of every rate and approval, so seeing it is a broader grant than administering logins |
| Screen | Administration → Audit. One record's writes, decisions and amendments are merged into a single time-ordered trail |

---

## Where these are tested

`npm run test:rules` — 195 cases, no database. Covers every calculation, the
transition tables, the navigation shape, the audit redaction and the
rolled-back-transaction buffer.

`npm test` — the API suite (119 cases), which needs a seeded database. It drives the rules
over HTTP, including cases that post a tampered `effectiveQty` and assert the
server discards it.

The database constraints are exercised by `npm run db:setup`: the seed loads the
whole workbook through them, so a constraint that contradicted real business
data would fail the setup rather than surfacing months later.
