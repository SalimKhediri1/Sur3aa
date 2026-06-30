@echo off
REM ============================================
REM  Sur3aa - start the local download server
REM  Keep this window open while using the extension.
REM  Close it to stop the server.
REM ============================================

cd /d "%~dp0server"
node index.js
pause
