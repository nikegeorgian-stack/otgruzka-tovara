@rem Копирует FST на E:\Fibercell-FST (без node_modules)
@echo off
set SRC=%~dp0..
set DST=E:\Fibercell-FST

if not exist E:\ (
  echo Disk E: not found
  exit /b 1
)

echo Copying to %DST%...
if not exist "%DST%" mkdir "%DST%"

robocopy "%SRC%" "%DST%" /MIR /XD node_modules dist .vercel fst-web\dist fst-web\node_modules .git\objects ^
  /XF *.local .env .env.production .env.target .env.vercel.* ^
  /NFL /NDL /NJH /NJS /nc /ns /np

echo.
echo Installing npm dependencies...
cd /d "%DST%"
call npm install

echo.
echo Done: %DST%
echo Next: set FST_SOURCE_PASSWORD and run npm run export:cloud-backup -- --out=E:\Fibercell-FST\cloud-backup
