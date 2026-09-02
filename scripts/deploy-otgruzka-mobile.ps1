# APK + UI deploy: build Android, publish direct download + app-version.json, then Vercel/Hosting.
# Run: npm run deploy:otgruzka:mobile

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$FstWeb = Join-Path $ProjectRoot 'fst-web'

Push-Location $ProjectRoot
try {
  if (Test-Path (Join-Path $FstWeb '.env.target')) {
    Copy-Item (Join-Path $FstWeb '.env.target') (Join-Path $FstWeb '.env.production') -Force
  }

  Write-Host 'tsc --noEmit...' -ForegroundColor Cyan
  npm exec -- tsc --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'tsc failed' }

  Write-Host 'build:apk (Capacitor + Gradle)...' -ForegroundColor Cyan
  npm run build:apk
  if ($LASTEXITCODE -ne 0) { throw 'build:apk failed' }

  & (Join-Path $ProjectRoot 'scripts\deploy-otgruzka-quick.ps1')
} finally {
  Pop-Location
}
