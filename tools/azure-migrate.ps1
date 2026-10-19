<#
  Applies pending Prisma migrations to the PRODUCTION database on Azure.

  Run it yourself from the repo root, in PowerShell, signed in with `az login`:
      powershell -ExecutionPolicy Bypass -File tools\azure-migrate.ps1

  What it does:
    1. Opens the database firewall to THIS machine's current IP (rule
       "migrate-temp").
    2. Reads DATABASE_URL from the web app's settings (following a Key Vault
       reference if it is one) into this process only. It is never printed
       and never written to disk.
    3. Shows `prisma migrate status` and asks before applying anything.
    4. Runs `prisma migrate deploy`. That only applies pending migrations; it
       never resets and never seeds.
    5. Always removes the firewall rule and the variable again, even on error.

  Azure keeps automatic point-in-time backups of the server (14 days), so a
  migration that goes wrong can be restored from the portal.
#>

$ErrorActionPreference = 'Stop'
$subscription = 'f613285e-b7e0-4502-bf87-120a89ebecfc'
$rg = 'shekhawati-erp'
$server = 'shekhawati-db-u4dfh'
$vault = 'shekhawati-kv-u4dfh'
$webapp = 'shekhawati-erp-u4dfh'
$rule = "migrate-temp-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$repo = Split-Path -Parent $PSScriptRoot
$firewallOpened = $false

try {
  az account set --subscription $subscription
  if ($LASTEXITCODE -ne 0) { throw "Could not select Azure subscription $subscription." }

  $activeSubscription = az account show --query id -o tsv
  if ($LASTEXITCODE -ne 0 -or $activeSubscription -ne $subscription) {
    throw "Azure CLI is not using the expected production subscription $subscription."
  }

  Write-Host 'Checking production Azure resources ...' -ForegroundColor Cyan
  az group show --name $rg --subscription $subscription --query id -o tsv
  if ($LASTEXITCODE -ne 0) { throw "Resource group '$rg' was not found in the production subscription." }
  az postgres flexible-server show -g $rg --name $server --subscription $subscription --query id -o tsv
  if ($LASTEXITCODE -ne 0) { throw "Database server '$server' was not found in resource group '$rg'." }
  az webapp show -g $rg --name $webapp --subscription $subscription --query id -o tsv
  if ($LASTEXITCODE -ne 0) { throw "Web app '$webapp' was not found in resource group '$rg'." }
  az keyvault show -g $rg --name $vault --subscription $subscription --query id -o tsv
  if ($LASTEXITCODE -ne 0) { throw "Key Vault '$vault' was not found in resource group '$rg'." }

  $ip = (Invoke-RestMethod https://api.ipify.org).Trim()
  Write-Host "Opening the database firewall for $ip ..." -ForegroundColor Cyan
  az postgres flexible-server firewall-rule create -g $rg --server-name $server --name $rule `
    --subscription $subscription `
    --start-ip-address $ip --end-ip-address $ip --output none
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the firewall rule.' }
  $firewallOpened = $true

  # The web app's own DATABASE_URL setting is the source of truth: it may be
  # the connection string itself or a Key Vault reference to it.
  Write-Host "Reading DATABASE_URL from the web app's settings ..." -ForegroundColor Cyan
  $env:DATABASE_URL = az webapp config appsettings list -g $rg -n $webapp --subscription $subscription `
    --query "[?name=='DATABASE_URL'].value | [0]" -o tsv
  if ($LASTEXITCODE -ne 0 -or -not $env:DATABASE_URL) { throw 'Could not read DATABASE_URL from the web app.' }
  if ($env:DATABASE_URL.StartsWith('@Microsoft.KeyVault')) {
    $env:DATABASE_URL = az keyvault secret show --vault-name $vault --name DATABASE-URL `
      --subscription $subscription --query value -o tsv
    if ($LASTEXITCODE -ne 0 -or -not $env:DATABASE_URL) { throw 'Could not read the DATABASE-URL secret from Key Vault.' }
  }

  Push-Location (Join-Path $repo 'server')
  try {
    $prismaCli = Join-Path $PWD 'node_modules\prisma\build\index.js'
    if (-not (Test-Path $prismaCli)) { throw 'The server Prisma CLI is not installed. Run npm install from the repository root.' }

    Write-Host "`n--- Migration status (read-only) ---" -ForegroundColor Cyan
    node $prismaCli migrate status
    $migrationStatusExitCode = $LASTEXITCODE
    if ($migrationStatusExitCode -ne 0) {
      Write-Warning "Prisma migration status returned exit code $migrationStatusExitCode. Review the output before continuing."
    }
    Write-Host ''
    $answer = Read-Host 'Apply the pending migrations listed above to PRODUCTION? Type yes to continue'
    if ($answer -eq 'yes') {
      node $prismaCli migrate deploy
      if ($LASTEXITCODE -ne 0) { throw 'prisma migrate deploy failed - read the error above.' }
      Write-Host "`nMigrations applied." -ForegroundColor Green
    } else {
      Write-Host 'Nothing applied.' -ForegroundColor Yellow
    }
  } finally {
    Pop-Location
  }
} finally {
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  if ($firewallOpened) {
    Write-Host 'Closing the temporary database firewall rule ...' -ForegroundColor Cyan
    az postgres flexible-server firewall-rule delete -g $rg --server-name $server --name $rule `
      --subscription $subscription --yes --output none
    if ($LASTEXITCODE -ne 0) { Write-Warning "Could not remove temporary firewall rule '$rule'." }
  }
}
