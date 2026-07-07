# Perekljuchenie na .env.target + deploy Firestore/Storage rules
# Run: powershell -ExecutionPolicy Bypass -File scripts\migrate-deploy-target.ps1

param(
  [switch]$SkipLogin
)

. "$PSScriptRoot\migrate-common.ps1"

Write-Banner 'Deploy v celevoj proekt' 'Magenta'

if (-not (Test-EnvTargetFile)) { exit 1 }

if (-not $SkipLogin) {
  Invoke-FirebaseLogin -ExpectedEmail $TargetEmail
}

Write-Host 'Perekljuchenie firebase.client.json...' -ForegroundColor Cyan
Invoke-Npm @('run', 'switch:firebase-project')

Push-Location $FstWeb
try {
  & firebase use $TargetProjectId
  if ($LASTEXITCODE -ne 0) { throw 'firebase use failed' }

  Write-Host 'Deploy firestore.rules + storage.rules...' -ForegroundColor Cyan
  & npm run sync:firestore-rules
  if ($LASTEXITCODE -ne 0) { throw 'sync rules failed' }

  & firebase deploy --only firestore:rules,storage --project $TargetProjectId
  if ($LASTEXITCODE -ne 0) { throw 'firebase deploy failed' }
} finally {
  Pop-Location
}

Write-Banner 'Deploy pravil gotov' 'Green'
Write-Host "  Proekt: $TargetProjectId" -ForegroundColor White
Write-Host '  Vercel (po zhelaniyu): npm run deploy:cloud' -ForegroundColor DarkGray
Write-Host ''
