# Use Case Diagram

Who uses this system, and what each of them can actually do.

The actors are the nine seeded roles in `prisma/seed/data/rbac.js`, not job
titles someone imagined. Every association drawn below is a permission the
seeder really grants, and every one of them is checked again by `can()` on the
API route — so this document and the running application can be compared line
by line rather than taken on trust.

- [Actors](#actors)
- [The diagram](#the-diagram)
- [The Director's use cases](#the-directors-use-cases)
- [«include» and «extend»](#include-and-extend)
- [Actor × use case matrix](#actor--use-case-matrix)
- [Use case detail](#use-case-detail)

---

## Actors

| Actor | Role code | In the workbook | What they own |
|---|---|---|---|
| **Admin** | `ADMIN` | — | Everything, plus users, roles and the master lists |
| **Head Office** | `HEAD_OFFICE` | "Role Acess – Master Lists" | The List Masters and the record masters. Read-only on transactions |
| **Merchandising & Planning** | `MERCHANDISING` | "Order" / "Planning" | Buyer orders, and the plans raised against them |
| **Planning GM** | `PLANNING_GM` | Vinay ji (GM) | Planning end to end; submits plans to the Director |
| **Store & Cutting Manager** | `STORE_MANAGER` | Ravi Prajapat · Maharaj Singh | Procurement, the store, job work — and the cutting floor |
| **QC** | `QC` | Sunita Devi, Rekha Sharma | Records the Fabric Scrutiny Report. The decision is not theirs |
| **Director** | `DIRECTOR` | Dinesh Sir | Final authority everywhere. Sees everything, edits nothing |

**Offstage parties.** The Buyer and the Vendor / Job Worker drive the process
but hold no login. They appear in the system only as master records and as the
counterparties named on documents, so they are drawn outside the boundary
without an association — a use case diagram that gave them one would claim an
access path that does not exist.

---

## The diagram

```
                            ┌────────────────────────────────────────────────────┐
                            │             SHEKHAWATI IMPEX ERP                   │
                            │                                                    │
   (Buyer)  ·············▶  │   ┌──────────────────────────────────────────┐     │
    offstage                │   │  MASTERS                                 │     │
                            │   │   Maintain list masters                  │     │
   ┌────────────┐           │   │   Maintain buyers / vendors / employees  │     │
   │Head Office ├───────────┼──▶│   Maintain styles and BOM                │     │
   └────────────┘           │   │   Maintain excess rules                  │     │
                            │   │   Maintain tolerance versions            │     │
                            │   └──────────────────────────────────────────┘     │
   ┌────────────┐           │   ┌──────────────────────────────────────────┐     │
   │Merchandiser├───────────┼──▶│  Raise a buyer order                     │     │
   └────────────┘           │   │  Request an excess above the rule ········┼────▶ Director
                            │   └──────────────────────────────────────────┘     │
   ┌────────────┐           │   ┌──────────────────────────────────────────┐     │
   │  Planning  ├───────────┼──▶│  Prepare a plan                          │     │
   │  Operator  │           │   │  Submit a plan for approval ··············┼────▶ Director
   └────────────┘           │   └──────────────────────────────────────────┘     │
   ┌────────────┐           │   ┌──────────────────────────────────────────┐     │
   │Planning GM ├───────────┼──▶│  Own planning end to end                 │     │
   └────────────┘           │   │  Raise a plan approval (versioned)       │     │
                            │   │  Rectify a rejected plan into version n+1│     │
                            │   └──────────────────────────────────────────┘     │
   ┌────────────┐           │   ┌──────────────────────────────────────────┐     │
   │   Store    ├───────────┼──▶│  Record a vendor quotation               │     │
   │  Manager   │           │   │  Raise a purchase order                  │     │
   └─────┬──────┘           │   │  Record and clear a gate pass            │     │
         │                  │   │  Book a GRN (stock exists on posting)    │     │
         │                  │   │  Raise a job work order                  │     │
         │                  │   │  Receive a job work return               │     │
         │                  │   │  Reconcile stock against the ledger      │     │
         │                  │   └──────────────────────────────────────────┘     │
         │                  │   ┌──────────────────────────────────────────┐     │
         └──────────────────┼──▶│  THE CUTTING FLOOR                       │     │
                            │   │   Issue fabric against a challan line    │◀────┼──┐
   ┌────────────┐           │   │   Raise a cutting challan                │     │  │
   │  Cutting   ├───────────┼──▶│   Post a cutting issue  (the last act)   │     │  │
   │ Supervisor │           │   └──────────────────────────────────────────┘     │  │
   └────────────┘           │   ┌──────────────────────────────────────────┐     │  │
                            │   │  Record a fabric scrutiny report         │     │  │
   ┌────────────┐           │   │   defects by category, roll by roll      │     │  │
   │     QC     ├───────────┼──▶│  Submit the findings ·····················┼────▶ Director
   └────────────┘           │   └──────────────────────────────────────────┘     │  │
                            │   ┌──────────────────────────────────────────┐     │  │
   ┌────────────┐           │   │  APPROVE / REJECT  (11 document types)   │     │  │
   │  Director  ├───────────┼──▶│  Decide a fabric scrutiny                │     │  │
   └────────────┘           │   │  Authorise an excess                     │     │  │
                            │   │  Work the cross-module approval queue    │     │  │
                            │   └──────────────────────────────────────────┘     │  │
                            │   ┌──────────────────────────────────────────┐     │  │
   ┌────────────┐           │   │  Run a report · export CSV               │     │  │
   │   Admin    ├───────────┼──▶│  Administer users and roles              │     │  │
   └────────────┘           │   │  Read the audit trail                    │     │  │
                            │   └──────────────────────────────────────────┘     │  │
                            └────────────────────────────────────────────────────┘  │
                                                                                    │
   (Vendor / Job Worker) ·············· returns the lot, is named on the document ───┘
    offstage
```

Dotted lines are hand-offs, not associations: the actor at the arrow head is
the one who must act next, and the document sits in `PENDING_APPROVAL` until
they do.

---

## The Director's use cases

One actor carries almost every gate in the pipeline, which is a fact about the
business and not an accident of the model. Drawing it separately is the only
way the rest of the diagram stays readable.

```
                              ┌──────────────────────┐
                              │       Director       │
                              └──────────┬───────────┘
                                         │
        ┌────────────┬────────────┬──────┴─────┬────────────┬────────────┐
        ▼            ▼            ▼            ▼            ▼            ▼
  Authorise an  Approve a   Authorise a   Approve a    Decide a     Approve a
  order excess  plan        quotation     purchase     fabric       plan
                                          order        scrutiny     approval
        │            │            │            │            │            │
        └────────────┴────────────┴─────┬──────┴────────────┴────────────┘
                                        │  «include»
                                        ▼
                          ┌──────────────────────────────┐
                          │  Record the decision in the  │
                          │  approval trail              │
                          │  (transition() — the only    │
                          │   writer of workflowState)   │
                          └──────────────────────────────┘
```

Two constraints the diagram cannot draw, both enforced in code:

- **Maker ≠ checker.** `domain/makerChecker.js` refuses a decision taken by the
  person who raised the document.
- **The Director edits nothing.** The role holds `*.VIEW`, `*.EXPORT` and
  `*.APPROVE`, and no CREATE, EDIT or DELETE anywhere.

---

## «include» and «extend»

```
  Raise a purchase order ──«include»──▶ Resolve the category tolerance version
                         ──«include»──▶ Check the style requirement ceiling
                         ──«extend»───▶ Request an excess authorisation
                                        (only when the ceiling is exceeded)

  Book a GRN             ──«include»──▶ Post the stock ledger IN
                         ──«include»──▶ Create the fabric rolls
                         ──«extend»───▶ Refuse on a cumulative tolerance breach

  Issue fabric           ──«include»──▶ Post the stock ledger OUT
                         ──«extend»───▶ Transfer to a vendor location
                                        (only when it goes to a job worker)
                         ──«extend»───▶ Consume a cutting challan line
                                        (only when it goes to cutting)

  Receive a job work     ──«include»──▶ Compute shrinkage against the rule
  return                 ──«extend»───▶ Demand a fabric scrutiny
                                        (only when the return is out of standard)

  Approve a plan         ──«extend»───▶ Rectify into version n+1
  approval                              (only on rejection)
                         ──«include»──▶ Demote the previous current version

  Post a cutting issue   ──«include»──▶ Run all ten verifications
                         ──«include»──▶ Post the ledger OUT and the remainder IN
                         ──«include»──▶ Lock the document permanently
                         ──«extend»───▶ Consume an excess authorisation
                                        (only when the plan quantity is exceeded)

  Any approval decision  ──«include»──▶ Write the approval trail
```

An «extend» here means exactly what it says: the base use case completes
without it, and the condition in brackets is the one that pulls it in.

---

## Actor × use case matrix

Derived from the role patterns in `prisma/seed/data/rbac.js` expanded against
the permission rows the seeder actually generates — not from the role
descriptions, which are prose.

**V** view · **C** create · **E** edit · **D** delete · **A** approve ·
**X** export · **·** no access.

| Module | Admin | Head Office | Merch | Plan Op | Plan GM | Store Mgr | Cutting Sup | QC | Director |
|---|---|---|---|---|---|---|---|---|---|
| List masters · Excess rules · Tolerances | VCEDX | VCEDX | V | V | V | V | V | V | VX |
| Buyers | VCEDX | VCEDX | V | V | V | V | V | V | VX |
| Vendors | VCEDX | VCEDX | V | · | · | V | · | · | VX |
| Employees | VCEDX | VX | · | · | · | V | V | V | VX |
| Styles & BOM | VCEDX | VCEDX | V | V | V | V | V | V | VX |
| Buyer order | VCEDAX | V | VCEX | V | V | V | V | V | V**A**X |
| Planning | VCEDAX | · | V | VCEX | VCED**A**X | V | V | · | V**A**X |
| Vendor quotation | VCEDAX | · | · | · | · | VCEX | · | · | V**A**X |
| Purchase order | VCEDAX | V | · | · | · | VCEX | · | · | V**A**X |
| Gate pass | VCEDAX | · | · | · | · | VCEX | · | · | V**A**X |
| GRN | VCEDAX | · | · | · | · | VCEX | · | V | V**A**X |
| Inventory | VX | V | · | · | V | VX | V | · | VX |
| Stock ledger | VX | · | · | · | V | VX | · | · | VX |
| Fabric roll | VCEDX | · | · | · | · | VCEX | V | V | VX |
| Fabric issue | VCEDX | · | · | · | V | VCEX | VCEX | · | VX |
| Job work (dye issue) | VCEDAX | · | · | · | · | VCEX | · | · | V**A**X |
| Printing | VCEDX | · | · | · | · | VCEX | · | · | VX |
| Dyeing receipt | VCEDX | · | · | · | · | VCEX | · | V | VX |
| Fabric scrutiny | VCEDAX | · | · | · | · | V | · | VCEX | V**A**X |
| Plan approval | VCEDAX | · | · | VCX | VCEX | V | V | · | V**A**X |
| Cutting issue | VCEDAX | · | V | V | V | VCE**A**X | VCE**A**X | · | V**A**X |
| Cutting challan | VCEDAX | · | V | V | V | VCEX | VCEX | · | V**A**X |
| Reports | VX | VX | V | V | VX | VX | V | V | VX |
| Users · Roles | VCEDX | · | · | · | · | · | · | · | VX |
| Audit trail | VX | · | · | · | · | · | · | · | VX |

Three rows earn a note:

- **Excess Rules and Tolerances share the List Master's permission.** Every
  operational role can therefore *read* them — which is intended, because a
  store keeper needs to know the limit being applied to them — and only Head
  Office and Admin can change one.
- **Cutting issue is the one place an operational role holds APPROVE.** Posting
  a challan is guarded by `CUTTING_ISSUE.APPROVE` rather than `EDIT`, because it
  is the point of no return in the whole application and deserves the authority
  of an approval. The supervisor who cuts the cloth is the one who posts it.
- **Cutting challan is raised on the floor and authorised above it.** The Store
  Manager creates and edits; only the Director
  approves, like every other authorisation in the system. `assertNotSelfApproval`
  refuses a raiser who tries to approve their own in any case.

> Until recently the last two rows of this table could not be filled in at all:
> `CUTTING_CHALLAN` was missing from `MODULES` and `DYE_ISSUE` from
> `APPROVABLE`, so the permissions their routes demanded were never generated
> and only ADMIN could reach either. Both are fixed, and
> `test/rbac.rules.test.js` now fails the build if any route ever again demands
> a permission the seeder does not issue. See
> [APPLICATION-FLOW.md](APPLICATION-FLOW.md#7-screen-route-permission).

---

## Use case detail

The five that carry the most rule, in the usual form.

### UC-01 · Raise a buyer order

| | |
|---|---|
| **Primary actor** | Merchandising & Planning |
| **Preconditions** | The buyer and the style exist and are active |
| **Main flow** | Enter buyer, style, quantity, delivery. The server derives `effectiveQty`; the browser multiplies nothing. |
| **Extension** | An excess above the resolved rule raises an excess approval for the Director |
| **Guarantee** | The order exists at a quantity nobody typed twice, and no downstream document can exceed it without an approved excess |

### UC-02 · Prepare and approve a plan

| | |
|---|---|
| **Primary actors** | Merchandising & Planning / Planning GM prepare · Director approves |
| **Preconditions** | An approved buyer order |
| **Main flow** | Allocate order quantity across units, sizes and containers; submit; the Director approves |
| **Rule** | `plannedQty ≤ orderQty × (1 + APPROVED excess)`, checked on every write **and** again at approval, because either side can move in between |
| **Guarantee** | No plan can commit the factory to more than the buyer bought |

### UC-03 · Book a GRN

| | |
|---|---|
| **Primary actor** | Store & Cutting Manager |
| **Preconditions** | An approved purchase order; a cleared inward gate pass |
| **Main flow** | Record what arrived, roll by roll. In one transaction the GRN, the fabric rolls and the ledger IN are written and the balances re-derived |
| **Extension** | Cumulative receipts beyond the frozen receipt tolerance are refused — three 1% deliveries against a 2% limit are caught |
| **Guarantee** | There is no moment at which the goods have arrived and the stock does not exist |

### UC-04 · Decide a fabric scrutiny

| | |
|---|---|
| **Primary actors** | QC records · Director decides |
| **Preconditions** | A job work return the shrinkage rule flagged as out of standard (C4) |
| **Main flow** | QC records defect lines by category, roll and quantity. The Director returns ACCEPT, REWORK or REJECT. The report then locks |
| **Rules** | REWORK or REJECT without a defect line is refused by the service **and** by a database trigger. Amending a locked report keeps a before/after set |
| **Guarantee** | A verdict on cloth is always attributable, always evidenced, and never quietly edited |

### UC-05 · Post a cutting issue

| | |
|---|---|
| **Primary actor** | Store & Cutting Manager (`CUTTING_ISSUE.APPROVE`) |
| **Preconditions** | An approved plan version, an approved cutting challan, and a posted fabric issue against its line |
| **Main flow** | Ten verifications run — all of them, every time, none short-circuiting — then the ledger is posted and the document locked |
| **Rules** | `issued = consumed + remainder + wastage`, with wastage typed rather than inferred. OUT covers the full issued quantity; the remainder returns IN on the same roll |
| **Guarantee** | Nothing is cut that the order, the plan, the approval, the process and the stock do not all agree on — because there is nothing after this to correct it with |

---

See also: [APPLICATION-FLOW.md](APPLICATION-FLOW.md) for the order these
happen in, and [BUSINESS-CONTROLS.md](BUSINESS-CONTROLS.md) for the twelve
things the system must prevent and where each is enforced.
