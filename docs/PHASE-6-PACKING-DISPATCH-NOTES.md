# Phase 6: Needle Checking, Packing and Dispatch

External QC's approved pieces go through Needle Checking into size-assorted
cartons, are packed box by box, and go out order by order. Earlier phases are
unchanged except where noted under **What changed elsewhere**.

| Screen | Route | Tables | Permission |
|---|---|---|---|
| Needle Checking | `/needle-checking` | `needle_check_cartons` | `NEEDLE_DETECTION.*` |
| Packing | `/packing` | `packing_entries` | `PACKING.*` |
| Dispatch | `/dispatches`, `/dispatches/new`, `/dispatches/:id` | `dispatches`, `dispatch_lines` | `DISPATCH.*` |

The APIs are `/api/needle-checking`, `/api/packing` and `/api/dispatches`. The
arithmetic is in `server/src/domain/shipping.js`. The shared lock and check
are in `server/src/services/shippingFlow.service.js`. They use the same
order-and-style lock as External QC, because the cartons draw on External QC's
Approved.

```
External QC approved ──► Needle Checking ──► Packing ──► Dispatch
                         (order, style)      (per colour) (order)
```

| Stage | Never more than |
|---|---|
| Needle-checked | External QC approved, for the order and style |
| Packed | Needle-checked, for the order, style **and colour** |
| On a dispatch | Packed, for the order and style |

## Packets and bags

One bag holds one piece. Ten bags make a packet and ten packets make a carton,
so a full carton is 100 pieces. A style packed differently says so on the
Style master: **Bags / Packet** and **Packets / Carton**, both 10 by default.

Needle Checking and Packing show every carton or box as packets and bags,
e.g. 100 pcs = "10 pkts × 10", 95 pcs = "9 pkts × 10 + 5 bags". So do the
packing list's per-box column and its total packets. Packing's **Packing**
field fills in from packets × bags (still editable). Nothing is refused for
not being a full carton: a short carton just shows its loose bags.

The older **Qty / Ctn** on the style is no longer read by Packing.

## Needle Checking: "Size Assortment Carton"

Order No and Style are picked once, at the top of the sheet. Each row is a
number of cartons of one colour, each packed to the same size assortment.

| Field | Rule |
|---|---|
| Carton | AUTO: the run of carton numbers the row covers (1-5, 6-8 …), in row order. Worked out when read, so deleting a row renumbers the rows after it. |
| Carton Qty | MANUAL. Cartons of this assortment. |
| Color | DROPDOWN: the order's colours for the style (order lines, else the order, else the style). |
| Size 1 … Size 10 | MANUAL. Pieces of each size in **one** carton. |
| Weight | MANUAL. kg, one carton. |
| Pcs/Carton | FORMULA: Size 1 + … + Size 10, shown as packets and bags. |
| Sign. | MANUAL. Defaults to the logged-in user. |

The row passes **Pcs/Carton × Carton Qty** pieces on to packing. A row cannot
be cut or deleted below what Packing has already packed of its colour.

## Packing: "Packing Details"

One line per run of boxes.

| Field | Rule |
|---|---|
| Box No | MANUAL, e.g. 1-20. |
| OrderNo / Style No. | DROPDOWN: orders and styles Needle Checking has passed. |
| Order size | AUTO: the style's order qty. |
| Name | AUTO: the style's description. |
| Color | DROPDOWN: the colours Needle Checking passed, with what is waiting in each. |
| Packing | MANUAL. Pieces in each box. Filled from the style's packets × bags (100). Shown as packets and bags. |
| Boxes | MANUAL. |
| Qty (In pcs) | FORMULA: Packing × Boxes. |
| N.W per Box / G.W per Box | MANUAL, kg. G.W cannot be less than N.W. |
| N.W (kg) / G.W (kg) | FORMULA: per box × Boxes. |
| Dim (in cms) L / W / H | MANUAL. One box. |
| CBM | FORMULA: L × W × H ÷ 1,000,000 × Boxes. |
| Remarks | TEXT. |

A loose last box is its own line (Packing 13, Boxes 1). Total packed of a
colour never exceeds what Needle Checking passed of it.

Each line shows the dispatch it is on. A line on a **Dispatched** or
**Delivered** dispatch cannot be changed or deleted: those boxes are what its
papers say left. Set the dispatch back to Pending first if they were packed
wrong. A line on a **Pending** dispatch can be corrected, and the dispatch's
totals follow; it cannot be deleted while it is on the dispatch.

## Dispatch

One dispatch is one order.

| Field | Rule |
|---|---|
| Dispatch No | AUTO: DSP-0001. |
| Date | AUTO: today. Can be moved back, never forward. |
| Order No | DROPDOWN: orders with packed pieces not yet on a dispatch. |
| Buyer | FORMULA: from the order. |
| Container No | FORMULA: from the order's approved, current Plan Approval (Planning), else the order's own Container No. |
| Invoice No | MANUAL. |
| Total Boxes / Total Qty | AUTO: from packing. The packing lines of the order on no other dispatch, taken whole, summed one line per style. |
| Ship Mode | DROPDOWN (`L_ShipMode`): the order's (or buyer's), unless changed. |
| Carrier / AWB-BL No | MANUAL. |
| ETA | MANUAL. Not before the dispatch date. |
| Status | DROPDOWN: Pending / Dispatched / Delivered. |
| Remarks | TEXT. |

**The buyer's shipment details and address** come from the buyer and the order
and are kept on the dispatch as printed: buyer address, ship to, buyer PO,
consignee and address, notify party and address, port of discharge, final
destination, price terms and freight terms.

- A dispatch holds packing lines, not just figures: each packing line goes on
  one dispatch, whole, and the dispatch's lines and totals are those packing
  lines. Deleting a dispatch frees its packing lines for the next one.
- **Pending** means made ready but not yet left. Every save of a Pending
  dispatch takes any packing line packed since and the shipment details
  afresh, and a correction to one of its packing lines changes its totals at
  once. Once it is **Dispatched** or **Delivered** it keeps what left, and its
  packing lines are locked.
- The order becomes **Partially Shipped** or **Shipped** from its Dispatched and
  Delivered dispatches, counted against its order qty. Pending ones do not
  count. Deleting a dispatch works the status out again (back to In Progress if
  nothing is left). Completed and Cancelled orders are not touched.
- A second dispatch of the same order takes what the first did not.

### Prints (from the dispatch page)

| Print | Shows |
|---|---|
| Dispatch note | From, buyer and consignee details, container, invoice, carrier, ETA; boxes and pcs per style; receiver's acknowledgement |
| Packing list | The shipment details, then the packing lines this dispatch took: box no, style, name, colour, packing, boxes, qty, N.W, G.W, dimensions, CBM, with totals. Its totals always match the dispatch note's. |

## Roles

| Role | Can |
|---|---|
| **QC** ("QC / Packing Dept") | Own Needle Checking and Packing. No delete. |
| **MERCHANDISING** | Own Dispatch, since the shipping plan is theirs. Read and export needle checking and packing. |
| Director | View and export all three. |
| Admin | Everything, including delete. |

Every write is in the audit trail. Excel (CSV) export is on every register:
`needle-checking`, `packing` and `dispatches`.

## What changed elsewhere

- **External QC** can no longer cut its Approved below what is already
  needle-checked.
- **Buyer orders** have two new statuses, Partially Shipped and Shipped. Only
  Dispatch sets them. From them, an order can be moved by hand to Completed (or
  On Hold from Partially Shipped).
- The **Reconciliation Report** reads **Packed Pcs** from packing and
  **Dispatched Pcs** from Dispatched and Delivered dispatches. The **Rejected
  Register** shows each reject's order-and-style packed qty.
- The sidebar has a new group, **Packing & Dispatch** (stage 10).
  Reconciliation moves to stage 11, since that is where an order closes.

### Replaced before release

An earlier build of this phase put Humidity Checking and a machine-by-machine
Needle Detection (calibration, quarantine, broken-needle holds) between
External QC and Packing, and dispatched container-wise. The floor's sheets
work differently, so migration `20261023000300` removes Humidity Checking
(its tables, dropdown lists, permissions and the buyers' and styles' Max
Moisture %), the needle detector tables and the Rejected Register's Needle
Detection stage. It reshapes packing and dispatch to the sheets above. None of
it had reached production.

## Deploying

Run the five migrations with `db:deploy`:

- `20261023000100_humidity_needle_packing_dispatch` and
  `20261023000200_dispatch_sequence` create the first build's tables, the
  enum values, the DSP counter and the permissions.
- `20261023000300_needle_checking_packing_dispatch_sheets` takes them to the
  sheets above.
- `20261023000400_style_packets_and_bags` adds Bags / Packet and
  Packets / Carton to the styles, 10 and 10 for every existing style.
- `20261023000500_packing_entries_on_a_dispatch` ties each packing line to
  the dispatch it goes on. Dispatches already made take their order's packing
  lines in the order they were packed, oldest dispatch first.

**Do not seed production.**

After deploying, make sure the shipping Plan Approvals carry the Container No,
and the buyers carry their consignee, notify party, port and terms, so
dispatches pick them up.

## Open points

1. **Size 1 … Size 10 are positions, not size names.** The sheet shows the
   style's size group beside them. If the size names per position should
   print (S, M, L …), they need a size breakdown on the style or order.
2. **Needle Checking does not check colour against External QC.** External QC
   approves per order and style, not per colour, so the cartons are held to
   the order-and-style total. Packing is held per colour.
3. **A packing line goes on one dispatch, whole.** To send part of a run of
   boxes now and the rest later, enter it as two packing lines.
