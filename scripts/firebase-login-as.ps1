# Firebase login v nuzhnom brauzere (Yandex = nikegeorgian, Chrome = admin).
# Run:
#   powershell -File scripts\firebase-login-as.ps1 -Account nika
#   powershell -File scripts\firebase-login-as.ps1 -Account admin

param(
  [ValidateSet('nika', 'admin')]
  [string]$Account = 'nika'
)

$ErrorActionPreference = 'Stop'
$Browsers = Join-Path $PSScriptRoot 'browsers'

if ($Account -eq 'nika') {
  $Email = 'nikegeorgian@gmail.com'
  $BrowserCmd = Join-Path $Browsers 'open-yandex.cmd'
  $BrowserName = 'Yandex Browser (inkognito)'
} else {
  $Email = 'admin@fibercell.net'
  $BrowserCmd = Join-Path $Browsers 'open-chrome.cmd'
  $BrowserName = 'Google Chrome (inkognito)'
}

Write-Host ''
Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host "  Firebase CLI -> $Email" -ForegroundColor Yellow
Write-Host "  Brauzer:      $BrowserName" -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host ''

# Podskazka Google s nuzhnym email
$hint = "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fconsole.firebase.google.com%2F&Email=$([uri]::EscapeDataString($Email))"
Write-Host '1. Otkryvayu pravilnyj brauzer s podskazkoj email...' -ForegroundColor White
& (Join-Path $Browsers $(if ($Account -eq 'nika') { 'open-yandex.ps1' } else { 'open-chrome.ps1' })) -Url $hint
Start-Sleep -Seconds 2

Write-Host '2. Zapuskayu Firebase OAuth v tom zhe brauzere...' -ForegroundColor White
Write-Host '   Esli otkroetsya ne tot brauzer - skopiruyte URL iz terminala v okno inkognito.' -ForegroundColor DarkGray
Write-Host ''

# BROWSER = nash skript (firebase peredaet URL kak argument)
$env:BROWSER = $BrowserCmd

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $ProjectRoot 'fst-web')
try {
  & firebase login:add $Email
  if ($LASTEXITCODE -ne 0) { throw "firebase login:add -> $LASTEXITCODE" }
  & firebase login:use $Email
  if ($LASTEXITCODE -ne 0) { throw "firebase login:use -> $LASTEXITCODE" }
} finally {
  Remove-Item Env:BROWSER -ErrorAction SilentlyContinue
  Pop-Location
}

Write-Host ''
Write-Host "Gotovo. Aktivnyj akkaunt: $Email" -ForegroundColor Green
& firebase login:list
Write-Host ''
