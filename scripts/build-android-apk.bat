@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
set "WEB=%ROOT%\fst-web"
set "ANDROID=%WEB%\android"
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot"
if not exist "%JAVA_HOME%\bin\java.exe" (
  echo JAVA_HOME not found: %JAVA_HOME%
  exit /b 1
)

rem Space-free SDK junction avoids jlink/jmod failures under JDK 21.
if not exist "C:\AndroidSdk\" (
  if not exist "%LOCALAPPDATA%\Android\Sdk\" (
    echo Android SDK not found: %LOCALAPPDATA%\Android\Sdk
    exit /b 1
  )
  mklink /J C:\AndroidSdk "%LOCALAPPDATA%\Android\Sdk"
  if errorlevel 1 (
    echo Failed to create C:\AndroidSdk junction. Run as Administrator if needed.
    exit /b 1
  )
)

if not exist "C:\gradle-home\" mkdir "C:\gradle-home"
set "GRADLE_USER_HOME=C:\gradle-home"
set "ANDROID_HOME=C:\AndroidSdk"
set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%"
set "CAPACITOR_BUILD=1"

cd /d "%WEB%" || exit /b 1
call npm run build
if errorlevel 1 exit /b 1

rem Do not pack the public APK into the Android app bundle.
if exist "%WEB%\dist\downloads\" rmdir /s /q "%WEB%\dist\downloads"

if not exist "%ANDROID%\gradlew.bat" (
  call "%ROOT%\node_modules\.bin\cap.cmd" add android
  if errorlevel 1 exit /b 1
) else (
  call "%ROOT%\node_modules\.bin\cap.cmd" sync android
  if errorlevel 1 exit /b 1
)

> "%ANDROID%\local.properties" echo sdk.dir=C:/AndroidSdk

rem Path may contain Cyrillic - allow Android Gradle on Windows.
findstr /C:"android.overridePathCheck=true" "%ANDROID%\gradle.properties" >nul 2>&1
if errorlevel 1 (
  echo android.overridePathCheck=true>> "%ANDROID%\gradle.properties"
)

cd /d "%ANDROID%" || exit /b 1
call gradlew.bat assembleDebug --no-daemon
if errorlevel 1 exit /b 1

set "APK=%ANDROID%\app\build\outputs\apk\debug\app-debug.apk"
set "OUT=%ROOT%\release"
if not exist "%OUT%" mkdir "%OUT%"
copy /Y "%APK%" "%OUT%\fst-fibercell-debug.apk"
if errorlevel 1 exit /b 1
echo.
echo APK ready: %OUT%\fst-fibercell-debug.apk
exit /b 0
