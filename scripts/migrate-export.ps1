# Eksport bazy FST v JSON (staryj proekt admin@fibercell.net)
# Run: powershell -ExecutionPolicy Bypass -File scripts\migrate-export.ps1
#      powershell -ExecutionPolicy Bypass -File scripts\migrate-export.ps1 -BackupDir D:\backup

param(
  [string]$BackupDir = $null
)

. "$PSScriptRoot\migrate-common.ps1"

if (-not $BackupDir) { $BackupDir = $DefaultBackupDir }

Write-Banner 'Eksport bazy (fst-uchet-14c02)' 'Green'
Write-Host "  Email:  $SourceEmail" -ForegroundColor White
Write-Host "  Papka:  $BackupDir" -ForegroundColor White
Write-Host ''

Read-SecureEnv 'FST_SOURCE_PASSWORD' "Parol $SourceEmail"

$nodeArgs = @(
  'fst-web/scripts/export-cloud-backup.mjs',
  "--out=$BackupDir"
)

Push-Location $ProjectRoot
try {
  & node @nodeArgs
  if ($LASTEXITCODE -ne 0) { throw 'export failed' }
} finally {
  Pop-Location
}

Write-Banner 'Eksport gotov' 'Green'
Write-Host "  Fayl: $BackupDir\fst-backup-fibercell-main.json" -ForegroundColor White
Write-Host ''
