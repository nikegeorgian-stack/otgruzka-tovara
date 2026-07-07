# Deploy FST (kak na fst-uchet-theta) v proekt otgruzka-tovara pod nikegeorgian.
# Run: powershell -ExecutionPolicy Bypass -File scripts\deploy-otgruzka-vercel.ps1

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\migrate-common.ps1"

$TargetProject = 'otgruzka-tovara'
$TargetUrl = 'https://otgruzka-tovara.vercel.app'
$OldUrl = 'https://fst-uchet-theta.vercel.app'

Write-Banner 'Deploy FST -> otgruzka-tovara' 'Magenta'
Write-Host "  Staroe:  $OldUrl (fb-cell-admin / fst-uchet-14c02)" -ForegroundColor DarkGray
Write-Host "  Novoe:   $TargetUrl (nikegeorgian / otgruzka-tovara)" -ForegroundColor White
Write-Host '  Uchetka: nikegeorgian@gmail.com' -ForegroundColor Cyan
Write-Host '  Brauzer: Yandex' -ForegroundColor Cyan
Write-Host ''

# Proverka Vercel CLI
$who = (& vercel whoami 2>&1 | Out-String).Trim()
Write-Host "  Vercel CLI sejchas: $who" -ForegroundColor Yellow
if ($who -match 'fb-cell-admin|admin-26691449') {
  Write-Host ''
  Write-Host '  OSHIBKA: CLI na STAROM akkaunte fb-cell-admin!' -ForegroundColor Red
  Write-Host '  Snachala: npm run vercel:login:nika' -ForegroundColor Yellow
  Write-Host '  (vojti kak nikegeorgian@gmail.com v Yandex)' -ForegroundColor Yellow
  $go = Read-Host '  Perezaloginitsya sejchas? (y/N)'
  if ($go -match '^[yY]') {
    & "$PSScriptRoot\vercel-login-as.ps1"
  } else {
    exit 1
  }
}

# Env iz .env.target
$target = Join-Path $FstWeb '.env.target'
$prod = Join-Path $FstWeb '.env.production'
if (-not (Test-Path $target)) { throw 'Net fst-web/.env.target' }
Copy-Item $target $prod -Force
Write-Host '  .env.production <- .env.target (otgruzka-tovara Firebase)' -ForegroundColor DarkGray

# Ubrat privyazku k fst-uchet / fb-cell-admin
$vercelDir = Join-Path $ProjectRoot '.vercel'
if (Test-Path $vercelDir) {
  Move-Item $vercelDir "$vercelDir.bak-$(Get-Date -Format 'yyyyMMdd-HHmm')"
}

Push-Location $ProjectRoot
try {
  Write-Host ''
  Write-Host "Link k proektu $TargetProject ..." -ForegroundColor Cyan
  & vercel link --yes --project $TargetProject
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Avtolink ne srabotal - zapustite vruchnuyu: vercel link' -ForegroundColor Yellow
    Write-Host "  Scope: nikegeorgian, Project: $TargetProject" -ForegroundColor Yellow
    & vercel link
    if ($LASTEXITCODE -ne 0) { throw 'vercel link failed' }
  }

  Write-Host ''
  Write-Host 'Sync env variables...' -ForegroundColor Cyan
  & npm run sync:vercel-env
  if ($LASTEXITCODE -ne 0) { throw 'sync:vercel-env failed' }

  Write-Host ''
  Write-Host 'Build + deploy production...' -ForegroundColor Cyan
  & node scripts/build.mjs
  if ($LASTEXITCODE -ne 0) { throw 'build failed' }
  & vercel --prod --yes
  if ($LASTEXITCODE -ne 0) { throw 'vercel --prod failed' }
} finally {
  Pop-Location
}

Write-Banner 'Gotovo' 'Green'
Write-Host "  Otkroyte: $TargetUrl" -ForegroundColor White
Write-Host '  Vojdite kak nikegeorgian@gmail.com ili admin@fibercell.net' -ForegroundColor DarkGray
Write-Host ''
