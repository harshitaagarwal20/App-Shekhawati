# Shekhawati Impex ERP

Manufacturing ERP for a Jaipur-based bag / tote export house, replacing the
Excel-and-paper process captured in `Shekwati Impex formats.xlsx`.

**The application covers Masters → Cutting Issue and ends there.**

```
MASTERS → BUYER ORDER → PLANNING → VENDOR QUOTATION → QUOTATION APPROVAL
       → PURCHASE ORDER → PO APPROVAL → GATE PASS → GRN → INVENTORY
       → FABRIC ISSUE → DYEING → PRINTING → FABRIC SCRUTINY
       → PLAN APPROVAL → CUTTING ISSUE → END
```

Nothing after Cutting Issue (stitching, hourly monitoring, QC records, alter,
packing, needle checking, dispatch, reconciliation) is part of this system —
no table, no route, no menu item, no placeholder. `npm run verify:scope` fails
the build if any of it creeps in.

That one line is the whole application. Drawn out — every branch, every gate,
who decides what, and how stock moves under it — it is
**[docs/APPLICATION-FLOW.md](docs/APPLICATION-FLOW.md)**, and who may do each of
those things is **[docs/USE-CASE-DIAGRAM.md](docs/USE-CASE-DIAGRAM.md)**.

---

## Status

| Phase | Scope | State |
|---|---|---|
| **0** | Database foundation: schema, constraints, indexes, soft deletion, audit columns, document sequences, seed, initial migration | **Delivered** |
| **1** | Login, JWT, password hashing, users, roles, user-role mapping, RBAC middleware, protected routes, session/logout, frontend route protection | **Delivered** |
| **2** | List Master, Buyers, Vendors, Employees, Styles, Style BOM, search/filter, active/inactive controls | **Delivered** |
| **3** | Buyer Order: creation, editing before approval, order numbering, excess approval workflow, status, search/filter, detail | **Delivered** |
| **4** | Planning: plan header and lines, order allocation, unit allocation, cutting pieces, deliverable size, container, status, approval flow | **Delivered** |
| **5** | Vendor Quotation: creation, vendor / item / qty / UOM / rate, server-calculated amount, order reference, authorisation, approval, rejection | **Delivered** |
| **6** | Purchase Order: per-vendor numbering, server-calculated amount, excess ceiling, style ceiling, Order → Quotation → PO traceability, approval workflow, printing | **Delivered** |
| **7** | Gate Pass: inward / outward, resolved reference document, server-calculated variation, authorising employee, clearing, printing | **Delivered** |
| **8** | GRN and Inventory: atomic GRN → Fabric Roll → Stock Ledger IN, receipt tolerance, the ledger as source of truth, balance reconciliation, roll traceability | **Delivered** |
| **12** | Fabric Issue: mobile-first, roll picker, availability checked at two levels, automatic Stock Ledger OUT | **Delivered** |
| **13** | Job Work: one register for dyeing, printing, washing and finishing; returns, shrinkage, scrutiny hold | **Delivered** |
| **14** | Fabric Scrutiny: findings, the Director’s decision, locking, and amendment with a before/after trail | **Delivered** |
| **15** | Plan Approval: version-controlled, rectification into a successor version, approved versions immutable | **Delivered** |
| **16** | Cutting Issue: nine pre-post verifications, excess authorisation, permanent lock. **The pipeline ends here.** | **Delivered** |
| **17** | Excess control: every tolerance configurable, scope precedence, authorisation workflow. No percentage is compiled into the application. | **Delivered** |
| **18** | Approval engine: one state machine, one transition table, nine document types, a cross-module queue | **Delivered** |
| **C12** | Material Plan: the raw material requirement — fabric **and** accessories — exploded from the Style BOM, frozen at creation, prepared by planning and signed before procurement goes to the market | **Delivered** |
| **32** | Reporting: fourteen operational reports, one per implemented module, RBAC-filtered, CSV export | **Delivered** |
| **33** | Excel reconciliation: every workbook column traced Excel → ERP → column → API → screen, with every deliberate omission documented | **Delivered** |

> **Live on Azure.** The application is deployed and in use — App Service for the
> API, a Static Web App for the client, PostgreSQL Flexible Server behind both.
> Pushing to `main` deploys it: see [AZURE-DEPLOYMENT.md](docs/AZURE-DEPLOYMENT.md)
> and [.github/workflows/deploy.yml](.github/workflows/deploy.yml), which applies
> migrations with `prisma migrate deploy` before shipping the new code.
>
> **`db:seed` must never touch that database.** It clears every in-scope table and
> rebuilds it from demo data — read
> ["Two things that will bite you"](docs/AZURE-DEPLOYMENT.md#two-things-that-will-bite-you)
> before running anything against production. `db:deploy` is the only database
> command that belongs in a pipeline.
>
> Everything verifiable without a database still is (see [Verification](#verification)):
> the schema validates, the scope guard passes, every seed cross-reference resolves,
> 433 rule tests pass with no database, lint is clean and the client builds.
> Two commands bring a *local* database up — see [Setup](#setup).

---

## Stack

| Layer | Technology |
|---|---|
| Database | PostgreSQL |
| ORM | Prisma |
| Backend | Node.js · Express · REST |
| Auth | JWT · bcrypt |
| Frontend | React · Vite · React Router · Axios · React Hook Form · Zod |

---

## Layout

```
/
├── server/
│   ├── prisma/
│   │   ├── schema.prisma                      43 models · 24 enums · ~166 indexes
│   │   ├── migrations/
│   │   │   ├── 20260825000000_init/           tables, indexes, foreign keys
│   │   │   ├── 20260825000100_check_constraints/   50 CHECK constraints
│   │   │   ├── 20260825000200_user_sessions/  refresh-token session store
│   │   │   ├── 20260825000300_buyer_order_excess_approval/
│   │   │   ├── 20260825000400_planning/       planned qty, approval flow, ceiling checks
│   │   │   ├── 20260825000500_vendor_quotation/  amount = qty x rate, reasoned decisions
│   │   │   ├── 20260825000600_purchase_order_gate_pass_grn/  three formulas, three CHECKs
│   │   │   ├── 20260825000700_inventory_item_sequence/  item codes from the counter table
│   │   │   ├── 20260825000800_stock_ledger_source_of_truth/  qty_in / qty_out, snapshots
│   │   │   ├── 20260825000900_issue_jobwork_scrutiny_planapproval/  locking and versions
│   │   │   └── 20260825001000_excess_engine_approval_engine_cutting/  no hardcoded 2%
│   │   ├── seed/                              seeder · offline verifier · data
│   │   └── verify-scope.js                    fails if an out-of-scope module appears
│   ├── src/
│   │   ├── config/         env.js · prisma.js
│   │   ├── middleware/     authenticate · authorize · validate · rateLimit · errorHandler
│   │   ├── services/       auth · user · role · masterList · buyer · vendor · employee · style
│   │   │                   buyerOrder · planning · vendorQuotation · purchaseOrder
│   │   │                   gatePass · grn · inventory · fabricIssue · jobWork
│   │   │                   fabricScrutiny · planApproval · cuttingIssue
│   │   │                   excess (configurable tolerances)
│   │   │                   approvalEngine (one workflow, nine document types)
│   │   │                   report (fourteen reports, one registry)
│   │   │                   dataset.registry (every exportable table, in one list)
│   │   │                   export (any table as CSV) · import (masters, from CSV)
│   │   │                   dashboard (the first screen, RBAC-filtered section by section)
│   │   │                   crud (shared master core) · documentNumber
│   │   ├── controllers/    auth · user · master · buyerOrder · planning · vendorQuotation
│   │   │                   purchaseOrder · gatePass · grn · inventory · production · report
│   │   │                   dashboard · dataTransfer (exports and imports)
│   │   ├── routes/         index · auth · user · master · buyerOrder · planning
│   │   │                   vendorQuotation · purchaseOrder · gatePass · grn
│   │   │                   inventory · production · report · dashboard
│   │   │                   dataTransfer (/exports and /imports)
│   │   ├── validators/     common · auth · user · master · buyerOrder · planning
│   │   │                   vendorQuotation · purchaseOrder · gatePass · grn
│   │   │                   production · report
│   │   ├── utils/          ApiError · http · tokens
│   │   │                   csv (the one reader and the one writer - see the note
│   │   │                        at its head on why both halves live together)
│   │   └── app.js  index.js
│   └── test/
│       ├── api.test.js                        auth · RBAC · masters       (needs a database)
│       ├── orders.test.js                     buyer order · excess        (needs a database)
│       ├── rules.test.js                      planning ceiling · amount   (no database)
│       ├── phase6-18.rules.test.js            54 cases                    (no database)
│       │                                      PO amount and both ceilings ·
│       │                                      gate pass variation · GRN tolerance ·
│       │                                      job work shrinkage · the excess
│       │                                      engine · the transition table
│       ├── reports.rules.test.js              55 cases                    (no database)
│                                              the report registry · RBAC filtering ·
│                                              the CSV writer
│       ├── dashboard.rules.test.js            56 cases                    (no database)
│       │                                    every descriptor · and who is shown
│       │                                    which section, asserted against the
│       │                                    real access decision
│       ├── pagination.rules.test.js          14 cases                    (no database)
│       │                                    every page boundary · the clamps ·
│       │                                    and that no row is dropped between
│       │                                    two pages
│       └── urlParams.rules.test.js           14 cases                    (no database)
│                                              what a list writes to the address
│                                              bar · defaults omitted · foreign
│                                              parameters preserved
│
├── client/
│   └── src/
│       ├── components/  ui.jsx        Field · MasterSelect · Modal · table bits
│       │                form.jsx      React Hook Form + Zod, server errors, submit-once
│       │                workflow.jsx  StateBadge · LockNotice · progress · trail · excess
│       │                mobile.jsx    shop floor: pickers · scan box · qty · confirm sheet
│       ├── config/       masters.jsx (descriptors) · navigation.js
│       ├── context/      AuthContext.jsx
│       ├── hooks/        useMasterList · useResourceList
│       ├── layouts/      AppLayout.jsx
│       ├── utils/        format.js    DD-MM-YYYY in Asia/Kolkata · display numbers
│       ├── pages/        Login · ChangePassword · Errors
│       │                 Dashboard      attention · approvals · the pipeline
│       │                 ApprovalQueue  everything awaiting a decision
│       │                 orders/      OrderList · OrderForm · OrderDetail
│       │                 planning/    Planning* · PlanApprovalPages (versions)
│       │                 quotations/  QuotationList · QuotationForm · QuotationDetail
│       │                 procurement/ PurchaseOrder* · GatePass* · Grn*
│       │                 inventory/   StockSummary · StockLedgerPage · RollList · RollDetail
│       │                 production/  FabricIssue* · JobWork* · ScrutinyPages
│       │                 cutting/     CuttingIssueForm · CuttingIssuePages
│       │                 reports/     Reports.jsx    (one screen, fourteen reports)
│       │                 print/       DocumentPrint  (all six printed documents)
│       │                 shared/      Detail.jsx     (TraceChain and friends)
│       │                 masters/     MasterPage · ListMaster · Buyers · Vendors · Employees · Styles
│       │                 admin/       Users · Roles · ExcessRules
│       ├── routes/       AppRoutes.jsx · ProtectedRoute.jsx
│       └── services/     api.js (axios + token refresh) · erp.js
│
└── docs/
    ├── PHASE-0-MODELLING-DECISIONS.md         26 decisions · 2 assumptions · 7 open points
    ├── PHASE-1-2-NOTES.md                     auth, RBAC and masters decisions
    ├── PHASE-3-NOTES.md                       buyer order and the excess workflow
    ├── PHASE-4-5-NOTES.md                     the planning ceiling rule, and the amount formula
    ├── PHASE-6-18-NOTES.md                    PO → Cutting Issue · the excess engine ·
    │                                          the approval engine · 6 assumptions · 6 open points
    ├── EXCEL-RECONCILIATION.md                every workbook column, traced end to end,
    │                                          and every deliberate omission with its reason
    ├── BUSINESS-CONTROLS.md                   the twelve controls, and where each is enforced
    ├── APPLICATION-FLOW.md                    the flow chart: the pipeline, every branch,
    │                                          the state machine, how stock moves, the ten
    │                                          gates on a cutting issue
    ├── USE-CASE-DIAGRAM.md                    the nine actors, what each may do, and the
    │                                          actor x use case matrix derived from the seeder
    └── AZURE-DEPLOYMENT.md                    the whole Azure deployment: resources, every
                                               app setting, the pipeline, the one-time seed,
                                               and the runbook
```

---

## Setup

**Prerequisites:** Node 20+, PostgreSQL 14+.

```bash
npm install
```

Configure the server:

```bash
cp server/.env.example server/.env
```

Then edit `server/.env`:

- `DATABASE_URL` — `postgresql://USER:PASSWORD@HOST:PORT/shekhawati_erp?schema=public`
- `JWT_SECRET` — at least 32 characters. Generate one: `openssl rand -base64 48`.
  The server refuses to start on the placeholder.
- `SEED_ADMIN_PASSWORD` / `SEED_DEFAULT_USER_PASSWORD` — change before seeding.

Create the database, migrate and seed:

```bash
createdb shekhawati_erp          # or: CREATE DATABASE shekhawati_erp;
npm run db:setup                 # migrate deploy + seed + row counts
```

Run it:

```bash
npm run dev:server               # API   → http://localhost:4000/api
npm run dev:client               # React → http://localhost:5175
```

Vite proxies `/api` to the server in development, so the browser sees one origin.

To rebuild the database from scratch: `npm run db:reset`.

---

## Deployment

**[docs/AZURE-DEPLOYMENT.md](docs/AZURE-DEPLOYMENT.md)** is the deployment on
Azure as sixteen numbered steps, in dependency order, each ending with a check
you can run before moving on: prerequisites, the two code changes to commit
first, the resources, every application setting and what it decides, the
pipeline, the one-time seed, the custom domain, and a go-live checklist. Then a
runbook for backups, secret rotation, schema changes and scaling.

Two things from it are worth knowing before anyone touches a production
database:

- **`npm run db:seed` — and therefore `db:setup` — is destructive.** It clears
  every in-scope table and rebuilds it. It is correct exactly once, on an empty
  database, before go-live. Afterwards the only command that touches production
  is `npm --workspace server run db:deploy`.
- **The rate limiter is per-process**, by design (see the note at the head of
  `server/src/middleware/rateLimit.js`). Run the API at a single instance, or
  move the limiter to a shared store first.

---

## Verification

```bash
npm run lint        # eslint over server, prisma, tests and client
npm run build       # Vite production build
npm run verify      # prisma validate + scope guard + offline seed verification
npm run test:rules  # every calculation and state rule            (no database)
npm test            # end-to-end API tests  (needs a seeded database)
```

Current results:

| Check | Result |
|---|---|
| `npm run lint` | **0 problems** |
| `npm run build` | **clean** — 186 modules, split per route: 402 kB initial (124 kB gzip) |
| `prisma validate` | valid — 59 models · 25 enums · 73 migrations |
| `verify:scope` | no out-of-scope module present; `CuttingIssue` is terminal |
| `verify:seed` | all cross-references resolve (1 warning on workbook sample data) |
| `npm run test:rules` | **433/433 pass** — every calculation, state rule, report descriptor, dashboard permission, RBAC route guard, page boundary and list URL |
| `npm test` | needs a seeded database — run it locally, never against production |

`npm run test:rules` drives the exported pure functions directly, so it runs on a
laptop with nothing installed but Node. The 74 cases cover:

| Phase | What is asserted |
|---|---|
| 4 | a plan may never allot more than the order permits |
| 5 | quotation amount is qty × rate |
| 6 | PO amount; the 1% accessory and 3% material ceilings; the style requirement that bounds an order-as-per-style; the amount in words on the Indian numbering system |
| 7 | gate pass variation, including the sheet’s sign convention and its `IFERROR` |
| 8 | GRN amount and variance; that tolerance is measured on the **cumulative** receipt, so three 1% deliveries against a 2% tolerance are caught |
| 13 | job work amount and shrinkage; that nothing returned yet is **zero** shrinkage rather than 100%; that the four processes are told apart |
| 17 | all nine excess figures, the brief’s own 10,000-at-2% example, the hard ceiling, advisory thresholds, and that a 5% contracted tolerance permits what 2% would not |
| 18 | the transition table: the happy path, the rejection loop, that `APPROVED` is terminal, and that a rejected document’s progress bar does not flatter it |
| 32 | the report registry: that all fourteen exist and nothing else does, that every one declares a permission over an in-scope module, that the catalogue is filtered by permission, and that the CSV writer escapes commas, quotes and newlines |

`npm run verify` and `npm run test:rules` need no database.

`npm run test:rules` drives the calculation functions directly, so the two rules
Phases 4 and 5 turn on are provable on a bare Node install: a plan may never
allot more than `orderQty x (1 + APPROVED excess)` — a *requested* excess buys
the planner nothing — and `amount = qty x rate`, in decimal arithmetic that does
not drift.

`npm test` boots the real Express app on an ephemeral port and drives it over
HTTP, covering login, token rotation and reuse detection, logout revocation, the
forced password change, RBAC refusals, List Master-driven dropdowns, CRUD across
all four record masters, and the whole buyer-order flow — including a case that
posts a tampered `effectiveQty` and asserts the server ignores it.

---

## Seed accounts

All seeded users are created with `mustChangePassword = true` — the API blocks
everything except the password-change endpoint until they set their own.
Passwords come from `server/.env`.

| Username | Role | Person in the workbook |
|---|---|---|
| `admin` | Admin | — |
| `dinesh` | Director | Dinesh Sir — final approver everywhere |
| `vinay` | Planning GM | Vinay ji (GM) |
| `ravi` | Store & Cutting Manager | Ravi Prajapat |
| `maharaj` | Store & Cutting Manager | Maharaj Singh |
| `sunita`, `rekha` | QC | Sunita Devi, Rekha Sharma |
| `merch` | Merchandising & Planning | — |
| `headoffice` | Head Office | — |
| `planner` | Merchandising & Planning | — |

---

## Export and import

### Exporting a table

Every list screen carries an **Export CSV** button. It downloads **every row the
table is currently showing** — the search, the filters and the sort exactly as
they are on screen — not just the page in front of you.

One endpoint serves all of it:

```
GET /api/exports              the tables this user may download
GET /api/exports/:key/csv     one of them, with the screen's own query string
```

The datasets are declared in `server/src/services/dataset.registry.js`, and each
entry names **the same `list()` its own screen calls**. That is the whole
contract: an export cannot show a different set of rows from the screen, because
it is not a second reading of the database — it is the same read, unpaged.
Columns are derived from the rows that came back rather than written out a
second time, so a column added to a list projection appears in its export
without anyone remembering to add it.

Exporting a table needs `<MODULE>.EXPORT`. The permission comes from the
registry entry, never from the URL, so the catalogue and the download cannot
disagree about who may see what. A file is capped at 50,000 rows: past that the
request is refused and names the number, rather than quietly truncating a
spreadsheet somebody is about to reconcile against.

### Importing a master

Buyers, Vendors, Employees, Styles and the Master List values each carry an
**Import CSV** button. The file a master exports is a file its importer accepts,
so the ordinary way to make one is: export, edit in Excel, send it back.

```
GET  /api/imports                  the masters this user may import
GET  /api/imports/:key             its columns, which are required, and why
GET  /api/imports/:key/template    a blank file with just the header row
POST /api/imports/:key             check a file, and apply it unless dryRun
```

Four rules decide what an import does — the reasoning for each is at the head of
`server/src/services/import.service.js`:

1. **Nothing is written until every row has been checked.** Schemas, dropdown
   membership, lookups and duplicate keys inside the file are all validated
   first. One bad row and nothing at all is written; the report names every
   problem against the row number your spreadsheet shows.
2. **A column that is not in the file is not touched.** A two-column file of
   `Vendor Code, Phone` changes thirty phone numbers and nothing else.
3. **A column that is in the file and empty clears that field.** On a round trip
   that is what a deleted cell means. Required fields are the exception — blank
   is refused, never stored.
4. **The importer goes through the same services the screen does.** Every rule
   the form enforces applies to an imported row, and the audit trail records the
   import as the user who sent it. There is no back door into these tables.

The screen always dry-runs first and only offers **Import N rows** once that
comes back clean, so the number being agreed to is one the server worked out
from the actual file. Permission is checked against what the file *does*: adding
rows needs `<MODULE>.CREATE`, changing them needs `<MODULE>.EDIT`, and a file
that does both needs both.

Two things are deliberately out of scope. A style's **BOM lines** are not
importable — the header is one row, the BOM is a grid, and importing a header
leaves the existing BOM untouched rather than flattening it into columns nobody
can edit. And a dropdown value cannot be **renamed** through a file, because an
edited cell is indistinguishable from a new value; rename it on the Master Lists
screen, which knows the difference.

---

## Five rules this codebase holds to

**1. The server is the security boundary.**
Hiding a sidebar link or guarding a route in React is a convenience. Every
permission code is enforced again by `can()` on the API route, and
`authenticate` re-reads the user's roles from the database on *every* request —
so a role change, a logout or a disabled account takes effect on the next call,
not at token expiry. The test suite asserts this by calling the API directly as
a QC user and expecting 403.

**2. Quantities are the server's.**
No screen multiplies a quantity. `effectiveQty`, every material requirement, a
plan's `plannedQty`, and a quotation's `amount` are each derived in one place on
the server. The input schemas contain no calculated field, so a posted one is
discarded before the service runs — and the live previews on the order, planning
and quotation forms are server calls, not browser arithmetic. All money and
quantity maths uses `Prisma.Decimal`, never floats.

Two ceilings follow from this and are enforced on every write **and** again at
approval, because either side can move in between:

- a plan may never allot more than `orderQty x (1 + APPROVED excess)` — an
  excess that is only *requested* buys the planner nothing;
- a quotation's `amount` is always `qty x rate`, backed by a CHECK constraint.

**3. Dropdowns are data, not code.**
Every business dropdown reads from the List Master at runtime by list code.
There are no hardcoded business option lists anywhere in the React client.
Adding a colour, a GSM or a stitching unit is done on the List Master screen and
takes effect immediately — the same as adding a row to the bottom of a column in
the workbook.

**4. Stock is derived, never overwritten.**
`stock_ledger` is append-only and is the source of truth. `stock_balances` holds
the same numbers, but nothing in this application ever increments a balance in
place — every one is recomputed by aggregating the ledger, inside the same
transaction as the movement that changed it. There is no `{ increment: … }`
anywhere in `inventory.service.js`, and no endpoint that writes a stock movement
directly: stock moves only as a consequence of a document. `POST
/api/inventory/stock/reconcile` rebuilds every balance from the movements, and
`?dryRun=true` reports the differences without writing.

**5. No tolerance is compiled into the application.**
2% is all over the workbook — the PO sheet, the receipt variance, dye-lot
shrinkage. Every one of those is now a row in `excess_rules`, resolved
narrowest-scope-first (order → buyer → item category → document type → global).
The seeded rows reproduce the workbook exactly, so nothing behaves differently on
day one; a buyer contracted at 5%, or one order agreed at 1%, is a change on the
Excess Rules screen rather than a deployment. `resolveRule()` refuses rather than
falling back to a hardcoded default — if no rule matches, the configuration is
wrong and that is worth saying out loud.

---

## Reading the schema against the workbook

Every business column in `schema.prisma` carries an `EXCEL:` comment naming the
sheet and the exact column caption it maps to:

```prisma
/// Excel: "Excess" - note on the sheet: "Approval from dinesh sir".
/// Stored as a fraction (0.02 = 2%) exactly as the workbook holds it.
excessPct Decimal @default(0) @map("excess_pct") @db.Decimal(9, 6)
```

| Workbook sheet | Model(s) | Screen |
|---|---|---|
| Master Lists | `MasterList`, `MasterListValue` | List Master |
| Buyer Master | `Buyer` | Buyers |
| Vendor Master | `Vendor` | Vendors |
| Employee Master | `Employee` | Employees |
| Style Master (BOM) | `Style`, `StyleBomLine` | Styles & BOM |
| Order | `BuyerOrder` | **Buyer Orders** |
| Planning\_ + Planning | `Planning`, `PlanningLine` | **Planning** |
| Vendor Quotation-Approval | `VendorQuotation` | **Vendor Quotations** |
| Plan Approval | `PlanApproval` | **Plan Approvals** — versioned |
| — (C12, from Style BOM) | `MaterialPlan`, `MaterialPlanLine` | **Material Plans** — what to buy in, signed |
| PO | `PurchaseOrder` | **Purchase Orders** |
| Gate Pass | `GatePass` | **Gate Passes** |
| GRN | `Grn` | **Goods Receipts** |
| — (derived) | `FabricRoll`, `InventoryItem`, `StockBalance`, `StockLedger` | **Stock · Stock Ledger · Fabric Rolls** |
| Fabric Issue | `FabricIssue` | **Fabric Issue** |
| Dye issue | `DyeIssue` | **Job Work** — dyeing, printing, washing, finishing |
| Dyeing Receipt *(Shekwati4.xlsx)* | `DyeingReceipt` | **Job Work** — the returns |
| Printing | `Printing` | **Job Work** — the printing process |
| Fabric Scrutiny Report | `FabricScrutiny` | **Fabric Scrutiny** |
| Cutting Issue | `CuttingIssue` | **Cutting Issue** — the last screen |
| — (not in the workbook) | `ExcessRule`, `ExcessApproval` | **Excess Rules** — every tolerance, as data |
| — (not in the workbook) | `ApprovalHistory`, `DocumentAmendment` | the trail on every document |

How the application flows, and who drives it:
- **[docs/APPLICATION-FLOW.md](docs/APPLICATION-FLOW.md)** — the flow chart end to
  end: Masters → Cutting Issue, every branch and what decides it, the approval
  state machine, how stock moves, and the ten gates on a cutting issue
- **[docs/USE-CASE-DIAGRAM.md](docs/USE-CASE-DIAGRAM.md)** — the nine actors, the
  use case diagram, «include» / «extend», and an actor × use case matrix derived
  from the seeded role patterns rather than from prose

Putting it into production:
- **[docs/AZURE-DEPLOYMENT.md](docs/AZURE-DEPLOYMENT.md)** — the Azure resources,
  every application setting and what it decides, the build and migration
  pipeline, the one-time seed, and the runbook for backups, secret rotation and
  schema changes

Decisions, assumptions and open questions:
- **[docs/PHASE-0-MODELLING-DECISIONS.md](docs/PHASE-0-MODELLING-DECISIONS.md)**
- **[docs/PHASE-1-2-NOTES.md](docs/PHASE-1-2-NOTES.md)**
- **[docs/PHASE-3-NOTES.md](docs/PHASE-3-NOTES.md)**
- **[docs/PHASE-4-5-NOTES.md](docs/PHASE-4-5-NOTES.md)**
- **[docs/PHASE-6-18-NOTES.md](docs/PHASE-6-18-NOTES.md)** — Purchase Order through
  Cutting Issue, the excess engine and the approval engine
- **[docs/EXCEL-RECONCILIATION.md](docs/EXCEL-RECONCILIATION.md)** — every workbook
  column traced Excel → ERP → database column → API field → React field, and every
  field that is deliberately not implemented, with its reason
- **[docs/BUSINESS-CONTROLS.md](docs/BUSINESS-CONTROLS.md)** — the twelve things the
  system must prevent, and where each is actually enforced
- **[docs/PHASE-4-5-NOTES.md](docs/PHASE-4-5-NOTES.md)** — the planning ceiling rule, and the amount formula
