# Polnaya migracija FST: eksport -> import -> deploy
# Run: powershell -ExecutionPolicy Bypass -File scripts\migrate-to-personal.ps1
#      powershell -ExecutionPolicy Bypass -File scripts\migrate-to-personal.ps1 -Step Import

param(
  [ValidateSet('All', 'Export', 'Import', 'Deploy')]
  [string]$Step = 'All',
  [string]$BackupDir = 'E:\Fibercell-FST-pack\cloud-backup'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\migrate-common.ps1"

Write-Banner 'FST migracija -> nikegeorgian@gmail.com' 'Yellow'
Write-Host "  Shag: $Step" -ForegroundColor DarkGray
Write-Host "  Bekap: $BackupDir" -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Staryj: fst-uchet-14c02 (admin@fibercell.net)' -ForegroundColor DarkGray
Write-Host '  Novyj:  .env.target (nikegeorgian@gmail.com)' -ForegroundColor DarkGray
Write-Host ''

$scriptArgs = @{
  BackupDir = $BackupDir
}

if ($Step -eq 'All' -or $Step -eq 'Export') {
  Write-Host '--- SHAG 1: EKSPORT ---' -ForegroundColor Cyan
  $backupFile = Join-Path $BackupDir 'fst-backup-fibercell-main.json'
  if ((Test-Path $backupFile) -and $Step -eq 'All') {
    $reuse = Read-Host '  Bekap uzhe est. Perezapustit eksport? (y/N)'
    if ($reuse -notmatch '^[yY]') {
      Write-Host '  Propusk eksporta.' -ForegroundColor DarkGray
    } else {
      & "$PSScriptRoot\migrate-export.ps1" @scriptArgs
    }
  } else {
    & "$PSScriptRoot\migrate-export.ps1" @scriptArgs
  }
  Write-Host ''
}

if ($Step -eq 'All' -or $Step -eq 'Import') {
  Write-Host '--- SHAG 2: IMPORT ---' -ForegroundColor Cyan
  if (-not (Test-EnvTargetFile)) {
    Write-Host '  Zapolnite fst-web\.env.target i zapustite snova.' -ForegroundColor Yellow
    exit 1
  }
  & "$PSScriptRoot\migrate-import.ps1" @scriptArgs
  Write-Host ''
}

if ($Step -eq 'All' -or $Step -eq 'Deploy') {
  Write-Host '--- SHAG 3: DEPLOY PRAVIL ---' -ForegroundColor Cyan
  if (-not (Test-EnvTargetFile)) { exit 1 }
  & "$PSScriptRoot\migrate-deploy-target.ps1"
  Write-Host ''
}

Write-Banner 'Gotovo' 'Green'
Write-Host '  Proverte vhod v prilozhenie pod nikegeorgian@gmail.com' -ForegroundColor White
Write-Host '  Dobavte sotrudnikov (@fibercell.net) v Auth novogo proekta' -ForegroundColor DarkGray
Write-Host ''
