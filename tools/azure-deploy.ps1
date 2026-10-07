<#
  Deploys the client AND the API to Azure in one command.

  Run it from the repo root, in PowerShell, signed in with `az login`:
      powershell -ExecutionPolicy Bypass -File tools\azure-deploy.ps1

  Switches:
      -PackageOnly   build and verify the zip, deploy nothing (safe dry run)
      -Swa           also push client/dist to the Static Web App
                     (off by default - see the CLIENT_ORIGIN note below)

  MIGRATIONS ARE NOT PART OF THIS. Run tools\azure-migrate.ps1 first when a
  migration is pending; this script only ships code.

  ---------------------------------------------------------------------------
  WHY THIS SCRIPT EXISTS, AND WHAT EACH STEP IS GUARDING AGAINST

  Every one of these cost an afternoon on 2026-10-07. They are not hypothetical.

  1. THE ZIP MUST NOT BE BUILT BY `Compress-Archive`.
     It writes forward slashes into the zip's central directory but BACKSLASHES
     into the local file headers. Kudu's extractor reads the local headers, so
     every file lands named literally `src\validators\grn.validator.js` - one
     filename, not nested folders. `/home` is an Azure Files SMB share where `\`
     is illegal, so Oryx's rsync step dies with
     `failed to stat ... Invalid argument (22)` / `rsync error ... (code 23)`.
     This builds entries through System.IO.Compression with explicit forward
     slashes, then VERIFIES the local headers before uploading. The verification
     is the point: a broken zip passes `zipfile.namelist()` because that reads
     the central directory, so checking the entry list gives a false all-clear.

  2. THE DEFAULT SUBSCRIPTION IS A DIFFERENT TENANT.
     Shekhawati lives in tenant b67605b7-...; the machine's default az
     subscription is laxmi-bhog's, in another tenant. Passing `--subscription`
     is NOT enough: ARM reads work cross-tenant, but the Kudu/SCM data-plane
     token comes from the DEFAULT tenant, so the deploy fails with 403. This
     sets the default, and restores whatever it was on the way out.

  3. THE CLI LIES ABOUT THE OUTCOME.
     `az webapp deploy` regularly exits 1 with HTTP 504 while the deployment
     SUCCEEDS server-side - the Oryx build simply outlives the gateway timeout.
     So the exit code is ignored and Kudu's own /api/deployments is polled for
     the truth (status 4 = success, 3 = failed), then /api/health is checked.

  4. `--clean true` DOES NOTHING on this app. The deployment log still reports
     `CleanOutputPath False`. Do not reach for it; fix the zip instead.

  5. THE GITHUB ACTIONS PIPELINE HAS NEVER WORKED, so this is the real path.
     Its migration step cannot reach the database from a GitHub-hosted runner,
     and its backend job authenticates with a publish profile - SCM basic auth -
     which is disabled on this app (`allow: false`), so it would 403 regardless.
     A push to `main` ships nothing. See docs/AZURE-DEPLOYMENT.md s.10.2.
  ---------------------------------------------------------------------------
#>

[CmdletBinding()]
param(
  [switch] $PackageOnly,
  [switch] $Swa
)

$ErrorActionPreference = 'Stop'

$sub     = 'f613285e-b7e0-4502-bf87-120a89ebecfc'
$rg      = 'shekhawati-erp'
$webapp  = 'shekhawati-erp-u4dfh'
$swaName = 'shekhawati-web-u4dfh'
$apiUrl  = 'https://shekhawati-erp-u4dfh.azurewebsites.net/api'
$health  = 'https://shekhawati-erp-u4dfh.azurewebsites.net/api/health'

$repo = Split-Path -Parent $PSScriptRoot
$work = Join-Path $env:TEMP ('shekhawati-deploy-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$pkg  = Join-Path $work 'pkg'
$zip  = Join-Path $work 'api.zip'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Good($text) { Write-Host "    $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }

$previousSub = $null

try {
  # -------------------------------------------------------------------------
  Step 'Building the client against the production API'
  # VITE_API_URL is baked into the bundle at build time. Build it here rather
  # than trusting whatever is already in client/dist, which may have been built
  # for localhost.
  $env:VITE_API_URL = $apiUrl
  Push-Location $repo
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Client build failed.' }
  } finally {
    Pop-Location
    Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue
  }
  Good 'client/dist ready'

  # -------------------------------------------------------------------------
  Step 'Assembling the package'
  # Exactly what the App Service expects at /home/site/wwwroot: the server's
  # own package.json at the root, its source and prisma schema, and the client
  # build under public/ - which is where CLIENT_DIST points.
  New-Item -ItemType Directory -Path $pkg -Force | Out-Null
  Copy-Item (Join-Path $repo 'server\package.json') $pkg
  Copy-Item (Join-Path $repo 'server\src')    (Join-Path $pkg 'src')    -Recurse
  Copy-Item (Join-Path $repo 'server\prisma') (Join-Path $pkg 'prisma') -Recurse
  Copy-Item (Join-Path $repo 'client\dist')   (Join-Path $pkg 'public') -Recurse
  Get-ChildItem -Path $pkg -Recurse -Filter *.map -File | Remove-Item -Force
  $fileCount = @(Get-ChildItem -Path $pkg -Recurse -File).Count
  Good "$fileCount files"

  # -------------------------------------------------------------------------
  Step 'Zipping with forward-slash entry names'
  # See note 1 at the top. Entry names are written verbatim into both the local
  # header and the central directory, so passing '/' is what makes this correct.
  Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
  $archive = [System.IO.Compression.ZipFile]::Open($zip, 'Create')
  try {
    $prefix = (Resolve-Path $pkg).Path.TrimEnd('\').Length + 1
    foreach ($f in (Get-ChildItem -Path $pkg -Recurse -File)) {
      $rel = $f.FullName.Substring($prefix).Replace('\', '/')
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f.FullName, $rel) | Out-Null
    }
  } finally {
    $archive.Dispose()
  }

  # The verification that note 1 is about. Walk the raw bytes, find every local
  # file header (PK\x03\x04), read the name length at +26 and the name at +30.
  $bytes = [System.IO.File]::ReadAllBytes($zip)
  $bad = 0; $total = 0
  for ($i = 0; $i -lt $bytes.Length - 30; $i++) {
    if ($bytes[$i] -eq 0x50 -and $bytes[$i+1] -eq 0x4B -and $bytes[$i+2] -eq 0x03 -and $bytes[$i+3] -eq 0x04) {
      $len  = [BitConverter]::ToUInt16($bytes, $i + 26)
      $name = [Text.Encoding]::UTF8.GetString($bytes, $i + 30, $len)
      $total++
      if ($name.Contains('\')) { $bad++ }
    }
  }
  if ($total -eq 0) { throw 'Could not read any local file headers - the zip is malformed.' }
  if ($bad -gt 0) {
    throw "$bad of $total local file headers contain a backslash. Kudu would extract these as broken filenames and the rsync step would fail. Do not upload this zip."
  }
  Good "$total local headers verified, 0 backslashes - $([math]::Round((Get-Item $zip).Length / 1MB, 2)) MB"

  if ($PackageOnly) {
    Warn "-PackageOnly: nothing deployed. Zip left at $zip"
    return
  }

  # -------------------------------------------------------------------------
  Step 'Selecting the Shekhawati subscription'
  # See note 2. The default, not just --subscription, because of the SCM token.
  $previousSub = az account show --query id -o tsv
  az account set --subscription $sub
  if ($LASTEXITCODE -ne 0) { throw 'Could not select the Shekhawati subscription. Run `az login --tenant b67605b7-f5f1-4dba-8b35-be8b9979d005`.' }
  $who = az account show --query "user.name" -o tsv
  Good "signed in as $who"

  # -------------------------------------------------------------------------
  Step 'Deploying the API (this runs npm install on the worker - about 4-6 min)'
  # Exit code deliberately ignored - see note 3. Kudu is the authority.
  #
  # NO `2>&1` AND NO `2>$null` ON `az`. In Windows PowerShell 5.1, redirecting a
  # native executable's stderr wraps every line in a NativeCommandError, and
  # with $ErrorActionPreference='Stop' that turns az's routine "does not run
  # build automation" WARNING into a terminating error - aborting the deploy at
  # the exact moment it was starting. Let az write to the console unredirected.
  $ErrorActionPreference = 'Continue'
  az webapp deploy -g $rg -n $webapp --type zip --src-path $zip
  $ErrorActionPreference = 'Stop'
  Warn 'CLI finished (its exit code is not trusted). Asking Kudu what actually happened...'

  # -------------------------------------------------------------------------
  Step 'Waiting for Kudu to report the real outcome'
  $deadline = (Get-Date).AddMinutes(12)
  $final = $null
  do {
    $tok = az account get-access-token --resource https://management.azure.com --query accessToken -o tsv
    $resp = curl.exe -s -H "Authorization: Bearer $tok" "https://$webapp.scm.azurewebsites.net/api/deployments"
    $d = ($resp | ConvertFrom-Json)[0]
    Write-Host ("    {0}  {1}  status={2} complete={3} active={4}" -f (Get-Date -Format 'HH:mm:ss'), $d.id.Substring(0, 8), $d.status, $d.complete, $d.active)
    if ($d.complete -eq $true) { $final = $d; break }
    Start-Sleep -Seconds 20
  } while ((Get-Date) -lt $deadline)

  if ($null -eq $final) { throw 'Timed out waiting for the deployment to complete. Check the portal.' }

  if ($final.status -ne 4) {
    # Kudu status: 3 = failed, 4 = success. The summary log says only
    # "Deployment Failed"; the real error is in the build step's details_url.
    Write-Host ''
    Warn "Deployment FAILED (status $($final.status)). The real error is in the Oryx sub-log:"
    $tok = az account get-access-token --resource https://management.azure.com --query accessToken -o tsv
    $log = curl.exe -s -H "Authorization: Bearer $tok" "https://$webapp.scm.azurewebsites.net/api/deployments/$($final.id)/log" | ConvertFrom-Json
    foreach ($e in $log) {
      Write-Host ("    " + $e.message)
      if ($e.details_url) { Write-Host ("    DETAILS: " + $e.details_url) -ForegroundColor Yellow }
    }
    throw 'API deployment failed.'
  }
  Good "deployment $($final.id.Substring(0,8)) succeeded and is active"

  # -------------------------------------------------------------------------
  Step 'Verifying the running app'
  # RETRY. A successful deploy restarts the worker, and for the next minute or
  # so the site answers 503 while Node cold-starts. Checking once immediately
  # reports a healthy deploy as a failure - which is exactly what it did.
  $ok = $false
  foreach ($attempt in 1..10) {
    $body = curl.exe -s --max-time 60 $health
    if ($body -match '"status"\s*:\s*"ok"') { $ok = $true; Write-Host "    $body"; break }
    Write-Host ("    attempt {0}/10 - not up yet, waiting..." -f $attempt) -ForegroundColor DarkGray
    Start-Sleep -Seconds 15
  }
  if (-not $ok) { throw 'The deploy landed but the app never came back healthy. Check `az webapp log tail`.' }

  # Which client bundle is actually being served. Comparing it to the one just
  # built is the honest proof that the new code is live - unlike probing a new
  # API route, which cannot distinguish "route exists" from "matched /:id and
  # got rejected by auth", since both answer 401.
  $built = (Get-ChildItem (Join-Path $repo 'client\dist\assets\index-*.js') | Select-Object -First 1).Name
  $servedPage = curl.exe -s --max-time 60 "https://$webapp.azurewebsites.net/"
  $servedMatch = [regex]::Match($servedPage, 'index-[A-Za-z0-9_-]+\.js')
  if ($servedMatch.Success -and $servedMatch.Value -eq $built) {
    Good "health ok; serving $built - the bundle just built"
  } else {
    Warn "health ok, but the site serves '$($servedMatch.Value)' while this build produced '$built'. Hard-refresh, or the deploy did not take."
  }

  # -------------------------------------------------------------------------
  if ($Swa) {
    Step 'Deploying the client to the Static Web App'
    # OFF BY DEFAULT ON PURPOSE. The App Service serves the client itself from
    # CLIENT_DIST=/home/site/wwwroot/public, which the zip above already
    # contains - so the frontend is ALREADY live at the App Service URL.
    # CLIENT_ORIGIN is the App Service's own origin, and in production the CORS
    # allowlist is exactly CLIENT_ORIGIN and nothing else, so a client served
    # from the SWA domain would have every API call refused until CLIENT_ORIGIN
    # is updated to that domain too.
    $token = az staticwebapp secrets list -g $rg -n $swaName --query properties.apiKey -o tsv
    if ($LASTEXITCODE -ne 0 -or -not $token) { throw 'Could not read the Static Web App deployment token.' }
    # 'Continue' again: the SWA CLI writes progress to stderr, which would
    # otherwise terminate the script mid-upload. Its exit code is checked.
    $ErrorActionPreference = 'Continue'
    npx --yes @azure/static-web-apps-cli deploy (Join-Path $repo 'client\dist') --deployment-token $token --env production
    $swaExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($swaExit -ne 0) { throw 'Static Web App deployment failed.' }
    $swaHost = az staticwebapp show -g $rg -n $swaName --query defaultHostname -o tsv
    Good "pushed to https://$swaHost"
    Warn "CORS: set CLIENT_ORIGIN to https://$swaHost if users browse the SWA domain, or they will get CORS errors."
  }

  Write-Host "`nDone." -ForegroundColor Green
  Write-Host "  App:  https://$webapp.azurewebsites.net"
  if (-not $Swa) { Write-Host "  (client shipped inside the API zip under public/ - pass -Swa to also push the Static Web App)" -ForegroundColor DarkGray }
}
finally {
  # 'Continue' for the same reason as the deploy above: a native command's
  # stderr must not be able to throw out of the cleanup block.
  $ErrorActionPreference = 'Continue'
  if ($previousSub -and $previousSub -ne $sub) {
    Write-Host "`nRestoring the previous default subscription ($previousSub)" -ForegroundColor DarkGray
    az account set --subscription $previousSub
  }
  if (Test-Path $work) { Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue }
}
