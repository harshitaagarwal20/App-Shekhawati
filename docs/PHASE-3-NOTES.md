# Phase 3 — Buyer Order

Sheet: **"Order" — Order Format** (Role Acess - Merchandising Team)

---

## The rule that shaped this phase

> *"All calculated quantities must be calculated on the server. The browser must
> never be trusted with calculated values."*

Three mechanisms enforce it, not one:

1. **The input schemas have no calculated fields.** `createOrderSchema` and
   `updateOrderSchema` list only what a human types. Zod strips unknown keys, so
   a request carrying `effectiveQty`, `excessApprovedPct` or a requirement line
   has them discarded before the service ever runs. There is a test that posts
   `effectiveQty: '10000'` on a 1000-piece order and asserts the saved order is
   1000.
2. **One calculation site.** `calculateEffectiveQty()` and
   `calculateRequirement()` in
   [buyerOrder.service.js](../server/src/services/buyerOrder.service.js) are the
   only places an order quantity is multiplied. Every route that returns a
   quantity — list, detail, preview, approve — routes through them.
3. **Even the preview is a server call.** The create form shows the material
   requirement as the merchandiser types, via `POST /orders/preview`. It would
   have been easy to multiply `qtyPerPc × orderQty` in React; the form asks the
   server instead, so the number on screen is the number the server would store.

`Prisma.Decimal` throughout, never JavaScript floats. There is a test asserting
`3 × 1.1 = 3.3` exactly, because in float arithmetic it is not.

---

## Excess approval workflow

The Order sheet annotates its "Excess" column **"Approval from dinesh sir"**.
That single note is the whole workflow, and it has one consequence worth stating
plainly:

> **P3-D1 — Requested excess and granted excess are two different numbers, and
> the ceiling follows the granted one.**
>
> | Field | Meaning |
> |---|---|
> | `excessPct` | what the merchandiser asked for |
> | `excessApprovedPct` | what the Director granted — **0 until approved** |
> | `effectiveQty` | `orderQty × (1 + excessApprovedPct)` |
>
> An order with an unapproved 2% excess behaves exactly like an order with no
> excess at all. Nothing downstream can consume an allowance that was never
> granted — which is the point of the note on the sheet.

States: `NOT_REQUIRED` → (`PENDING` → `APPROVED` | `REJECTED`).

- Asking for an excess **requires a justification**; it goes to the Director with
  the request.
- The Director may **grant less than was asked for** (`approvedPct`), but never
  more — a database CHECK enforces `excess_approved_pct <= excess_pct` as well.
- Approving recomputes `effectiveQty` server-side; rejecting returns it to the
  plain order quantity.
- Only `BUYER_ORDER.APPROVE` may decide, which of the nine roles is Director
  alone. A merchandiser cannot approve their own request — there is a test.

Every transition is written to `approval_history` with who, when and why.

---

## Editing before approval

> **P3-D2 — Two different locks, for two different reasons.**
>
> - **The excess decision** locks nothing by itself, but any change to
>   `orderQty` or `excessPct` returns an approved excess to `PENDING`. A decision
>   taken on 5,000 pieces does not carry over to 7,500.
> - **Downstream documents** lock the structural fields — buyer, style, quantity,
>   colour, size group, excess — as soon as a plan, quotation, PO, fabric issue
>   or cutting issue exists against the order. A PO raised for 5,000 pieces must
>   not find its order silently changed to 3,000.
>
> Descriptive fields (remarks, ship-to, delivery date) stay editable throughout.

`GET /orders/:id` returns an `editable` block — `canEditDetails`,
`canEditStructural`, `requiresAmendment`, `lockedBy` — so the screen shows the
reason rather than a disabled button with no explanation.

**Amendments.** A locked order is changed through `POST /orders/:id/amend`,
which demands a reason, writes a field-level before/after diff to
`document_amendments` (the Phase 0 table, now in use), increments
`amendmentCount`, and returns any approved excess to the Director.

---

## Order numbering

> **P3-D3 — A supplied buyer PO number always wins; the sequence is a fallback.**
> The sheet marks Order No "Manual" and notes *"Buyer PO num is their order no"*,
> but Phase 3 asks for order number generation. Both are supported: enter the
> buyer's number and it is kept verbatim (`B9641IS`); leave it blank — the order
> was taken before the buyer's paperwork arrived — and the `BUYER_ORDER`
> sequence issues `SO-00001`.

---

## Other decisions

**P3-D4 — A style must belong to the order's buyer.** Styles are buyer-specific
in the master, so the style dropdown follows the buyer selection and the server
refuses a mismatch outright rather than warning.

**P3-D5 — Fields the sheet marks "Auto" are defaulted, not required.**
`Bill To` comes from the Buyer Master, `Currency` and `Ship Mode` from the
buyer's standing terms, `Size Group` from the style, `Item Description` from the
style description, `Ship To` from the buyer's consignee address. Each can be
overridden; none has to be typed.

**P3-D6 — Status transitions are guarded.** The sheet marks Status "Auto", but
the stages that would drive it are not built yet, so it is set explicitly with
the transitions that make sense: nothing leaves `COMPLETED` or `CANCELLED`, and
an order with downstream documents cannot be cancelled at all (hold it instead).

**P3-D7 — The percentage is a fraction in the database and a percentage in the
form.** The workbook stores `0.02`; merchandisers think in "2%". The form takes
2 and converts at the boundary — the only arithmetic in the client, and it is
unit conversion, not a business calculation.

---

## API

| Method | Path | Permission |
|---|---|---|
| GET | `/api/orders` | `BUYER_ORDER.VIEW` |
| GET | `/api/orders/:id` | `BUYER_ORDER.VIEW` |
| GET | `/api/orders/options` | `BUYER_ORDER.VIEW` |
| POST | `/api/orders/preview` | `BUYER_ORDER.VIEW` |
| POST | `/api/orders` | `BUYER_ORDER.CREATE` |
| PATCH | `/api/orders/:id` | `BUYER_ORDER.EDIT` |
| POST | `/api/orders/:id/amend` | `BUYER_ORDER.EDIT` |
| PATCH | `/api/orders/:id/status` | `BUYER_ORDER.EDIT` |
| DELETE | `/api/orders/:id` | `BUYER_ORDER.DELETE` |
| POST | `/api/orders/:id/excess/approve` | `BUYER_ORDER.APPROVE` |
| POST | `/api/orders/:id/excess/reject` | `BUYER_ORDER.APPROVE` |

Search: order no, item description, colour, remarks.
Filters: buyer, style, status, excess approval state, currency, order-date range,
delivery-date range. Sortable: order no, order date, delivery date, order qty,
status, excess state.

---

## Schema change

Migration `20260825000300_buyer_order_excess_approval`:

- New enum `ExcessApprovalStatus`
- Nine columns on `buyer_orders` (`effective_qty`, the excess decision fields,
  `amendment_count`), with the existing rows backfilled — the workbook's sample
  orders are live orders, so their excess is treated as already granted
- Eight CHECK constraints, including `excess_approved_pct <= excess_pct` and
  `buyer_delivery_date >= order_date`
- A `BUYER_ORDER` document sequence

Still **35 models** — no new tables; `document_amendments` and
`approval_history` from Phase 0 are now carrying real traffic.

---

## Verification

| Check | Result |
|---|---|
| `npm run lint` | **0 problems** |
| `npm run build` | **clean** |
| `prisma validate` | valid — 35 models |
| `verify:scope` | no out-of-scope module; `CuttingIssue` still terminal |
| `verify:seed` | all cross-references resolve |
| Route smoke test | health reports Phase 3; all order routes 401 without a token |

**Not yet run:** `npm test`. [server/test/orders.test.js](../server/test/orders.test.js)
adds ~30 cases — creation and defaults, number generation, the tamper test,
Decimal exactness, the full excess workflow including partial approval,
re-approval on quantity change, the downstream lock, amendments, status
transitions, and search/filter/detail. It needs a migrated, seeded database,
which has still not been created.

---

## Open points

1. **Status is set by hand for now.** The sheet marks it "Auto". Once Planning
   and Cutting Issue exist they should drive it; confirm the intended triggers.
2. **"Ship to" is free text.** The sheet marks it a dropdown but no master list
   backs it, and it is buyer-specific. It is prefilled from the buyer's consignee
   address. If buyers have a fixed set of delivery addresses, that is a small
   master worth adding.
3. **Excess above a threshold.** Every excess currently needs the Director.
   Confirm whether a small allowance (say ≤1%) should be automatic.
4. The Phase 0 and Phase 1/2 open points remain open; none blocked this phase.
