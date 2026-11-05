import { describe, expect, it } from 'vitest'
import { buildSttPrompt, isSttArtifact } from '../src/refine/prompts.ts'

const prompt = buildSttPrompt(['Just Say', 'Groq', 'Notion', 'Claude Code'])

describe('transcrição que não é fala (D79)', () => {
  it('o prompt é só a lista, sem o rótulo "Termos:" que o Whisper copiava (D87)', () => {
    expect(prompt).toBe('Just Say, Groq, Notion, Claude Code.')
    expect(buildSttPrompt([])).toBeUndefined()
  })

  it('o eco do começo do prompt vira "nenhuma fala"', () => {
    expect(isSttArtifact('Just Say.', prompt)).toBe(true)
    expect(isSttArtifact('Just Say, Groq.', prompt)).toBe(true)
  })

  it('um pedaço de 3+ palavras do glossário também', () => {
    expect(isSttArtifact('Groq, Notion, Claude Code.', prompt)).toBe(true)
  })

  it('fala de verdade com termos do glossário passa', () => {
    expect(isSttArtifact('Notion', prompt)).toBe(false)
    expect(isSttArtifact('Abre o Notion pra mim.', prompt)).toBe(false)
    expect(isSttArtifact('Os termos do contrato estão ok.', prompt)).toBe(false)
    expect(isSttArtifact('Termos.', prompt)).toBe(false)
  })

  it('frases de legenda que o Whisper inventa no silêncio', () => {
    expect(isSttArtifact('Legendas pela comunidade Amara.org', undefined)).toBe(true)
    expect(isSttArtifact('Obrigado por assistir!', undefined)).toBe(true)
    expect(isSttArtifact('Thank you for watching.', undefined)).toBe(true)
    expect(isSttArtifact('Obrigado pela ajuda, Ana.', undefined)).toBe(false)
  })

  it('vazio ou só pontuação', () => {
    expect(isSttArtifact('  ', prompt)).toBe(true)
    expect(isSttArtifact('...', undefined)).toBe(true)
  })

  it('sem dicionário (sem prompt) a fala comum passa', () => {
    expect(isSttArtifact('Termos.', undefined)).toBe(false)
    expect(isSttArtifact('Bom dia.', undefined)).toBe(false)
  })
})
