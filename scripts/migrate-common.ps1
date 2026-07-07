# Shared helpers for FST Firebase migration scripts.
# Dot-source: . "$PSScriptRoot\migrate-common.ps1"

$ErrorActionPreference = 'Stop'

if (-not $ProjectRoot) {
  $ProjectRoot = Split-Path -Parent $PSScriptRoot
}
if (-not $FstWeb) {
  $FstWeb = Join-Path $ProjectRoot 'fst-web'
}
if (-not $DefaultBackupDir) {
  $DefaultBackupDir = 'E:\Fibercell-FST-pack\cloud-backup'
}

$SourceEmail = 'admin@fibercell.net'
$TargetEmail = 'nikegeorgian@gmail.com'
$SourceProjectId = 'fst-uchet-14c02'

function Write-Banner([string]$Title, [string]$Color = 'Yellow') {
  Write-Host ''
  Write-Host '========================================' -ForegroundColor DarkCyan
  Write-Host "  $Title" -ForegroundColor $Color
  Write-Host '========================================' -ForegroundColor DarkCyan
  Write-Host ''
}

function Wait-Enter([string]$Prompt = 'Nazhmite Enter, kogda budete gotovy...') {
  Read-Host $Prompt | Out-Null
}

function Read-SecureEnv([string]$Name, [string]$Prompt) {
  if ([string]::IsNullOrWhiteSpace((Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue).Value)) {
    $sec = Read-Host $Prompt -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    Set-Item -Path "Env:$Name" -Value $plain
    Write-Host "  $Name zadan." -ForegroundColor DarkGray
  } else {
    Write-Host "  $Name uzhe v okruzhenii." -ForegroundColor DarkGray
  }
}

function Test-EnvTargetFile {
  $path = Join-Path $FstWeb '.env.target'
  if (-not (Test-Path $path)) {
    Write-Host "  Net: $path" -ForegroundColor Red
    Write-Host '  Skopiruyte .env.target.example -> .env.target i vstavte klyuchi SDK.' -ForegroundColor Yellow
    return $false
  }
  $text = Get-Content $path -Raw
  if ($text -match 'YOUR-PROJECT-ID' -or $text -notmatch 'VITE_FIREBASE_PROJECT_ID=\S+') {
    Write-Host '  .env.target ne zapolnen.' -ForegroundColor Red
    return $false
  }
  if ($text -match 'VITE_FIREBASE_PROJECT_ID=(\S+)') {
    $script:TargetProjectId = $Matches[1].Trim()
    Write-Host "  Cel: $TargetProjectId" -ForegroundColor Green
  }
  return $true
}

function Get-TargetProjectIdFromEnv {
  $path = Join-Path $FstWeb '.env.target'
  if (-not (Test-Path $path)) { return $null }
  $text = Get-Content $path -Raw
  if ($text -match 'VITE_FIREBASE_PROJECT_ID=(\S+)') {
    return $Matches[1].Trim()
  }
  return $null
}

function Invoke-Npm([string[]]$Args) {
  Push-Location $ProjectRoot
  try {
    & npm @Args
    if ($LASTEXITCODE -ne 0) { throw "npm $($Args -join ' ') -> code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

function Open-GoogleLoginHint([string]$Email) {
  $encoded = [uri]::EscapeDataString($Email)
  $url = "https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fconsole.firebase.google.com%2F&Email=$encoded"
  Write-Host "  Otkryvayu Google dlya: $Email" -ForegroundColor DarkGray
  Start-Process $url
}

function Invoke-FirebaseLogin([string]$ExpectedEmail) {
  Write-Banner "Firebase CLI: $ExpectedEmail" 'Cyan'
  Open-GoogleLoginHint -Email $ExpectedEmail
  Wait-Enter 'Enter - otkroetsya OAuth Firebase CLI...'
  Push-Location $FstWeb
  try {
    & firebase login --reauth
    if ($LASTEXITCODE -ne 0) { throw 'firebase login failed' }
  } finally {
    Pop-Location
  }
  $list = & firebase login:list 2>&1 | Out-String
  Write-Host $list
}
