@echo off
setlocal
if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0docker-up.ps1" -Mirror daocloud
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0docker-up.ps1" %*
)
exit /b %errorlevel%
