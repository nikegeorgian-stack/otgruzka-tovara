$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$Port = if ($env:TABEL_DB_PORT) { $env:TABEL_DB_PORT } else { '3847' }
$ServerUrl = "http://localhost:$Port/"
$HealthUrl = "${ServerUrl}api/health"

Write-Host ''
Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host '  FiberCell — локальный сервер (SQLite)' -ForegroundColor Yellow
Write-Host "  $ServerUrl" -ForegroundColor Green
Write-Host "  Проверка: $HealthUrl" -ForegroundColor DarkGray
Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host ''
Write-Host 'Остановка: Ctrl+C или закройте это окно.' -ForegroundColor DarkGray
Write-Host ''

npm run dev:db

Write-Host ''
Write-Host 'Локальный сервер остановлен.' -ForegroundColor Yellow
