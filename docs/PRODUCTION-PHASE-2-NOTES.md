# Production Phase 2: Stitching and Hourly Monitoring

Phase 2 continues straight after Cutting Issue. Phase 1 behaviour is unchanged:
no existing rule, screen or permission was altered, except that the scope guard
now permits these two modules.

## What was built

| Screen | Route | Table | Permission |
|---|---|---|---|
| Stitching Record | `/stitching` | `stitching_records` | `STITCHING_RECORD.*` |
| Hourly Monitoring | `/stitching/hourly` | `hourly_monitoring_entries` | `HOURLY_MONITORING.*` |
| Printing (optional) | `/stitching/printing` | `printings` (stage `AFTER_STITCHING`) | `PRINTING.*` (unchanged) |

Inline QC (Phase 3) sits in the same menu: checks are taken on the line while
stitching runs. See [INLINE-QC-NOTES.md](INLINE-QC-NOTES.md).

The API is under `/api/stitching`, and every rule lives in
`server/src/domain/stitching.js` and `server/src/services/stitching.service.js`.

## The rules, and where they are enforced

| Rule | Where |
|---|---|
| A supervisor sees and records **only their own unit**. | `unitScopeFor()`: the unit is the **Unit / Line** on the Employee record linked to the login. Every list, record, grid and CSV export is scoped by the server. |
| Admin chooses the unit. The Director and office logins can read every unit but cannot record for any. | `unitScopeFor()` |
| The Order dropdown lists only orders with cutting **posted** to the unit. | `orderOptions()`: posted, non-cancelled `cutting_issues` where `firm_name` = unit |
| **Total stitched can never exceed the cut pieces issued to that unit** (per order and style). | `assertCeiling()`, run under an advisory lock so two simultaneous saves cannot both pass. Tested. |
| Remaining = Deliverable − Actual. | Calculated by the server and held by a `CHECK` constraint. The workbook's sample row (10,000 / 900 / 100) does not satisfy it, so it was not copied. |
| Deliverable Qty is AUTO from the plan and editable. | It comes from the latest **approved STITCHING** plan's lines for the unit and date. When no approved line exists, the form asks for it to be typed. The plan's figure is stored next to it (`deliverable_from_plan`), so a typed-over target remains visible. |
| One record per unit, date, order and style. | A partial unique index. On a day that is already recorded, the form switches to editing that record. |
| No future dates. | Service |
| The hourly grid shows one row per tailor. | Tailors are employees whose Designation is **Tailor**, who are Active, and whose Unit / Line is the unit. |
| Each slot saves on its own. | `PUT /api/stitching/hourly/slot` handles one cell; clearing a cell deletes it. The audit trail keeps the old value. |
| Daily totals per tailor, per slot and per unit. | `buildGrid()` |
| A slot below the style's hourly target is shown in red. | `Style.hourly_target` (new field on the Style master). Each cell stores the target that applied when it was saved. |
| The time slots are configurable. | A **Hourly Slot** list on the Dropdown Lists screen, in sort order. It is seeded with 10:00 … 6:30. |
| Pieces out for printing are not available for later stages. | Since Ironing, printing names its **From Unit** and pieces out are held against that unit by `unitFlow.service.js`: what is still at a unit = stitched − out for printing − received at ironing. No more can be sent than that, and no more can come back than was sent (`CHECK`). See [IRONING-NOTES.md](IRONING-NOTES.md). |

## Printing after stitching is optional

Nothing in stitching or hourly monitoring requires a printing entry or waits
for one. An order with no printing entries keeps all of its stitched pieces
available. The menu labels it "Printing (optional)".

This uses the existing `printings` table (the workbook's Printing sheet), with
**Pcs Received Back** added. Rows from before stitching are untouched, and the
`printing-status` report still lists both kinds.

## Roles

A new role, **STITCHING_SUPERVISOR**, has view, create, edit and export on both
modules. It has no delete permission: a wrong count is corrected by editing it.
To make someone a supervisor:

1. Set **Unit / Line** on their Employee record to the stitching unit, exactly
   as the value appears in the Stitching Unit list.
2. Link their user to that employee and give the user the Stitching Supervisor
   role.

Director, Merchandising and Store also get view and export on both modules.

## Deploying

There is one migration, `20261020000300_stitching_and_hourly_monitoring`. It
creates the tables, constraints, permissions, role, grants and the Hourly Slot
list, and makes sure the PRINTING number sequence exists. It is idempotent
reference data, and `db:deploy` is all it needs. **Do not seed production.**

After deploying:

- Load the tailors on the Employee master: Designation **Tailor**, Unit / Line
  set to their unit.
- Set **Hourly Target** on the styles that should be highlighted.

## Open points

1. **Who sends pieces for printing after stitching?** For now it is the Store
   (which already owns `PRINTING`). If supervisors should do it, add `PRINTING.*`
   to their role.
2. ~~**Unit-level vs order-level printing.**~~ Settled by Ironing: printing
   now names the unit the pieces left.
3. **Should Actual Stitched have to match the hourly total?** It does not. The
   form shows the hourly total as a hint with a "Use it" button.
