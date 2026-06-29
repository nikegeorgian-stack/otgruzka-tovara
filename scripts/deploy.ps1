<#
  FST — деплой веб-версии.
  Использование:
    powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1            # меню выбора
    powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Target firebase
    powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Target vercel
    powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Target all
#>
param(
  [ValidateSet('firebase', 'vercel', 'all', 'ask')]
  [string]$Target = 'ask'
)

$ErrorActionPreference = 'Stop'

# Консоль в UTF-8, чтобы кириллица в меню/сообщениях не превращалась в кракозябры.
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  chcp 65001 > $null
} catch { }

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$WebDir = Join-Path $ProjectRoot 'fst-web'
$FirebaseProject = 'fst-uchet-14c02'
$FirebaseUrl = 'https://fst-uchet-14c02.web.app'
$VercelUrl = 'https://fst-uchet-theta.vercel.app'

function Write-Step($text) { Write-Host "`n>>> $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "OK  $text" -ForegroundColor Green }
function Write-Warn2($text) { Write-Host "!!  $text" -ForegroundColor Yellow }

if ($Target -eq 'ask') {
  Write-Host ''
  Write-Host '========================================' -ForegroundColor DarkCyan
  Write-Host '  FST — деплой' -ForegroundColor Yellow
  Write-Host '========================================' -ForegroundColor DarkCyan
  Write-Host '  1) Firebase  (' -NoNewline; Write-Host $FirebaseUrl -ForegroundColor Green -NoNewline; Write-Host ')'
  Write-Host '  2) Vercel    (' -NoNewline; Write-Host $VercelUrl -ForegroundColor Green -NoNewline; Write-Host ')'
  Write-Host '  3) Оба'
  Write-Host ''
  $choice = Read-Host 'Выбор [1/2/3]'
  switch ($choice) {
    '1' { $Target = 'firebase' }
    '2' { $Target = 'vercel' }
    '3' { $Target = 'all' }
    default { Write-Warn2 'Отмена.'; exit 1 }
  }
}

function Deploy-Firebase {
  Write-Step 'Firebase: проверка логина'
  $who = (firebase login:list 2>&1 | Out-String)
  if ($who -notmatch 'Logged in as') {
    Write-Warn2 'Не выполнен вход в Firebase. Запускаю firebase login...'
    firebase login
  } else {
    Write-Ok ($who.Trim())
  }

  Write-Step 'Firebase: сборка и деплой hosting'
  Set-Location $WebDir
  npm run deploy:hosting
  if ($LASTEXITCODE -ne 0) { throw 'Деплой Firebase завершился с ошибкой.' }
  Write-Ok "Готово: $FirebaseUrl"
}

function Deploy-Vercel {
  Write-Step 'Vercel: проверка логина'
  $who = (vercel whoami 2>&1 | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($who) -or $who -match 'Error') {
    Write-Warn2 'Не выполнен вход в Vercel. Запускаю vercel login...'
    vercel login
  } else {
    Write-Ok "Logged in as $who"
  }

  Write-Step 'Vercel: деплой прод (--prod)'
  Set-Location $ProjectRoot
  npm run deploy:cloud
  if ($LASTEXITCODE -ne 0) { throw 'Деплой Vercel завершился с ошибкой.' }
  Write-Ok "Готово: $VercelUrl"
}

try {
  if ($Target -eq 'firebase' -or $Target -eq 'all') { Deploy-Firebase }
  if ($Target -eq 'vercel' -or $Target -eq 'all') { Deploy-Vercel }
  Write-Host "`n✓ Деплой завершён." -ForegroundColor Green
} catch {
  Write-Host "`n✗ $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  Set-Location $ProjectRoot
}

if ($Host.Name -eq 'ConsoleHost') {
  Write-Host ''
  Read-Host 'Нажмите Enter, чтобы закрыть'
}
