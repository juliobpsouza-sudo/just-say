@echo off
chcp 65001 >nul
title Instalando o Just Say
rem Instala o servidor e o app (uma vez só). Usa o Prompt de Comando, não o PowerShell:
rem num Windows novo, o PowerShell bloqueia o "npm" por padrão.
rem Se o PC não tiver Node.js 22 ou mais novo, baixa um Node portátil para runtime\node,
rem dentro desta pasta: não pede administrador e não mexe no resto do PC.
cd /d "%~dp0"
set "NODE_DIR=%~dp0runtime\node"
set "NODE_URL=https://nodejs.org/dist/latest-v24.x"

if exist "%NODE_DIR%\node.exe" goto usarportatil
where node >nul 2>nul
if errorlevel 1 goto baixarnode
node -e "process.exit(+process.versions.node.split('.')[0] < 22 ? 1 : 0)"
if errorlevel 1 goto baixarnode
echo Usando o Node.js deste PC.
goto instalar

:baixarnode
echo.
echo [0/3] Baixando o Node.js portátil (uns 30 MB, só nesta pasta)...
set "TMPN=%~dp0runtime\baixando"
if exist "%TMPN%" rd /s /q "%TMPN%"
mkdir "%TMPN%" || goto erro
curl -fsSL -o "%TMPN%\SHASUMS256.txt" "%NODE_URL%/SHASUMS256.txt" || goto semnet
set "ZIP="
for /f "tokens=1,2" %%a in ('findstr /c:"-win-x64.zip" "%TMPN%\SHASUMS256.txt"') do (
  set "HASH=%%a"
  set "ZIP=%%b"
)
if not defined ZIP goto erro
curl -fL --progress-bar -o "%TMPN%\%ZIP%" "%NODE_URL%/%ZIP%" || goto semnet
rem Confere a impressão digital (SHA-256) publicada pelo nodejs.org.
set "GOT="
for /f "skip=1 delims=" %%h in ('certutil -hashfile "%TMPN%\%ZIP%" SHA256') do if not defined GOT set "GOT=%%h"
set "GOT=%GOT: =%"
if /i not "%GOT%"=="%HASH%" (
  echo O arquivo do Node.js veio corrompido. Tente de novo.
  goto erro
)
tar -xf "%TMPN%\%ZIP%" -C "%TMPN%" || goto erro
if exist "%NODE_DIR%" rd /s /q "%NODE_DIR%"
move "%TMPN%\%ZIP:.zip=%" "%NODE_DIR%" >nul || goto erro
rd /s /q "%TMPN%"

:usarportatil
set "PATH=%NODE_DIR%;%PATH%"
echo Usando o Node.js portátil desta pasta.

:instalar
echo.
echo [1/3] Instalando o servidor...
cd /d "%~dp0server"
call npm ci --no-audit --no-fund || goto erro

echo.
echo [2/3] Instalando o app (pode levar alguns minutos)...
cd /d "%~dp0app"
call npm ci --no-audit --no-fund || goto erro
rem O Electron 44 não baixa o executável no "npm ci": só quando alguém pede. Baixa agora.
call node node_modules\electron\install.js || goto erro

echo.
echo [3/3] Preparando o app...
call npm run build || goto erro

echo.
echo Pronto! Agora clique duas vezes em "Abrir Just Say.cmd".
pause
exit /b 0

:semnet
echo.
echo Não consegui baixar o Node.js. Confira a internet e clique de novo neste arquivo.
pause
exit /b 1

:erro
echo.
echo Algo deu errado. Tire um print desta janela e mande para quem te passou o Just Say.
pause
exit /b 1
