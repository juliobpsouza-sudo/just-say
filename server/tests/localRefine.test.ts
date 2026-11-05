import { describe, expect, it } from 'vitest'
import { extractRefinedText, localRefineIsSafe } from '../src/refine/prompts.ts'

describe('checagem da limpeza do modelo local (D94)', () => {
  it('aceita a limpeza que só tira muletas e aplica a autocorreção', () => {
    expect(localRefineIsSafe('éé, tipo, amanhã às três, não, às quatro, pode ser?', 'Amanhã às quatro, pode ser?')).toBe(true)
    expect(localRefineIsSafe('Coloca, pode fazer.', 'Coloca, pode fazer.')).toBe(true)
  })

  it('recusa quando o modelo corta uma frase inteira (como nos testes reais)', () => {
    const said =
      'Marca a reunião para quinta-feira. Sempre que alguém pedir a planilha nova, você já manda a versão final. Você já manda o arquivo com todas as abas no mesmo lugar, uma para cada mês. Avisa o pessoal também.'
    const cut = 'Marca a reunião para quinta-feira. Sempre que alguém pedir a planilha nova, já manda o arquivo com todas as abas no mesmo lugar, uma para cada mês.'
    expect(localRefineIsSafe(said, cut)).toBe(false)
  })

  it('recusa termo do dicionário que a pessoa não falou', () => {
    expect(localRefineIsSafe('E coloca também o aplicativo do... Não estou conseguindo achar.', 'E coloca também o aplicativo do Claude.', ['Claude'])).toBe(false)
    expect(localRefineIsSafe('Abre o Claude pra mim.', 'Abre o Claude pra mim.', ['Claude'])).toBe(true)
  })

  it('recusa saída vazia', () => {
    expect(localRefineIsSafe('Oi, tudo bem?', '  ')).toBe(false)
  })

  it('tira a etiqueta com nome errado ("<teto>")', () => {
    expect(extractRefinedText('<teto>\nE a gente não consegue.\n</teto>')).toBe('E a gente não consegue.')
    expect(extractRefinedText('<texto>Olá.</texto>')).toBe('Olá.')
  })
})
