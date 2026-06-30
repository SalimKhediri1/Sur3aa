@echo off
REM ============================================
REM  Sur3aa setup script for Windows
REM  Installs ffmpeg, yt-dlp, and server deps,
REM  then registers the server to start silently
REM  at login, just like Linux does via systemd.
REM  Double-click or run from Command Prompt.
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

REM --- Register autostart via Windows Startup folder (no admin required) ---
echo ==^> Registering Sur3aa to start automatically at login...
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
copy /y "%~dp0start-server-hidden.vbs" "%STARTUP%\Sur3aa.vbs" >nul
if errorlevel 1 (
  echo Warning: could not write to Startup folder. You can start the server manually with start-server.bat
) else (
  echo =^> Sur3aa will start silently in the background on every login.
)

REM --- Start the server right now without waiting for next login ---
echo ==^> Starting Sur3aa server in the background...
wscript.exe "%~dp0start-server-hidden.vbs"

REM --- Done ---
echo.
echo ============================================
echo   Sur3aa setup complete!
echo ============================================
echo The server is running silently in the background.
echo It will start automatically every time you log in.
echo.
echo Load the extension in your browser ^(see the README^).
echo.
echo Useful commands:
echo   stop-server.bat          - stop the background server
echo   start-server.bat         - start it again ^(visible terminal, for debugging^)
echo   start-server-hidden.vbs  - start it again silently

endlocal
