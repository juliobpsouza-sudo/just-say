# Métricas de latência

A métrica principal é o tempo de "toque final → texto pronto para colar", ou seja, da hora em que a pessoa toca a tecla para terminar até o texto estar pronto para colar.

Ainda não há medição "toque final → texto colado" com ditado real. Ela entra com a Fase 4 (streaming), que é quando este arquivo vira o comparativo de latência.

## Linha de base: caminho HTTP em lote (Fases 3 e 5)
Medido em 2026-10-13 e 2026-10-14 no PC de desenvolvimento. A fala é sintética (voz "Maria" do Windows) e é mandada ao servidor local, que usa o Groq gratuito: Whisper `large-v3-turbo` + refino com o `qwen/qwen3.8-27b`. Não inclui a colagem, que leva ~500 ms de espera por segurança.

| Fala | Tamanho do WAV | Até o texto pronto | Transcrição | Refino |
|---|---|---|---|---|
| ~17 s | 0,5 MB | 1,1–1,2 s | 0,7–0,8 s | 0,3–0,4 s |
| ~2 min 14 s | 4,3 MB | 1,5 s | 1,0 s | 0,5 s |
| ~6 min 43 s | 12,9 MB | **7,6 s** | 6,9 s | 0,6 s |
| ~17 s, com o contexto completo da tela (Fase 5) | 0,5 MB | 1,1 s | 0,7 s | 0,4 s |

Conclusão: até ~2 min de fala, o caminho atual já é rápido. O custo cresce nos ditados longos, porque o áudio inteiro sobe e é transcrito de uma vez, e é isso que a Fase 4 resolve.

## Outros tempos medidos
- **Abrir o microfone** (toque → gravação ativa): 86–144 ms. Só a primeira gravação depois de abrir o app é mais lenta, enquanto o microfone aquece.
- **Captura de contexto** (Fase 5):
  - app + URL: ~30 ms;
  - campo: ~15 ms;
  - texto visível numa página pesada (YouTube): ~0,5–1,2 s;
  - total: ~0,6–0,8 s, em paralelo com a gravação.

## Just Ask e Tradução (Fase 6)
Medido em 2026-10-14, com a mesma fala sintética e o mesmo servidor local (Groq gratuito). É o tempo até a resposta chegar ao app, sem a entrega.

| Pedido | Ação | Até a resposta | Transcrição | Modelo |
|---|---|---|---|---|
| "deixa esse texto mais formal" (com seleção) | colar | 1,4 s | 0,7 s | 0,6 s (Qwen) |
| "quanto é 15% de 230?" | responder | 0,7 s | 0,3 s | 0,3 s (Qwen) |
| "abre o YouTube" | abrir | 0,8 s | 0,5 s | 0,4 s (Qwen) |
| "qual é a cotação do dólar hoje?" | buscar | **3,5 s** | 0,4 s | 3,1 s (Qwen decide + `gpt-oss-20b` busca em 2,8 s) |
| tradução pt → en (~6 s de fala) | colar | 0,7 s | 0,4 s | 0,3 s (Qwen) |
