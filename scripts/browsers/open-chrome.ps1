# Otkryvaet URL v Google Chrome (inkognito).
param([Parameter(Mandatory)][string]$Url)
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$chromeX86 = 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'
if (Test-Path $chrome) { $exe = $chrome }
elseif (Test-Path $chromeX86) { $exe = $chromeX86 }
else { Write-Error 'Google Chrome ne naiden' }
Start-Process -FilePath $exe -ArgumentList '--incognito', $Url
