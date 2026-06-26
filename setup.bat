@echo off
REM ============================================
REM  Sur3aa setup script for Windows
REM  Installs ffmpeg, yt-dlp, and server deps.
REM  Double-click this file or run it from Command Prompt.
REM ============================================

setlocal

REM --- Check for winget ---
where winget >nul 2>&1
if errorlevel 1 (
  echo Error: winget was not found.
  echo Update Windows or install "App Installer" from the Microsoft Store, then re-run this script.
  exit /b 1
)

REM --- Install ffmpeg ---
echo ==^> Installing ffmpeg...
winget install --id Gyan.FFmpeg -e
if errorlevel 1 (
  echo Error: failed to install ffmpeg.
  exit /b 1
)

REM --- Install yt-dlp ---
echo ==^> Installing yt-dlp...
winget install --id yt-dlp.yt-dlp -e
if errorlevel 1 (
  echo Error: failed to install yt-dlp.
  exit /b 1
)

REM --- Install Node.js dependencies ---
echo ==^> Installing server dependencies...
where npm >nul 2>&1
if errorlevel 1 (
  echo Error: npm was not found. Install Node.js ^(v18+^) from https://nodejs.org then re-run this script.
  exit /b 1
)
pushd "%~dp0server"
call npm install
if errorlevel 1 (
  echo Error: npm install failed.
  popd
  exit /b 1
)
popd

REM --- Done ---
echo.
echo ============================================
echo   Sur3aa setup complete!
echo ============================================
echo Start the server with:
echo     node server\index.js
echo.
echo Then load the extension in your browser (see the README).

endlocal
