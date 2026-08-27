@echo off
cd /d %~dp0

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo.
  echo Node.js was not found.
  echo Download and install it from https://nodejs.org (LTS version) and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies, one moment...
  call npm install
)

echo.
echo Starting the internet monitor...
echo Leave this window open. Open this link in your browser:
echo http://localhost:5757
echo.
node src\main.js
pause
