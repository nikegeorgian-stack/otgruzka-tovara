@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0open-chrome.ps1" -Url %*
