# Post-Cutting scope — what building the production flow would take

**Status: assessment only. Nothing in this document has been built.**

The production flowchart (Cutting → Stitching → QC → Finishing → Packing →
Dispatch) describes work that is **explicitly out of scope** for this
application. This document maps every stage of it onto the tables, fields and
screens it would need, so the decision to build it — or not — can be made
against real numbers rather than an impression.

It changes no schema and no code. `npm run verify:scope` still passes.

---

## 1. Why this is a decision and not a task

The application ends at Cutting Issue, and that boundary is enforced in three
places rather than merely stated:

| Where | What it does |
|---|---|
| `server/prisma/verify-scope.js` | Fails the build if any of fifteen named modules appears in `schema.prisma` — including as a stray column name |
| `README.md` | Opens with "no table, no route, no menu item, no placeholder" |
| `docs/EXCEL-RECONCILIATION.md` §16 | Lists every workbook column deliberately not implemented, with its reason |

Eight of the flowchart's stages are on that forbidden list by name:

| Flowchart stage | Guard entry | Workbook sheet |
|---|---|---|
| Stitching Department, Stitching of Bags / Straps | Stitching Record | Stitching Record, Hourly Monitoring |
| Quality check of Bags / Straps | Internal Quality Check, QC Defects | QC Size, QC Defects, Internal Quality Check |
| Quality Check of Final Stitched bags | Internal / Final Checker Report, Finished Checker | Internal / Final Checker Report, Finished Checker |
| Rework | Alter Report, Spot Rectification-Scrap | Alter Report, Spot Rectification-Scrap |
| Wastage | Rejected | Rejected |
| Third Party Quality Check | External Secondary Checking | External Secondary Checking |
| Primary / Secondary Packaging | Packing | Packing |
| Needle checking | Needle Checking | Needle Checking |
| Dispatch | Dispatch | Dispatch, Reconciliation Report |

So the first commit of this work is not a model. It is deleting or rewriting
the guard, and amending the README's central claim. That is worth doing
deliberately, in one commit, with the reason recorded — not as a side effect of
adding a stitching table.

---

## 2. The one decision everything else follows from

**After Cutting Issue, what is the unit of work?**

Everything up to and including Cutting Issue is measured in *fabric*: metres on
a roll, tracked roll by roll, with `stock_ledger` as the source of truth. A
cutting challan issues **cutting pieces** to a stitching unit and the pipeline
stops there.

Everything in the flowchart after it is measured in *bags*. Between the two
there is a unit of work the schema does not currently have, and every table
below hangs off it:

```
CuttingIssue  ──issues──▶  [ ??? ]  ──becomes──▶  stitched bags ──▶ cartons
                              │
                    every stage below attaches to this
```

Three candidates, and the choice is not obvious:

| Option | The unit | Consequence |
|---|---|---|
| **Bundle / lot** | A batch of cut pieces moving together, numbered | Matches how a factory floor actually works — a bundle is handed to an operator and comes back. Every QC, alter and packing row references a lot. One new model, referenced everywhere. |
| **Per-piece** | Each bag individually | Only justified if bags are serialised. Needle checking and third-party QC suggest per-piece records exist at the end, but almost certainly as counts, not identities. Very high row volume. |
| **Per-challan** | The cutting issue itself is the unit | Cheapest — no new model. But a challan is issued once and stitched over days by several operators, so hourly monitoring and per-operator records have nowhere to attach. |

**The bundle is the right answer if hourly monitoring is real**, because
"how many did this operator finish this hour" needs something smaller than a
challan to count against. The flowchart does not settle it, and it should be
settled with Vinay ji before anything is modelled.

A second structural point the flowchart makes explicit: **bags and straps are
two parallel streams that converge.**

```
Cutting of Bags  ──▶ Stitching of Bags  ──▶ QC ─┐
                                                ├──▶ Stitching of Bags and straps ──▶ QC
Cutting of Straps ──▶ Stitching of Straps ──▶ QC ┘
        └──▶ (re-cut to the size of bags)
```

That is an assembly relationship — two components with their own cut, stitch
and QC history, joined into one finished bag. `StyleBomLine` already describes
what a bag is made of, so the lot model needs a component discriminator
(`BAG` / `STRAP`) and a join step, or the two streams cannot be reconciled
against each other.

---

## 3. Stage-by-stage mapping

Each row is a flowchart node, the workbook sheet behind it, and what it would
need. Field lists are indicative, not final — the workbook columns are the
authority and would be reconciled the way §16 of EXCEL-RECONCILIATION.md
reconciles everything else.

### 3.1 Stitching

| Node | Model | Key fields | Notes |
|---|---|---|---|
| Stitching Department (receipt of cut pieces) | `ProductionLot` | `lotNo`, `cuttingIssueId`, `component` (BAG/STRAP), `styleId`, `orderId`, `pcsIn`, `unitId`, `stage` | The unit of work from §2 |
| Stitching of Bags / Straps | `StitchingRecord` | `lotId`, `operatorEmployeeId`, `operation`, `date`, `pcsCompleted`, `pcsRejected`, `firmName` | `Employee` and `StitchingUnit` master already exist |
| — (not on the flowchart, but on the sheet) | `HourlyMonitoring` | `stitchingRecordId`, `hour`, `pcsCompleted`, `target` | Only meaningful if the lot is the unit — see §2 |
| Cutting of Straps as per the size of Bags | *(no new model)* | — | A second `StitchingRecord` operation, or a re-cut lot |
| Stitching of Bags and straps | `LotAssembly` | `bagLotId`, `strapLotId`, `outputLotId`, `pcsAssembled` | The convergence in §2 |

New master lists required: `Operation`, `InformTo`.

### 3.2 Quality

The workbook has **six** separate QC sheets. The flowchart has three QC points
(bags, straps, final) plus a third-party check. This is the place where the
existing codebase suggests a different shape from the workbook.

> **Precedent.** Job Work already collapses four workbook processes — dyeing,
> printing, washing, finishing — into **one** `DyeIssue` register with a
> `process` discriminator, and the UI retitles itself per process. The same
> argument applies here with more force: six QC tables would be six places to
> get a defect count wrong.

**Recommended shape — one register:**

| Model | Key fields |
|---|---|
| `QualityCheck` | `checkNo`, `lotId`, `checkpoint` (enum), `checkedByEmployeeId`, `date`, `pcsChecked`, `pcsPassed`, `pcsRejected`, `pcsForAlter`, `decision`, `isLocked` |
| `QualityDefectLine` | `qualityCheckId`, `defectType`, `qty`, `severity` |

`checkpoint` covers: `BAG`, `STRAP`, `FINAL_STITCHED`, `INTERNAL`,
`FINAL_CHECKER`, `FINISHED`, `EXTERNAL_SECONDARY`, `THIRD_PARTY`.

`DefectType` master list **already exists** and is seeded. New master lists
required: `StatusQC`, `RejectReason`, `InspDefect26` (the 26-defect
inspection grid), `SentFor`.

**Fabric Scrutiny is the model to copy.** It already does findings → decision →
lock → amend-with-trail, which is exactly the shape a QC record needs, and it
is the one existing module with a Director's decision that locks a record.

### 3.3 The three outcomes of a failed check

The flowchart shows two arrows off a failed check — **Rework** and **Wastage** —
and the workbook has three sheets for them. They are genuinely different events
and should not collapse:

| Outcome | Model | Why separate |
|---|---|---|
| Rework / alter | `AlterRecord` | The piece comes back. Needs a return path and a re-check, so it carries state. |
| Spot rectification / scrap | `SpotRectification` | Fixed in place. No return path, but consumes time and material. |
| Wastage / rejected | `RejectedRecord` | The piece is gone. Terminal, and the one that has to reconcile against the order quantity. |

The **rework loop is the hard part of this whole scope.** A piece that fails,
is altered and passes must not be counted twice in "pieces passed", and must
not silently inflate the order fulfilment. Whatever is built needs one rule,
in one place, for what a lot's piece count means after a rework round — the
same discipline `effectiveQty` and `plannedQty` already have.

### 3.4 Finishing, packing, dispatch

| Node | Model | Key fields | Notes |
|---|---|---|---|
| Ironing, Moisture Dryout | `FinishingRecord` | `lotId`, `process` (IRONING/MOISTURE_DRYOUT), `date`, `pcsIn`, `pcsOut`, `byEmployeeId` | One register, two processes — the Job Work pattern again |
| Third Party Quality Check | `QualityCheck` with `checkpoint = THIRD_PARTY` | plus `agencyName`, `reportRef` | Not a new table |
| Primary Packaging | `PackingRecord` | `packNo`, `lotId`, `level` (PRIMARY/SECONDARY), `cartonNo`, `pcsPacked`, `netWeight`, `grossWeight`, `dimensions` | One register, two levels |
| Needle checking | `NeedleCheckRecord` | `packNo` or `lotId`, `date`, `byEmployeeId`, `result`, `machineRef` | A compliance record — buyers audit it, so it must be immutable once passed |
| Secondary Packaging | `PackingRecord` (`level = SECONDARY`) | `parentPackId` | Cartons into shippers |
| Dispatch | `Dispatch` | `dispatchNo`, `orderId`, `containerNo`, `date`, `cartons`, `invoiceNo`, `transporter`, `vehicleNo`, `status` | `ContainerNo` master already exists |
| — | `ReconciliationReport` | `orderId`, `orderedQty`, `cutQty`, `stitchedQty`, `passedQty`, `rejectedQty`, `packedQty`, `dispatchedQty`, `variance` | The closing report — derived, not entered |

New master lists required: `StatusDispatch`, `StatusRecon`, `YesNo`.

---

## 4. What has to change in existing code

Not new tables — these are edits to things that already work, and they are the
part most likely to be underestimated.

| File | Change |
|---|---|
| `prisma/verify-scope.js` | Delete, or invert into an allow-list. This is the commit that opens the scope. |
| `prisma/schema.prisma` — `DocumentType` | Add ~10 values. Drives `DocumentSequence`, `ApprovalHistory`, `DocumentAmendment` and `StockLedger` back-references. |
| `prisma/schema.prisma` — `RollStage` | `CONSUMED` is currently terminal. Cut pieces continuing into stitching needs either a new enum or a separate lot stage. |
| `seed/data/rbac.js` — `MODULES` | Add ~10 modules × 6 actions ≈ 60 permissions, plus role grants. |
| `seed/data/masterLists.js` | The nine deferred lists named in EXCEL-RECONCILIATION.md §16. |
| `services/approvalEngine.js` — `REGISTRY` | Any new approvable document (QC decisions, dispatch) joins the same state machine. |
| `services/report.service.js` | The brief's report list is "one per implemented module" — ~10 more reports. |
| `config/auditedTables.js` | Every new table needs its label and route, or its trail has a hole. |
| `client/src/config/navigation.js` | A new nav group; the sidebar is already 27 links across 9 groups. |
| `README.md` | The scope claim, the pipeline diagram, the phase table. |

### Stock is the sharpest question

`stock_ledger` is currently append-only and fabric-only, and rule 4 of the
README is that stock is derived and never overwritten. Post-cutting WIP is
**bags at a stage**, not metres on a roll.

Two options, and this needs deciding before any table is written:

- **Extend the ledger** to finished-goods items. Keeps one source of truth, but
  every existing inventory screen, report and the reconcile routine has to cope
  with a second kind of item.
- **A separate WIP ledger** for lots. Leaves fabric inventory untouched, but
  creates a second place that answers "how much of this exists", which is
  exactly what rule 4 exists to prevent.

---

## 5. Open questions — none of these can be guessed

1. **What is the unit of work?** (§2) Bundle, piece or challan. Everything
   else depends on it.
2. **Are the first three flowchart nodes in this system at all?** "Sales Order
   (Prom.ct)", "PO (Prom.ct)" and "ORN (Prom.ct)" appear to name another
   application. If those live in Promact, the integration boundary needs
   defining before the flow can start.
3. **The note reading "…seams variation is accepted & payment is made…"** could
   not be read with confidence from the flowchart. It appears to be a
   tolerance-and-payment rule for stitching, which would make it an
   `excess_rules` row rather than code — but it needs restating before it is
   modelled.
4. **Six QC sheets or one register?** (§3.2) The Job Work precedent says one.
   The workbook says six. QC must confirm which reflects how they actually work.
5. **How does a reworked piece count?** (§3.3) The rule for piece counts across
   a rework round.
6. **Does hourly monitoring exist in practice**, or is it an aspiration on the
   sheet? It is the single highest-volume table in this scope.
7. **Who approves what?** The Director is the final gate everywhere up to
   Cutting Issue. Dispatch and third-party QC almost certainly need the same,
   but the flowchart does not say.
8. **Finished-goods stock: extend or separate?** (§4)

---

## 6. If it were built, in what order

Each stage is independently useful and independently shippable. Nothing here
requires the whole thing to land at once.

| Step | Contents | Depends on |
|---|---|---|
| 0 | Open the scope: guard, README, `DocumentType`, permissions, master lists | Q1, Q2 |
| 1 | `ProductionLot` + assembly — the unit of work and the bag/strap convergence | Q1 |
| 2 | Stitching + hourly monitoring | 1, Q6 |
| 3 | `QualityCheck` register + defect lines, all checkpoints | 1, Q4 |
| 4 | Alter / spot rectification / rejected, and the rework counting rule | 3, Q5 |
| 5 | Finishing (ironing, moisture dryout) | 1 |
| 6 | Packing, primary and secondary | 1, Q8 |
| 7 | Needle checking | 6 |
| 8 | Dispatch | 6, Q7 |
| 9 | Reconciliation report | all |

**Rough size.** Roughly 13 new models, ~60 permissions, ~10 reports, ~15
screens, plus the existing-code edits in §4. For comparison, phases 12–16
(Fabric Issue through Cutting Issue) are 8 models and 12 screens. This scope is
**larger than everything built after GRN**, and its riskiest parts — the rework
loop and the WIP stock question — have no equivalent in what exists.

---

## 7. What was done instead

The two flowcharts that *are* in scope — procurement and planning — were
checked node by node against the code. Both are implemented, with two gaps
found:

- **Fixed.** "Remaining fabric is rolled back to the inventory" did not work.
  A Fabric Issue with `purpose = RETURN` posted a ledger **OUT** and subtracted
  from the roll, so returning cloth removed it from stock twice — and the
  availability check refused a return off a roll already fully issued, which is
  precisely the case the feature exists for. A return is now an inward
  movement. See `services/fabricIssue.service.js`.
- **Open.** "Assessment of Fabric and other raw material availability" — the
  first step of the planning flow. `planning.service.js` never reads stock, so
  a planner cannot see what fabric is on hand while building a plan.
