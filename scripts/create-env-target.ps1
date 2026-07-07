# Sozdaet fst-web/.env.target iz vvedennyh v terminale klyuchej.
# Run: powershell -ExecutionPolicy Bypass -File scripts\create-env-target.ps1

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$FstWeb = Join-Path $ProjectRoot 'fst-web'
$OutPath = Join-Path $FstWeb '.env.target'

Write-Host ''
Write-Host '=== .env.target dlya novogo Firebase ===' -ForegroundColor Yellow
Write-Host 'Klyuchi: Firebase Console -> Project settings -> Your apps -> Web' -ForegroundColor DarkGray
Write-Host "https://console.firebase.google.com/project/otgruzka-tovara/settings/general" -ForegroundColor Cyan
Write-Host ''

$projectId = Read-Host 'VITE_FIREBASE_PROJECT_ID (napr. otgruzka-tovara)'
if (-not $projectId) { $projectId = 'otgruzka-tovara' }

$apiKey = Read-Host 'VITE_FIREBASE_API_KEY'
$authDomain = Read-Host "VITE_FIREBASE_AUTH_DOMAIN [${projectId}.firebaseapp.com]"
if (-not $authDomain) { $authDomain = "${projectId}.firebaseapp.com" }
$storageBucket = Read-Host "VITE_FIREBASE_STORAGE_BUCKET [${projectId}.firebasestorage.app]"
if (-not $storageBucket) { $storageBucket = "${projectId}.firebasestorage.app" }
$senderId = Read-Host 'VITE_FIREBASE_MESSAGING_SENDER_ID'
$appId = Read-Host 'VITE_FIREBASE_APP_ID'

$content = @"
# Cel: nikegeorgian@gmail.com / $projectId
VITE_FIREBASE_API_KEY=$apiKey
VITE_FIREBASE_AUTH_DOMAIN=$authDomain
VITE_FIREBASE_PROJECT_ID=$projectId
VITE_FIREBASE_STORAGE_BUCKET=$storageBucket
VITE_FIREBASE_MESSAGING_SENDER_ID=$senderId
VITE_FIREBASE_APP_ID=$appId
VITE_FST_WEB=true
"@

Set-Content -Path $OutPath -Value $content -Encoding UTF8
Write-Host ''
Write-Host "Sohraneno: $OutPath" -ForegroundColor Green
Write-Host 'Dalyshe: npm run migrate:import  ili  scripts\migrate-import.ps1' -ForegroundColor White
Write-Host ''
