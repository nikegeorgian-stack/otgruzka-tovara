@echo off
winget install --id Microsoft.OpenJDK.21 -e --accept-source-agreements --accept-package-agreements
exit /b %ERRORLEVEL%
