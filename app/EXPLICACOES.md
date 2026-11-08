# Explicações do Just Say

Guia rápido do que cada opção faz, em português simples.

## Áudio
Fica em **Configurações → Áudio**.

- **Sons de início e fim.** Um tom curto quando a gravação começa e outro quando termina. Dá para desligar.
- **Atraso do som de início:**
  - **Automático** (padrão): o app vê qual fone você usa. Se for **Bluetooth**, o som de início espera 1,2 s, porque esses fones cortam o começo do som quando o microfone liga. Fone **USB ou com fio** toca na hora.
  - **Sempre atrasar:** sempre espera 1,2 s.
  - **Nunca atrasar:** sempre toca na hora.
  - A tela mostra o que o app detectou no seu PC.
- **Silenciar o áudio de fundo.** Meio segundo depois do toque que começa a gravação, o app muta as músicas e vídeos dos **outros** programas, e devolve tudo ao terminar. Só desfaz o que ele mesmo mutou, e não cala os sons do próprio Just Say.
- **Nenhuma fala detectada.** Se ficar em silêncio entre 1 s e 6 s depois do toque, a barra avisa e nada é colado.
- **Gravações.** Cada ditado fica salvo em `%APPDATA%\Just Say\Recordings\` (`.wav`). É daí que sai o "Refazer" do Painel.

## Privacidade
Fica em **Configurações → Privacidade**. O botão principal também está no menu do ícone da bandeja.

- **Ler o contexto da tela** (começa **ligado**):
  - **Ligado:** junto com a sua fala vão para o modelo o texto visível na tela e o que já está escrito no campo. Com isso, os nomes saem certos e o tom combina com o lugar.
  - **Desligado:** vão só o nome do programa, o título da janela e o domínio do site.
- **Apps e sites onde nunca leio a tela.** Duas listas editáveis. Nelas o app não lê texto nenhum, mesmo com a leitura ligada. Já vêm com:
  - gerenciadores de senha;
  - WhatsApp, Telegram e Signal;
  - terminais;
  - acesso remoto;
  - Office;
  - bancos, pagamentos, logins e `gov.br`.
  - Um site bloqueado vale também para os subdomínios dele.
  - "Restaurar as listas padrão" desfaz as suas mudanças.
- **Campos de senha** nunca são lidos.
- **Para onde vai.** A fala e o contexto vão para o servidor local do Just Say, e de lá para o Groq (plano gratuito), que transcreve e limpa o texto.
- **Histórico do clipboard.** O texto colado pelo app não entra no histórico do Windows (Win+V). O que você tinha copiado volta ao clipboard logo depois da colagem.
- **Aprender com as correções** (Configurações → Aprendizado e histórico, começa **ligado**). Depois de colar, o app relê só aquele campo por até 15 s para ver se você corrigiu um nome. Segue as mesmas regras da leitura da tela: não roda com ela desligada, nos apps e sites bloqueados nem em campo de senha.
- **Estilo pessoal** (mesma tela, começa **ligado**). Um resumo curto do seu jeito de escrever, feito só com o que você ditou. Dá para ver, apagar ou desligar.
- **Histórico.** Fica só no seu PC (`%APPDATA%\Just Say\just-say.db`), com os áudios. Você escolhe por quanto tempo guardar e pode apagar tudo no Hub → Histórico.
- **Estatísticas.** Guardam só números (palavras, duração, hora) e o nome do app, nunca o texto, no mesmo arquivo do histórico. Apagar o histórico não zera as estatísticas. Para zerar, use o botão na página Estatísticas.
- **Notion** (Conectores → Notion). Só manda algo para o seu Notion quando você pede com "anota", "salva" ou "guarda" no Just Ask. O app só enxerga as páginas que você conectar a ele no Notion, e a chave fica em `server\.env`.
- **Para conferir o que foi lido:** em **Painel → Último ditado**, a linha cinza mostra o app, o site, o tipo de campo e quanto texto foi lido em cada ditado.
