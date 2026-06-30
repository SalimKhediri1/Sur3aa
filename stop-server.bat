@echo off
REM Stops the Sur3aa server by finding and killing the process on port 3333.
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3333 "') do (
  taskkill /pid %%a /f >nul 2>&1
)
echo Sur3aa server stopped.
