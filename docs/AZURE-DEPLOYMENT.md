# Deploying Shekhawati Impex ERP on Azure

**Follow this top to bottom.** Steps 0–15 are in dependency order: each one only
uses things an earlier step created. Every step ends with a **✓ Check** you can
run before moving on, so a mistake surfaces at the step that caused it rather
than four steps later.

Reasoning is set aside in **Why** blocks. You can skip them on the first pass
and the sequence still works.

Before you start, read [Two things that will bite you](#two-things-that-will-bite-you)
— one of them can destroy production data, and it is a command you would
otherwise reasonably run.

| | Step | You end up with |
|---|---|---|
| **0** | [Prerequisites](#step-0--prerequisites) | Tools installed, signed in, names chosen |
| **1** | [Two code changes, committed first](#step-1--two-code-changes-committed-first) | The repo can actually build for Azure |
| **2** | [Resource group](#step-2--resource-group) | `rg-shekhawati-erp-prod` |
| **3** | [PostgreSQL](#step-3--postgresql-flexible-server) | A running database server |
| **4** | [The connection string](#step-4--build-the-connection-string) | A tested `DATABASE_URL` |
| **5** | [App Service + identity](#step-5--app-service-plan-web-app-and-identity) | The API host, with a managed identity |
| **6** | [Key Vault + role](#step-6--key-vault-secrets-and-the-role-assignment) | Secrets the app can read |
| **7** | [App Service configuration](#step-7--app-service-configuration) | Startup command, Always On, health check |
| **8** | [Application settings](#step-8--application-settings) | Every environment variable |
| **9** | [Static Web App](#step-9--static-web-app) | The client host + its deployment token |
| **10** | [The deployment pipeline](#step-10--the-deployment-pipeline) | GitHub Actions, wired to both |
| **11** | [First deploy](#step-11--first-deploy) | Code running, database still empty |
| **12** | [Migrate and seed — once](#step-12--migrate-and-seed--once-only) | A populated database |
| **13** | [Custom domain](#step-13--custom-domain-and-client_origin) | `erp.…` serving, CORS correct |
| **14** | [Monitoring](#step-14--monitoring-and-alerts) | Alerts pointing at a named person |
| **15** | [Go-live checklist](#step-15--go-live-checklist) | Sign-off |

Then: [Operations runbook](#operations-runbook) · [Troubleshooting](#troubleshooting) ·
[Alternative: one App Service](#alternative-one-app-service)

---

## Two things that will bite you

### 1. `npm run db:seed` is destructive

From the header of [server/prisma/seed/index.js](../server/prisma/seed/index.js):

> The seed is destructive and idempotent: it clears every in-scope table in
> reverse dependency order and rebuilds it.

`npm run db:setup` is `prisma migrate deploy && npm run db:seed`. It is the
right command **exactly once** — Step 12, on an empty database, before anyone
logs in. Run it the day after go-live and you will delete every buyer order,
GRN and stock movement the factory has entered.

After Step 12, the only database command that touches production is:

```bash
npm --workspace server run db:deploy    # prisma migrate deploy — migrations only
```

Never give the production connection string to a `db:setup` or `db:reset` step
in any pipeline. The workflow in Step 10 deliberately runs `db:deploy` only.

#### ...and it deletes counters the migrations created

A subtler consequence of the same clearing, and one that has already bitten
once. `document_sequences` is in the wipe list, so the seed does not *add* to
the counters the migrations inserted - it **replaces** them with whatever
`seed/data/transactions.js` lists.

Three counters were added by migrations after that list was last updated:

| Migration | Counter |
|---|---|
| `20260827001100` | `CUTTING_CHALLAN` - CC-0001 |
| `20260831000200` | `MATERIAL_PLAN` - MP-0001 |
| `20260901000200` | `GRN_REVERSAL` - GRV-0001 |

On a database that was migrated and then seeded, the seed deleted all three.
The symptom is a document that cannot be saved at all:

> No document sequence configured for CUTTING_CHALLAN

**Re-running `db:deploy` does not fix it.** An applied migration is never
applied again, so the inserts that would restore the rows never re-run. It
takes a *new* migration - `20261002000200_restore_missing_document_sequences`
is that migration, and it is idempotent, so it is safe on a healthy database.

> **The rule:** any counter a migration inserts must also be listed in
> `seed/data/transactions.js`. The two are not alternatives - a dev box that
> is reset uses the list, and only the list.

### 2. The rate limiter is per-process

[server/src/middleware/rateLimit.js](../server/src/middleware/rateLimit.js)
says so at its head: an in-memory `Map`, dependency-free by design, adequate
for one API process. It protects login and password-change against brute force
and spraying.

Scale the API to *N* instances and the effective ceiling becomes *N* × the
configured one, because each worker counts its own attempts. That is a
weakening, not a failure.

**So: run the API at a single instance.** This is an ERP for one factory; one
B1 or P0v3 instance handles a few dozen concurrent users comfortably. If you
ever do scale out, move the limiter to a shared store *first*. Step 7 sets the
instance count.

---

## The topology

```
                    ┌──────────────────────────────────────┐
   Browser  ───────►│  Azure Static Web Apps               │
   (factory)        │  stapp-shekhawati-erp-prod           │
                    │  the built Vite bundle (client/dist) │
                    └──────────────────────────────────────┘
                                   │
                                   │  HTTPS, cross-origin,
                                   │  Authorization: Bearer …
                                   ▼
                    ┌──────────────────────────────────────┐
                    │  Azure App Service (Linux, Node 20)  │
                    │  app-shekhawati-erp-api-prod         │
                    │  Express · /api/*  ·  1 instance     │
                    └──────────────────────────────────────┘
                                   │
                                   │  TLS, sslmode=require
                                   ▼
                    ┌──────────────────────────────────────┐
                    │  Azure Database for PostgreSQL       │
                    │  Flexible Server · psql-…-prod       │
                    │  database: shekhawati_erp            │
                    └──────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │  Key Vault  kv-shekhawati-erp-prod   │
                    │  JWT_SECRET · DATABASE_URL           │
                    │  read by the API's managed identity  │
                    └──────────────────────────────────────┘
```

> **Why the client is hosted separately.** The API does not serve static files —
> [server/src/app.js](../server/src/app.js) mounts `/api` and nothing else.
> Static Web Apps hosts the bundle on a CDN for free, handles the SPA fallback,
> and issues a certificate without being asked. Nothing needs the two to share
> an origin: authentication is a bearer token in `localStorage`, not a cookie,
> so there is no same-site problem, and the CORS allowlist in `app.js` already
> exposes the headers downloads depend on. If you would rather have one
> hostname, see [Alternative: one App Service](#alternative-one-app-service) —
> it is a good choice, it just needs a code change.

> **Why hosting this is easy.** Nothing is written to disk (uploads go to
> `multer.memoryStorage()` and land in a `bytea` column; exports stream to the
> response), sessions live in the `user_sessions` table, and `app.js` already
> sets `trust proxy: 1` so App Service's `X-Forwarded-For` is read correctly.
> No file share, no Redis, no session affinity.

---

## Step 0 — Prerequisites

### 0.1 Install the tools

| Tool | Check it works |
|---|---|
| Azure CLI | `az version` |
| Node 20+ | `node --version` |
| PostgreSQL client (`psql`, `pg_dump`) | `psql --version` |
| Git | `git --version` |

On Windows, `winget install Microsoft.AzureCLI PostgreSQL.PostgreSQL.16 OpenJS.NodeJS.LTS`
covers all four.

### 0.2 Sign in and select the subscription

```bash
az login
az account list --output table
az account set --subscription "<your subscription name or id>"
```

### 0.3 Decide these now, and write them down

You will paste them repeatedly. Everything below assumes these values; change
them consistently if you use your own.

| What | Value used in this guide |
|---|---|
| Region | `centralindia` — closest to Jaipur |
| Resource group | `rg-shekhawati-erp-prod` |
| Database server | `psql-shekhawati-erp-prod` |
| Database name | `shekhawati_erp` |
| Database admin user | `siadmin` |
| App Service plan | `plan-shekhawati-erp-prod` |
| API app | `app-shekhawati-erp-api-prod` |
| Static Web App | `stapp-shekhawati-erp-prod` |
| Key Vault | `kv-shekhawati-erp-prod` |
| App Insights | `appi-shekhawati-erp-prod` |
| Public URL for the client | `erp.shekhawatiimpex.com` |

App Service and Key Vault names are **globally unique** across all of Azure. If
one is taken, append something short and stay consistent.

### 0.4 Generate the database password now

Use letters and digits only. A password containing `@`, `/`, `:` or `#` breaks
the connection string in Step 4 with an error that blames the host.

```bash
openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32; echo
```

Put it somewhere safe — you need it in Steps 3, 4 and 12.

### 0.5 Choose your database network posture

Two paths. **Pick one now**, because Step 3 and Step 10 both depend on it.

| | **A — Public access, firewalled** | **B — Private, no public endpoint** |
|---|---|---|
| Setup effort | Low | Higher (VNet + private endpoint) |
| Migrations from GitHub-hosted runners | Work | **Do not work** — need a self-hosted runner or manual migration |
| Recommended for | Getting running; small deployments | Anything holding data you would not want exposed |

This guide shows **A** inline and notes what changes for **B**. Neither path
ever opens the database to `0.0.0.0/0`.

**✓ Check before moving on**

```bash
az account show --query "{subscription:name, tenant:tenantId}" --output table
```

You should see your subscription. If not, `az login` again.

---

## Step 1 — Two code changes, committed first

Both are needed *before* the pipeline in Step 10 runs, so do them now and
commit them together.

### 1.1 Prisma binary targets

Prisma compiles a native query engine per platform. The engine built on a CI
runner is not guaranteed to be the one an App Service worker needs, and the
failure is a startup crash reading *"Query engine library for current platform
could not be found"*.

Edit [server/prisma/schema.prisma](../server/prisma/schema.prisma):

```prisma
generator client {
  provider      = "prisma-client-js"
  binaryTargets = ["native", "debian-openssl-3.0.x"]
}
```

`native` keeps `npm run dev` working on your Windows laptop;
`debian-openssl-3.0.x` is what App Service's Node 20 Linux image needs. Both
ship in the artifact; the right one is chosen at runtime.

> Verify the target rather than trusting this document. After Step 11 you can
> SSH into the App Service and run `cat /etc/os-release` and `openssl version`.
> If it reports OpenSSL 1.1, change this to `debian-openssl-1.1.x` and redeploy.

### 1.2 The SPA fallback for Static Web Apps

React Router owns the URLs. Without this, a user who refreshes on `/orders/123`
gets a 404 from the CDN, because there is no such file.

Create `client/public/staticwebapp.config.json` — `public/` is copied into
`dist/` by the Vite build, which is what Step 10 uploads:

```json
{
  "navigationFallback": {
    "rewrite": "/index.html",
    "exclude": ["/assets/*", "*.{css,js,png,jpg,svg,ico,webp,woff2,map}"]
  },
  "globalHeaders": {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  },
  "routes": [
    { "route": "/*.map", "allowedRoles": ["authenticated"] }
  ]
}
```

> **Why the `/*.map` rule.** The Vite config sets `sourcemap: 'hidden'`
> deliberately — maps are emitted so a production stack trace is readable, but
> no `sourceMappingURL` comment points a browser at them. Blocking them at the
> edge closes the remaining gap: someone who guesses the filename gets nothing,
> and you still have the maps in the build artifact.

**✓ Check before moving on**

```bash
npm install
npm --workspace server run db:generate    # regenerates with the new targets
npm run build                             # Vite build must still succeed
ls client/dist/staticwebapp.config.json   # must exist
```

Then commit both changes.

---

## Step 2 — Resource group

```bash
az group create \
  --name rg-shekhawati-erp-prod \
  --location centralindia
```

**✓ Check**

```bash
az group show --name rg-shekhawati-erp-prod --query properties.provisioningState -o tsv
# Succeeded
```

---

## Step 3 — PostgreSQL Flexible Server

Takes 5–10 minutes to provision. Replace `<DB_PASSWORD>` with the password from
Step 0.4.

```bash
az postgres flexible-server create \
  --resource-group rg-shekhawati-erp-prod \
  --name psql-shekhawati-erp-prod \
  --location centralindia \
  --tier Burstable --sku-name Standard_B2s \
  --storage-size 64 \
  --version 16 \
  --admin-user siadmin \
  --admin-password '<DB_PASSWORD>' \
  --public-access None \
  --high-availability Disabled \
  --backup-retention 14
```

Create the database itself:

```bash
az postgres flexible-server db create \
  --resource-group rg-shekhawati-erp-prod \
  --server-name psql-shekhawati-erp-prod \
  --database-name shekhawati_erp
```

### 3.1 Open the firewall (path A)

Two rules. The first lets the App Service reach it; the second lets *you* run
migrations in Step 12.

```bash
# "Allow other Azure services" — despite how it reads, 0.0.0.0 is Azure's
# sentinel for this, NOT the public internet.
az postgres flexible-server firewall-rule create \
  --resource-group rg-shekhawati-erp-prod \
  --name psql-shekhawati-erp-prod \
  --rule-name allow-azure-services \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0

# Your own machine, for migrations and psql.
MY_IP=$(curl -s https://api.ipify.org)
az postgres flexible-server firewall-rule create \
  --resource-group rg-shekhawati-erp-prod \
  --name psql-shekhawati-erp-prod \
  --rule-name admin-workstation \
  --start-ip-address "$MY_IP" --end-ip-address "$MY_IP"
```

On path B, skip these and create a private endpoint into the App Service's VNet
instead.

> **Why these settings.** `--backup-retention 14` gives fourteen days of
> point-in-time restore; seven is the default, and for a system of record
> holding a factory's purchase orders fourteen is the smaller mistake.
> Flexible Server has `require_secure_transport` **on** by default — that is
> why `sslmode=require` appears in Step 4. Leave it on.

> **Sizing.** Two things drive storage growth, one of them unusual. Attachments
> are *rows*: a measurement sheet goes into `buyer_order_attachments.data` as
> `bytea`, capped at 10 MB per file by
> [attachment.service.js](../server/src/services/attachment.service.js) — so it
> counts against server storage *and* against every backup. And the audit trail
> never shrinks, which is the point of it. 64 GB is generous for both. Storage
> can be grown later but never shrunk.

**✓ Check**

```bash
az postgres flexible-server show \
  --resource-group rg-shekhawati-erp-prod \
  --name psql-shekhawati-erp-prod \
  --query "{state:state, fqdn:fullyQualifiedDomainName}" -o table
# state should be Ready
```

---

## Step 4 — Build the connection string

Prisma reads exactly one variable, `DATABASE_URL`, validated at start-up by
[server/src/config/env.js](../server/src/config/env.js) — it must begin
`postgresql://` or `postgres://` or the server refuses to boot.

Assemble it from the password in Step 0.4 and the FQDN from Step 3:

```
postgresql://siadmin:<DB_PASSWORD>@psql-shekhawati-erp-prod.postgres.database.azure.com:5432/shekhawati_erp?schema=public&sslmode=require&connection_limit=10&pool_timeout=20
```

| Parameter | Why it is there |
|---|---|
| `schema=public` | What the migrations were written against. |
| `sslmode=require` | Flexible Server rejects unencrypted connections. Without it, every query fails at connect time with a message that never mentions TLS. |
| `connection_limit=10` | Prisma's default derives from the *container's* CPU count, which is not what a B2s database can afford. Ten per instance leaves room for `psql`, migrations and Prisma Studio alongside. |
| `pool_timeout=20` | Fail a query that cannot get a connection within 20 s rather than hanging the request. |

**✓ Check — do not skip this one.** Prove the string works before it goes into
Key Vault, a pipeline secret and an app setting, where a typo is three times as
annoying to find:

```bash
psql "postgresql://siadmin:<DB_PASSWORD>@psql-shekhawati-erp-prod.postgres.database.azure.com:5432/shekhawati_erp?sslmode=require" -c "SELECT version();"
```

A version banner means the password, the firewall and TLS are all correct.
If it hangs, the firewall rule is wrong. If it rejects the password, check
whether it contains a character needing URL-encoding (`@` → `%40`).

---

## Step 5 — App Service plan, web app, and identity

```bash
az appservice plan create \
  --name plan-shekhawati-erp-prod \
  --resource-group rg-shekhawati-erp-prod \
  --location centralindia \
  --is-linux --sku B1

az webapp create \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod \
  --plan plan-shekhawati-erp-prod \
  --runtime "NODE:20-lts"
```

Now give it a managed identity — **Step 6 needs the principal id this returns**:

```bash
az webapp identity assign \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod
```

**✓ Check**

```bash
az webapp identity show \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod \
  --query principalId -o tsv
```

A GUID. If it is empty, the identity was not assigned and Step 6 will not work.

---

## Step 6 — Key Vault, secrets, and the role assignment

Two values must never appear in a portal blade, a repository, or a pipeline
log: the database URL and the JWT signing secret.

### 6.1 Create the vault

```bash
az keyvault create \
  --name kv-shekhawati-erp-prod \
  --resource-group rg-shekhawati-erp-prod \
  --location centralindia \
  --enable-rbac-authorization true
```

### 6.2 Give yourself permission to write secrets

RBAC-authorised vaults do not grant the creator access implicitly.

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)
MY_ID=$(az ad signed-in-user show --query id -o tsv)

az role assignment create \
  --assignee "$MY_ID" \
  --role "Key Vault Secrets Officer" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-shekhawati-erp-prod/providers/Microsoft.KeyVault/vaults/kv-shekhawati-erp-prod"
```

Role assignments take up to a minute to propagate. If 6.3 fails with a
permission error, wait and retry.

### 6.3 Store the secrets

```bash
# The env schema demands >= 32 characters and refuses any value containing
# "CHANGE_ME".
az keyvault secret set \
  --vault-name kv-shekhawati-erp-prod \
  --name JWT-SECRET \
  --value "$(openssl rand -base64 48)"

az keyvault secret set \
  --vault-name kv-shekhawati-erp-prod \
  --name DATABASE-URL \
  --value 'postgresql://siadmin:<DB_PASSWORD>@psql-shekhawati-erp-prod.postgres.database.azure.com:5432/shekhawati_erp?schema=public&sslmode=require&connection_limit=10&pool_timeout=20'
```

Use **single quotes** — the string contains `&`, which an unquoted shell would
treat as a job-control operator.

### 6.4 Let the App Service read them

This is the step the earlier draft of this guide left out entirely. Without it,
the Key Vault references in Step 8 resolve to nothing and the app fails to boot
with an environment-validation error.

```bash
APP_PRINCIPAL=$(az webapp identity show \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod \
  --query principalId -o tsv)

az role assignment create \
  --assignee "$APP_PRINCIPAL" \
  --role "Key Vault Secrets User" \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-shekhawati-erp-prod/providers/Microsoft.KeyVault/vaults/kv-shekhawati-erp-prod"
```

**✓ Check**

```bash
az keyvault secret list --vault-name kv-shekhawati-erp-prod --query "[].name" -o tsv
# DATABASE-URL
# JWT-SECRET

az role assignment list \
  --assignee "$APP_PRINCIPAL" \
  --query "[].roleDefinitionName" -o tsv
# Key Vault Secrets User
```

---

## Step 7 — App Service configuration

### 7.1 Startup command

```bash
az webapp config set \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod \
  --startup-file "node server/src/index.js"
```

Without this the platform guesses, and with a workspace root whose
`package.json` has no `start` script, it guesses wrong.

**Do not set `PORT`.** The app binds `env.PORT`, which App Service injects; its
value is the one the platform's front end forwards to.

### 7.2 Always On, HTTPS, TLS, health check, single instance

```bash
az webapp config set \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod \
  --always-on true \
  --min-tls-version 1.2 \
  --http20-enabled true

az webapp update \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod \
  --https-only true \
  --client-affinity-enabled false \
  --set siteConfig.healthCheckPath="/api/health"
```

Pin the instance count to one — see
[Two things that will bite you](#two-things-that-will-bite-you):

```bash
az monitor autoscale list \
  --resource-group rg-shekhawati-erp-prod -o table   # should be empty

az appservice plan update \
  --name plan-shekhawati-erp-prod \
  --resource-group rg-shekhawati-erp-prod \
  --number-of-workers 1
```

| Setting | Value | Why |
|---|---|---|
| Always On | **On** | Prevents idle recycling — which costs a cold start on the first morning login *and* silently resets every rate-limit bucket. |
| Health check path | `/api/health` | Public, and it pings the database: a degraded database reports `"database": "down"`. |
| Scale out | **1** instance | The rate limiter is per-process. |
| ARR affinity | **Off** | Nothing is held in process. |
| HTTPS only / TLS 1.2 | On | — |

**✓ Check**

```bash
az webapp config show \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod \
  --query "{startup:appCommandLine, alwaysOn:alwaysOn, health:healthCheckPath, tls:minTlsVersion}" -o table
```

---

## Step 8 — Application settings

Every one of these is validated at boot by the Zod schema in
[server/src/config/env.js](../server/src/config/env.js). A missing or malformed
value throws *before* the server listens — deliberately, so you find out at
deploy time rather than at the first request.

### 8.1 Fill in your real values

Three of these are not guesses you can fix later without consequence:

- **`CLIENT_ORIGIN`** must be the browser's origin *exactly* — scheme, host,
  port, no trailing slash. Anything else and every API call fails CORS. You set
  it provisionally now and correct it in Step 13 once the domain exists.
- **`COMPANY_GSTIN`** is a legal statement printed on purchase invoices.
- **`COMPANY_STATE_CODE`** — the first two digits of your own GSTIN —
  **decides whether a purchase is taxed CGST+SGST or IGST**. Wrong here
  mis-taxes every purchase invoice in the system. `08` is Rajasthan.

### 8.2 Apply them

```bash
az webapp config appsettings set \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod \
  --settings \
    NODE_ENV=production \
    CLIENT_ORIGIN='https://stapp-shekhawati-erp-prod.azurestaticapps.net' \
    JWT_EXPIRES_IN=30m \
    REFRESH_TOKEN_DAYS=7 \
    BCRYPT_SALT_ROUNDS=12 \
    COMPANY_NAME='Shekhawati Impex' \
    COMPANY_ADDRESS='Jaipur, Rajasthan, India' \
    COMPANY_GSTIN='08XXXXXXXXXXXXX' \
    COMPANY_STATE_CODE=08 \
    COMPANY_STATE_NAME=Rajasthan \
    WEBSITE_TIME_ZONE='Asia/Kolkata' \
    SCM_DO_BUILD_DURING_DEPLOYMENT=false \
    WEBSITE_RUN_FROM_PACKAGE=1 \
    DATABASE_URL='@Microsoft.KeyVault(SecretUri=https://kv-shekhawati-erp-prod.vault.azure.net/secrets/DATABASE-URL/)' \
    JWT_SECRET='@Microsoft.KeyVault(SecretUri=https://kv-shekhawati-erp-prod.vault.azure.net/secrets/JWT-SECRET/)'
```

### 8.3 What each one is for

| Setting | Value | Notes |
|---|---|---|
| `DATABASE_URL` | *Key Vault reference* | Step 6. |
| `JWT_SECRET` | *Key Vault reference* | ≥ 32 chars; must not contain `CHANGE_ME`. |
| `NODE_ENV` | `production` | **Load-bearing.** In `development`/`test` the CORS layer additionally allows any `localhost` origin. In `production` the allowlist is exactly `CLIENT_ORIGIN` and nothing else. |
| `CLIENT_ORIGIN` | the client's origin | Comma-separated for more than one. Corrected in Step 13. |
| `JWT_EXPIRES_IN` | `30m` | Access-token life. Short by design; the refresh token carries the session. |
| `REFRESH_TOKEN_DAYS` | `7` | How long someone stays signed in. The schema accepts up to 90. |
| `BCRYPT_SALT_ROUNDS` | `12` | 10 is the default; 12 adds a few hundred ms to a login, which nobody notices. Schema caps at 15. |
| `COMPANY_*` | your real details | Printed on documents; see 8.1. |
| `WEBSITE_TIME_ZONE` | `Asia/Kolkata` | Makes container logs read in IST. The app stores UTC and formats in Asia/Kolkata client-side, so this is for whoever reads logs. |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` | Step 10 ships a built, installed artifact. Rebuilding on the worker is slower and can produce a Prisma client for the wrong platform. |
| `WEBSITE_RUN_FROM_PACKAGE` | `1` | Mounts the zip read-only: faster cold start, atomic deploys, and no "fixing" production by editing a file over SSH. |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | set in Step 14 | — |

Deliberately **not** set here: `PORT` (App Service supplies it) and
`SEED_ADMIN_PASSWORD` / `SEED_DEFAULT_USER_PASSWORD` — those belong to Step 12,
run from your workstation. Leaving them in the app's settings is a standing
invitation to a destructive re-seed.

**✓ Check** — the Key Vault references must resolve. Anything other than
`Resolved` means Step 6.4 did not take:

```bash
az webapp config appsettings list \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod \
  --query "[?name=='DATABASE_URL' || name=='JWT_SECRET']" -o table
```

Or in the portal: **Configuration → Application settings** shows a green
*Key Vault Reference* badge against both.

---

## Step 9 — Static Web App

```bash
az staticwebapp create \
  --name stapp-shekhawati-erp-prod \
  --resource-group rg-shekhawati-erp-prod \
  --location centralindia \
  --sku Free
```

Get the deployment token — Step 10 needs it as a GitHub secret:

```bash
az staticwebapp secrets list \
  --name stapp-shekhawati-erp-prod \
  --query properties.apiKey -o tsv
```

And note the default hostname:

```bash
az staticwebapp show \
  --name stapp-shekhawati-erp-prod \
  --query defaultHostname -o tsv
```

**✓ Check** — the token is a long opaque string, and the hostname ends
`.azurestaticapps.net`.

---

## Step 10 — The deployment pipeline

### 10.1 Create the Azure credentials for GitHub

Use OIDC federated credentials rather than a stored password:

```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

az ad app create --display-name "shekhawati-erp-deploy"
APP_ID=$(az ad app list --display-name "shekhawati-erp-deploy" --query "[0].appId" -o tsv)

az ad sp create --id "$APP_ID"
SP_ID=$(az ad sp list --display-name "shekhawati-erp-deploy" --query "[0].id" -o tsv)

az role assignment create \
  --assignee "$APP_ID" \
  --role Contributor \
  --scope "/subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-shekhawati-erp-prod"

# Trust pushes to main in your repo. Replace ORG/REPO.
az ad app federated-credential create --id "$APP_ID" --parameters '{
  "name": "github-main",
  "issuer": "https://token.actions.githubusercontent.com",
  "subject": "repo:ORG/REPO:ref:refs/heads/main",
  "audiences": ["api://AzureADTokenExchange"]
}'
```

### 10.2 Add the GitHub secrets

Repository → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `AZURE_CLIENT_ID` | `$APP_ID` from 10.1 |
| `AZURE_TENANT_ID` | `az account show --query tenantId -o tsv` |
| `AZURE_SUBSCRIPTION_ID` | `az account show --query id -o tsv` |
| `DATABASE_URL` | the string from Step 4 |
| `SWA_DEPLOYMENT_TOKEN` | the token from Step 9 |

> **Path B note.** On a private database, a GitHub-hosted runner cannot reach
> PostgreSQL and the migration step will hang, then fail. Either run the `api`
> job on a **self-hosted runner** inside the VNet, or delete the migration step
> and run migrations manually (Step 12 shows the command). Do not solve it by
> opening the database to the internet.

### 10.3 Create `.github/workflows/deploy.yml`

```yaml
name: Deploy to Azure

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-production
  cancel-in-progress: false

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm --workspace server run db:generate
      - run: npm run lint
      - run: npm run verify        # prisma validate + scope guard + seed cross-refs
      - run: npm run test:rules    # every calculation and state rule, no database
      - run: npm run build         # the Vite production build

  api:
    needs: verify
    runs-on: ubuntu-latest
    environment: production
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      # A full install, because `prisma` (the CLI that generates the client) is
      # a devDependency of the server workspace — `--omit=dev` here would
      # remove the very tool the next step needs.
      - run: npm ci
      - run: npm --workspace server run db:generate

      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      # Migrations run BEFORE the new code, and exactly once per deploy.
      # `migrate deploy` applies pending migrations and nothing else — it never
      # resets, never seeds, and never prompts.
      - name: Apply database migrations
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: npm --workspace server run db:deploy

      - name: Package
        run: zip -r api.zip server node_modules package.json package-lock.json -x 'server/test/*' '*.map'

      - uses: azure/webapps-deploy@v3
        with:
          app-name: app-shekhawati-erp-api-prod
          package: api.zip

  client:
    needs: verify
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
        env:
          # The API's absolute origin — the client is on a different host, so
          # the default of "/api" would resolve against the Static Web App.
          VITE_API_URL: https://app-shekhawati-erp-api-prod.azurewebsites.net/api
      - uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.SWA_DEPLOYMENT_TOKEN }}
          action: upload
          app_location: client/dist
          skip_app_build: true
```

> **Why migrations run in the pipeline, not at app start.** A migration at boot
> races itself the moment there is more than one instance, and it makes the
> health of the app depend on a schema change succeeding. As an explicit,
> ordered step, a failed migration fails the deploy with a readable log and
> leaves the previous version serving.

> **Why `concurrency` is set.** Two overlapping deploys mean two concurrent
> `migrate deploy` runs against one database. The group serialises them.

> **Why the artifact ships devDependencies.** `prisma` is a devDependency of
> the `server` workspace, so `npm ci --omit=dev` would remove the CLI before
> `db:generate` could run. The obvious repair — generate, then
> `npm prune --omit=dev` — is a trap: the engines live in `node_modules/.prisma/`,
> which npm does not track and may treat as extraneous. Shipping the full
> `node_modules` costs some tens of megabytes in the zip and nothing at
> runtime. If size ever matters, the clean fix is a `postinstall` running
> `prisma generate` with `prisma` moved to `dependencies`.

**✓ Check** — commit and push, then watch the run. All three jobs green.

---

## Step 11 — First deploy

The push in Step 10 triggers it. The `api` job's migration step creates the
schema; the database has tables but **no data** yet.

```bash
curl -s https://app-shekhawati-erp-api-prod.azurewebsites.net/api/health
```

**✓ Expected**

```json
{"status":"ok","database":"up","pipelineEndsAt":"CUTTING_ISSUE","time":"..."}
```

If it does not come back, tail the logs — the environment validator names the
exact setting it rejected:

```bash
az webapp log tail \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod
```

See [Troubleshooting](#troubleshooting).

---

## Step 12 — Migrate and seed — once only

> **STOP.** This step is destructive and belongs to an *empty* database. Re-read
> [Two things that will bite you](#two-things-that-will-bite-you). If the
> factory has entered any data, do not run it — run
> `npm --workspace server run db:deploy` instead.

Run from your workstation (path A) or from inside the VNet (path B):

```bash
export DATABASE_URL='postgresql://siadmin:<DB_PASSWORD>@psql-shekhawati-erp-prod.postgres.database.azure.com:5432/shekhawati_erp?schema=public&sslmode=require'
export SEED_ADMIN_USERNAME='admin'
export SEED_ADMIN_PASSWORD='<strong, one-time>'
export SEED_DEFAULT_USER_PASSWORD='<strong, one-time>'
export JWT_SECRET='<any 32+ char value; the seed signs nothing>'

npm --workspace server run db:generate
npm --workspace server run db:setup     # migrate deploy + seed
npm --workspace server run verify:seed  # every cross-reference resolves
```

Every seeded user is created with `mustChangePassword = true`, so the API
refuses everything except the password-change endpoint until each person sets
their own. **These are handover credentials, not production ones** — used once,
then replaced.

Seeded accounts (full list in the [README](../README.md#seed-accounts)):
`admin`, `dinesh` (Director), `vinay` (Planning GM), `ravi` and `maharaj`
(Store & Cutting), `sunita` and `rekha` (QC), `merch`, `headoffice`, `planner`.

> **Decide this before you run it, not after.** The seed also loads the
> workbook's sample transactions. If you want masters and RBAC but no example
> buyer orders in production, settle that with whoever is doing the data
> migration first.

**✓ Check**

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM users;"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM master_list_values;"
```

Both non-zero, and `verify:seed` reported no unresolved references.

---

## Step 13 — Custom domain and `CLIENT_ORIGIN`

### 13.1 Add the domain to the Static Web App

Portal → your Static Web App → **Custom domains** → Add. Create the CNAME it
asks for at your DNS provider, pointing `erp` at the `azurestaticapps.net`
hostname from Step 9. The certificate is issued automatically once DNS
resolves.

### 13.2 Correct `CLIENT_ORIGIN` — do not skip this

The single most common way this deployment breaks. Until you do it, the browser
is on the custom domain while the allowlist still names the
`azurestaticapps.net` one, and every API call fails CORS with an error that
names the origin but not the cause.

```bash
az webapp config appsettings set \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod \
  --settings CLIENT_ORIGIN='https://erp.shekhawatiimpex.com'

az webapp restart \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod
```

**✓ Check** — open `https://erp.shekhawatiimpex.com`, open the browser console,
and confirm the login screen loads with no CORS error.

---

## Step 14 — Monitoring and alerts

```bash
az monitor app-insights component create \
  --app appi-shekhawati-erp-prod \
  --location centralindia \
  --resource-group rg-shekhawati-erp-prod \
  --application-type web

CONN=$(az monitor app-insights component show \
  --app appi-shekhawati-erp-prod \
  --resource-group rg-shekhawati-erp-prod \
  --query connectionString -o tsv)

az webapp config appsettings set \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod \
  --settings APPLICATIONINSIGHTS_CONNECTION_STRING="$CONN"
```

App Service's Node agent attaches without a code change. Then add four alerts,
each routed to a **named person**, not a shared inbox nobody reads:

| Alert | Condition |
|---|---|
| Availability | Standard test on `https://<api>/api/health`, every 5 min, 3 locations, fire when 2 of 3 fail |
| Errors | HTTP 5xx > 10 in 5 minutes |
| Database CPU | > 80% for 15 minutes |
| Database storage | > 80% — remember attachments and the audit trail grow this monotonically |

**✓ Check** — App Insights → Live metrics shows requests arriving.

---

## Step 15 — Go-live checklist

- [ ] `GET https://<api>/api/health` returns `{"status":"ok","database":"up"}`
- [ ] The client loads over the custom domain and shows the login screen
- [ ] `admin` can log in and is forced to change the password
- [ ] After the change, the dashboard renders — this proves auth, RBAC and the database read path in one action
- [ ] A list screen's **Export CSV** downloads with the right filename (proves `Content-Disposition` survived CORS, which it only does because `exposedHeaders` names it)
- [ ] `COMPANY_GSTIN` and `COMPANY_STATE_CODE` are the real ones — print one purchase order and check the tax split
- [ ] Every seeded account's password has been changed, or the account disabled
- [ ] Point-in-time restore exercised once (restore to a scratch server, confirm, delete it)
- [ ] Application Insights is receiving requests; all four alerts route to a named person
- [ ] The App Service plan still shows **1** worker
- [ ] Whoever holds the production credentials has been told, in writing, that `db:setup` and `db:reset` are destructive

---

## Operations runbook

### Applying a schema change

1. Write the migration locally against a local PostgreSQL: `npm run db:migrate`.
2. Commit the generated folder under `server/prisma/migrations/`.
3. Push to `main`. The workflow runs `migrate deploy` before deploying the code.

Never edit a migration already applied to production, and never run `db:reset`
or `db:seed` against it.

### Backups and restore

Flexible Server takes automatic backups with point-in-time restore across the
retention window (14 days, from Step 3). Restore creates a **new server** — it
does not overwrite the original, which is what you want in an incident. The
runbook is: restore to `psql-shekhawati-erp-restore`, point a staging App
Service at it, confirm the data, then decide.

**Test this once before go-live.** A backup you have never restored is a
belief, not a backup.

A portable dump before a risky migration:

```bash
pg_dump --format=custom --no-owner --no-privileges \
  --dbname="postgresql://siadmin:<DB_PASSWORD>@psql-shekhawati-erp-prod.postgres.database.azure.com:5432/shekhawati_erp?sslmode=require" \
  --file="shekhawati_erp_$(date +%Y%m%d).dump"
```

This includes the `bytea` attachments, so it is larger than the row count
suggests.

### Rotating the JWT secret

```bash
az keyvault secret set --vault-name kv-shekhawati-erp-prod \
  --name JWT-SECRET --value "$(openssl rand -base64 48)"

az webapp restart --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod
```

No app-settings edit is needed, because the reference in Step 8 carries no
version and therefore follows the current one.

What users experience: every **access** token becomes invalid immediately, so
the next API call returns 401. The client's axios interceptor then attempts a
refresh — and refresh tokens are opaque random strings hashed in
`user_sessions`, not JWTs, so they are unaffected and the refresh succeeds. A
rotation is effectively invisible: one silent re-authentication per active
user, nobody signed out.

To actually sign everyone out, expire or delete the rows in `user_sessions`.

### Scaling, when it is time

Cheapest first:

1. **Scale up the database** — B2s → B4ms, or Burstable → General Purpose. Most
   slowness in an ERP of this shape is the database, not Node.
2. **Scale up the App Service plan** — B1 → P0v3. Still one instance, so the
   rate limiter stays honest.
3. **Only then scale out** — and move the rate limiter to a shared store first.

### Watching logs

```bash
az webapp log tail \
  --name app-shekhawati-erp-api-prod \
  --resource-group rg-shekhawati-erp-prod
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| App won't start; log says `Invalid environment configuration` | Zod rejected a setting; the message names the exact key and reason | Read the log — it is specific. Usually `JWT_SECRET` under 32 chars, or a Key Vault reference that did not resolve (Step 6.4). |
| App settings show the literal `@Microsoft.KeyVault(...)` text | The managed identity has no role on the vault | Step 6.4, then restart. |
| `Query engine library for current platform could not be found` | Prisma client built for a different platform, or engines excluded from the zip | Step 1.1; confirm `node_modules/.prisma/client/` is inside the package. |
| Every API call fails CORS | `CLIENT_ORIGIN` does not exactly match the browser's origin | Step 13.2. Compare scheme, host and port character by character. No trailing slash. Restart after changing. |
| Refreshing on `/orders/123` gives 404 | SPA fallback missing | Step 1.2 — confirm `staticwebapp.config.json` is in `client/dist`. |
| CSV downloads save under the route name instead of `buyers-2026-09-04.csv` | `Content-Disposition` not reaching JavaScript | It is already in `exposedHeaders`, so suspect something in between stripping it — a proxy or WAF rule. |
| Health check returns `"database": "down"` | The app cannot reach PostgreSQL | Firewall rule (Step 3.1); or `sslmode=require` missing; or the password needs URL-encoding. |
| `psql` hangs at Step 4 | Firewall | Your IP changed — re-run the `admin-workstation` rule. |
| Requests hang, then 500 | Prisma connection pool exhausted | Raise `connection_limit`, or find the long-running query in App Insights. |
| First request each morning takes 20 s | Always On is off | Step 7.2. |
| Deploy succeeded but old code still serving | Run-from-package mount did not swap | Restart the app; check the Deployment Center log. |
| Logins fail for a whole department at once | The office is behind one NAT address and the per-IP bucket tripped | The limiter counts only *failed* attempts, so this means real failures — look for a stale saved password before raising the ceiling. |
| Saving a document fails with `No document sequence configured for X` | The counter row is missing from `document_sequences` — almost always because the seed was run after the migrations and does not list that counter | Apply the pending migrations (`db:deploy`, or `tools/azure-migrate.ps1`). If none are pending, the row needs a new idempotent migration — see ["...and it deletes counters the migrations created"](#and-it-deletes-counters-the-migrations-created). No restart is needed: the counter is read per save. |

---

## Alternative: one App Service

If a single hostname and no CORS at all is worth a small code change, serve the
built client from Express. Add to `createApp()` in
[server/src/app.js](../server/src/app.js), **after** `app.use('/api', routes)`
and **before** `notFound`:

```js
if (env.NODE_ENV === 'production') {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  app.use(express.static(dist, { maxAge: '1y', index: false }));
  // Anything that is not /api and not a real file is a React Router route.
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
```

Then: build the client in the pipeline, include `client/dist` in the zip, skip
Steps 9 and 13.1, and set `CLIENT_ORIGIN` to the App Service's own origin.
(Same-origin requests carry no `Origin` header and are allowed regardless, but
the setting is still read and validated, so give it a real value.)

The trade-off is honest either way. One service is simpler to reason about and
one certificate to renew; two means the client is on a CDN for free, the API
restarts without taking the login page down with it, and static assets never
touch your Node process.

---

## Resource and cost summary

| Resource | SKU | Created in |
|---|---|---|
| `rg-shekhawati-erp-prod` | — | Step 2 |
| `psql-shekhawati-erp-prod` | B2s, 64 GB, PostgreSQL 16 | Step 3 |
| `plan-shekhawati-erp-prod` | B1 Linux (→ P0v3 if slow) | Step 5 |
| `app-shekhawati-erp-api-prod` | Node 20 LTS, 1 instance | Step 5 |
| `kv-shekhawati-erp-prod` | Standard | Step 6 |
| `stapp-shekhawati-erp-prod` | Free | Step 9 |
| `appi-shekhawati-erp-prod` | Pay-as-you-go, cap 1 GB/day | Step 14 |

The App Service plan and the database dominate the bill; the Static Web App is
free at this size, and Key Vault and App Insights are rounding errors at this
volume. Price the exact SKUs in the Azure pricing calculator for Central India
before committing — list prices move, and any figure written into a document is
stale by the time it is read.

---

## Related documentation

- **[README.md](../README.md)** — the stack, local setup, the five rules the codebase holds to, export and import
- **[APPLICATION-FLOW.md](APPLICATION-FLOW.md)** — Masters → Cutting Issue, every branch and gate
- **[USE-CASE-DIAGRAM.md](USE-CASE-DIAGRAM.md)** — the nine actors and what each may do
- **[BUSINESS-CONTROLS.md](BUSINESS-CONTROLS.md)** — the twelve controls and where each is enforced
- **[SECURITY_AND_AUDIT.md](../SECURITY_AND_AUDIT.md)** — the audit trail and the security model
