# Just Say

Ditado por voz com refino por IA, em qualquer app do Windows.

## Rodar

Pré-requisitos já presentes na máquina:
- Node 24;
- Visual Studio Build Tools 2026, com o C++ (o CMake vem junto).

```bash
npm install
npm run native
npm run dev
```

O que cada comando faz:
- `npm install` instala as dependências.
- `npm run native` compila as DLLs em C++ para `resources/native/`. Só é preciso rodar de novo quando mudar algo em `native/`.
- `npm run dev` abre o app com recarga automática.

Outros comandos:
- `npm test`: testes da lógica pura (atalhos, máquina de estados, contexto, idiomas, markdown, links, histórico, diff de edição, dica de uso e microfone).
- `npm run typecheck`: checagem de tipos.
- `npm run build`, seguido de `npm start`: build de produção e execução.
- `npm run icon`: gera o ícone de novo.

## Atalho da Área de Trabalho

O atalho **Just Say** roda `scripts/abrir-just-say.ps1`, sem terminal:
- **App fechado:** ele compila o código mais novo e abre o app. O servidor local sobe junto.
- **Nome no Gerenciador de Tarefas:** o app abre como **Just Say.exe**, uma cópia do Electron com o nome e o ícone do app em `%USERPROFILE%\.just-say\runtime`. Ela é refeita sozinha quando o Electron muda (`scripts/prepare-runtime.mjs`, D74).
- **App já aberto:** ele só traz o Hub para a frente.

Se a compilação falhar, aparece uma mensagem com o caminho do log (`%TEMP%\just-say-build.log`).

## Servidor

A transcrição e o refino rodam no servidor local, em `../server`. Em desenvolvimento, o `npm run dev` do app sobe o servidor sozinho.

A chave gratuita do Groq fica em `../server/.env`. Os modelos em uso e a ordem deles ficam em **Configurações → Modelos**.

## Trocar a tecla de acionamento

Abra o Just Say (ícone na bandeja) → **Configurações** → **Atalhos** → **Alterar**, aperte a combinação nova, solte e clique em **Salvar**.

O tray também tem **Trocar atalhos…**.

## Onde ficam as coisas
- **Configurações:** `%APPDATA%\Just Say\app-settings.json`.
- **Gravações:** `%APPDATA%\Just Say\Recordings\`.
- **Logs de cada gravação:** `%APPDATA%\Just Say\Logs\recording_events\`.
- **Histórico:** `%APPDATA%\Just Say\just-say.db` (SQLite).
- **Dados do servidor** (token, dicionário, perfil de estilo, uso gratuito): `../server/data/`.

## Documentos do projeto
- `EXPLICACOES.md`: o que as opções de áudio e de privacidade fazem.
- `DECISOES.md`: decisões técnicas (D1 a D95).
- `METRICAS.md`: latências medidas.
