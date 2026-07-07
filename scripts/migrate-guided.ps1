# FST - poshagovaja migracija Firebase s podskazkami, pod kakoj uchetkoj vhodit.
# Run: npm run migrate:guided
#      npm run migrate:guided -- -Step Login
#      npm run migrate:guided -- -Step Migrate
#      npm run migrate:guided -- -Step Deploy

param(
  [ValidateSet('All', 'Login', 'Migrate', 'Deploy')]
  [string]$Step = 'All',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$FstWeb = Join-Path $ProjectRoot 'fst-web'
Set-Location $ProjectRoot

$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

# --- Учётки (держите в sync с fst-web/scripts/_firebaseEnv.mjs) ---
$SourceFirebaseCli = 'admin@fibercell.net'
$TargetFirebaseCli = 'nikegeorgian@gmail.com'
$SourceAppEmail = 'admin@fibercell.net'
$TargetAppEmail = 'nikegeorgian@gmail.com'
$SourceProjectId = 'fst-uchet-14c02'

function Write-Banner([string]$Title, [string]$Color = 'Yellow') {
  Write-Host ''
  Write-Host '========================================' -ForegroundColor DarkCyan
  Write-Host "  $Title" -ForegroundColor $Color
  Write-Host '========================================' -ForegroundColor DarkCyan
  Write-Host ''
}

function Write-AccountHint([string]$Role, [string]$Email, [string]$Why) {
  Write-Host "  Роль:    $Role" -ForegroundColor Cyan
  Write-Host "  Email:   $Email" -ForegroundColor White
  Write-Host "  Зачем:   $Why" -ForegroundColor DarkGray
  Write-Host ''
}

function Wait-Enter([string]$Prompt = 'Нажмите Enter, когда будете готовы...') {
  Read-Host $Prompt | Out-Null
}

function Get-FirebaseCliEmail {
  Push-Location $FstWeb
  try {
    $out = & firebase login:list 2>&1 | Out-String
    if ($out -match 'Logged in as\s+(\S+)') { return $Matches[1].Trim() }
    return $null
  } catch { return $null }
  finally { Pop-Location }
}

function Open-GoogleAccountHint([string]$Email) {
  $encoded = [uri]::EscapeDataString($Email)
  $url = "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fconsole.firebase.google.com%2F&Email=$encoded"
  Write-Host "  Открываю подсказку Google для: $Email" -ForegroundColor DarkGray
  Start-Process $url
}

function Invoke-GuidedFirebaseLogin {
  param(
    [string]$ExpectedEmail,
    [string]$Purpose,
    [string]$ProjectId = ''
  )

  Write-Banner 'Firebase CLI - вход' 'Yellow'
  Write-AccountHint 'Firebase CLI (деплой правил)' $ExpectedEmail $Purpose
  if ($ProjectId) {
    Write-Host "  Проект:  $ProjectId" -ForegroundColor White
    Write-Host ''
  }

  $current = Get-FirebaseCliEmail
  if ($current -and $current.ToLower() -eq $ExpectedEmail.ToLower()) {
    Write-Host "  Уже вошли как $current - повторный вход не нужен." -ForegroundColor Green
    Write-Host ''
    return
  }
  if ($current) {
    Write-Host "  Сейчас CLI: $current" -ForegroundColor Yellow
    Write-Host "  Нужен:      $ExpectedEmail" -ForegroundColor Yellow
    Write-Host ''
  }

  Write-Host '  1. Сейчас откроется страница Google - выберите именно этот email.' -ForegroundColor White
  Write-Host '  2. Затем в терминале откроется OAuth Firebase CLI.' -ForegroundColor White
  Write-Host '  3. Если предложит другой аккаунт - Use another account.' -ForegroundColor White
  Write-Host ''
  Wait-Enter

  Open-GoogleAccountHint -Email $ExpectedEmail
  Start-Sleep -Seconds 2

  Push-Location $FstWeb
  try {
    & firebase login --reauth
    if ($LASTEXITCODE -ne 0) { throw "firebase login завершился с кодом $LASTEXITCODE" }
  } finally { Pop-Location }

  $after = Get-FirebaseCliEmail
  if (-not $after) {
    Write-Host '  Не удалось определить email после входа.' -ForegroundColor Red
    return
  }
  if ($after.ToLower() -ne $ExpectedEmail.ToLower()) {
    Write-Host "  Внимание: вошли как $after, ожидался $ExpectedEmail" -ForegroundColor Red
    Write-Host '  Для деплоя в новый проект нужен именно целевой аккаунт.' -ForegroundColor Yellow
  } else {
    Write-Host "  OK: Firebase CLI -> $after" -ForegroundColor Green
  }
  Write-Host ''
}

function Invoke-GuidedVercelLogin {
  param([string]$ExpectedEmail = $TargetFirebaseCli)

  Write-Banner 'Vercel CLI - вход' 'Magenta'
  Write-AccountHint 'Vercel (деплой сайта)' $ExpectedEmail 'Публикация fst-uchet на Vercel под вашей учёткой'

  $who = $null
  try { $who = (& vercel whoami 2>&1 | Out-String).Trim() } catch {}
  if ($who -and $who -notmatch 'Error|not logged') {
    Write-Host "  Сейчас Vercel: $who" -ForegroundColor DarkGray
    $reuse = Read-Host '  Перелогиниться? (y/N)'
    if ($reuse -notmatch '^[yY]') {
      Write-Host '  Пропуск Vercel login.' -ForegroundColor DarkGray
      Write-Host ''
      return
    }
  }

  Write-Host '  Сейчас откроется браузер Vercel - войдите под нужной учеткой.' -ForegroundColor White
  Write-Host "  Рекомендуемый email: $ExpectedEmail" -ForegroundColor Cyan
  Write-Host ''
  Wait-Enter
  & vercel login
  Write-Host ''
}

function Test-EnvTarget {
  $path = Join-Path $FstWeb '.env.target'
  if (-not (Test-Path $path)) {
    Write-Host '  Нет fst-web/.env.target' -ForegroundColor Red
    Write-Host '  Скопируйте .env.target.example -> .env.target и вставьте ключи из Firebase Console.' -ForegroundColor Yellow
    Write-Host "  Проект создайте под: $TargetFirebaseCli" -ForegroundColor Yellow
    return $false
  }
  $text = Get-Content $path -Raw
  if ($text -notmatch 'VITE_FIREBASE_PROJECT_ID=\S+' -or $text -match 'YOUR-PROJECT-ID') {
    Write-Host '  .env.target не заполнен (нужен VITE_FIREBASE_PROJECT_ID и ключи SDK).' -ForegroundColor Red
    return $false
  }
  if ($text -match 'VITE_FIREBASE_PROJECT_ID=(\S+)') {
    $script:TargetProjectId = $Matches[1].Trim()
    Write-Host "  Целевой проект: $TargetProjectId" -ForegroundColor Green
  }
  return $true
}

function Read-AppPasswords {
  Write-Banner 'Пароли приложения (Firestore)' 'Yellow'
  Write-Host '  Пароли вводятся здесь, в терминал - не в чат Cursor.' -ForegroundColor DarkGray
  Write-Host ''
  Write-AccountHint 'Источник (чтение базы)' $SourceAppEmail "Пользователь Auth в проекте $SourceProjectId"
  Write-AccountHint 'Цель (запись базы)' $TargetAppEmail 'Пользователь Auth в НОВОМ Firebase-проекте'
  Write-Host ''

  if (-not $env:FST_SOURCE_PASSWORD) {
    $sec = Read-Host "  Пароль $SourceAppEmail" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $env:FST_SOURCE_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  } else {
    Write-Host "  FST_SOURCE_PASSWORD уже задан в окружении." -ForegroundColor DarkGray
  }

  if (-not $env:FST_TARGET_PASSWORD) {
    $sec = Read-Host "  Пароль $TargetAppEmail" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $env:FST_TARGET_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  } else {
    Write-Host "  FST_TARGET_PASSWORD уже задан в окружении." -ForegroundColor DarkGray
  }
  Write-Host ''
}

function Invoke-MigrateData {
  Write-Banner 'Копирование базы Firestore' 'Green'
  Write-Host "  $SourceProjectId  ->  $TargetProjectId" -ForegroundColor White
  Write-Host ''

  if ($DryRun) {
    npm run migrate:firebase-project:dry
  } else {
    npm run migrate:firebase-project
  }
  if ($LASTEXITCODE -ne 0) { throw 'migrate:firebase-project завершился с ошибкой' }
}

function Invoke-SwitchAndDeploy {
  if (-not $TargetProjectId) {
    if (-not (Test-EnvTarget)) { throw 'Нет .env.target' }
  }

  Write-Banner 'Переключение приложения + правила' 'Green'
  npm run switch:firebase-project
  if ($LASTEXITCODE -ne 0) { throw 'switch:firebase-project failed' }

  Invoke-GuidedFirebaseLogin -ExpectedEmail $TargetFirebaseCli `
    -Purpose 'Деплой firestore.rules и storage.rules в НОВЫЙ проект' `
    -ProjectId $TargetProjectId

  Push-Location $FstWeb
  try {
    & firebase use $TargetProjectId
    if ($LASTEXITCODE -ne 0) { throw 'firebase use failed' }
    npm run deploy:firestore-rules
    if ($LASTEXITCODE -ne 0) { throw 'deploy:firestore-rules failed' }
  } finally { Pop-Location }
}

function Invoke-VercelDeploy {
  Invoke-GuidedVercelLogin -ExpectedEmail $TargetFirebaseCli
  Write-Banner 'Деплой на Vercel' 'Magenta'
  npm run deploy:cloud
}

# --- main ---
$script:TargetProjectId = $null

Write-Banner 'FST: migracija pod nikegeorgian@gmail.com' 'Yellow'
Write-Host '  Шаги с подсказками: какой email, когда откроется браузер.' -ForegroundColor DarkGray
Write-Host "  Режим: $Step$(if ($DryRun) { ' (dry-run)' })" -ForegroundColor DarkGray
Write-Host ''

if ($Step -eq 'All' -or $Step -eq 'Login') {
  Write-Host '--- Этап A: проверка .env.target ---' -ForegroundColor Cyan
  $hasTarget = Test-EnvTarget
  if (-not $hasTarget) {
    Write-Host ''
    Write-Host '  Создайте проект в Firebase Console под nikegeorgian@gmail.com,' -ForegroundColor Yellow
    Write-Host '  затем заполните fst-web/.env.target и запустите скрипт снова.' -ForegroundColor Yellow
    if ($Step -eq 'Login') { exit 1 }
  }
  Write-Host ''

  Write-Host '--- Этап B: Firebase CLI (целевой проект) ---' -ForegroundColor Cyan
  if ($hasTarget) {
    Invoke-GuidedFirebaseLogin -ExpectedEmail $TargetFirebaseCli `
      -Purpose 'Владелец нового Firebase-проекта' `
      -ProjectId $TargetProjectId
  } else {
    Invoke-GuidedFirebaseLogin -ExpectedEmail $TargetFirebaseCli `
      -Purpose 'Владелец нового Firebase-проекта (создайте проект, если ещё нет)'
  }
}

if ($Step -eq 'All' -or $Step -eq 'Migrate') {
  if (-not (Test-EnvTarget)) { exit 1 }
  Read-AppPasswords
  Invoke-MigrateData
}

if ($Step -eq 'All' -or $Step -eq 'Deploy') {
  if (-not (Test-EnvTarget)) { exit 1 }
  Invoke-SwitchAndDeploy
  $deploy = Read-Host '  Задеплоить на Vercel сейчас? (y/N)'
  if ($deploy -match '^[yY]') { Invoke-VercelDeploy }
}

Write-Banner 'Готово' 'Green'
Write-Host '  Проверьте вход в приложении под nikegeorgian@gmail.com.' -ForegroundColor White
Write-Host '  Команду сотрудников (@fibercell.net) добавьте в Auth нового проекта.' -ForegroundColor DarkGray
Write-Host ''
