# Nika Start — открыть FST в Cursor и поднять dev-сервер
param(
  [switch]$IdeOnly,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')

$AppUrl = 'http://localhost:5173/'

function Open-CursorProject {
  param([string]$Root)
  $candidates = @(
    "$env:LOCALAPPDATA\Programs\cursor\Cursor.exe",
    "$env:LOCALAPPDATA\Programs\Cursor\Cursor.exe"
  )
  foreach ($exe in $candidates) {
    if (Test-Path $exe) {
      Start-Process -FilePath $exe -ArgumentList "`"$Root`""
      return $true
    }
  }
  $cursorCli = Get-Command cursor -ErrorAction SilentlyContinue
  if ($cursorCli) {
    Start-Process -FilePath $cursorCli.Source -ArgumentList "`"$Root`""
    return $true
  }
  return $false
}

Write-Host ''
Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host '  Nika Start · FST (tabel)' -ForegroundColor Yellow
Write-Host "  $ProjectRoot" -ForegroundColor DarkGray
Write-Host '========================================' -ForegroundColor DarkCyan
Write-Host ''

if (-not (Open-CursorProject -Root $ProjectRoot)) {
  Write-Host 'Cursor не найден — откройте папку вручную:' -ForegroundColor Yellow
  Write-Host $ProjectRoot -ForegroundColor White
}

if ($IdeOnly) {
  Write-Host 'Режим: только Cursor (-IdeOnly).' -ForegroundColor DarkGray
  exit 0
}

$devCmd = @"
Set-Location '$ProjectRoot'
`$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
Write-Host ''
Write-Host '  FST dev → $AppUrl' -ForegroundColor Green
Write-Host '  Остановка: Ctrl+C' -ForegroundColor DarkGray
Write-Host ''
npm run dev
"@

Start-Process powershell.exe -ArgumentList @(
  '-NoExit',
  '-NoProfile',
  '-ExecutionPolicy', 'Bypass',
  '-Command', $devCmd
) | Out-Null

if (-not $NoBrowser) {
  Start-Process powershell.exe -ArgumentList @(
    '-NoProfile',
    '-Command',
    "Start-Sleep -Seconds 4; Start-Process '$AppUrl'"
  ) -WindowStyle Hidden | Out-Null
}

Write-Host "Dev-сервер запускается → $AppUrl" -ForegroundColor Green
Write-Host ''
