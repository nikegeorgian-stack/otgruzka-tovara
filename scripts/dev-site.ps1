# Запуск веб-кабинета FST (Firebase, как на production)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

Write-Host ""
Write-Host "  FST — веб-кабинет (Firebase)" -ForegroundColor Cyan
Write-Host "  http://localhost:5173" -ForegroundColor Green
Write-Host "  Деплой: npm run deploy" -ForegroundColor DarkGray
Write-Host ""

npm run dev
