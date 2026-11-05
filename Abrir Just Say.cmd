@echo off
rem Abre o Just Say (depois do Instalar.cmd). Ele fica no ícone ao lado do relógio.
cd /d "%~dp0app"
if not exist "out\main\index.js" (
  echo Rode primeiro o "Instalar.cmd".
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "%~dp0app"
