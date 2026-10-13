@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows-server.ps1" -Action Foreground
pause
