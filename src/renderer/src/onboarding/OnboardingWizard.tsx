import { useEffect, useRef, useState } from 'react'
import type { WeeklyLimit } from '../../../shared/provider'
import { LimitsStep } from './LimitsStep'
import { PROVIDER_GUIDES } from './provider-guide'
import { ProvidersStep } from './ProvidersStep'
import {
  STEP_LABELS,
  WIZARD_STEPS,
  nextStep,
  prevStep,
  stepIndex,
  type WizardStep
} from './wizard-steps'

export function OnboardingWizard(): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>('welcome')
  const [saved, setSaved] = useState<WeeklyLimit[]>([])
  const headingRef = useRef<HTMLHeadingElement>(null)

  // 단계가 바뀌면 제목으로 포커스를 옮겨 키보드/스크린리더 사용자가 새 화면을 알 수 있게 한다.
  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  return (
    <main className="wizard">
      <h1>My Company 시작하기</h1>
      <nav aria-label="진행 단계">
        <ol className="stepper">
          {WIZARD_STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={s === step ? 'step' : undefined}
              className={i < stepIndex(step) ? 'is-done' : s === step ? 'is-current' : ''}
            >
              <span className="stepper__num">{i + 1}</span> {STEP_LABELS[s]}
              {i < stepIndex(step) && <span className="visually-hidden"> (완료)</span>}
            </li>
          ))}
        </ol>
      </nav>

      <h2 ref={headingRef} tabIndex={-1}>
        {stepIndex(step) + 1}단계. {STEP_LABELS[step]}
      </h2>

      {step === 'welcome' && (
        <div>
          <p>AI 직원들과 일하려면 먼저 AI 프로그램을 연결하고, 한 주에 쓸 예산을 정해야 해요.</p>
          <ol className="steps">
            <li>쓰고 싶은 AI(Claude, ChatGPT, Gemini)를 설치하고 로그인해요.</li>
            <li>AI별로 한 주에 쓸 예산을 정해요.</li>
          </ol>
          <p className="hint">
            로그인은 터미널에서 직접 해요. 이 앱은 비밀번호나 토큰을 받지 않아요.
          </p>
          <div className="toolbar">
            <button type="button" className="primary" onClick={() => setStep(nextStep(step))}>
              시작하기
            </button>
          </div>
        </div>
      )}

      {step === 'providers' && (
        <div>
          <ProvidersStep />
          <div className="toolbar">
            <button type="button" onClick={() => setStep(prevStep(step))}>
              이전
            </button>
            <button type="button" className="primary" onClick={() => setStep(nextStep(step))}>
              다음
            </button>
          </div>
        </div>
      )}

      {step === 'limits' && (
        <LimitsStep
          onBack={() => setStep(prevStep(step))}
          onSaved={(limits) => {
            setSaved(limits)
            setStep('done')
          }}
        />
      )}

      {step === 'done' && (
        <div>
          <p>설정을 저장했어요. 나중에 언제든 바꿀 수 있어요.</p>
          <h3>주간 한도</h3>
          <ul className="summary">
            {PROVIDER_GUIDES.map((g) => {
              const l = saved.find((x) => x.provider === g.id)
              return (
                <li key={g.id}>
                  {g.name}: {l ? `$${l.amount}` : '정하지 않음'}
                </li>
              )
            })}
          </ul>
          <div className="toolbar">
            <button type="button" onClick={() => setStep('welcome')}>
              처음부터 다시 보기
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
