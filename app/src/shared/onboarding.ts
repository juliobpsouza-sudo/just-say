// Passo a passo da primeira abertura. O ditado de treino usa um contexto fictício fixo,
// para mostrar o app adaptando o texto à conversa.
// Conversa e nomes próprios do Just Say.

export const ONBOARDING_STEPS = ['chave', 'microfone', 'atalho', 'ditado', 'ask'] as const
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export interface OnboardingState {
  step: number
  completedAt: string | null
}

export const PRACTICE_CHAT = {
  app: 'Chat da equipe',
  channel: '#projeto-site',
  messages: [
    { author: 'Marina', text: 'Oi! Conseguiu ver o orçamento do site novo?' },
    { author: 'Marina', text: 'O cliente quer saber o prazo e se dá para incluir a loja virtual.' },
  ],
}

/** O que substitui o app em foco no `audio_context` durante o ditado de treino. */
export function practiceActiveApplication(): Record<string, unknown> {
  return {
    name: PRACTICE_CHAT.app,
    executable: 'just-say-treino',
    window_title: `${PRACTICE_CHAT.channel} · ${PRACTICE_CHAT.app}`,
    type: 'native_app',
    visible_screen_content: PRACTICE_CHAT.messages.map((m) => `${m.author}: ${m.text}`).join('\n'),
    browser_context: null,
  }
}
