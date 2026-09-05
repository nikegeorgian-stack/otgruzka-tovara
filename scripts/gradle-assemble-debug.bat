@echo off
setlocal EnableExtensions
set "ROOT=%~dp0.."
set "ANDROID=%ROOT%\fst-web\android"
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

> "%ANDROID%\local.properties" echo sdk.dir=C:/AndroidSdk

findstr /C:"android.overridePathCheck=true" "%ANDROID%\gradle.properties" >nul 2>&1
if errorlevel 1 echo android.overridePathCheck=true>> "%ANDROID%\gradle.properties"

cd /d "%ANDROID%" || exit /b 1
set "OUT=%ROOT%\release"
if not exist "%OUT%" mkdir "%OUT%"
set "LOG=%OUT%\gradle-run.log"
echo JAVA_HOME=%JAVA_HOME%> "%LOG%"
echo GRADLE_USER_HOME=%GRADLE_USER_HOME%>> "%LOG%"
echo ANDROID_HOME=%ANDROID_HOME%>> "%LOG%"
"%JAVA_HOME%\bin\java.exe" -version >> "%LOG%" 2>&1
call gradlew.bat --stop >> "%LOG%" 2>&1
call gradlew.bat assembleDebug --no-daemon >> "%LOG%" 2>&1
if errorlevel 1 (
  echo BUILD FAILED - see %LOG%
  exit /b 1
)
set "APK=%ANDROID%\app\build\outputs\apk\debug\app-debug.apk"
copy /Y "%APK%" "%OUT%\fst-fibercell-debug.apk"
echo APK ready: %OUT%\fst-fibercell-debug.apk
exit /b 0
