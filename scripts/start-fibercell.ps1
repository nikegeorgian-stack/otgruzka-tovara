$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$AppUrl = 'http://localhost:5173/'

Write-Host ''
Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host '  FiberCell' -ForegroundColor Yellow
Write-Host "  $AppUrl" -ForegroundColor Green
Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host ''
Write-Host 'Остановка: Ctrl+C или закройте это окно.' -ForegroundColor DarkGray
Write-Host ''

Start-Process powershell.exe -ArgumentList @(
  '-NoProfile',
  '-Command',
  "Start-Sleep -Seconds 4; Start-Process '$AppUrl'"
) -WindowStyle Hidden | Out-Null

npm run dev

Write-Host ''
Write-Host 'Сервер остановлен.' -ForegroundColor Yellow
