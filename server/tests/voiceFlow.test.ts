import { describe, expect, it } from 'vitest'
import { buildDictationUserMessage, buildSttPrompt, extractRefinedText } from '../src/refine/prompts.ts'
import { dictationContextFrom, sttLanguage } from '../src/voiceFlow.ts'

describe('extração do texto refinado', () => {
  it('pega o conteúdo das tags <texto>', () => {
    expect(extractRefinedText('Claro!\n<texto>Olá, mundo.</texto>')).toBe('Olá, mundo.')
  })
  it('aceita tag sem fechamento e cercas de código', () => {
    expect(extractRefinedText('<texto>Linha 1\nLinha 2')).toBe('Linha 1\nLinha 2')
    expect(extractRefinedText('```\nsó texto\n```')).toBe('só texto')
  })
  it('sem tags devolve o texto limpo', () => {
    expect(extractRefinedText('  Oi.  ')).toBe('Oi.')
  })
})

describe('idioma do STT', () => {
  it('fixa o idioma só quando há exatamente um escolhido', () => {
    expect(sttLanguage({ languages: ['pt-BR'] })).toBe('pt')
    expect(sttLanguage({ languages: ['pt-BR', 'en'] })).toBeUndefined()
    expect(sttLanguage({})).toBeUndefined()
  })
})

describe('contexto de ditado a partir do audio_context', () => {
  it('lê app, navegador e markdown', () => {
    const ctx = dictationContextFrom({
      active_application: {
        name: 'Chrome',
        executable: 'chrome.exe',
        window_title: 'Gmail',
        type: 'web_browser',
        browser_context: { domain: 'mail.google.com' },
      },
      text_insertion_point: { input_capabilities: { supports_markdown: true } },
    })
    expect(ctx).toMatchObject({
      appName: 'Chrome',
      executable: 'chrome.exe',
      appType: 'web_browser',
      domain: 'mail.google.com',
      supportsMarkdown: true,
    })
  })
  it('lê o texto da tela, do campo e da página (Fase 5)', () => {
    const ctx = dictationContextFrom({
      active_application: { visible_screen_content: 'Moreira: bom dia', browser_context: { page_title: 'Gmail' } },
      text_insertion_point: {
        cursor_state: { text_before: 'Oi Moreira,', text_after: '' },
        surrounding_context: { before: 'Para: moreira@x.com', after: '' },
        input_capabilities: { placeholder: 'Escreva' },
      },
    })
    expect(ctx).toMatchObject({
      visibleText: 'Moreira: bom dia',
      pageTitle: 'Gmail',
      fieldBefore: 'Oi Moreira,',
      pageBefore: 'Para: moreira@x.com',
      placeholder: 'Escreva',
    })
  })

  it('o prompt leva o recorte da tela dentro do orçamento de tokens', () => {
    const msg = buildDictationUserMessage('oi', { visibleText: 'x'.repeat(40_000), fieldBefore: 'Oi Moreira,' }, [])
    expect(msg).toContain('<tela>')
    expect(msg).toContain('<campo_antes_do_cursor>\nOi Moreira,\n</campo_antes_do_cursor>')
    const tela = msg.split('<tela>\n')[1].split('\n</tela>')[0]
    expect(tela.length).toBeLessThanOrEqual(1000 * 4 + 10)
  })

  it('contexto ausente não quebra', () => {
    expect(dictationContextFrom(undefined).supportsMarkdown).toBe(false)
  })
})

describe('prompt do STT', () => {
  it('vira a lista dos termos, sem rótulo, ou nada', () => {
    expect(buildSttPrompt([])).toBeUndefined()
    expect(buildSttPrompt(['Just Say', 'Groq'])).toBe('Just Say, Groq.')
  })
})
