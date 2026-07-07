#Requires -Version 5.1
# Копирует FST на диск E: — полный пакет для переноса на другой аккаунт.
# Run: powershell -ExecutionPolicy Bypass -File scripts\setup-e-drive.ps1

$ErrorActionPreference = "Stop"
$Src = Split-Path $PSScriptRoot -Parent
$Dst = "E:\Fibercell-FST"

Write-Host "=== FST: копирование на $Dst ===" -ForegroundColor Cyan

if (-not (Test-Path "E:\")) {
  Write-Host "Диск E: не найден." -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force -Path $Dst | Out-Null

$excludeDirs = @(
  "node_modules", "dist", ".vercel", ".git\objects", "fst-web\dist", "fst-web\node_modules"
)

Write-Host "Копирование файлов (без node_modules, dist)..."
robocopy $Src $Dst /MIR /XD node_modules dist .vercel fst-web\dist fst-web\node_modules .git\objects `
  /XF *.local .env .env.production .env.target .env.vercel.* `
  /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null

# firebase.client.json — публичный конфиг текущего проекта
$clientJson = Join-Path $Src "fst-web\firebase.client.json"
if (Test-Path $clientJson) {
  Copy-Item $clientJson (Join-Path $Dst "fst-web\firebase.client.json") -Force
}

# Шаблоны для нового аккаунта
Copy-Item (Join-Path $Src "fst-web\.env.target.example") (Join-Path $Dst "fst-web\.env.target.example") -Force -ErrorAction SilentlyContinue

# README переноса
@'
# Fibercell FST — пакет для переноса

Скопировано с рабочего ПК для загрузки под **другой Firebase / Vercel / GitHub** аккаунт.

## Содержимое

- `app/` — исходники программы (корень репозитория)
- `cloud-backup/` — дамп Firestore (после export)
- `MIGRATION.md` — пошаговая инструкция

## Быстрый старт на новом ПК / аккаунте

```powershell
cd E:\Fibercell-FST
npm install
cd fst-web
copy .env.target.example .env.target
# заполните .env.target ключами НОВОГО Firebase-проекта
```

## Экспорт базы (если ещё не сделан)

```powershell
$env:FST_SOURCE_PASSWORD="пароль admin@fibercell.net"
npm run export:cloud-backup -- --out=E:\Fibercell-FST\cloud-backup
```

## Импорт в новый Firebase

```powershell
$env:FST_TARGET_PASSWORD="пароль в новом проекте"
npm run import:cloud-backup -- --in=E:\Fibercell-FST\cloud-backup
npm run switch:firebase-project
```

## Деплой

```powershell
cd fst-web
firebase login
firebase use <NEW_PROJECT_ID>
npm run deploy:firestore-rules
cd ..
vercel login
vercel link
vercel --prod
```

Текущий production (до переноса): https://fst-uchet-theta.vercel.app  
Текущий Firebase: fst-uchet-14c02
'@ | Set-Content -Encoding UTF8 (Join-Path $Dst "README-MIGRATION.txt")

Write-Host "Установка зависимостей npm..."
Set-Location $Dst
npm install 2>&1 | Out-Host

Write-Host ""
Write-Host "Готово: $Dst" -ForegroundColor Green
Write-Host "Дальше: export базы (нужен FST_SOURCE_PASSWORD) или перенесите папку на другой ПК."
