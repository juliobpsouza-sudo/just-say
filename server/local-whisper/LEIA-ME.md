# IA local (reserva offline, opcional)

Quando o Groq não responde (sem internet, fora do ar ou no limite), o Just Say pode usar a placa de vídeo do PC:
- **Whisper large-v3-turbo** para transcrever (faster-whisper, em int8: ~1,1 GB de memória na placa);
- **Qwen3.5-4B** (ou o 9B, se a placa tiver 7 GB livres) no llama.cpp para limpar o ditado.

O Groq continua sendo o principal. A reserva vale só para o ditado: Ask Anything, tradução e Notion precisam de internet. Ver `app/DECISOES.md` (D94).

Testado numa NVIDIA de 8 GB com CUDA. Sem placa NVIDIA, o Whisper roda no processador (bem mais lento).

## Onde fica
Tudo o que é pesado (~10 GB) fica fora de pastas sincronizadas, em `JUST_SAY_LOCAL_DIR` ou, sem ela, em `%USERPROFILE%\.just-say\local`:
- `whisper-venv\`: o ambiente Python;
- `hf\`: o modelo do Whisper (~1,6 GB, baixado na primeira vez);
- `llama\`: o llama.cpp (build CUDA 12.4 do [ggml-org/llama.cpp](https://github.com/ggml-org/llama.cpp/releases));
- `models\`: `Qwen3.5-4B-Q4_K_M.gguf` e, se quiser, `Qwen3.5-9B-Q4_K_M.gguf` ([unsloth no Hugging Face](https://huggingface.co/unsloth)).

## Instalar
1. Instale o Python 3.12 e rode `.\instalar.ps1` nesta pasta. Ele usa só pacotes prontos (`--only-binary`), em versões fixas (`requirements.txt` e `constraints.txt`).
2. Baixe o llama.cpp e os modelos para as pastas acima e confira o SHA-256 de cada arquivo com o publicado na página de download.
3. Na tela **Configurações → Modelos**, deixe ligados o "Whisper local" e o "Modelo local".

## Ligar e desligar
É automático: o servidor liga os dois quando precisa e desliga depois de 15 min sem uso. Ele confere a internet a cada 30 s e, se ela cair, liga os dois antes do próximo ditado. Se o local estiver em 1º lugar na tela Modelos, ele fica sempre ligado.

Para testar o Whisper sozinho: `.\iniciar.ps1` (porta 8788).

## Problemas comuns
- **"GPU indisponível… usando CPU":** as DLLs de CUDA não foram achadas. Rode o `instalar.ps1` de novo.
- **Lento no primeiro ditado sem internet:** os modelos estavam desligados e levam de 5 a 15 s para carregar. Os seguintes saem em 1 a 4 s.
