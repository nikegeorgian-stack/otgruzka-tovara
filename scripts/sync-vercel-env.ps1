# Push VITE_* from fst-web/.env to Vercel (project fst-uchet)
# Run after: npm run setup:firebase
$ErrorActionPreference = "Stop"
$envFile = Join-Path $PSScriptRoot "..\fst-web\.env"
if (-not (Test-Path $envFile)) {
  Write-Host "Missing fst-web/.env — run: npm run setup:firebase" -ForegroundColor Red
  exit 1
}

$vars = @(
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
  "VITE_FST_WEB"
)

Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Test-Path ".vercel")) {
  vercel link --yes --project fst-uchet --scope fb-cell-admin-s-projects
}

$content = Get-Content $envFile -Raw
foreach ($name in $vars) {
  if ($content -notmatch "(?m)^$name=(.+)$") { continue }
  $val = $Matches[1].Trim().Trim('"')
  if (-not $val) { continue }
  Write-Host "Setting $name ..."
  $val | vercel env add $name production --force 2>$null
  $val | vercel env add $name preview --force 2>$null
  $val | vercel env add $name development --force 2>$null
}

Write-Host "Done. Redeploy: vercel --prod" -ForegroundColor Green
