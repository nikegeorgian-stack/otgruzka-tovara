# Vercel login v Yandex Browser (nikegeorgian@gmail.com).
# Run: powershell -File scripts\vercel-login-as.ps1

$ErrorActionPreference = 'Stop'
$Browsers = Join-Path $PSScriptRoot 'browsers'
$Yandex = Join-Path $Browsers 'open-yandex.ps1'

Write-Host ''
Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host '  Vercel CLI -> nikegeorgian@gmail.com' -ForegroundColor Yellow
Write-Host '  Brauzer:      Yandex (inkognito)' -ForegroundColor Cyan
Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host ''

& $Yandex -Url 'https://vercel.com/login'
Start-Sleep -Seconds 2

Write-Host 'Otkryvayu OAuth Vercel v Yandex...' -ForegroundColor White
$env:BROWSER = Join-Path $Browsers 'open-yandex.cmd'
try {
  & vercel login
  if ($LASTEXITCODE -ne 0) { throw "vercel login -> $LASTEXITCODE" }
} finally {
  Remove-Item Env:BROWSER -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host 'Tekushchij akkaunt:' -ForegroundColor Green
& vercel whoami
Write-Host ''
