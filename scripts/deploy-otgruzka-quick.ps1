# Fast deploy otgruzka-tovara as nikegeorgian (no env sync).
# Run: npm run deploy:otgruzka:quick
#
# Cloud `vercel --prod` so serverless `/api/fst/*` (password reset, users, …)
# are built on Vercel. Local dist → Firebase Hosting (UI mirror).
# Password reset works on https://otgruzka-tovara.vercel.app (not web.app).
#
# ONLY UI: Vercel + firebase hosting. NEVER firestore / import / clear /
# overwrite access.users or user settings in the cloud.

$ErrorActionPreference = 'Continue'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$FstWeb = Join-Path $ProjectRoot 'fst-web'
$Dist = Join-Path $ProjectRoot 'dist'

function Invoke-Vercel {
  param([Parameter(Mandatory)][string[]]$Args)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & vercel @Args
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prev
  }
}

$who = (cmd /c "vercel whoami 2>&1").Trim()
Write-Host "Vercel CLI: $who" -ForegroundColor Cyan
if ($who -match 'fb-cell-admin|admin-26691449') {
  Write-Host 'OSHIBKA: vojdite kak nikegeorgian: npm run vercel:login:nika' -ForegroundColor Red
  exit 1
}

Copy-Item (Join-Path $FstWeb '.env.target') (Join-Path $FstWeb '.env.production') -Force

$vercelDir = Join-Path $ProjectRoot '.vercel'
if (Test-Path $vercelDir) {
  Remove-Item $vercelDir -Recurse -Force
  Write-Host 'Udalen staryj .vercel (chuzhoj akkaunt)' -ForegroundColor Yellow
}

Push-Location $ProjectRoot
try {
  $code = Invoke-Vercel -Args @('link', '--yes', '--project', 'otgruzka-tovara')
  if ($code -ne 0) { throw 'vercel link failed' }

  Write-Host 'Local build (node scripts/build.mjs) for Hosting...' -ForegroundColor Cyan
  if (Test-Path (Join-Path $FstWeb 'public\downloads\fst-fibercell.apk')) {
    Write-Host 'Refresh downloads/app-version.json before web build...' -ForegroundColor Cyan
    & node scripts/write-app-version.mjs
  }
  & node scripts/build.mjs
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
  if (-not (Test-Path $Dist)) { throw 'dist missing after build' }

  # NOT --prebuilt static-only: that stripped /api and broke password reset.
  Write-Host 'vercel --prod (cloud build = UI + /api serverless)...' -ForegroundColor Cyan
  $vercelOut = & vercel deploy --prod --yes 2>&1 | Out-String
  Write-Host $vercelOut
  $vercelOk = ($vercelOut -match 'otgruzka-tovara\.vercel\.app') -or ($vercelOut -match 'Aliased:') -or ($LASTEXITCODE -eq 0)
  if (-not $vercelOk) { throw 'vercel --prod failed' }

  $env:NODE_OPTIONS = ''
  Push-Location $FstWeb
  try {
    & firebase deploy --only hosting --project otgruzka-tovara
    if ($LASTEXITCODE -ne 0) { throw 'firebase hosting failed' }
  } finally {
    Pop-Location
  }

  Write-Host ''
  Write-Host 'Gotovo: https://otgruzka-tovara.vercel.app (+ hosting web.app)' -ForegroundColor Green
  Write-Host 'API check: POST /api/fst/update-user without token -> 401 JSON (not HTML/405)' -ForegroundColor Cyan
  Write-Host 'Password reset: only on Vercel URL (Hosting has no serverless)' -ForegroundColor Cyan
} finally {
  Pop-Location
}
