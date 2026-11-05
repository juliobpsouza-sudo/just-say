import { describe, expect, it } from 'vitest'
import { autoCapitalize } from '../src/refine/prompts.ts'

describe('maiúscula no começo de toda frase (D91)', () => {
  it('começo do texto e depois de . ? !', () => {
    expect(autoCapitalize('oi, tudo bem? vamos sim. até amanhã! valeu')).toBe('Oi, tudo bem? Vamos sim. Até amanhã! Valeu')
  })

  it('começo de linha e itens de lista', () => {
    expect(autoCapitalize('compras:\n- arroz\n- feijão\n1. lavar\n2) secar')).toBe('Compras:\n- Arroz\n- Feijão\n1. Lavar\n2) Secar')
  })

  it('texto já certo não muda', () => {
    expect(autoCapitalize('Oi, Ana. Combinado: amanhã às 16h.')).toBe('Oi, Ana. Combinado: amanhã às 16h.')
  })

  it('não mexe em abreviação, reticências, iPhone, endereço, e-mail e número', () => {
    expect(autoCapitalize('falei com o Dr. silva e etc. depois')).toBe('Falei com o Dr. silva e etc. depois')
    expect(autoCapitalize('hmm... acho que sim')).toBe('Hmm... acho que sim')
    expect(autoCapitalize('iPhone novo')).toBe('iPhone novo')
    expect(autoCapitalize('www.site.com.br tem tudo')).toBe('www.site.com.br tem tudo')
    expect(autoCapitalize('ana@email.com respondeu')).toBe('ana@email.com respondeu')
    expect(autoCapitalize('3d print')).toBe('3d print')
  })

  it('não mexe em terminal nem editor de código', () => {
    expect(autoCapitalize('git status', { executable: 'WindowsTerminal.exe' })).toBe('git status')
    expect(autoCapitalize('const x = 1', { executable: 'Code.exe' })).toBe('const x = 1')
    expect(autoCapitalize('oi', { executable: 'chrome.exe' })).toBe('Oi')
  })
})
