"""Whisper local do Just Say: transcreve na GPU (faster-whisper), na porta 8788.

Rotas:
  GET  /health                         -> {"ok": true, "model": ..., "device": ...}
  POST /transcribe?language=pt&prompt= -> corpo = arquivo de áudio (wav/ogg); devolve {"text", "language"}

Só escuta em 127.0.0.1. Iniciar: iniciar.ps1 (ver LEIA-ME.md).
"""

import io
import json
import os
import site
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HOST = "127.0.0.1"
PORT = int(os.environ.get("LOCAL_WHISPER_PORT", "8788"))
MODEL = os.environ.get("LOCAL_WHISPER_MODEL", "large-v3-turbo")
# int8_float16: metade da memória da placa (1,1 GB em vez de 2,1 GB) e o mesmo texto, medido em
# 30 ditados reais (97,7% x 97,9% iguais ao Groq), D94.
COMPUTE = os.environ.get("LOCAL_WHISPER_COMPUTE", "int8_float16")
MAX_BODY = 60 * 1024 * 1024


def add_cuda_dll_dirs() -> None:
    """No Windows, as DLLs do CUDA instaladas pelo pip (nvidia-*) precisam entrar no caminho de busca."""
    if sys.platform != "win32":
        return
    for base in site.getsitepackages() + [site.getusersitepackages()]:
        for sub in ("cublas", "cudnn"):
            path = os.path.join(base, "nvidia", sub, "bin")
            if os.path.isdir(path):
                os.add_dll_directory(path)
                os.environ["PATH"] = path + os.pathsep + os.environ.get("PATH", "")


add_cuda_dll_dirs()

from faster_whisper import WhisperModel  # noqa: E402  (depois de ajustar o caminho das DLLs)


def load_model():
    try:
        return WhisperModel(MODEL, device="cuda", compute_type=COMPUTE), "cuda"
    except Exception as err:  # sem GPU/CUDA: cai para a CPU, mais lento
        print(f"[local-whisper] GPU indisponível ({err}); usando CPU", flush=True)
        return WhisperModel(MODEL, device="cpu", compute_type="int8"), "cpu"


print(f"[local-whisper] carregando o modelo {MODEL}...", flush=True)
model, device = load_model()
print(f"[local-whisper] pronto em http://{HOST}:{PORT} ({device})", flush=True)


def wav_pcm16_16k(data: bytes):
    """WAV PCM 16 bits, 16 kHz, mono (o que o Just Say grava) -> float32 para o Whisper.

    Lido direto, sem a biblioteca av: a av 19 tirou um parâmetro que o faster-whisper 1.2.1
    usa, e qualquer áudio quebrava (D94). Outro formato: None (vai pela av, como antes).
    """
    import numpy as np

    if len(data) < 44 or data[0:4] != b"RIFF" or data[8:12] != b"WAVE":
        return None
    pos, fmt = 12, None
    while pos + 8 <= len(data):
        chunk, size = data[pos : pos + 4], int.from_bytes(data[pos + 4 : pos + 8], "little")
        body = pos + 8
        if chunk == b"fmt " and size >= 16:
            fmt = (
                int.from_bytes(data[body : body + 2], "little"),  # formato (1 = PCM)
                int.from_bytes(data[body + 2 : body + 4], "little"),  # canais
                int.from_bytes(data[body + 4 : body + 8], "little"),  # taxa
                int.from_bytes(data[body + 14 : body + 16], "little"),  # bits
            )
        elif chunk == b"data":
            if fmt != (1, 1, 16000, 16):
                return None
            pcm = np.frombuffer(data[body : body + size - (size % 2)], dtype="<i2")
            return pcm.astype(np.float32) / 32768.0
        pos = body + size + (size % 2)
    return None


class Handler(BaseHTTPRequestHandler):
    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if urlparse(self.path).path == "/health":
            self._json(200, {"ok": True, "model": MODEL, "device": device})
        else:
            self._json(404, {"error": "rota desconhecida"})

    def do_POST(self) -> None:
        url = urlparse(self.path)
        if url.path != "/transcribe":
            self._json(404, {"error": "rota desconhecida"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self._json(400, {"error": "áudio vazio ou grande demais"})
            return
        audio = self.rfile.read(length)
        query = parse_qs(url.query)
        language = (query.get("language") or [None])[0] or None
        prompt = (query.get("prompt") or [None])[0] or None

        started = time.time()
        try:
            segments, info = model.transcribe(
                pcm if (pcm := wav_pcm16_16k(audio)) is not None else io.BytesIO(audio),
                language=language,
                initial_prompt=prompt,
                beam_size=1,
                vad_filter=True,
                condition_on_previous_text=False,
            )
            text = " ".join(s.text.strip() for s in segments).strip()
        except Exception as err:  # responde o erro em vez de derrubar a conexão
            print(f"[local-whisper] erro: {err}", flush=True)
            self._json(500, {"error": str(err)[:300]})
            return
        ms = int((time.time() - started) * 1000)
        print(f"[local-whisper] {info.duration:.1f}s de áudio em {ms} ms", flush=True)
        self._json(200, {"text": text, "language": info.language})

    def log_message(self, *_args) -> None:  # silencia o log padrão por pedido
        pass


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
