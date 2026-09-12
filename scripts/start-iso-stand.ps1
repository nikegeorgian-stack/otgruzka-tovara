# Reproducible local timesheet/payroll stand (review worktree)
#
# Prerequisites: fnm Node 22 (better-sqlite3 prebuild). Do NOT use system Node 24.
#
# From worktree root:
#   powershell -ExecutionPolicy Bypass -File scripts/start-iso-stand.ps1
#
# Then UI: http://127.0.0.1:5173
# SQLite API: http://127.0.0.1:3847/api/health
# DB file: data/tabel-iso-s1s8.db

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:TABEL_DB_PATH = Join-Path $Root 'data\tabel-iso-s1s8.db'
$env:TABEL_DB_PORT = '3847'
$env:TABEL_DB_HOST = '127.0.0.1'
$env:VITE_LOCAL_DB = 'true'
$env:VITE_FST_WEB = ''

# Load remaining .env keys without clobbering the above
$envFile = Join-Path $Root '.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $k, $v = $_.Split('=', 2)
    $k = $k.Trim(); $v = $v.Trim()
    if ($k -in @('TABEL_DB_PATH','TABEL_DB_PORT','TABEL_DB_HOST','VITE_LOCAL_DB','VITE_FST_WEB')) { return }
    if ($k) { Set-Item -Path "Env:$k" -Value $v }
  }
}

foreach ($p in 3847, 5173) {
  Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue | ForEach-Object {
    try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
  }
}
Start-Sleep -Seconds 1

$node22 = & fnm exec --using=22 -- node -p "process.execPath"
if (-not $node22) { throw 'fnm Node 22 required: fnm install 22' }

Write-Host "SQLite: $node22 → $($env:TABEL_DB_PATH)"
Start-Process -FilePath $node22 -ArgumentList 'server/index.mjs' -WorkingDirectory $Root -WindowStyle Hidden
Start-Sleep -Seconds 2
$health = Invoke-RestMethod "http://127.0.0.1:$($env:TABEL_DB_PORT)/api/health"
Write-Host ($health | ConvertTo-Json -Compress)

Write-Host "Vite: http://127.0.0.1:5173 (VITE_LOCAL_DB=true)"
# Keep vite in foreground for this script's caller, or start hidden:
Start-Process -FilePath "C:\Program Files\nodejs\npx.cmd" -ArgumentList 'vite --host 127.0.0.1 --port 5173' -WorkingDirectory $Root -WindowStyle Hidden
Start-Sleep -Seconds 3
Write-Host "Stand ready."
