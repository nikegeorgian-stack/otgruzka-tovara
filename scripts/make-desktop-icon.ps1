# Creates fst-desktop/build/icon.png at 256x256 for electron-builder NSIS.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'fst-web\android\app\src\main\res\mipmap-xxxhdpi\ic_launcher.png'
$destDir = Join-Path $root 'fst-desktop\build'
$dest = Join-Path $destDir 'icon.png'
if (-not (Test-Path $src)) { throw "Source icon missing: $src" }
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($src)
$size = 256
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, 0, 0, $size, $size)
$bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $img.Dispose()
Write-Host "OK: $dest ($size x $size)" -ForegroundColor Green
