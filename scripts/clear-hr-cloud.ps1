<#
  Очистка всего персонала в облаке Firestore (fstStores/fibercell-main).
  Запуск из корня репозитория:
    powershell -ExecutionPolicy Bypass -File scripts\clear-hr-cloud.ps1
#>
param(
  [string]$Password
)

$ErrorActionPreference = 'Stop'

try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
  chcp 65001 > $null
} catch { }

$ProjectRoot = Split-Path -Parent $PSScriptRoot

if (-not $Password) {
  if ($env:FST_ADMIN_PASSWORD) {
    $Password = $env:FST_ADMIN_PASSWORD
  } else {
    $sec = Read-Host 'FST_ADMIN_PASSWORD (admin@fibercell.net)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try {
      $Password = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}

if ([string]::IsNullOrWhiteSpace($Password)) {
  Write-Host 'Пароль не задан.' -ForegroundColor Red
  exit 1
}

$env:FST_ADMIN_PASSWORD = $Password
Set-Location $ProjectRoot
npm run clear:hr-cloud
exit $LASTEXITCODE
