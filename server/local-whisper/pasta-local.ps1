# Onde ficam o ambiente Python e os modelos locais: fora de pastas sincronizadas (D94).
if ($env:JUST_SAY_LOCAL_DIR) { $localDir = $env:JUST_SAY_LOCAL_DIR }
else { $localDir = Join-Path $env:USERPROFILE '.just-say\local' }
New-Item -ItemType Directory -Force $localDir | Out-Null
$venv = Join-Path $localDir 'whisper-venv'
# Os modelos do Hugging Face também ficam lá (sem isso iriam para C:\Users\...\.cache).
$env:HF_HOME = Join-Path $localDir 'hf'
