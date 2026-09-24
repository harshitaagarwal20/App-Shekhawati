# Phase 1 & 2 — Implementation Notes

Shekhawati Impex ERP · Authentication / Access Control, and Masters

---

## Phase 1 — Authentication and Access Control

### Roles

The Phase 1 brief supersedes the eleven roles Phase 0 derived from the sheet
banners. Nine roles are now seeded:

| Role | Workbook banner it covers |
|---|---|
| `ADMIN` | Employee Master; everything else |
| `HEAD_OFFICE` | Master Lists, Buyer Master, Vendor Master, Style Master |
| `MERCHANDISING` | Order |
| `PLANNING_OPERATOR` | Planning\_ / Planning |
| `PLANNING_GM` | Planning + Plan Approval (Vinay ji) |
| `STORE_MANAGER` | Vendor Quotation, PO, Gate Pass, GRN, Dye issue, Dyeing Receipt, Printing — **and** Fabric Issue + Cutting Issue |
| `CUTTING_SUPERVISOR` | Fabric Issue, Cutting Issue |
| `QC` | Fabric Scrutiny Report |
| `DIRECTOR` | Dinesh Sir — approves everywhere, edits nowhere |

Two decisions this forced:

> **P1-D1 — CuttingSupervisor is created but StoreManager also holds its
> permissions.** The brief says the cutting work "will be done by StoreManager",
> so `STORE_MANAGER` is granted the full Fabric Issue and Cutting Issue sets.
> `CUTTING_SUPERVISOR` is kept as a real role for when the cutting floor gets
> its own logins; no schema change is needed to start using it.

> **P1-D2 — Printing is folded into StoreManager.** The workbook has a
> "Printing Dept (Manager)" banner, but the Phase 1 role list has no equivalent
> and the question was not answered. Printing sits with `STORE_MANAGER`, which
> already owns the neighbouring job-work register (Dye issue covers dyeing *and*
> printing job work). Splitting it out later is one entry in
> `prisma/seed/data/rbac.js` plus a role row.

`DIRECTOR` is granted `*.VIEW`, `*.EXPORT` and `*.APPROVE` and nothing else —
the approver should not be able to quietly edit the document they are approving.

### Permissions

119 permissions, generated as `MODULE.ACTION` across 24 in-scope modules.
`APPROVE` exists only on the eight modules that carry a decision in the
workbook; `INVENTORY`, `STOCK_LEDGER` and `REPORT` are view/export only because
they are projections of other documents.

Server-side enforcement is the `can('CODE')` middleware
([server/src/middleware/authorize.js](../server/src/middleware/authorize.js)),
applied on every route. `can()` throws if it is ever used on a route that has
no `authenticate` in front of it, so an unprotected route fails loudly at the
first request rather than silently allowing everyone.

### Tokens and sessions

> **P1-D3 — Short-lived JWT access token + opaque, DB-backed refresh token.**
> A bare JWT cannot be revoked, which makes "log out", "disable this account"
> and "this person changed role" unenforceable until the token expires. The
> access token is a 30-minute JWT; the refresh token is 48 random bytes whose
> **SHA-256 hash** is the only thing stored (`user_sessions`). Logging out,
> disabling an account, resetting a password or changing a role all revoke rows
> in that table and take effect on the very next request.

> **P1-D4 — Permissions are re-read from the database on every request, not
> taken from the token.** The JWT carries a permission list for the client's
> convenience, but `authenticate` ignores it and rebuilds the set from
> `user_roles → role_permissions`. A role change therefore applies immediately
> even to a token that was issued a moment earlier.

> **P1-D5 — Refresh-token rotation with reuse detection.** Every refresh
> revokes the old session and issues a new pair. Presenting an already-rotated
> token means a replay or a stolen token, so **all** of that user's sessions are
> revoked and they must sign in again.

Also implemented:

- **Forced first password change.** Every seeded and admin-created account is
  flagged `mustChangePassword`. `requirePasswordChanged` blocks the whole API
  except `/auth/me`, `/auth/change-password` and the logout routes, so the user
  can complete exactly the one action that is open to them.
- **Login rate limiting** — 10 attempts per 15 minutes, keyed on username.
  In-process and dependency-free, because the fixed stack has no rate-limit
  package or Redis. Adequate for one on-premise API process; move it to a shared
  store if the API is ever run multi-process.
- **Uniform failure message** for an unknown username and a wrong password, with
  a bcrypt comparison run either way so the two take comparable time.
- **Last-admin guard** — the final active `ADMIN` cannot be deactivated or
  deleted, and nobody can deactivate or delete their own account.

### Token storage in the browser

> **P1-D6 — Tokens in `localStorage`.** An httpOnly cookie resists XSS better,
> but needs same-site cookie handling plus a CSRF defence, and this is an
> on-premise ERP on shared factory machines rather than a public web app. The
> mitigations that actually matter here are in place: the access token lives 30
> minutes, the refresh token is revocable server-side, and **the server
> re-authorises every request** regardless of what the client believes.

### Frontend route protection

`RequireAuth` and `RequirePermission`
([client/src/routes/ProtectedRoute.jsx](../client/src/routes/ProtectedRoute.jsx))
gate navigation, and `visibleNavigation()` hides sidebar links the user cannot
open. Both are stated in code comments to be conveniences. The server refuses
the underlying request either way — the `RBAC is enforced on the server` block
in [server/test/api.test.js](../server/test/api.test.js) asserts exactly that,
by calling the API directly as a QC user and expecting 403.

---

## Phase 2 — Masters

### List Master drives every dropdown

`MasterList` / `MasterListValue` is the single source for all business
dropdowns. Two endpoints serve them:

```
GET /api/master-lists/values/:code          one list,  e.g. ColorCode
GET /api/master-lists/values?codes=UOM,GSM  several in one round trip
```

> **P2-D1 — Reading dropdown values needs no `MASTER_LIST.VIEW`.** Every screen
> in the application needs its dropdowns, so any authenticated user may read
> list values. `MASTER_LIST.VIEW/EDIT/DELETE` gate *managing* the lists. The
> alternative — granting `MASTER_LIST.VIEW` to all nine roles — would have made
> the permission meaningless.

On the client, `useMasterList(code)` / `useMasterLists([codes])`
([client/src/hooks/useMasterList.js](../client/src/hooks/useMasterList.js)) fetch
and cache per list code for the page's lifetime, so a form with eight dropdowns
makes one request rather than eight. Editing a list calls
`invalidateMasterList()` so the change shows without a reload.

**There are no hardcoded business dropdown values in the React code.** The only
`EnumSelect` uses in the client are Active/Inactive, page size, sort direction
and the role filter — none of them business data. `MasterSelect` is the only
control used for business dropdowns and it always takes a `listCode`.

> **P2-D2 — A deactivated value still renders on an existing record.**
> `MasterSelect` takes `currentValue`; if the record holds a value that has
> since been deactivated, the option is re-added and labelled `(inactive)`
> rather than the field silently blanking on edit.

### Validation: shape in Zod, membership in the database

> **P2-D3 — Dropdown membership is checked in the service layer, not in Zod.**
> Zod validates that a dropdown field is a trimmed string of the right length.
> Whether `"Olive Green"` is a valid `ColorCode` is checked against the database
> by `assertValueInList()`. List content is *data*: a value added at 09:00 must
> be accepted at 09:01 without a redeploy, which a compiled-in enum cannot do.

Failures come back as HTTP 422 with `details.fields`, shaped so the React forms
can map them straight onto inputs via `setError`.

### Auto-numbering

| Master | Rule | Source |
|---|---|---|
| Buyer | Initials of the significant words + `#` → `Trade Word` = `TWA#` | Buyer Master sheet note "Come from buyer initial letters" |
| Vendor | `VEN-001` from `DocumentSequence` | Vendor Master (Auto) |
| Employee | `EMP-001` from `DocumentSequence` | Employee Master (Auto) |
| Style | Manual — the workbook's style numbers encode buyer and range | Style Master |

Creating a vendor also **creates that vendor's PO counter**
(`DocumentSequence(PURCHASE_ORDER, scopeKey = poInitials)`), because PO IDs are
"vendor initial + no" and each vendor's series is independent. The suite asserts
this.

### Active/inactive vs delete

Both exist and mean different things:

- **Deactivate** (`PATCH /:id/status`) — the record stops appearing in
  `/options` dropdowns for new documents. Existing documents are untouched.
  This is the everyday control.
- **Delete** (`DELETE /:id`) — a soft delete, and it is **refused** if any
  document references the record. Deleting `Trade Word` returns 409 naming the
  buyer orders and styles that block it. There is also `POST /:id/restore`.

> **P2-D4 — An employee with a login cannot be deleted.** It would orphan the
> user account. The API says so and names the count.

### Style BOM

The BOM grid is edited inline with the style header.

> **P2-D5 — The Fabric BOM line's `qtyPerPc` always equals the header's
> "Avg Fabric Utilization / Pc".** The workbook has one number and the BOM adds
> a second place to put it; two places that can disagree is a defect. The
> service overwrites the fabric line's quantity from the header on every write,
> and the grid shows that cell read-only so the rule is visible rather than
> surprising. The test asserts that submitting `0.5` against a header of `0.8`
> stores `0.8`.

> **P2-D6 — Updating a style replaces its BOM wholesale, hard-deleting the old
> lines.** A BOM line is a component of the style, not a document in its own
> right, and nothing references a line id — so soft-deleting them would only
> accumulate rows the user cannot see or use.

`GET /api/styles/:id/requirement?qty=N` returns the "Order as per Style"
material requirement (Process Documentation §5), with and without wastage. The
PO module will consume it in a later phase; the Style screen surfaces it now.

### List behaviour, shared

`useResourceList` + `parseListQuery` give every master the same
search / filter / sort / paginate contract:

```
?page=1&pageSize=25&search=tote&sortBy=buyerName&sortDir=asc&status=ACTIVE
```

> **P2-D7 — `sortBy` is checked against a per-master allow-list.** An unknown
> column is ignored and the default sort is used; nothing from the query string
> reaches Prisma unvalidated. The test asserts `?sortBy=notAColumn` returns 200
> rather than erroring or sorting on an arbitrary column.

---

## Schema change in this phase

One table added, `user_sessions`
(migration `20260825000200_user_sessions`) — refresh-token hash, expiry,
revocation reason, IP and user agent, with a CHECK that a session cannot expire
before it was created. **35 models total.**

---

## Verification performed

| Check | Result |
|---|---|
| `npm run lint` (server + prisma + test + client) | **0 problems** |
| `npm run build` (Vite production build) | **clean**, 120 modules |
| `prisma validate` | schema valid, 35 models |
| `npm run verify:scope` | no out-of-scope module in the schema |
| `npm run verify:seed` | all cross-references resolve |
| API boot + route smoke test | 401 unauthenticated · 422 validation · 503 when the DB is down · health reports correctly |

**Not yet run:** `npm test --workspace server`. The suite is written
([server/test/api.test.js](../server/test/api.test.js), ~40 cases across auth,
RBAC, List Master and masters CRUD) but needs a migrated, seeded database, which
has not been created — see the README for the two commands.

---

## Open points carried forward

1. **Printing role** (P1-D2) — own role, or stays with StoreManager?
2. The seven Phase 0 open points in
   [PHASE-0-MODELLING-DECISIONS.md](PHASE-0-MODELLING-DECISIONS.md) are still
   open; none of them blocked Phase 1 or 2.
3. **Password policy** is length-first: 10 characters with a letter and a digit.
   Confirm this suits the factory-floor users, or supply the company standard.
4. **Session lifetime** is a 30-minute access token and a 7-day refresh token
   (`JWT_EXPIRES_IN`, `REFRESH_TOKEN_DAYS`). On shared machines a shorter
   refresh window may be wanted.
