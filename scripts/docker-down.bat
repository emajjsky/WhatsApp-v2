@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0docker-down.ps1" %*
exit /b %errorlevel%
