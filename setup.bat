@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-server.ps1" -Action Setup %*
set "SUR3AA_EXIT=%ERRORLEVEL%"
if not "%SUR3AA_EXIT%"=="0" pause
exit /b %SUR3AA_EXIT%
