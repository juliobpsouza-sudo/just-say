# Servidor do Just Say

É o backend local do app. Ele escuta só em `127.0.0.1:8787`, e tudo nele é gratuito.

- **Transcrição:** Whisper do Groq (plano gratuito), com o Whisper local como reserva opcional (`local-whisper/`).
- **Refino:** modelos gratuitos do Groq em cascata. Quando o limite de um acaba, o servidor passa para o próximo; "sem refino" é o último recurso.
- **Just Ask e Tradução:** os mesmos modelos, sem o degrau "sem refino". A busca na web do Just Ask usa o `gpt-oss-20b` do Groq com a ferramenta `browser_search` (gratuita).
- **Dicionário pessoal:** fica no SQLite, em `data/just-say.db`.

## Rodar

Em desenvolvimento, o app sobe o servidor sozinho. Para rodar à parte:

```bash
npm install
npm run dev
```

A chave do Groq fica em `.env` (`GROQ_API_KEY=`), que não vai para o git. O modelo do arquivo é o `.env.example`.

## Rotas
| Rota | Para quê |
|---|---|
| `GET /health` | O servidor está no ar? A chave do Groq está configurada? |
| `POST /auth/local-pair` | Entrega o token local (só para pedidos do próprio PC) |
| `POST /ai/voice_flow` | Multipart com `audio_file` e os campos do pedido de voz. Modos `voice_transcript`, `voice_command` (Just Ask, `parameters.selected_text`) e `voice_translation` (`parameters.output_language`). Devolve `refine_text`, `delivery`, `user_prompt`, `web_metadata` e `external_action` |
| `/user/dictionary/list`, `add`, `update`, `delete` | O dicionário pessoal |
| `GET`/`PUT /settings/providers`, `POST /settings/providers/unblock` | A cascata de modelos (a tela Modelos do app) |

## Testes

```bash
npm test
```
