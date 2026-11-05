import { describe, expect, it } from 'vitest'
import { buildDictationUserMessage } from '../src/refine/prompts.ts'
import { buildStyleUserMessage, extractProfile, MAX_PROFILE_CHARS } from '../src/style.ts'

describe('perfil de estilo pessoal', () => {
  it('pega só os tópicos dentro de <perfil>, no máximo 6', () => {
    const raw = 'Claro!\n<perfil>\n- informal, usa "pra"\n- sem ponto final no chat\nlinha solta\n- frases curtas\n- a\n- b\n- c\n- d\n</perfil>'
    expect(extractProfile(raw)).toBe('- informal, usa "pra"\n- sem ponto final no chat\n- frases curtas\n- a\n- b\n- c')
  })
  it('sem tópicos, sem perfil', () => {
    expect(extractProfile('<perfil></perfil>')).toBeNull()
  })
  it('perfil longo é cortado', () => {
    expect(extractProfile(`<perfil>- ${'x'.repeat(2000)}</perfil>`)!.length).toBe(MAX_PROFILE_CHARS)
  })
  it('amostras numeradas, cortadas e sem vazias', () => {
    const msg = buildStyleUserMessage(['oi tudo bem', '   ', 'y'.repeat(1000)])
    expect(msg).toContain('<texto n="1">\noi tudo bem\n</texto>')
    expect(msg).toContain(`<texto n="2">\n${'y'.repeat(600)}\n</texto>`)
    expect(msg).not.toContain('n="3"')
  })
  it('o perfil entra no refino do ditado só quando existe', () => {
    expect(buildDictationUserMessage('oi', {}, [], '- informal')).toContain('<estilo_pessoal>\n- informal\n</estilo_pessoal>')
    expect(buildDictationUserMessage('oi', {}, [], null)).not.toContain('estilo_pessoal')
  })
})
