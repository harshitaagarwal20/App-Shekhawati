# Ironing (after stitching, before final QC)

Screen: **Finishing → Ironing** (`/ironing`). API: `/api/ironing`. Rules:
`server/src/domain/ironing.js`. The shared check: `server/src/services/unitFlow.service.js`.

## How an entry works

An entry records what happened at the ironing table for one order and style
from one stitching unit: pieces **received**, **ironed** and **damaged**. Any of
the three may be zero. A delivery with nothing ironed yet is an entry, and so
is a morning's ironing of yesterday's pieces.

- **Ironer** comes from employees whose Designation is **Ironer**. It is
  required when anything is ironed or damaged; a delivery on its own needs no
  ironer.
- **Damage Type** comes from the **Ironing Damage** list (Iron Shine,
  Scorch-Burn, Water Mark). It is required when any piece is damaged.
- **Balance at Ironing** = received − ironed − damaged + re-ironed. It is
  calculated per unit, order and style, never per entry.

## The two limits

These are checked after every write to stitching, printing or ironing, under
one shared lock. A write that breaks either one is rolled back.

| Limit | Meaning |
|---|---|
| Stitched − out for printing − received at ironing ≥ 0 | Ironing cannot receive more from a unit than it stitched, less what is at the printer. This also stops a stitching count being lowered below what has already left the unit. |
| Received − ironed − damaged + re-ironed ≥ 0 | Ironed + damaged cannot exceed received. Re-ironed pieces count back toward received. This also stops a delivery being deleted after its pieces were ironed. |

## Deciding damaged pieces

Each damaged piece is decided as **Re-iron** or **Rejected**. This can be done
on the entry form or later with **Decide damage**.

- **Re-iron** puts the piece back in the balance to be ironed again.
- **Rejected** sends the pieces to the **Alteration Unit** as a bag
  (`alteration_receipts`, source `IRONING`) with reason "Ironing damage", the
  damage type, the unit and the quantity. There is one per entry, kept equal
  to the entry's rejected count; it cannot be made smaller than the Alteration
  Unit has already worked. *(Before Phase 4 these were held as pending
  rejects; the Phase 4 migration converted every one into a bag and marked it
  `TRANSFERRED`. See `PHASE-4-EXTERNAL-QC-NOTES.md`.)*
- Since Phase 4 an entry also has a **Source**: a stitching unit, **Re-iron**
  (sent back by External QC with reason Iron) or **From Alteration Unit**. Only
  a stitching unit names a From Unit; each source has its own balance.
- Undecided damage is flagged on the list, on the entry itself, and in both
  reports until it is decided.

## The cutting challan closes

The "cutting challan for that unit" is the **Cutting Issue** (CH-001…), whose
Firm Name is the unit. The C5 Cutting Challan has no unit, so it is not the one
meant here.

What a unit sends to ironing is shared across its posted challans for the order
and style, oldest first. Each challan is then marked **Not received**,
**Partially received** or **Closed**, and its received count is stored as
`pcs_received_at_ironing`. Both values are recalculated from the entries after
every write, and nothing else on a posted challan changes. They appear on the
Cutting Issue list and detail, and on the ironing entry.

A challan stays Partially received if pieces never come back from stitching,
for example pieces lost in stitching. Stitching rejects are not recorded yet.

## Printing after stitching now names its unit

To hold pieces at the printer against the right unit, printing now has a
**From Unit** field. It is required on new entries. Older after-stitching rows,
including the workbook's sample rows PR-004, PR-005 and PR-007, have no unit.
They are not counted by the flow check, because they predate stitching records
and cannot be tied to a stitched piece. Giving one a unit on the printing
screen brings it into the check. The migration marks old rows that were
already COMPLETED as fully received back.

## Reports (Reports → Stitching & Finishing)

- **Ironing – daily output**: pieces ironed per day, by ironer and order, with
  damage count, damage % (damaged ÷ (ironed + damaged)), re-iron, rejected and
  undecided.
- **Ironing – balance waiting**: per order, style and unit: stitched, out for
  printing, still at the unit, received, ironed, damaged, damage %, undecided,
  the **balance waiting**, and the challans' status.

## Roles

A new role, **FINISHING_SUPERVISOR** (Ironing & Finishing Supervisor), has view,
create, edit and export on ironing, plus Reports. It is not tied to a unit,
because ironing takes pieces from every unit. Admin has everything. Director,
Merchandising and Store can view and export.

## Deploying

There is one migration, `20261020000400_ironing`. It adds the tables, CHECKs,
permissions, role and grants; the Ironing Damage list; "Ironer" on Designation;
and "Finishing" on Department. Use `db:deploy` only.

After deploying:

- Add the ironers on the Employee master (Designation **Ironer**).
- Give the ironing desk's login the new role.

## Open points

1. **Who records ironing?** I assumed one finishing supervisor login. If a
   stitching supervisor should record ironing for their own unit, the role and
   the unit scoping need a decision.
2. **Mixed damage on one entry.** Each entry carries one damage type. Pieces
   with a different type go on a second entry.
3. **Partially received forever.** A challan cannot close until stitching
   rejects or losses are recorded somewhere (Phase 3).
