import { describe, expect, it } from 'vitest'
import {
  activeTargetLanguage,
  isValidTargetList,
  languageLabel,
  nextTargetLanguage,
} from '../src/shared/languages'
import { markdownToHtml, markdownToPlain } from '../src/shared/markdown'
import { displayDomain, safeExternalUrl } from '../src/shared/urls'

describe('idiomas da tradução', () => {
  it('ativo: o escolhido, se está na lista; senão o primeiro; lista vazia = nenhum', () => {
    expect(activeTargetLanguage(['en', 'es'], 'es')).toBe('es')
    expect(activeTargetLanguage(['en', 'es'], 'fr')).toBe('en')
    expect(activeTargetLanguage(['en'], null)).toBe('en')
    expect(activeTargetLanguage([], 'en')).toBeNull()
  })
  it('clique na barra passa para o próximo e volta ao começo', () => {
    expect(nextTargetLanguage(['en', 'es', 'fr'], 'en')).toBe('es')
    expect(nextTargetLanguage(['en', 'es', 'fr'], 'fr')).toBe('en')
    expect(nextTargetLanguage(['en'], 'en')).toBe('en')
    expect(nextTargetLanguage([], null)).toBeNull()
  })
  it('lista válida: só códigos conhecidos, sem repetir, no máximo 3', () => {
    expect(isValidTargetList(['en', 'es', 'fr'])).toBe(true)
    expect(isValidTargetList([])).toBe(true)
    expect(isValidTargetList(['en', 'es', 'fr', 'de'])).toBe(false)
    expect(isValidTargetList(['en', 'en'])).toBe(false)
    expect(isValidTargetList(['klingon'])).toBe(false)
    expect(isValidTargetList('en')).toBe(false)
  })
  it('nome para mostrar', () => {
    expect(languageLabel('en')).toBe('Inglês')
    expect(languageLabel('xx')).toBe('xx')
    expect(languageLabel(null)).toBe('')
  })
})

describe('markdown da resposta', () => {
  it('vira HTML com lista e negrito', () => {
    const html = markdownToHtml('**Atenção**\n\n- um\n- dois')
    expect(html).toContain('<strong>Atenção</strong>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>um</li>')
  })
  it('HTML cru do modelo é escapado, nunca interpretado', () => {
    const html = markdownToHtml('<script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })
  it('links javascript: não viram link', () => {
    expect(markdownToHtml('[clique](javascript:alert(1))')).not.toContain('href="javascript')
    expect(markdownToHtml('[site](https://exemplo.com)')).toContain('href="https://exemplo.com"')
  })
  it('texto puro tira a marcação e mantém a estrutura', () => {
    const md = '## Resumo\n\n**Negrito** e *itálico* e `código`.\n\n* item um\n* item dois\n\n1. passo\n\n[site](https://a.com)'
    expect(markdownToPlain(md)).toBe('Resumo\n\nNegrito e itálico e código.\n\n- item um\n- item dois\n\n1. passo\n\nsite (https://a.com)')
  })
  it('tabela vira colunas separadas por tabulação', () => {
    expect(markdownToPlain('| A | B |\n|---|---|\n| 1 | 2 |')).toBe('A\tB\n1\t2')
  })
  it('não estraga snake_case nem multiplicação', () => {
    expect(markdownToPlain('use a variável nome_do_arquivo e 2 * 3 * 4')).toBe('use a variável nome_do_arquivo e 2 * 3 * 4')
  })
  it('bloco de código fica como está', () => {
    expect(markdownToPlain('```js\nconst a = **b**\n```')).toBe('const a = **b**')
  })
})

describe('links externos', () => {
  it('só http/https e sem credenciais', () => {
    expect(safeExternalUrl('https://www.youtube.com')).toBe('https://www.youtube.com/')
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('file:///C:/Windows')).toBeNull()
    expect(safeExternalUrl('https://u:p@site.com')).toBeNull()
    expect(safeExternalUrl(42)).toBeNull()
  })
  it('domínio para mostrar', () => {
    expect(displayDomain('https://www.youtube.com/watch?v=1')).toBe('youtube.com')
    expect(displayDomain('nada')).toBe('nada')
  })
})
