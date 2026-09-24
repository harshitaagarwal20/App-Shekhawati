# Stock valuation policy — FIFO

**Decision:** Shekhawati Impex values inventory on a **First In, First Out (FIFO)** basis, effective from the date migration `20260926000200_fifo_cost_layers` is applied.

This is permitted under Ind AS 2 / AS 2 (Inventories), which allow FIFO or weighted-average cost. The policy has to be applied consistently from one period to the next. Any change of method is a change in accounting policy and must be disclosed.

## Before this policy

The ledger held a rate and a value on every movement, but no costing policy was documented. In practice `recomputeBalance()` valued each (item, location) at the **weighted average of everything ever received there**. That figure never forgot an old price, and moving stock between locations reset its cost.

## The four rules

1. **Every receipt opens a cost layer.** A GRN (or any other inward movement that is not a transfer) opens a layer at its own inventory rate, dated with the movement's date. Table: `stock_cost_layers`.
2. **Every issue consumes the oldest layers first.** An OUT movement at an (item, location) draws down layers in order of `layer_date`, then of creation. The ledger row is valued at exactly the cost of the layers consumed. Which layers were consumed, how much of each and at what rate is recorded in `stock_layer_consumptions`.
3. **Transfers carry their cost.** Moving stock between locations (store → cutting floor, store → dye house, cutting floor → store for the unused remainder, cutting floor → remnant store) is an OUT and an IN in the same transaction. The IN carries the consumed layers with their **original dates and rates**, so a transfer never changes cost or makes stock look younger.
   - When a cutting issue returns a remainder or keeps remnants, the returned cloth carries the **newest** part of the cost that left the floor, because FIFO says the oldest cloth is what was cut.
4. **Normal process loss is absorbed.** When fabric comes back from a job worker with shrinkage, the metres returned carry the **whole cost** of the metres that left the job worker, so the loss raises the unit cost of good stock instead of being written off at cost. (Job-work charges are not yet capitalised into the layer; see the open points below.)

### One exception: GRN reversal

A GRN reversal is not an issue; it undoes one receipt. It consumes the layers **that receipt opened** first, at the receipt's own rate, and falls back to FIFO order only if some of those goods have already been issued.

## What the numbers mean

| Figure | Source |
|---|---|
| Quantity on hand | `stock_ledger`: `SUM(qty_in) − SUM(qty_out)`, unchanged |
| Stock value | `SUM(qty_remaining × rate)` over the open layers at the (item, location) |
| `stock_balances.avg_rate` | Stock value ÷ quantity: the average cost of what is **on the shelf now**, not of everything ever received |
| Cost of an issue | The ledger row's `rate` × `qty`. `stock_layer_consumptions` shows the layers behind it. |

The ledger stores the blended rate to four decimal places, and its value is `ROUND(qty × rate, 2)` (the database enforces this). The consumption rows hold each layer's exact cost, so the two can differ by at most a paisa of rounding.

## The cut-over

- The migration opened **one opening layer per (item, location) holding stock**, for exactly the quantity on hand, at exactly the weighted-average rate the system was already using. **No balance changed value on the day of the switch.**
- Opening layers are marked `is_opening = true` and show `OPENING` as their source. Each is dated with the earliest receipt at that location, so it is consumed before anything received afterwards.
- **Historic ledger rows are not re-costed.** The ledger is append-only; movements posted before the cut-over keep the values they were posted with.

## Reports

- **Reports → Stock valuation (FIFO)**: every open layer with its receipt date, age, source document, remaining quantity, rate and value. The total is the stock value.
- **Reports → Inventory**: balances by item and location. The value column now reads from the layers.

## Controls

- Layers are read and written under the same per-(item, location) advisory lock as the availability check, so two simultaneous issues cannot consume the same layer.
- `stock_cost_layers_remaining_in_range` (0 ≤ remaining ≤ qty in) refuses a layer driven negative. Layers are decremented, never overwritten.
- If an OUT ever finds too few layers to cost it (the layers have fallen out of step with the ledger, which should not happen), the uncovered quantity is valued at the caller's rate and **the ledger row's remarks say so**. It is never silently priced at zero.

## Open points for the accounts team

- **Job-work charges** (dyeing and printing rates on the job work order) are not added to the value of returned fabric. If they are to be capitalised into inventory, as Ind AS 2 permits for conversion costs, that is a further change to the job-work return.
- **Write-downs to net realisable value** are outside the system. The FIFO value is cost.
