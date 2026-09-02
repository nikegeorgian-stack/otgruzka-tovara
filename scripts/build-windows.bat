@echo off
setlocal
cd /d "%~dp0.."
set PATH=C:\Program Files\nodejs;%PATH%
node scripts\build-windows.mjs
pause
