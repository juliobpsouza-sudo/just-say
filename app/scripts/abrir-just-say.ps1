# Abre o Just Say sem terminal (usado pelo atalho da Área de Trabalho).
# - App fechado: compila antes (pega o código mais novo) e abre.
# - App já aberto: só traz o Hub para a frente.
# O servidor local sobe sozinho junto com o app.
$ErrorActionPreference = 'Stop'
$app = Split-Path -Parent $PSScriptRoot
Set-Location $app
$electron = Join-Path $app 'node_modules\electron\dist\electron.exe'

# O app pode estar rodando como electron.exe ou como "Just Say.exe" (D74). O processo do
# teclado e os auxiliares do Chromium não contam.
$running = Get-CimInstance Win32_Process -Filter "Name='electron.exe' OR Name='Just Say.exe'" |
  Where-Object { $_.CommandLine -like "*$app*" -and $_.CommandLine -notmatch '--type=' -and $_.CommandLine -notmatch 'keyboard-child' }

$exe = $electron
if (-not $running) {
  $log = Join-Path $env:TEMP 'just-say-build.log'
  & npm.cmd run build *> $log
  if ($LASTEXITCODE -ne 0) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show("Não consegui compilar o Just Say. O log está em:`n$log", 'Just Say') | Out-Null
    exit 1
  }
  # "Just Say.exe": a cópia do Electron com o nome e o ícone do app. Se não der, abre pelo
  # electron.exe, como antes.
  $runtimeExe = & node.exe (Join-Path $app 'scripts\prepare-runtime.mjs') 2>> $log
  if ($LASTEXITCODE -eq 0 -and $runtimeExe -and (Test-Path -LiteralPath $runtimeExe)) { $exe = $runtimeExe }
} else {
  # Já aberto: o segundo processo só avisa o primeiro (traz o Hub para a frente) e sai.
  $runtimeExe = Join-Path $env:USERPROFILE '.just-say\runtime\Just Say.exe'
  if (Test-Path -LiteralPath $runtimeExe) { $exe = $runtimeExe }
}

Start-Process -FilePath $exe -ArgumentList "`"$app`"" -WorkingDirectory $app
