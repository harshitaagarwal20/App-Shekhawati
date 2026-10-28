# Shekhawati Impex ERP

Manufacturing ERP for a Jaipur-based bag / tote export house, replacing the
Excel-and-paper process captured in `Shekwati Impex formats.xlsx`.

**The application covers Masters → Cutting Issue → Stitching (with Inline QC beside it) → Ironing → External QC → Needle Checking → Packing → Dispatch, and closes each order at the Reconciliation Report.**

```
MASTERS → BUYER ORDER → PLANNING → VENDOR QUOTATION → QUOTATION APPROVAL
       → PURCHASE ORDER → PO APPROVAL → GATE PASS → GRN → INVENTORY
       → FABRIC ISSUE → DYEING → PRINTING → FABRIC SCRUTINY
       → PLAN APPROVAL → CUTTING ISSUE → STITCHING (+ HOURLY MONITORING,
         INLINE QC, optional PRINTING AFTER STITCHING) → IRONING
       → EXTERNAL QC → ALTERATION UNIT / REJECTED REGISTER
       → NEEDLE CHECKING → PACKING → DISPATCH
       → RECONCILIATION → END
```

Production Phase 2 added Stitching Record and Hourly Monitoring, then Ironing.
Phase 3 added **Inline QC**, checks taken on the line while stitching runs: it
sits beside stitching rather than after it and moves no pieces. Phase 4 added
External QC, the Alteration Unit and the Rejected Register; Phase 5 the final
QC sheets and the Reconciliation Report. Phase 6 takes External QC's approved
pieces through Needle Checking into the boxes and out to the buyer. Every stage the workbook names is now built.
`npm run verify:scope` checks every delivered module's tables are still there,
and fails the build if anything named in `FORBIDDEN` (today: nothing) creeps
in — see `server/prisma/verify-scope.js`.

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
| **16** | Cutting Issue: nine pre-post verifications, excess authorisation, permanent lock. Production carries on from here — see P2 onwards. | **Delivered** |
| **17** | Excess control: every tolerance configurable, scope precedence, authorisation workflow. No percentage is compiled into the application. | **Delivered** |
| **18** | Approval engine: one state machine, one transition table, thirteen document types, a cross-module queue | **Delivered** |
| **C12** | Material Plan: the raw material requirement — fabric **and** accessories — exploded from the Style BOM, frozen at creation, prepared by planning and signed before procurement goes to the market | **Delivered** |
| **32** | Reporting: twenty-six operational reports across every implemented module, RBAC-filtered, CSV export | **Delivered** |
| **33** | Excel reconciliation: every workbook column traced Excel → ERP → column → API → screen, with every deliberate omission documented | **Delivered** |
| **P2** | Production Phase 2: Stitching Record (per unit, per day, never more than was cut for the unit), Hourly Monitoring (per tailor, per slot, saved cell by cell, phone-first), optional printing after stitching. A supervisor sees only their own unit — taken from the Unit / Line on their Employee record. See [docs/PRODUCTION-PHASE-2-NOTES.md](docs/PRODUCTION-PHASE-2-NOTES.md) | **Delivered** |
| **P3** | Inline QC: one screen with a Check Type toggle (Size / Workmanship — the workbook's QC Size and QC Defects sheets), taken on the line beside stitching. Unit follows the tailor; Pcs Checked and Pcs Rejected; several defects from the Defect Type list. Each defect goes to the **Action needed** list of the supervisor named in Inform To, who marks it Resolved. See [docs/INLINE-QC-NOTES.md](docs/INLINE-QC-NOTES.md) | **Delivered** |
| **Ironing** | Received from a unit (never more than it stitched less out for printing), ironed, damaged with a type; every damaged piece decided re-iron or rejected (rejects held as pending rejects); receiving closes the unit's cutting challans oldest first; daily and balance reports. See [docs/IRONING-NOTES.md](docs/IRONING-NOTES.md) | **Delivered** |
| **P4** | External QC (offered = approved + alteration + rejected, each faulty box by reason), the Alteration Unit (bags to repair or clean), and the Rejected Register. See [docs/PHASE-4-EXTERNAL-QC-NOTES.md](docs/PHASE-4-EXTERNAL-QC-NOTES.md) | **Delivered** |
| **P6** | Needle Checking (the Size Assortment Carton sheet: Order + Style at the top, cartons numbered on row by row, ten sizes, Pcs/Carton the sum; never more than External QC approved), Packing (the Packing Details sheet, box by box: Qty = Packing × Boxes, N.W, G.W and CBM worked out; never more of a colour than Needle Checking passed), and Dispatch (order-wise: buyer and shipment details from the order, container from its plan, totals from packing; Pending / Dispatched / Delivered; sets the order Partially Shipped / Shipped; dispatch note and packing list). See [docs/PHASE-6-PACKING-DISPATCH-NOTES.md](docs/PHASE-6-PACKING-DISPATCH-NOTES.md) | **Delivered** |
| **VP** | Vendor Performance (Dashboard → Vendor Performance): charts of job workers' shrinkage against their allowance and lots back by the due date, suppliers' PO lines received in full by the delivery date, cutting wastage by mill, and defect reasons at every QC stage. Each is a report in the registry, so it also has a table and a CSV export | **Delivered** |
| **DS** | Daily summary: at `DAILY_SUMMARY_TIME` (default 20:00 India time), holders of `REPORT.SUMMARY` (the Director) get the day's pieces cut, issued and stitched, External and Inline QC, rejections and the approvals waiting — in the bell, and by email / WhatsApp per their settings. Each line is shown only to someone who may view that register; anyone can switch it off or preview it under Notifications → Settings. With `ANTHROPIC_API_KEY` set, up to five **Needs attention** lines written by Claude go on top: a unit well under its usual output, a style's QC rejections up on its last 7 days, approvals waiting on the reader. They are written only from what that reader may see, and the figures stay underneath ([summaryBriefing.service.js](server/src/services/summaryBriefing.service.js)) | **Delivered** |

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
> 706 rule tests pass with no database, lint is clean and the client builds.
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
│   │   ├── schema.prisma          73 models · 36 enums
│   │   ├── migrations/            92 migrations, applied in name order by db:deploy
│   │   │   ├── 20260825000000_init/                       tables, indexes, foreign keys
│   │   │   ├── 20260825000100_check_constraints/          the CHECK constraints
│   │   │   ├── …                                          one per change since
│   │   │   ├── 20261020000300_stitching_and_hourly_monitoring/
│   │   │   ├── 20261020000400_ironing/
│   │   │   ├── 20261020000500_external_qc_and_alteration/
│   │   │   ├── 20261021000100_inline_qc/
│   │   │   ├── 20261021000200_daily_summary/
│   │   │   ├── 20261021000300_approval_queue_and_excess_rule_permissions/
│   │   │   └── 20261021000400_notification_dismiss/
│   │   ├── seed/                  seeder · offline verifier · data
│   │   └── verify-scope.js        delivered modules must exist; forbidden ones must not
│   ├── src/
│   │   ├── config/         env · prisma · poolWarmer · events
│   │   │                   auditedTables · auditContext · auditSnapshot (the audit trail)
│   │   ├── domain/         the rules as pure functions, no database:
│   │   │                   costing · panels · cutCheck · fifo · requirement · shade
│   │   │                   itemCategory · documentLines · makerChecker
│   │   │                   stitching · inlineQc · ironing · finishing
│   │   ├── middleware/     authenticate · authorize · validate · rateLimit
│   │   │                   receiveFile (uploads) · errorHandler
│   │   ├── services/       auth · user · role · masterList · buyer · vendor · employee · style
│   │   │                   buyerOrder · planning · materialPlan · planApproval · costSheet
│   │   │                   vendorQuotation · purchaseOrder · gatePass · grn · grnReversal
│   │   │                   inventory · openingStock · fabricIssue · jobWork · fabricScrutiny
│   │   │                   cuttingIssue · cuttingChallan · cuttingFabric · cutPiecesReceipt
│   │   │                   stitching · inlineQc · ironing · externalQc · alteration
│   │   │                   rejectedRegister · unitFlow · finishingFlow (pieces between stages)
│   │   │                   excess · tolerance · tax (configurable figures, never hardcoded)
│   │   │                   approvalEngine (one workflow, thirteen document types)
│   │   │                   report + reports.* (twenty-six reports, one registry)
│   │   │                   dashboard · notification · dailySummary
│   │   │                   dataset.registry (every exportable table, in one list)
│   │   │                   export (any table as CSV) · import (masters, from CSV)
│   │   │                   attachment · audit · crud (shared master core) · documentNumber
│   │   ├── controllers/    request handlers, one file per area
│   │   ├── routes/         index · one file per area, mounted under /api
│   │   ├── validators/     one Zod file per area, plus common
│   │   ├── utils/          ApiError · http · tokens · dates · figures · approvability
│   │   │                   csv (the one reader and the one writer - see the note
│   │   │                        at its head on why both halves live together)
│   │   └── app.js  index.js
│   └── test/               44 files
│       ├── *.rules.test.js           pure rules, no database — see Verification
│       ├── *.db.test.js              one module against a real database
│       └── api · orders · planning · quotations · pagination
│           c2-c9.constraints · c2-c9.e2e · concurrency.*
│                                     end to end over HTTP, or against the
│                                     database's own constraints
│
├── client/
│   └── src/
│       ├── components/  ui.jsx        Field · MasterSelect · Modal · table bits
│       │                form.jsx      React Hook Form + Zod, server errors, submit-once
│       │                workflow.jsx  StateBadge · LockNotice · progress · trail · excess
│       │                mobile.jsx    shop floor: pickers · scan box · qty · confirm sheet
│       │                ReportTable · TrendChart · RankedBars   report tables and charts
│       │                NotificationBell · HubChoice · Combobox · dataTransfer (CSV buttons)
│       ├── config/       masters.jsx (descriptors) · navigation.js
│       ├── context/      AuthContext.jsx
│       ├── hooks/        useMasterList · useResourceList · useOptionalColumns · useIsMounted
│       ├── layouts/      AppLayout.jsx
│       ├── utils/        format.js    DD-MM-YYYY in Asia/Kolkata · display numbers
│       │                 rollSuggest.js
│       ├── pages/        Login · ChangePassword · Errors
│       │                 Dashboard      attention · approvals · the pipeline
│       │                 ApprovalsHub · ApprovalQueue   everything awaiting a decision
│       │                 orders/      OrderList · OrderForm · OrderDetail · ColourwayGrid
│       │                 planning/    PlanningHub · Planning* · MaterialPlanPages
│       │                              PlanApprovalPages (versions)
│       │                 costing/     CostSheetPages
│       │                 quotations/  QuotationList · QuotationForm · QuotationDetail
│       │                 procurement/ PurchaseOrder* · GatePass* · Grn* · GrnReversalDetail
│       │                              DocumentPages
│       │                 inventory/   InventoryHub · StockSummary · StockLedgerPage
│       │                              RollList · RollDetail · OpeningStockPage · InventoryAnalysis
│       │                 production/  FabricIssue* · JobWork* · ScrutinyPages
│       │                 cutting/     CuttingIssue* · CuttingChallanPages · CutPiecesReceiptPages
│       │                 stitching/   StitchingPages · HourlyMonitoring · PrintingPages
│       │                              InlineQcPages · IroningPages
│       │                 finishing/   ExternalQcPages · AlterationPages · RejectedRegister
│       │                 reports/     Reports.jsx (one screen, twenty-six reports)
│       │                              VendorPerformance · AnalysisScreen (the charts)
│       │                 print/       DocumentPrint  (every printed document)
│       │                 shared/      Detail.jsx     (TraceChain and friends)
│       │                 masters/     MasterPage · ListMaster · Buyers · Vendors · Employees · Styles
│       │                 admin/       Users · Roles · ExcessRules · Audit
│       ├── routes/       AppRoutes.jsx · ProtectedRoute.jsx
│       └── services/     api.js (axios + token refresh) · erp.js
│                         dataTransferCache · loadFailures
│
└── docs/
    ├── PHASE-0-MODELLING-DECISIONS.md         26 decisions · 2 assumptions · 7 open points
    ├── PHASE-1-2-NOTES.md                     auth, RBAC and masters decisions
    ├── PHASE-3-NOTES.md                       buyer order and the excess workflow
    ├── PHASE-4-5-NOTES.md                     the planning ceiling rule, and the amount formula
    ├── PHASE-6-18-NOTES.md                    PO → Cutting Issue · the excess engine ·
    │                                          the approval engine · 6 assumptions · 6 open points
    ├── PRODUCTION-PHASE-2-NOTES.md            stitching record, hourly monitoring,
    │                                          printing after stitching
    ├── INLINE-QC-NOTES.md                     Phase 3: two check types, Inform To, Resolved
    ├── IRONING-NOTES.md                       received, ironed, damaged; closing a unit
    ├── PHASE-4-EXTERNAL-QC-NOTES.md           External QC, the Alteration Unit, the
    │                                          Rejected Register
    ├── POST-CUTTING-SCOPE-ASSESSMENT.md       the production flow mapped stage by stage,
    │                                          and the questions the rest still needs answered
    ├── EXCEL-RECONCILIATION.md                every workbook column, traced end to end,
    │                                          and every deliberate omission with its reason
    ├── BUSINESS-CONTROLS.md                   the twelve controls, and where each is enforced
    ├── STOCK-VALUATION-POLICY.md              FIFO, and why
    ├── APPLICATION-FLOW.md                    the flow chart: the pipeline, every branch,
    │                                          the state machine, how stock moves, the ten
    │                                          gates on a cutting issue
    ├── USE-CASE-DIAGRAM.md                    the actors, what each may do, and the
    │                                          actor x use case matrix derived from the seeder
    ├── AZURE-DEPLOYMENT.md                    the whole Azure deployment: resources, every
    │                                          app setting, the pipeline, the one-time seed,
    │                                          and the runbook
    └── HOSTING-AND-SECRETS.md                 what runs where, and Key Vault
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
| `npm run build` | **clean** — 194 modules, split per route: 410 kB initial (124 kB gzip) |
| `prisma validate` | valid — 73 models · 36 enums · 92 migrations |
| `verify:scope` | all eight delivered production modules present; none of the eight forbidden stages (final checks, spot rectification, packing, needle checking, dispatch, reconciliation) |
| `verify:seed` | all cross-references resolve (1 warning on workbook sample data) |
| `npm run test:rules` | **650/650 pass** — every calculation, state rule, report descriptor, dashboard permission, RBAC route guard, page boundary and list URL |
| `npm test` | needs a seeded database — run it locally, never against production |

`npm run test:rules` drives the exported pure functions directly, so it runs on a
laptop with nothing installed but Node. What each file asserts:

| File | Cases | What is asserted |
|---|---|---|
| `rules` | 20 | Phases 4–5: a plan may never allot more than the order permits; the workflow state is derived; quotation amount is qty × rate |
| `phase6-18` | 60 | PO amount and both ceilings; the amount in words on the Indian numbering system; gate pass variation and its sign convention; GRN tolerance measured on the **cumulative** receipt; job work shrinkage; the excess engine; the transition table |
| `phase38-40` | 64 | no status is settable from the frontend; the transition tables are total and closed; the navigation shows the current scope; the audit trail is read-only and never holds a secret |
| `reports` | 114 | every report the brief asks for exists and nothing else does; each declares a permission over an in-scope module; the catalogue is filtered by permission; the CSV writer escapes commas, quotes and newlines |
| `dashboard` | 62 | every descriptor is well formed; a user sees only what they hold; seeing a queue is not deciding it |
| `rbac` | 15 | every permission a route demands is one the seeder issues; someone other than Admin can open each module |
| `screensByRole` | 56 | the sidebar and the page guards agree; each role sees exactly its screens |
| `tax` | 20 | GST: the state code decides the split, intra- versus inter-state, rounding, zero versus absent |
| `c1.poMode` | 18 | order tolerance by category; As-per-style is a hard cap, Bulk is never blocked, and the mode must be stated |
| `excessRules` | 13 | which rule applies to which item, and that a rule needing no approval still has a ceiling |
| `improvements` | 34 | buyer order pricing; one bag, one shade; approval notifications; after-commit hooks; FOB costing; multi-line documents |
| `costing-and-cutting` | 23 | panels from the style; the five-term fabric equation; planned versus actual consumption; FIFO cost layers; the cut-pieces sample check |
| `accessoryVariety` | 6 | two varieties of one item are two stock items; which BOM line bounds a PO |
| `planning.fabricStock` | 19 | which bucket a roll is in; what is still to arrive; whether the store covers a cutting plan |
| `stitching` | 20 | remaining = deliverable − actual; never more stitched than was cut for the unit; which unit a login works for; the hourly grid; printing after stitching |
| `inlineQc` | 21 | two check types on one screen; pieces checked and rejected; defects and Inform To; only the person named marks a defect Resolved |
| `ironing` | 16 | the two balances every write must keep; damage %; closing the unit |
| `finishing` | 20 | External QC's three boxes and their reasons; where each piece goes next; the Alteration Unit; no piece counted twice and none lost |
| `dailySummary` | 8 | each line goes only to those who may see that register; when it is sent |
| `pagination` | 14 | every page boundary, the clamps, and that no row is dropped between two pages |
| `urlParams` | 21 | what a list writes to the address bar: defaults omitted, foreign parameters kept, values escaped |
| `upload` | 6 | a file reaches the server as a file |

Four more files hold pure rules but are not yet in the `test:rules` script, so
they run only under `npm test`: `c2-c9.rules` (54), `c12.materialPlan.rules` (10),
`makerChecker.rules` (9) and `approvalQueue.routes.rules` (4). All 77 pass with no
database.

`npm run verify` and `npm run test:rules` need no database.

`npm run test:rules` drives the calculation functions directly, so the two rules
Phases 4 and 5 turn on are provable on a bare Node install: a plan may never
allot more than `orderQty x (1 + APPROVED excess)` — a *requested* excess buys
the planner nothing — and `amount = qty x rate`, in decimal arithmetic that does
not drift.

`npm test` boots the real Express app on an ephemeral port and drives it over
HTTP, covering login, token rotation and reuse detection, logout revocation,
RBAC refusals, List Master-driven dropdowns, CRUD across
all four record masters, and the whole buyer-order flow — including a case that
posts a tampered `effectiveQty` and asserts the server ignores it.

---

## Seed accounts

Passwords come from `server/.env`. There is no forced first password change —
it was retired, and accounts are created ready to use — so tell each person to
set their own from **Change Password** as soon as they have signed in.

| Username | Role | Person in the workbook |
|---|---|---|
| `admin` | Admin | — |
| `dinesh` | Director | Dinesh Sir — final approver everywhere |
| `vinay` | Planning GM | Vinay ji (GM) |
| `ravi` | Store & Cutting Manager | Ravi Prajapat |
| `maharaj` | Store & Cutting Manager | Maharaj Singh |
| `sunita`, `rekha` | QC (Fabric Scrutiny and Inline QC) | Sunita Devi, Rekha Sharma |
| `merch` | Merchandising & Planning | — |
| `headoffice` | Head Office | — |
| `planner` | Merchandising & Planning | — |
| `anil` | Stitching Supervisor | Anil Kumar — Unit 1 |
| `mahipal` | Stitching Supervisor | Mahipal Yadav — Unit 2 |
| `finishing` | Ironing & Finishing Supervisor | — (the ironing desk) |
| `extqc` | External QC Coordinator | — (the External QC desk) |
| `alteration` | Alteration Unit Supervisor | — (the Alteration Unit) |

The stitching supervisors are who Inline QC informs: they hold
`INLINE_QC.RESOLVE` and get each defect on their Action needed list.

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
