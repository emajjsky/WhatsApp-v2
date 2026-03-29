@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0docker-up.ps1" %*
exit /b %errorlevel%
