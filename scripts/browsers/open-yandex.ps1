# Otkryvaet URL v Yandex Browser (inkognito).
param([Parameter(Mandatory)][string]$Url)

$candidates = @(
  'C:\Program Files\Yandex\YandexBrowser\Application\browser.exe',
  'C:\Program Files (x86)\Yandex\YandexBrowser\Application\browser.exe',
  (Join-Path $env:LOCALAPPDATA 'Yandex\YandexBrowser\Application\browser.exe')
)

$yb = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $yb) {
  Write-Error "Yandex Browser ne naiden. Ustanovite Yandex ili otkroyte vruchnuyu: $Url"
}
Start-Process -FilePath $yb -ArgumentList '--incognito', $Url
