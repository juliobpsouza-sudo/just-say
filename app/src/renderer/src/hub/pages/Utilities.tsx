// Utilidades (D78, D84): o que cada parte do Just Say faz, frases para experimentar e dicas de uso.
// Cada cartão tem o logo colorido e a cor da sua função (estilo aprovado dos Usos populares).
// Os atalhos mostrados são os que a pessoa configurou.
import { useEffect, useState } from 'react'
import { IPC } from '../../../../shared/ipc'
import type { AppSettings } from '../../../../shared/settings'
import type { ShortcutBindings, ShortcutFeature } from '../../../../shared/shortcuts'
import { AppLogo, LOGO_TONE, type LogoKind } from '../components/AppLogos'
import { Keys } from '../components/Keys'

interface Group {
  /** Título curto do grupo de frases, ex.: "Com texto selecionado". */
  label: string
  phrases: string[]
}

interface Utility {
  id: string
  title: string
  logo: LogoKind
  shortcut?: ShortcutFeature
  /** Onde fica, quando não tem atalho próprio. */
  where?: string
  what: string
  tryIt?: Group[]
  tips: string[]
}

const UTILITIES: Utility[] = [
  {
    id: 'ditado',
    title: 'Ditado',
    logo: 'dictation',
    shortcut: 'dictation',
    what: 'Fale em vez de digitar. O texto entra limpo e pontuado no campo onde o cursor está, em qualquer programa.',
    tryIt: [
      {
        label: 'Fale do seu jeito',
        phrases: ['"é… tipo, amanhã eu chego cedo, né"', '"chego às oito, não, às nove"'],
      },
    ],
    tips: [
      'Toque uma vez para começar e outra para terminar. Não precisa segurar a tecla.',
      'As muletas ("é", "tipo", "né") somem, e quando você se corrige no meio da frase fica só a versão final.',
      'O tom acompanha o app: mais solto numa conversa, mais caprichado num e-mail.',
      'Sem caixa de texto aberta? O texto aparece num cartão para você copiar.',
      'Até 9 minutos por ditado. No último minuto a barra mostra a contagem.',
      'Enquanto você fala, o som dos outros programas fica mudo (dá para desligar em Configurações → Áudio).',
    ],
  },
  {
    id: 'ask',
    title: 'Ask Anything',
    logo: 'ask',
    shortcut: 'askAnything',
    what: 'Seu assistente por voz: edita o texto selecionado, responde perguntas, busca na internet, abre sites e anota no Notion.',
    tryIt: [
      {
        label: 'Com um texto selecionado',
        phrases: ['"deixa mais formal"', '"corrige os erros"', '"transforma em lista"', '"resume isso"', '"o que é isso?"', '"o que tem nesse link?"'],
      },
      {
        label: 'Sem nada selecionado',
        phrases: [
          '"escreve um e-mail pedindo o orçamento"',
          '"quanto é 15% de 230?"',
          '"qual a cotação do dólar hoje?"',
          '"abre o YouTube"',
          '"pesquisa camiseta preta no Mercado Livre"',
        ],
      },
    ],
    tips: [
      'Selecione o texto antes de tocar o atalho. Edições (reescrever, corrigir, resumir, formatar) substituem a seleção.',
      'Perguntas e explicações aparecem num cartão, com um botão para copiar.',
      'Assuntos do momento (notícias, preços, clima) são buscados na internet, e o cartão mostra as fontes.',
      'Numa conversa ou página onde não dá para escrever, a resposta vai sempre para o cartão.',
      'Se ele disser que não leu a seleção, copie o texto (Ctrl+C) e peça de novo.',
    ],
  },
  {
    id: 'traducao',
    title: 'Tradução',
    logo: 'translate',
    shortcut: 'translation',
    what: 'Fale em português e o texto entra já traduzido no campo onde você está.',
    tips: [
      'Escolha até 3 idiomas de destino em Configurações → Tradução. O primeiro é o padrão.',
      'Com mais de um idioma, clique no idioma que aparece na barra para trocar o destino.',
      'Quer só ver a tradução, sem colar? Selecione o texto, use o Ask Anything e diga "traduz pro inglês": a tradução vai para o cartão e o seu texto fica intacto.',
    ],
  },
  {
    id: 'notion',
    title: 'Anotar no Notion',
    logo: 'notion',
    shortcut: 'askAnything',
    what: 'Pelo Ask Anything, guarde vídeos, links e ideias nas suas listas do Notion sem sair do que está fazendo.',
    tryIt: [
      {
        label: 'Diga',
        phrases: ['"anota esse vídeo pra ver mais tarde"', '"anota na pasta Ideias: comprar café para o escritório"', '"salva esse link" (com um link selecionado)'],
      },
    ],
    tips: [
      'Funciona com a página aberta no navegador ou com um link selecionado em qualquer app, até no WhatsApp.',
      'O item entra com o título real do vídeo ou da página.',
      'A barra mostra Abrir e Desfazer logo depois de anotar.',
      'A pasta padrão e as pastas que ele enxerga ficam em Conectores → Notion.',
    ],
  },
  {
    id: 'colar',
    title: 'Colar a última transcrição',
    logo: 'paste',
    shortcut: 'pasteLastTranscript',
    what: 'Insere de novo o último texto ditado, onde o cursor estiver.',
    tips: [
      'Útil quando o texto foi parar no lugar errado ou quando você quer o mesmo texto em outro app.',
      'O que você tinha copiado antes volta para a área de transferência logo depois.',
    ],
  },
  {
    id: 'aprender',
    title: 'Dicionário e aprendizado',
    logo: 'dictionary',
    where: 'Configurações → Dicionário',
    what: 'Ensine nomes, marcas e termos que a IA erra, e deixe o app aprender o seu jeito de escrever.',
    tips: [
      'Adicione termos em Configurações → Dicionário, ou importe uma lista em CSV.',
      'Corrigiu um nome logo depois de ditar? O app percebe, põe o nome no dicionário sozinho e mostra um Desfazer.',
      'O estilo pessoal resume o seu jeito de escrever (pontuação, abreviações) e o refino passa a seguir. Dá para ver e desligar em Configurações → Aprendizado e histórico.',
    ],
  },
  {
    id: 'historico',
    title: 'Histórico e estatísticas',
    logo: 'history',
    where: 'Histórico e Estatísticas',
    what: 'Tudo o que você ditou fica guardado no seu PC, com o áudio, e vira números de quanto tempo você economizou.',
    tips: [
      'No Histórico dá para buscar, copiar, ouvir o áudio e refazer um ditado que saiu errado.',
      'Em Estatísticas: palavras ditadas, tempo economizado, sequência de dias e os seus horários.',
      'Você escolhe por quanto tempo guardar o histórico em Configurações → Aprendizado e histórico.',
    ],
  },
  {
    id: 'privacidade',
    title: 'Privacidade',
    logo: 'privacy',
    where: 'Configurações → Privacidade',
    what: 'O app lê a tela para acertar nomes e tom, mas você controla onde ele pode ler.',
    tips: [
      'Desligue a leitura da tela quando quiser, em Configurações → Privacidade ou no ícone da bandeja.',
      'WhatsApp e Telegram vêm bloqueados. Dá para bloquear outros apps e sites.',
      'Campos de senha nunca são lidos.',
    ],
  },
]

export function Utilities() {
  const [bindings, setBindings] = useState<ShortcutBindings | null>(null)

  useEffect(() => {
    void window.justSay.invoke<AppSettings>(IPC.settingsGet).then((s) => setBindings(s.featureShortcutBindings))
    return window.justSay.on(IPC.settingsChanged, (s) => setBindings((s as AppSettings).featureShortcutBindings))
  }, [])

  const goTo = (id: string) => document.getElementById(`util-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <section className="utilities">
      <h1>Utilidades</h1>
      <p className="muted context-line">O que o Just Say faz, frases para experimentar e dicas para aproveitar melhor.</p>

      <div className="util-nav">
        {UTILITIES.map((u) => (
          <button key={u.id} className="chip util-chip" style={{ ['--tone' as string]: LOGO_TONE[u.logo] }} onClick={() => goTo(u.id)}>
            {u.title}
          </button>
        ))}
      </div>

      {UTILITIES.map((u) => (
        <div key={u.id} id={`util-${u.id}`} className="util-card" style={{ ['--tone' as string]: LOGO_TONE[u.logo] }}>
          <div className="util-head">
            <span className="util-logo">
              <AppLogo kind={u.logo} />
            </span>
            <div className="util-title">{u.title}</div>
            {u.shortcut && bindings ? (
              <Keys keys={bindings[u.shortcut]} />
            ) : (
              u.where && <span className="muted small">{u.where}</span>
            )}
          </div>
          <p className="util-what">{u.what}</p>

          {u.tryIt?.map((g) => (
            <div key={g.label} className="util-try">
              <div className="util-label">{g.label}</div>
              <div className="util-phrases">
                {g.phrases.map((p) => (
                  <span key={p} className="util-phrase">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          ))}

          <div className="util-label">Dicas</div>
          <ul className="util-tips">
            {u.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
