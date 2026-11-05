import { describe, expect, it } from 'vitest'
import { diffCounts, editVerdict, locateEdited } from '../src/shared/editDiff'
import { canShowTypingHint, isTypingKey, TypingCounter, TYPING_HINT_COOLDOWN_MS } from '../src/shared/typingHint'

describe('diff de letras', () => {
  it('conta removidas e adicionadas', () => {
    expect(diffCounts('Marcus', 'Marcos')).toEqual({ removed: 1, added: 1 })
    expect(diffCounts('abc', 'abc')).toEqual({ removed: 0, added: 0 })
    expect(diffCounts('', 'abc')).toEqual({ removed: 0, added: 3 })
    expect(diffCounts('abc', '')).toEqual({ removed: 3, added: 0 })
    expect(diffCounts('reunião às 4', 'reunião às 16h')).toEqual({ removed: 1, added: 3 })
  })
  it('acentos e emoji contam como uma letra', () => {
    expect(diffCounts('ação', 'acao')).toEqual({ removed: 2, added: 2 })
    expect(diffCounts('ok 👍', 'ok')).toEqual({ removed: 2, added: 0 })
  })
  it('para cedo quando passa do limite', () => {
    expect(diffCounts('aaaa', 'bbbb', 3)).toBeNull()
  })
})

describe('veredito da edição', () => {
  const colado = 'Falei com o Marcus sobre o projeto ontem.'
  it('correção pequena conta', () => {
    expect(editVerdict(colado, 'Falei com o Marcos sobre o projeto ontem.')).toEqual({ kind: 'small', removed: 1, added: 1 })
  })
  it('sem mudança', () => {
    expect(editVerdict(colado, colado)).toEqual({ kind: 'none' })
  })
  it('mais de 50% apagado é descartado', () => {
    expect(editVerdict(colado, 'Falei com o Marcos.')).toMatchObject({ kind: 'too_big' })
  })
  it('reescrita grande (mais de 2× alterado) é descartada', () => {
    expect(editVerdict('Oi tudo bem', 'Prezado senhor, venho por meio desta informar que')).toMatchObject({
      kind: 'too_big',
      reason: 'changed',
    })
  })
  it('trecho que ficou com menos de 20% é descartado', () => {
    expect(editVerdict(colado, 'Ok')).toEqual({ kind: 'too_big', reason: 'shrunk' })
  })
})

describe('onde está o trecho colado', () => {
  it('acha o trecho entre o que já estava no campo', () => {
    const base = 'Oi Pedro,\n Falei com o Marcus hoje.\nAbraço'
    const now = 'Oi Pedro,\n Falei com o Marcos hoje.\nAbraço'
    expect(locateEdited(base, ' Falei com o Marcus hoje.', now)).toEqual({
      before: 'Falei com o Marcus hoje.',
      after: 'Falei com o Marcos hoje.',
    })
  })
  it('se a pessoa mexeu fora do trecho colado, não vale', () => {
    expect(locateEdited('Oi Pedro, texto colado', 'texto colado', 'Olá Pedro, texto colado')).toBeNull()
  })
  it('se o texto colado não está no campo, não vale', () => {
    expect(locateEdited('outra coisa', 'texto colado', 'outra coisa')).toBeNull()
  })
})

describe('dica de uso', () => {
  it('só conta teclas de escrever, sem Ctrl/Alt/Win', () => {
    expect(isTypingKey('A', [])).toBe(true)
    expect(isTypingKey('Space', ['LeftShift'])).toBe(true)
    expect(isTypingKey('C', ['LeftCtrl'])).toBe(false)
    expect(isTypingKey('ArrowLeft', [])).toBe(false)
    expect(isTypingKey('Pause', [])).toBe(false)
    expect(isTypingKey('F5', [])).toBe(false)
  })
  it('mais de 60 teclas em 60 s disparam uma vez', () => {
    const c = new TypingCounter()
    let fired = 0
    for (let i = 0; i < 61; i++) if (c.push(i * 500)) fired++
    expect(fired).toBe(1)
  })
  it('teclas espalhadas em mais de 60 s não disparam', () => {
    const c = new TypingCounter()
    let fired = false
    for (let i = 0; i < 120; i++) fired ||= c.push(i * 1100)
    expect(fired).toBe(false)
  })
  it('no máximo uma vez por dia, e respeita o desligado', () => {
    expect(canShowTypingHint(true, null, 0)).toBe(true)
    expect(canShowTypingHint(true, 0, TYPING_HINT_COOLDOWN_MS - 1)).toBe(false)
    expect(canShowTypingHint(true, 0, TYPING_HINT_COOLDOWN_MS)).toBe(true)
    expect(canShowTypingHint(false, null, 0)).toBe(false)
  })
})
