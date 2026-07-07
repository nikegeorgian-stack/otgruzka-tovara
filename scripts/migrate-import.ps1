# Import bazy v novyj Firebase (.env.target)
# Run: powershell -ExecutionPolicy Bypass -File scripts\migrate-import.ps1
#      powershell -ExecutionPolicy Bypass -File scripts\migrate-import.ps1 -BackupDir E:\Fibercell-FST-pack\cloud-backup

param(
  [string]$BackupDir = $null
)

. "$PSScriptRoot\migrate-common.ps1"

if (-not $BackupDir) { $BackupDir = $DefaultBackupDir }

Write-Banner 'Import bazy v cel' 'Green'

if (-not (Test-EnvTargetFile)) { exit 1 }

$backupFile = Join-Path $BackupDir 'fst-backup-fibercell-main.json'
if (-not (Test-Path $backupFile)) {
  Write-Host "  Net bekapa: $backupFile" -ForegroundColor Red
  Write-Host '  Snachala: scripts\migrate-export.ps1' -ForegroundColor Yellow
  exit 1
}

Write-Host "  Email:  $TargetEmail" -ForegroundColor White
Write-Host "  Proekt: $TargetProjectId" -ForegroundColor White
Write-Host "  Iz:     $backupFile" -ForegroundColor White
Write-Host ''

Read-SecureEnv 'FST_TARGET_PASSWORD' "Parol $TargetEmail"

$nodeArgs = @(
  'fst-web/scripts/import-cloud-backup.mjs',
  "--in=$BackupDir"
)

Push-Location $ProjectRoot
try {
  & node @nodeArgs
  if ($LASTEXITCODE -ne 0) { throw 'import failed' }
} finally {
  Pop-Location
}

Write-Banner 'Import zavershon' 'Green'
Write-Host '  Dalyshe: scripts\migrate-deploy-target.ps1' -ForegroundColor White
Write-Host ''
