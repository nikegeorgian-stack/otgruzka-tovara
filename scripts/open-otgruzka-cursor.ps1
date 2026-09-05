# Ярлык «отгрузка товаров» — Cursor в проекте Otgruzka + чат с контекстом сессии.
$ErrorActionPreference = 'SilentlyContinue'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

$cursorExe = Join-Path $env:LOCALAPPDATA 'Programs\cursor\Cursor.exe'
if (-not (Test-Path $cursorExe)) {
  $cursorExe = Join-Path $env:LOCALAPPDATA 'Programs\Cursor\Cursor.exe'
}

if (Test-Path $cursorExe) {
  Start-Process -FilePath $cursorExe -ArgumentList "`"$ProjectRoot`""
} else {
  $cursorCli = Get-Command cursor -ErrorAction SilentlyContinue
  if ($cursorCli) {
    Start-Process -FilePath $cursorCli.Source -ArgumentList "`"$ProjectRoot`""
  }
}

Start-Sleep -Seconds 2

$prompt = @(
  'Продолжаем работу над Otgruzka (отгрузка товаров).'
  'Проект: tabel, GitHub nikegeorgian-stack/otgruzka-tovara.'
  'Прод: otgruzka-tovara.vercel.app и otgruzka-tovara.web.app.'
  'Перед правками читай .cursor/rules/fst-session-memory.mdc и fst-skill-router.mdc.'
  'Кратко: что уже сделано и что делаем дальше?'
) -join ' '

$encoded = [uri]::EscapeDataString($prompt)
$deeplink = "cursor://anysphere.cursor-deeplink/prompt?text=$encoded"
Start-Process $deeplink
