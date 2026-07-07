# Perenos FST v sushchestvuyushchij proekt Vercel "Otgruzka tovarov".
# Run: powershell -ExecutionPolicy Bypass -File scripts\migrate-vercel.ps1
#      powershell -ExecutionPolicy Bypass -File scripts\migrate-vercel.ps1 -SkipLogin
#      powershell -ExecutionPolicy Bypass -File scripts\migrate-vercel.ps1 -ProjectName otgruzka-tovarov

param(
  [switch]$SkipLogin,
  [string]$ProjectName = 'otgruzka-tovara'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\migrate-common.ps1"

Write-Banner 'Vercel: proekt Otgruzka -> FST' 'Magenta'
Write-Host '  Uchetka:  nikegeorgian@gmail.com' -ForegroundColor White
Write-Host '  Brauzer:  Yandex' -ForegroundColor White
Write-Host '  Firebase: otgruzka-tovara (iz .env.target)' -ForegroundColor White
Write-Host "  Vercel:   sushchestvuyushchij proekt (~$ProjectName)" -ForegroundColor White
Write-Host ''
Write-Host '  Obnulenie na Vercel = novye env + novyj deploy (staryj sajt zamenitsya).' -ForegroundColor DarkGray
Write-Host ''

if (-not $SkipLogin) {
  & "$PSScriptRoot\vercel-login-as.ps1"
}

# .env.production iz .env.target
$target = Join-Path $FstWeb '.env.target'
$prod = Join-Path $FstWeb '.env.production'
if (-not (Test-Path $target)) {
  Write-Host 'Net fst-web/.env.target' -ForegroundColor Red
  exit 1
}
Copy-Item $target $prod -Force
Write-Host '  .env.production <- .env.target' -ForegroundColor DarkGray

# Ubrat staruyu privyazku k fb-cell-admin
$vercelDir = Join-Path $ProjectRoot '.vercel'
if (Test-Path $vercelDir) {
  $bak = "$vercelDir.bak-$(Get-Date -Format 'yyyyMMdd-HHmm')"
  Move-Item $vercelDir $bak
  Write-Host "  Staryj .vercel -> $bak" -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '--- Shag A: ochistka v brauzere (po zhelaniyu) ---' -ForegroundColor Cyan
Write-Host '  Uchetka: nikegeorgian@gmail.com, Brauzer: Yandex' -ForegroundColor White
Write-Host '  https://vercel.com/dashboard' -ForegroundColor Cyan
Write-Host '  Otkroyte proekt Otgruzka tovarov:' -ForegroundColor White
Write-Host '  - Settings -> Environment Variables: starye VITE_* mozhno udalit' -ForegroundColor DarkGray
Write-Host '    (skript sync perezapishet ih avtomaticheski)' -ForegroundColor DarkGray
Write-Host '  - Settings -> Git: esli privyazan staryj repo — mozhno otklyuchit' -ForegroundColor DarkGray
Write-Host ''
$skipClean = Read-Host '  Propustit ruchnuyu ochistku v dashboard? (Y/n)'
if ($skipClean -match '^[nN]') {
  Wait-Enter 'Enter posle ochistki v Vercel Dashboard...'
}

Write-Host ''
Write-Host '--- Shag B: vercel link ---' -ForegroundColor Cyan
Write-Host '  Vybirite:' -ForegroundColor White
Write-Host '  - Scope:   nikegeorgian@gmail.com (NE fb-cell-admin)' -ForegroundColor Yellow
Write-Host "  - Project: Link to existing -> imya proekta Otgruzka (~$ProjectName)" -ForegroundColor Yellow
Write-Host '  - NE sozdavajte novyj, esli hotite zamenit staryj Otgruzka' -ForegroundColor Yellow
Write-Host ''
Wait-Enter 'Enter - zapusk vercel link...'

Push-Location $ProjectRoot
try {
  & vercel link
  if ($LASTEXITCODE -ne 0) { throw 'vercel link failed' }

  Write-Host ''
  Write-Host '--- sync env ---' -ForegroundColor Cyan
  & npm run sync:vercel-env
  if ($LASTEXITCODE -ne 0) { throw 'sync:vercel-env failed' }

  Write-Host ''
  Write-Host '--- deploy production ---' -ForegroundColor Cyan
  & vercel --prod
  if ($LASTEXITCODE -ne 0) { throw 'vercel --prod failed' }
} finally {
  Pop-Location
}

Write-Banner 'Vercel deploy gotov' 'Green'
Write-Host '  Proverte URL kotoryj pokazal vercel.' -ForegroundColor White
Write-Host '  Vojdite v prilozhenie pod nikegeorgian@gmail.com' -ForegroundColor White
Write-Host ''
