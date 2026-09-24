# Hosting and Secrets: Separate Frontend/Backend, Key Vault

Set up on 2026-09-18. Azure account: **dinesh@sekawati.com**, resource group `shekhawati-erp`.

## What runs where

| Part | Azure service | Name | URL |
|---|---|---|---|
| Frontend (React build) | Static Web App, Free tier | `shekhawati-web-u4dfh` | https://yellow-river-02ae19400.4.azurestaticapps.net |
| Backend (Express API) | App Service, Linux B1 | `shekhawati-erp-u4dfh` | https://shekhawati-erp-u4dfh.azurewebsites.net/api |
| Database | PostgreSQL Flexible Server | `shekhawati-db-u4dfh` | private, reached only by the backend |
| Secrets | Key Vault (RBAC mode) | `shekhawati-kv-u4dfh` | https://shekhawati-kv-u4dfh.vault.azure.net |

```
Browser ──> Static Web App (HTML/JS/CSS)
   │
   └─ API calls ──> App Service /api ──> PostgreSQL
                         │
                         └─ reads DATABASE_URL, JWT_SECRET from Key Vault
                            (via its managed identity, no password stored in the app)
```

## How the pieces are connected

**Frontend → backend.** The client is built with `VITE_API_URL` from
[client/.env.production](../client/.env.production), so every API call goes to
the App Service URL. Login tokens are sent as `Authorization: Bearer` headers,
not cookies, so different domains work without any cookie settings.

**Backend allows the frontend.** App Setting `CLIENT_ORIGIN` is a comma-separated
list of allowed origins. It currently holds the App Service URL and the Static Web
App URL. **If the frontend URL changes (for example, a custom domain), add it here
and restart the web app.** A missing origin shows up in the browser as a CORS error
and on the server as a rejected request.

**Page refresh on a deep link** (e.g. `/masters/buyers`) works because
[client/public/staticwebapp.config.json](../client/public/staticwebapp.config.json)
rewrites unknown paths to `index.html`.

**The backend still serves the old combined site** at the App Service URL
(App Setting `CLIENT_DIST`). The old link keeps working while users move to the
new one. To stop serving it, delete `CLIENT_DIST`, and stop including `public/`
in the backend zip.

## Secrets in Key Vault

| App Setting | Key Vault secret | Contains |
|---|---|---|
| `DATABASE_URL` | `DATABASE-URL` | Postgres connection string including the `siadmin` password |
| `JWT_SECRET` | `JWT-SECRET` | Signing key for login tokens |

The App Setting value becomes a reference, for example
`@Microsoft.KeyVault(VaultName=shekhawati-kv-u4dfh;SecretName=DATABASE-URL)`.
App Service fetches the real value at startup through the web app's
**system-assigned managed identity**, which has the **Key Vault Secrets User** role
on the vault (read-only).

**One-time setup:** run [tools/azure-keyvault-setup.ps1](../tools/azure-keyvault-setup.ps1)
(details in that file). It is safe to run again.

### Changing the database password

1. Change it on the server:
   `az postgres flexible-server update -g shekhawati-erp -n shekhawati-db-u4dfh --admin-password "<new>"`
2. In the Azure Portal, open **Key Vault → Secrets → DATABASE-URL → New version** and
   paste the full connection string with the new password.
3. Restart the web app: `az webapp restart -g shekhawati-erp -n shekhawati-erp-u4dfh`.
   The reference has no version pinned, so the app picks up the latest version on restart.

### Troubleshooting

- **Status is not `Resolved`**: the role assignment may not have taken effect yet.
  Wait five minutes and restart the web app.
- **`AccessToKeyVaultDenied`**: check the role:
  `az role assignment list --scope <vault id> -o table`. The web app's identity
  should show **Key Vault Secrets User**.
- If a secret reference cannot be resolved, the app receives the literal
  `@Microsoft.KeyVault(...)` text. Prisma then fails and `/api/health` reports the database as down.

## Redeploying

### Frontend

```bash
cd client
npx vite build
rm -f dist/assets/*.map        # source maps stay local
SWA_CLI_DEPLOYMENT_TOKEN=$(az staticwebapp secrets list -n shekhawati-web-u4dfh -g shekhawati-erp --query properties.apiKey -o tsv) \
  npx @azure/static-web-apps-cli deploy ./dist --env production
```

### Backend

Same as before: zip `package.json`, `src`, `prisma` (and `public` only while
`CLIENT_DIST` is kept) with `tar -a`, then run
`az webapp deployment source config-zip -g shekhawati-erp -n shekhawati-erp-u4dfh --src <zip>`.

## CI/CD (automatic deploy on every change)

Today both parts are deployed by hand from this laptop. Automatic deploys need
the code in a hosted Git repository:

- **GitHub (recommended):** a free account and a **private** repository.
  Static Web Apps and App Service both have built-in GitHub Actions setup. A push
  to `main` builds and deploys the frontend and backend, and the deploy
  credentials are kept as GitHub secrets.
- **Azure DevOps:** also free for small teams and uses the same Microsoft
  login. Setup takes more steps.
- **No Git host:** keep deploying by hand with the commands above.

This project folder is not yet a Git repository, so the first step is
`git init`, commit, and push to a private GitHub repo. Check that `.env` files
and `backups/` are in `.gitignore` first.

## Cost

Static Web App Free: ₹0. Key Vault: a few paise per 10,000 secret reads, so
effectively ₹0 here. App Service B1 and Postgres B1ms are unchanged.
