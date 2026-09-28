<#
  Applies pending Prisma migrations to the PRODUCTION database on Azure.

  Run it yourself from the repo root, in PowerShell, signed in with `az login`:
      powershell -ExecutionPolicy Bypass -File tools\azure-migrate.ps1

  What it does:
    1. Opens the database firewall to THIS machine's current IP (rule
       "migrate-temp").
    2. Reads DATABASE_URL from Key Vault into this process only. It is never
       printed and never written to disk.
    3. Shows `prisma migrate status` and asks before applying anything.
    4. Runs `prisma migrate deploy`. That only applies pending migrations; it
       never resets and never seeds.
    5. Always removes the firewall rule and the variable again, even on error.

  Azure keeps automatic point-in-time backups of the server (14 days), so a
  migration that goes wrong can be restored from the portal.
#>

$ErrorActionPreference = 'Stop'
$rg = 'shekhawati-erp'
$server = 'shekhawati-db-u4dfh'
$vault = 'shekhawati-kv-u4dfh'
$rule = 'migrate-temp'
$repo = Split-Path -Parent $PSScriptRoot

try {
  $ip = (Invoke-RestMethod https://api.ipify.org).Trim()
  Write-Host "Opening the database firewall for $ip ..." -ForegroundColor Cyan
  az postgres flexible-server firewall-rule create -g $rg --server-name $server --rule-name $rule `
    --start-ip-address $ip --end-ip-address $ip --output none
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the firewall rule.' }

  Write-Host 'Reading DATABASE_URL from Key Vault ...' -ForegroundColor Cyan
  $env:DATABASE_URL = az keyvault secret show --vault-name $vault --name DATABASE-URL --query value -o tsv
  if ($LASTEXITCODE -ne 0 -or -not $env:DATABASE_URL) {
    throw 'Could not read the DATABASE-URL secret. Your account needs the "Key Vault Secrets Officer" role on the vault.'
  }

  Push-Location (Join-Path $repo 'server')
  try {
    Write-Host "`n--- Migration status (read-only) ---" -ForegroundColor Cyan
    npx prisma migrate status
    Write-Host ''
    $answer = Read-Host 'Apply the pending migrations listed above to PRODUCTION? Type yes to continue'
    if ($answer -eq 'yes') {
      npx prisma migrate deploy
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
  Write-Host 'Closing the database firewall rule ...' -ForegroundColor Cyan
  az postgres flexible-server firewall-rule delete -g $rg --server-name $server --rule-name $rule --yes --output none 2>$null
}
