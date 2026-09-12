# Start local SQLite API with Node 22 (better-sqlite3 prebuild abi 127).
# System Node 24 cannot load/rebuild the native module without VS C++ tools.
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

# Load .env (TABEL_DB_PATH, PORT, HOST) without extra deps
$envFile = Join-Path $Root '.env'
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $k, $v = $_.Split('=', 2)
    $k = $k.Trim(); $v = $v.Trim()
    if ($k -and -not [string]::IsNullOrEmpty($v)) {
      Set-Item -Path "Env:$k" -Value $v
    }
  }
}

$node22 = & fnm exec --using=22 -- node -p "process.execPath"
if (-not $node22) { throw 'fnm Node 22 not found. Install: fnm install 22' }

$env:TABEL_DB_PORT = if ($env:TABEL_DB_PORT) { $env:TABEL_DB_PORT } else { '3847' }
$env:TABEL_DB_HOST = if ($env:TABEL_DB_HOST) { $env:TABEL_DB_HOST } else { '127.0.0.1' }

Write-Host "Starting SQLite API with $($node22) (v$((& $node22 -v))) on $($env:TABEL_DB_HOST):$($env:TABEL_DB_PORT)"
Write-Host "DB: $($env:TABEL_DB_PATH)"
& $node22 server/index.mjs
