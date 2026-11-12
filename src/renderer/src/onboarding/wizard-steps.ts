export const WIZARD_STEPS = ['welcome', 'providers', 'limits', 'done'] as const
export type WizardStep = (typeof WIZARD_STEPS)[number]

export const STEP_LABELS: Record<WizardStep, string> = {
  welcome: '시작',
  providers: 'AI 연결',
  limits: '주간 한도',
  done: '완료'
}

/** 'done'은 저장이 성공해야만 갈 수 있어서 next 대상에서 제외하고 limits 화면의 저장 성공이 직접 이동시킨다. */
export function nextStep(step: WizardStep): WizardStep {
  if (step === 'limits' || step === 'done') return step
  return WIZARD_STEPS[WIZARD_STEPS.indexOf(step) + 1]
}

export function prevStep(step: WizardStep): WizardStep {
  if (step === 'welcome' || step === 'done') return step
  return WIZARD_STEPS[WIZARD_STEPS.indexOf(step) - 1]
}

export function stepIndex(step: WizardStep): number {
  return WIZARD_STEPS.indexOf(step)
}
