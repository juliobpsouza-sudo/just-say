# Instala o Whisper local do Just Say (uma vez só).
# O ambiente Python e os modelos (~4 GB) ficam fora de pastas sincronizadas (D94): em
# $env:JUST_SAY_LOCAL_DIR ou, sem ela, em %USERPROFILE%\.just-say\local.
# Só pacotes prontos (--only-binary): nenhum script de instalação roda.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'pasta-local.ps1')

if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) {
  Write-Host "Criando o ambiente Python em $venv ..."
  py -3.12 -m venv $venv
}
$python = Join-Path $venv 'Scripts\python.exe'
Write-Host 'Instalando faster-whisper e as bibliotecas de CUDA...'
& $python -m pip install --only-binary ':all:' 'pip==26.2.1' # versão fixa, também com 14+ dias
# constraints.txt fixa também as dependências indiretas (todas com 14+ dias de publicadas).
& $python -m pip install --only-binary ':all:' -r (Join-Path $PSScriptRoot 'requirements.txt') -c (Join-Path $PSScriptRoot 'constraints.txt')
Write-Host ''
Write-Host 'Pronto. Para iniciar: .\iniciar.ps1  (depois ligue "Whisper local" em Just Say > Configurações > Modelos)'
