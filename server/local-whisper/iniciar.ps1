# Inicia o Whisper local do Just Say em http://127.0.0.1:8788
. (Join-Path $PSScriptRoot 'pasta-local.ps1')
$python = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path $python)) {
  Write-Host 'O Whisper local ainda não foi instalado. Rode primeiro: .\instalar.ps1'
  exit 1
}
& $python (Join-Path $PSScriptRoot 'server.py')
