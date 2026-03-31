@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0docker-down.ps1" %*
set "EXITCODE=%errorlevel%"
if not "%EXITCODE%"=="0" (
  echo.
  echo Stop failed. Run this in PowerShell to see the full error:
  echo   powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0docker-down.ps1"
  echo.
  pause
)
exit /b %EXITCODE%
