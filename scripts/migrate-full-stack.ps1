# Polnyj perenos FST: Firebase + GitHub + Vercel
# Run: powershell -ExecutionPolicy Bypass -File scripts\migrate-full-stack.ps1
#      powershell -ExecutionPolicy Bypass -File scripts\migrate-full-stack.ps1 -Step Firebase

param(
  [ValidateSet('All', 'Firebase', 'GitHub', 'Vercel', 'Check')]
  [string]$Step = 'Check',
  [string]$BackupDir = 'E:\Fibercell-FST-pack\cloud-backup',
  [string]$NewGitHubRepo = '',
  [string]$NewVercelProject = 'fst-uchet'
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\migrate-common.ps1"

$OldGitHub = 'FBcellAdmin/FST-uchet'
$OldVercelUrl = 'https://fst-uchet-theta.vercel.app'
$OldFirebase = 'fst-uchet-14c02'

function Show-Status {
  Write-Banner 'Tekushchij status' 'Cyan'

  $backup = Join-Path $BackupDir 'fst-backup-fibercell-main.json'
  Write-Host "  Bekap bazy:        $(if (Test-Path $backup) { 'OK' } else { 'NET' })" -ForegroundColor $(if (Test-Path $backup) { 'Green' } else { 'Red' })
  Write-Host "  .env.target:       $(if (Test-EnvTargetFile) { "OK ($TargetProjectId)" } else { 'NET' })" -ForegroundColor $(if ($script:TargetProjectId) { 'Green' } else { 'Red' })

  $client = Join-Path $FstWeb 'firebase.client.json'
  if (Test-Path $client) {
    $json = Get-Content $client -Raw | ConvertFrom-Json
    Write-Host "  firebase.client:   $($json.VITE_FIREBASE_PROJECT_ID)" -ForegroundColor White
  }

  try {
    $gh = (& gh auth status 2>&1 | Out-String).Trim()
    if ($gh -match 'Logged in to github.com account (\S+)') {
      Write-Host "  GitHub CLI:        $($Matches[1])" -ForegroundColor White
    } else {
      Write-Host '  GitHub CLI:        ne zaloginen' -ForegroundColor Yellow
    }
  } catch {
    Write-Host '  GitHub CLI:        ne ustanovlen' -ForegroundColor Yellow
  }

  try {
    $vercel = (& vercel whoami 2>&1 | Out-String).Trim()
    if ($vercel -and $vercel -notmatch 'Error') {
      Write-Host "  Vercel CLI:        $vercel" -ForegroundColor White
    } else {
      Write-Host '  Vercel CLI:        ne zaloginen' -ForegroundColor Yellow
    }
  } catch {
    Write-Host '  Vercel CLI:        ne ustanovlen' -ForegroundColor Yellow
  }

  Write-Host ''
  Write-Host "  Staroe: $OldFirebase | $OldGitHub | $OldVercelUrl" -ForegroundColor DarkGray
  Write-Host ''
}

function Invoke-FirebasePhase {
  Write-Banner 'FAZA 1: Firebase (baza + pravila)' 'Green'
  Write-Host '  Cel: nikegeorgian@gmail.com, proekt iz .env.target' -ForegroundColor White
  Write-Host ''

  if (-not (Test-Path (Join-Path $BackupDir 'fst-backup-fibercell-main.json'))) {
    & "$PSScriptRoot\migrate-export.ps1" -BackupDir $BackupDir
  } else {
    Write-Host '  Bekap uzhe est - propusk eksporta.' -ForegroundColor DarkGray
  }

  if (-not (Test-EnvTargetFile)) {
    Write-Host ''
    Write-Host '  Sozdayte fst-web\.env.target (kluchi novogo Firebase).' -ForegroundColor Yellow
    Write-Host '  Shablom: fst-web\.env.target.example' -ForegroundColor Yellow
    exit 1
  }

  & "$PSScriptRoot\migrate-import.ps1" -BackupDir $BackupDir
  & "$PSScriptRoot\migrate-deploy-target.ps1"
}

function Invoke-GitHubPhase {
  param([string]$Repo)

  Write-Banner 'FAZA 2: GitHub (novyj repozitorij)' 'Magenta'

  if (-not $Repo) {
    $Repo = Read-Host '  Imya repozitoriya (napr. fst-uchet)'
    if (-not $Repo) { throw 'Ukazhite repozitorij' }
  }

  Write-Host ''
  Write-Host '  1. Vojdite v GitHub pod nikegeorgian@gmail.com:' -ForegroundColor White
  Write-Host '     gh auth login' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '  2. Sozdaem repozitorij i push:' -ForegroundColor White

  $doGh = Read-Host '  Zapustit gh sejchas? (y/N)'
  if ($doGh -notmatch '^[yY]') {
    Write-Host '  Vruchnuyu: github.com -> New repository -> push kod' -ForegroundColor Yellow
    return
  }

  Push-Location $ProjectRoot
  try {
    if (-not (Test-Path '.git')) { throw 'Net git v papke proekta' }

    $status = & git status --porcelain 2>&1
    if ($status) {
      Write-Host '  Est neschachennye izmeneniya. Snachala commit.' -ForegroundColor Yellow
      & git status -sb
      $commit = Read-Host '  Sdelat commit sejchas? (y/N)'
      if ($commit -match '^[yY]') {
        & git add -A
        $msg = Read-Host '  Soobshchenie commita' 
        if (-not $msg) { $msg = 'chore: migrate to personal Firebase/Vercel/GitHub' }
        & git commit -m $msg
      }
    }

    & gh repo create $Repo --private --source . --remote new-origin --push
    Write-Host ''
    Write-Host '  Novyj remote: new-origin' -ForegroundColor Green
    Write-Host '  Posle proverki: git remote rename origin old-origin; git remote rename new-origin origin' -ForegroundColor DarkGray
  } finally {
    Pop-Location
  }
}

function Invoke-VercelPhase {
  param([string]$ProjectName)

  Write-Banner 'FAZA 3: Vercel (novyj deploy)' 'Magenta'

  if (-not (Test-EnvTargetFile)) {
    Write-Host '  Snachala Firebase: .env.target' -ForegroundColor Red
    exit 1
  }

  Write-Host '  1. vercel login  (nikegeorgian@gmail.com)' -ForegroundColor Cyan
  Write-Host '  2. Udalite staruju privyazku .vercel (esli est)' -ForegroundColor White
  Write-Host '  3. vercel link   (novyj proekt)' -ForegroundColor Cyan
  Write-Host '  4. npm run sync:vercel-env' -ForegroundColor Cyan
  Write-Host '  5. vercel --prod' -ForegroundColor Cyan
  Write-Host ''

  $go = Read-Host '  Zapustit Vercel sejchas? (y/N)'
  if ($go -notmatch '^[yY]') { return }

  $vercelDir = Join-Path $ProjectRoot '.vercel'
  if (Test-Path $vercelDir) {
    $bak = "$vercelDir.bak-$(Get-Date -Format 'yyyyMMdd-HHmm')"
    Write-Host "  Backup .vercel -> $bak" -ForegroundColor DarkGray
    Move-Item $vercelDir $bak
  }

  & vercel login
  Push-Location $ProjectRoot
  try {
    & vercel link
    if ($LASTEXITCODE -ne 0) { throw 'vercel link failed' }

  # sync env from firebase.client.json / .env.target
    $envSource = Join-Path $FstWeb '.env.target'
    if (Test-Path $envSource) {
      Copy-Item $envSource (Join-Path $FstWeb '.env.production') -Force
      Write-Host '  .env.production obnovlen iz .env.target' -ForegroundColor DarkGray
    }

    Invoke-Npm @('run', 'sync:vercel-env')
    & vercel --prod
    if ($LASTEXITCODE -ne 0) { throw 'vercel deploy failed' }
  } finally {
    Pop-Location
  }

  Write-Host ''
  Write-Host '  Novyj URL pokazhet vercel posle deploy.' -ForegroundColor Green
}

# --- main ---
Write-Banner 'FST: polnyj perenos infrastruktury' 'Yellow'
Write-Host '  Firebase + GitHub + Vercel -> nikegeorgian@gmail.com' -ForegroundColor White
Write-Host "  Shag: $Step" -ForegroundColor DarkGray
Write-Host ''

Show-Status

switch ($Step) {
  'Check' {
    Write-Host 'Komandy:' -ForegroundColor Cyan
    Write-Host '  ... -Step Firebase   # baza + rules' -ForegroundColor White
    Write-Host '  ... -Step GitHub     # novyj repo' -ForegroundColor White
    Write-Host '  ... -Step Vercel     # novyj deploy' -ForegroundColor White
    Write-Host '  ... -Step All        # vse fazy podryad' -ForegroundColor White
  }
  'Firebase' { Invoke-FirebasePhase }
  'GitHub' { Invoke-GitHubPhase -Repo $NewGitHubRepo }
  'Vercel' { Invoke-VercelPhase -ProjectName $NewVercelProject }
  'All' {
    Invoke-FirebasePhase
    Invoke-GitHubPhase -Repo $NewGitHubRepo
    Invoke-VercelPhase -ProjectName $NewVercelProject
  }
}

Write-Banner 'Konec shaga' 'Green'
