// Estado do passo a passo (store `app-onboarding`) e o modo de treino.
import Store from 'electron-store'
import { ONBOARDING_STEPS, type OnboardingState } from '../shared/onboarding'

let store: Store<OnboardingState> | null = null

function onboardingStore(): Store<OnboardingState> {
  store ??= new Store<OnboardingState>({ name: 'app-onboarding', defaults: { step: 0, completedAt: null } })
  return store
}

export function onboardingState(): OnboardingState {
  return onboardingStore().store
}

export function setOnboarding(patch: { step?: unknown; completed?: unknown }): OnboardingState {
  const s = onboardingStore()
  if (typeof patch.step === 'number' && Number.isInteger(patch.step))
    s.set('step', Math.min(Math.max(patch.step, 0), ONBOARDING_STEPS.length - 1))
  if (patch.completed === true) s.set('completedAt', new Date().toISOString())
  if (patch.completed === false) s.set('completedAt', null)
  return s.store
}

// Enquanto o ditado de treino está aberto, o contexto do app em foco é o fictício.
let practice = false

export function setPractice(on: boolean): void {
  practice = on
}

export function practiceActive(): boolean {
  return practice
}
