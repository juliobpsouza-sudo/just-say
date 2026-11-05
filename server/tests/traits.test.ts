import { describe, expect, it } from 'vitest'
import { similarity, termsFromEdit, wordReplacements } from '../src/traits.ts'

describe('trocas de palavras', () => {
  it('acha a palavra trocada', () => {
    expect(wordReplacements('Falei com o Marcus hoje.', 'Falei com o Marcos hoje.')).toEqual([
      { from: 'Marcus', to: 'Marcos', sentenceStart: false },
    ])
  })
  it('acha trocas de mais de uma palavra', () => {
    expect(wordReplacements('uso o next jays no projeto', 'uso o Next.js no projeto').map((r) => [r.from, r.to])).toEqual([
      ['next jays', 'Next.js'],
    ])
  })
  it('sem troca, nada', () => {
    expect(wordReplacements('igual', 'igual')).toEqual([])
  })
})

describe('o que vira termo do dicionário', () => {
  it('nome próprio corrigido entra', () => {
    expect(termsFromEdit('Falei com o Marcus hoje.', 'Falei com o Marcos hoje.', [])).toEqual(['Marcos'])
  })
  it('termo técnico corrigido entra', () => {
    expect(termsFromEdit('uso o next jays', 'uso o Next.js', [])).toEqual(['Next.js'])
    expect(termsFromEdit('uso o fig jam', 'uso o FigJam', [])).toEqual(['FigJam'])
  })
  it('só a maiúscula no meio da frase entra; no começo da frase não', () => {
    expect(termsFromEdit('falei com o marcos', 'falei com o Marcos', [])).toEqual(['Marcos'])
    expect(termsFromEdit('ontem fui. hoje vou', 'ontem fui. Hoje vou', [])).toEqual([])
  })
  it('troca de palavra comum não entra', () => {
    expect(termsFromEdit('reunião na sexta', 'reunião na segunda', [])).toEqual([])
    expect(termsFromEdit('o concerto do carro', 'o conserto do carro', [])).toEqual([])
  })
  it('troca por algo muito diferente não entra (não é erro de reconhecimento)', () => {
    expect(termsFromEdit('falei com o Pedro', 'falei com o Marcos', [])).toEqual([])
  })
  it('termo que já está no dicionário não entra de novo', () => {
    expect(termsFromEdit('o Marcus', 'o Marcos', ['marcos'])).toEqual([])
  })
  it('restos de edição não entram (D87)', () => {
    // ponto sem espaço colando duas palavras, sigla grudada, termo curto demais
    expect(termsFromEdit('os nomes. Dr Paulo', 'os nomes.Dr Paulo', [])).toEqual([])
    expect(termsFromEdit('o TI setor Vendas', 'o TIsetor Vendass', [])).toEqual([])
    expect(termsFromEdit('foi lá', 'foi Va', [])).toEqual([])
    // termos de verdade com ponto, sigla ou maiúsculas no meio continuam entrando
    expect(termsFromEdit('uso o Sqlite', 'uso o SQLite', [])).toEqual(['SQLite'])
    expect(termsFromEdit('abre o git hub', 'abre o GitHub', [])).toEqual(['GitHub'])
  })

  it('no máximo 2 por edição', () => {
    expect(termsFromEdit('o Marcus e a Figmaa e o Notiom', 'o Marcos e a Figma e o Notion', []).length).toBe(2)
  })
})

describe('semelhança', () => {
  it('ignora acento e maiúscula', () => {
    expect(similarity('Ação', 'acao')).toBe(1)
    expect(similarity('Marcus', 'Marcos')).toBeCloseTo(0.833, 2)
  })
})
