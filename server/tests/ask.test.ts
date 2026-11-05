import { describe, expect, it } from 'vitest'
import { sourcesFromExecutedTools } from '../src/providers/groq.ts'
import {
  buildAskUserMessage,
  buildSearchUserMessage,
  cleanSearchAnswer,
  isTranslationRequest,
  parseAskDecision,
  safeExternalUrl,
} from '../src/refine/askPrompts.ts'
import { languageName } from '../src/refine/languages.ts'
import { askMaxTokens, fieldEditableFrom, todayLabel } from '../src/voiceFlow.ts'

describe('decisão do Ask Anything', () => {
  it('lê colar e responder', () => {
    expect(parseAskDecision('<acao>colar</acao>\n<texto>Prezado João,</texto>', 'x', true)).toMatchObject({
      action: 'colar',
      text: 'Prezado João,',
    })
    expect(parseAskDecision('<acao>responder</acao><texto>**42**</texto>', 'x', false)).toMatchObject({
      action: 'responder',
      text: '**42**',
    })
  })

  it('buscar sem consulta usa o próprio comando', () => {
    expect(parseAskDecision('<acao>buscar</acao><busca>dólar hoje</busca>', 'qual o dólar', false)).toMatchObject({
      action: 'buscar',
      query: 'dólar hoje',
    })
    expect(parseAskDecision('<acao>buscar</acao>', 'qual o dólar', false).query).toBe('qual o dólar')
  })

  it('abrir só com link http/https; senão vira busca', () => {
    expect(parseAskDecision('<acao>abrir</acao><url>https://www.youtube.com/</url>', 'abre o youtube', false)).toMatchObject({
      action: 'abrir',
      url: 'https://www.youtube.com/',
    })
    const bad = parseAskDecision('<acao>abrir</acao><url>file:///C:/Windows/system32/calc.exe</url>', 'abre a calculadora', false)
    expect(bad).toMatchObject({ action: 'buscar', query: 'abre a calculadora', url: '' })
  })

  it('resposta sem formato: com seleção vira colar, sem seleção vira responder', () => {
    expect(parseAskDecision('Texto reescrito.', 'melhora', true)).toMatchObject({ action: 'colar', text: 'Texto reescrito.' })
    expect(parseAskDecision('Paris.', 'capital da França', false)).toMatchObject({ action: 'responder', text: 'Paris.' })
  })

  it('colar vazio não cola nada: vira um aviso no cartão', () => {
    const d = parseAskDecision('<acao>colar</acao><texto></texto>', 'x', true)
    expect(d.action).toBe('responder')
    expect(d.text).toMatch(/Não consegui/)
  })
})

describe('link externo', () => {
  it('aceita http e https', () => {
    expect(safeExternalUrl('https://www.google.com/search?q=p%C3%A3o')).toBe('https://www.google.com/search?q=p%C3%A3o')
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com/')
  })
  it('recusa outros esquemas, credenciais e lixo', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('file:///C:/x')).toBeNull()
    expect(safeExternalUrl('ms-settings:privacy')).toBeNull()
    expect(safeExternalUrl('https://user:pass@example.com')).toBeNull()
    expect(safeExternalUrl('não é link')).toBeNull()
    expect(safeExternalUrl(null)).toBeNull()
  })
})

describe('mensagem do Ask Anything', () => {
  it('põe a seleção e o comando, e marca o campo editável', () => {
    const msg = buildAskUserMessage({
      command: 'deixa mais formal',
      selectedText: 'oi, tudo bem?',
      context: { appName: 'Chrome', domain: 'mail.google.com' },
      fieldEditable: true,
    })
    expect(msg).toContain('<selecionado>\noi, tudo bem?\n</selecionado>')
    expect(msg).toContain('<comando>\ndeixa mais formal\n</comando>')
    expect(msg).toContain('campo editável: sim')
    expect(msg).toContain('site: mail.google.com')
  })
  it('sem seleção não manda a tag', () => {
    const msg = buildAskUserMessage({ command: 'oi', selectedText: '  ', context: {}, fieldEditable: null })
    expect(msg).not.toContain('<selecionado>')
    expect(msg).toContain('campo editável: não sei')
  })
})

describe('resposta da busca', () => {
  it('tira as marcas de citação e a linha de fontes', () => {
    const raw = 'O Flamengo venceu por 1 a 0.【1†L6-L10】【1†L14-L18】\n\n*Fonte:* Flamengo.com.br – “Com gol…”【1†L6-L10】'
    expect(cleanSearchAnswer(raw)).toBe('O Flamengo venceu por 1 a 0.')
  })
  it('mantém o texto normal', () => {
    expect(cleanSearchAnswer('- item 1\n- item 2')).toBe('- item 1\n- item 2')
  })

  it('fontes: páginas abertas primeiro, sem repetir e sem o buscador', () => {
    const tools = [
      {
        type: 'browser_search',
        search_results: {
          results: [
            { title: 'Notícia A', url: 'https://a.com/1' },
            { title: 'Notícia B', url: 'https://b.com/2' },
            { title: 'Busca', url: 'https://exa.ai/search?q=x' },
            { title: 'Ruim', url: 'javascript:alert(1)' },
          ],
        },
      },
      {
        type: 'browser.open',
        search_results: { results: [{ title: 'b.com - viewing lines [0 - 116] of 116', url: 'https://b.com/2' }] },
      },
    ]
    expect(sourcesFromExecutedTools(tools)).toEqual([
      { title: 'b.com', url: 'https://b.com/2' },
      { title: 'Notícia A', url: 'https://a.com/1' },
    ])
  })
  it('limita a quantidade de fontes', () => {
    const results = Array.from({ length: 9 }, (_, i) => ({ title: `T${i}`, url: `https://s${i}.com/` }))
    expect(sourcesFromExecutedTools([{ type: 'browser_search', search_results: { results } }], 5)).toHaveLength(5)
    expect(sourcesFromExecutedTools(undefined)).toEqual([])
  })
})

describe('outros', () => {
  it('nome do idioma de destino', () => {
    expect(languageName('en')).toBe('inglês')
    expect(languageName('pt-BR')).toBe('português do Brasil')
    expect(languageName('xx')).toBeNull()
    expect(languageName('toString')).toBeNull()
    expect(languageName(undefined)).toBeNull()
  })
  it('campo editável a partir do audio_context', () => {
    expect(fieldEditableFrom({ text_insertion_point: { input_capabilities: { is_editable: false } } })).toBe(false)
    expect(fieldEditableFrom({ text_insertion_point: { is_editable: true } })).toBe(true)
    expect(fieldEditableFrom({})).toBeNull()
  })
  it('data de hoje por extenso', () => {
    expect(todayLabel(new Date(2026, 9, 14))).toContain('14 de outubro de 2026')
  })
})

describe('teto de saída do Ask Anything', () => {
  it('sem seleção grande fica em 1000 (cabe no limite do Qwen)', () => {
    expect(askMaxTokens('')).toBe(1000)
    expect(askMaxTokens('x'.repeat(900))).toBe(1000)
  })
  it('seleção grande pede mais, até 4096', () => {
    expect(askMaxTokens('x'.repeat(3000))).toBe(1600)
    expect(askMaxTokens('x'.repeat(50_000))).toBe(4096)
  })
})

describe('busca com o texto selecionado (D70)', () => {
  it('leva a seleção e pede para abrir os links dela', () => {
    const msg = buildSearchUserMessage('o que tem nesse link?', 'x', {}, 'veja https://exemplo.com/artigo?a=1 e https://exemplo.com/artigo?a=1.')
    expect(msg).toContain('Texto que a pessoa selecionou')
    expect(msg).toContain('Abra e leia este link para responder: https://exemplo.com/artigo?a=1')
  })
  it('sem seleção, sem bloco de seleção', () => {
    expect(buildSearchUserMessage('dólar hoje', 'dólar hoje', {})).not.toContain('selecionou')
  })
})

describe('tradução pelo Ask Anything vai sempre para o cartão (D71)', () => {
  it('reconhece pedidos de tradução', () => {
    for (const c of ['Traduza essa frase para o inglês.', 'tradução pro espanhol', 'passa isso pro inglês', 'translate this', 'Traduz.', 'converte para o francês'])
      expect(isTranslationRequest(c), c).toBe(true)
  })
  it('não confunde com outros pedidos', () => {
    for (const c of ['deixa mais formal', 'escreve um e-mail em inglês pedindo folga', 'quanto é 15% de 230', 'resume isso'])
      expect(isTranslationRequest(c), c).toBe(false)
  })
  it('mesmo que o modelo escolha colar, vira cartão', () => {
    expect(parseAskDecision('<acao>colar</acao><texto>Good morning</texto>', 'traduz pro inglês', true)).toMatchObject({
      action: 'responder',
      text: 'Good morning',
    })
    expect(parseAskDecision('<acao>colar</acao><texto>Prezados,</texto>', 'deixa mais formal', true).action).toBe('colar')
  })
})
