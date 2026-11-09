# Versões

O que mudou em cada versão do Just Say. A numeração segue `MAIOR.MENOR.CORREÇÃO`: correções sobem o último número, novidades o do meio. Enquanto o primeiro número for `0`, o app ainda está em evolução rápida.

## v0.1.3 — 2026-11-08

- **O texto ditado também fica no Ctrl+C.** Depois de colar, tudo o que você dita (ditado, tradução e o que o Just Ask cola) continua copiado, para colar de novo onde quiser. Sem aviso.
- **Dá para escolher:** em Configurações → Privacidade → "Deixar o texto no Ctrl+C". Vem ligado. Desligado, volta o modo mais privado: o que estava copiado antes é devolvido e o texto ditado não aparece no histórico do Win+V (D98).

## v0.1.2 — 2026-11-08

- **"Ask Anything" agora se chama "Just Ask".** Um nome próprio, que combina com o do app: *Just Say* para ditar, *Just Ask* para pedir. Muda só o nome nas telas; o atalho (AltGr + Espaço), as configurações e o histórico continuam iguais (D97).

## v0.1.1 — 2026-11-05

- **Abrir com o Windows funciona para quem instala pelo GitHub.** Antes, a opção ficava ligada na tela, mas só era registrada no Windows quando o app abria por um atalho específico. Agora o app registra o próprio executável e a pasta dele na primeira abertura pelo `Abrir Just Say.cmd` (D96).

## v0.1.0 — 2026-11-04

Primeira versão pública.

- **Ditado em qualquer programa:** toque o atalho (AltGr por padrão), fale, toque de novo. O texto entra limpo e pontuado onde está o cursor.
- **Ask Anything:** pergunte por voz, com ou sem texto selecionado. O app cola a resposta, mostra num cartão, busca na web ou abre um link.
- **Tradução enquanto você fala**, para até 3 idiomas à sua escolha.
- **Notion:** "anota esse vídeo pra ver mais tarde" salva o item numa pasta sua.
- **Histórico, Dicionário e aprendizado:** o app aprende nomes e o seu jeito de escrever com as correções que você faz.
- **Groq com a sua chave:** tela para colar, testar e guardar a chave (criptografada pela sua conta do Windows).
- **Reserva sem internet (opcional):** Whisper e Qwen3.5 na placa de vídeo, ver `server/local-whisper/LEIA-ME.md`.
- **Instalação em dois cliques:** `Instalar.cmd` (baixa um Node portátil se o PC não tiver) e `Abrir Just Say.cmd`.
