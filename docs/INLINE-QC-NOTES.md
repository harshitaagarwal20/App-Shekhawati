# Phase 3: Inline QC

Inline QC runs **beside stitching**, not after it. A checker walks the line
while the tailors work, so it sits in the Stitching menu next to Stitching
Record and Hourly Monitoring. It moves no pieces: nothing in stitching,
ironing, External QC or the Alteration Unit waits on it or counts it.

## What was built

| Screen | Route | Table | Permission |
|---|---|---|---|
| Inline QC (one screen, Check Type toggle Size / Workmanship) | `/inline-qc` | `inline_qc_entries` | `INLINE_QC.*` |
| QC Action Needed | `/inline-qc/actions` | `inline_qc_defects` | `INLINE_QC.VIEW` (resolving: see below) |

The workbook's **QC Size** and **QC Defects** sheets are the same row except
for Operation and Size, so they are one register with a Check Type rather
than two tables. The API is under `/api/inline-qc`. The rules are in
`server/src/domain/inlineQc.js` and `server/src/services/inlineQc.service.js`.

## The fields

| Field | How it is filled | Rule |
|---|---|---|
| Check Type | Toggle | Size or Workmanship |
| Date | AUTO (today) | Can be moved back, never forward |
| Tailor | DROPDOWN | Active employees, Designation **Tailor**, Unit / Line a stitching unit |
| Unit | AUTO | The tailor's Unit / Line, stored on the entry |
| Order No, Style | DROPDOWN | Orders and styles with cutting **posted** to that unit (the same list stitching uses) |
| Operation | DROPDOWN, **Operation** list | Size checks only; required there, cleared on Workmanship |
| Size measurement | MANUAL | Size checks only; required there, cleared on Workmanship |
| Pcs Checked | MANUAL | More than 0, and no more than the cut pieces issued to the unit |
| Pcs Rejected | MANUAL | 0 to Pcs Checked |
| Defects Found | MULTI-SELECT, **Defect Type** list | Required when Pcs Rejected is above 0 |
| Inform To | DROPDOWN | A login holding `INLINE_QC.RESOLVE`. Required when any defect is chosen |

The pieces and Size/Operation rules are also `CHECK` constraints in the
database. Tailor, order and style are fixed once a check is saved, because
they define the check. Everything else can be edited.

## Action needed

- Each defect on a check is its own line on the Inform To person's **Action
  needed** list. They also get an in-app notification.
- **Only that person can mark it Resolved**, with an optional note on what was
  done. Admin can too, so a line is never stuck with someone who has left. The
  checker who found it cannot, and neither can another supervisor.
- **Reopen** undoes a Resolved marked by mistake. The audit log keeps both.
- An edit keeps resolved defects resolved, removes defects that were taken
  off, and adds new ones as Open.
- Changing Inform To moves the open defects to the new person and notifies
  them.
- Deleting a check (Admin) removes its defects from the list.

## Roles

| Role | Inline QC |
|---|---|
| **QC** (the workbook's "QC Dept (Checker)") | View, create, edit, export. No delete. Not tied to a unit |
| **Stitching Supervisor** | View, export, **Resolve**. Sees only their own unit's checks, plus anything sent to them |
| Director, Merchandising, Store Manager | View, export |
| Admin | Everything |

`INLINE_QC.RESOLVE` is the only permission outside the standard five
actions. It controls **who appears in Inform To**. To let a QC Head or
Production Manager be informed, give their role this permission on the Roles
screen. Admin-only logins are left out of the dropdown on purpose.

A supervisor's unit is the Unit / Line on their Employee record, the same rule
as the stitching screens. The Inform To dropdown suggests the tailor's own unit
supervisor first, and the checker can choose someone else.

## Audit log and Excel export

- Both tables are audited (`inline_qc_entries`, `inline_qc_defects`). Every
  defect line added, removed, resolved or reopened is in the trail.
- **Export CSV** on each screen gives:
  - `inline-qc`: one row per check, with the workbook's columns in its order.
    Defects Found is one cell, separated by `;`.
  - `inline-qc-actions`: one row per defect, with status, who resolved it,
    when and the note.
- A supervisor's file is limited to their unit, the same as their screen.

## Deploying

There is one migration, `20261021000100_inline_qc`. It creates the two
tables, the constraints, the six permissions and their grants, and the
**Operation** list (Body Stitch, Handle Attach, Hemming, Label Attach, Lupi
Stitch, Gusset Stitch, Final Trim). It is idempotent, and `db:deploy` is all
it needs. **Do not seed production.**

After deploying:

- Make sure tailors are on the Employee Master with Designation **Tailor** and
  Unit / Line set to their unit. The Stitching phase already needs this.
- Make sure each supervisor's login is linked to their Employee record and has
  the Stitching Supervisor role. That is what puts them in Inform To.

## Open points

1. **Workbook "Inform To" values.** The workbook lists job titles: Unit
   Incharge, QC Head, Supervisor, Production Manager, Dinesh Sir. A job title
   has no Action needed list, so Inform To names a person instead. If QC Head
   or the Production Manager should be informed, their role needs
   `INLINE_QC.RESOLVE`.
2. **Pcs Checked vs. stitched.** A check is capped by the cut pieces issued to
   the unit, not by what has been stitched, because checks happen during the
   day before the stitching record is entered.
3. **Rejected pieces go back to the tailor.** Inline QC does not send them to
   the Alteration Unit. If that should change, the hook already exists:
   `AlterationSource` and `syncBag()` in `alteration.service.js`.
