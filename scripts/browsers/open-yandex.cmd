@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-yandex.ps1" -Url %*
