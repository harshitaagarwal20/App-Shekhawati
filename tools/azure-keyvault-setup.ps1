# Moves the database connection string (with its password) and the JWT secret
# out of the web app's App Settings and into Azure Key Vault.
#
# Run once, from PowerShell, signed in to az as dinesh@sekawati.com:
#   powershell -ExecutionPolicy Bypass -File tools\azure-keyvault-setup.ps1
#
# Already done before this script: vault `shekhawati-kv-u4dfh` created (RBAC
# mode) and the web app's system-assigned managed identity switched on.
# Secret values are never printed; they pass through a temp file that is
# deleted straight away (cmd.exe mangles `&` if passed on the command line).

$ErrorActionPreference = 'Stop'
$rg    = 'shekhawati-erp'
$app   = 'shekhawati-erp-u4dfh'
$vault = 'shekhawati-kv-u4dfh'
$sub   = 'f613285e-b7e0-4502-bf87-120a89ebecfc'
$vaultId = "/subscriptions/$sub/resourceGroups/$rg/providers/Microsoft.KeyVault/vaults/$vault"

Write-Host '1/5  Letting the web app read secrets from the vault...'
$principalId = az webapp identity show -g $rg -n $app --query principalId -o tsv
if (-not $principalId) { throw 'Web app has no managed identity. Run: az webapp identity assign -g shekhawati-erp -n shekhawati-erp-u4dfh' }
$existing = az role assignment list --assignee $principalId --scope $vaultId --role 'Key Vault Secrets User' --query '[].id' -o tsv
if (-not $existing) {
  az role assignment create --assignee-object-id $principalId --assignee-principal-type ServicePrincipal `
    --role 'Key Vault Secrets User' --scope $vaultId -o none
}

Write-Host '2/5  Copying secrets into the vault (values not shown)...'
$settings = az webapp config appsettings list -g $rg -n $app -o json | ConvertFrom-Json
function Copy-Secret($settingName, $secretName) {
  $value = ($settings | Where-Object { $_.name -eq $settingName }).value
  if (-not $value) { throw "$settingName is empty in App Settings" }
  if ($value.StartsWith('@Microsoft.KeyVault')) { Write-Host "     $settingName already points at the vault - skipped"; return }
  $tmp = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($tmp, $value)
    az keyvault secret set --vault-name $vault -n $secretName --file $tmp --encoding utf-8 -o none
  } finally { Remove-Item $tmp -Force }
  Write-Host "     $settingName -> $secretName"
}
Copy-Secret 'DATABASE_URL' 'DATABASE-URL'
Copy-Secret 'JWT_SECRET'   'JWT-SECRET'

Write-Host '3/5  Waiting 60s for the role assignment to take effect...'
Start-Sleep -Seconds 60

Write-Host '4/5  Pointing App Settings at the vault...'
$refs = @(
  @{ name = 'DATABASE_URL'; value = "@Microsoft.KeyVault(VaultName=$vault;SecretName=DATABASE-URL)"; slotSetting = $false },
  @{ name = 'JWT_SECRET';   value = "@Microsoft.KeyVault(VaultName=$vault;SecretName=JWT-SECRET)";   slotSetting = $false }
)
$refFile = Join-Path $env:TEMP 'kv-refs.json'
[IO.File]::WriteAllText($refFile, (ConvertTo-Json -InputObject $refs))  # no BOM
az webapp config appsettings set -g $rg -n $app --settings "@$refFile" -o none
Remove-Item $refFile -Force
az webapp restart -g $rg -n $app

Write-Host '5/5  Checking...'
Start-Sleep -Seconds 30
az rest --method get --url "https://management.azure.com/subscriptions/$sub/resourceGroups/$rg/providers/Microsoft.Web/sites/$app/config/configreferences/appsettings?api-version=2022-03-01" `
  --query "value[].{setting:name, status:properties.status}" -o table
for ($i = 0; $i -lt 12; $i++) {
  try {
    $h = Invoke-RestMethod "https://$app.azurewebsites.net/api/health" -TimeoutSec 20
    Write-Host "Health: $($h.data.status), database: $($h.data.database)"
    break
  } catch { Start-Sleep -Seconds 10 }
}
Write-Host 'Both rows above should say Resolved. If not, see docs/HOSTING-AND-SECRETS.md -> Troubleshooting.'
