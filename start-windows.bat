@echo off
cd /d %~dp0

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo.
  echo No se encontro Node.js instalado.
  echo Descargalo e instalalo desde https://nodejs.org (version LTS) y vuelve a correr este archivo.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias, un momento...
  call npm install
)

echo.
echo Iniciando el monitor de internet...
echo Deja esta ventana abierta. Abre este link en tu navegador:
echo http://localhost:5757
echo.
node src\main.js
pause
