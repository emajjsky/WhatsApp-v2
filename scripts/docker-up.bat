@echo off
setlocal
if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0docker-up.ps1" -Mirror daocloud
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0docker-up.ps1" %*
)
set "EXITCODE=%errorlevel%"
if not "%EXITCODE%"=="0" (
  echo.
  echo Startup failed. Common reasons:
  echo   1. Docker Desktop is not installed
  echo   2. Docker Desktop is not running
  echo   3. .env is missing in the project root
  echo.
  echo Run this in PowerShell to see the full error:
  echo   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0docker-up.ps1" -Mirror daocloud
  echo.
  pause
)
exit /b %EXITCODE%
