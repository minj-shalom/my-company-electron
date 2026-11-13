import { useCallback, useEffect, useRef, useState } from 'react'
import { OnboardingWizard } from '../onboarding/OnboardingWizard'
import { AppShell } from '../shell/AppShell'
import {
  applyAction,
  applyRecheck,
  createAndOpenCompany,
  loadCompanyOnStartup,
  loadCompanyState,
  openExistingCompany,
  screenFor,
  type ActionResult,
  type GateState
} from './company-flow'
import { StartScreen } from './StartScreen'

/** 앱 시작 분기: 회사 상태에 따라 시작 화면, (새 회사) 온보딩, 앱 셸을 고른다. */
export function CompanyGate(): React.JSX.Element {
  const [gate, setGate] = useState<GateState>({ kind: 'loading' })
  const [error, setError] = useState<{ message: string; field?: 'name' } | undefined>()
  const [info, setInfo] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [onboarded, setOnboarded] = useState(false)
  // state는 비동기로 반영되므로 더블 클릭 중복 호출은 ref로 막는다.
  const busyRef = useRef(false)

  useEffect(() => {
    let alive = true
    void loadCompanyOnStartup(window.api).then((g) => alive && setGate(g))
    return () => {
      alive = false
    }
  }, [])

  const guarded = useCallback(async (work: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    setInfo(undefined)
    try {
      await work()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const run = useCallback(
    (action: () => Promise<ActionResult>) =>
      guarded(async () => {
        const r = await action()
        const next = applyAction(gate, r)
        setGate(next.gate)
        setError(next.error)
      }),
    [guarded, gate]
  )

  const recheck = useCallback(
    () =>
      guarded(async () => {
        const out = applyRecheck(await loadCompanyState(window.api))
        if (out.gate) setGate(out.gate)
        setError(out.error ? { message: out.error } : undefined)
        setInfo(out.info)
      }),
    [guarded]
  )

  const screen = screenFor(gate, onboarded)
  if (screen === 'loading') {
    return (
      <div className="start start--center" role="status" aria-live="polite">
        마지막 회사를 확인하고 있어요...
      </div>
    )
  }
  if (gate.kind === 'open') {
    return screen === 'onboarding' ? (
      <OnboardingWizard onFinish={() => setOnboarded(true)} />
    ) : (
      <AppShell companyName={gate.company.name} initialFirstHire={gate.fresh} />
    )
  }
  const notice = gate.kind === 'notice' ? { reason: gate.reason, name: gate.name } : undefined
  const shownError = error ?? (gate.kind === 'error' ? { message: gate.message } : undefined)
  return (
    <StartScreen
      notice={notice}
      error={shownError?.message}
      errorField={shownError?.field}
      info={info}
      busy={busy}
      onCreate={(name) => void run(() => createAndOpenCompany(window.api, name))}
      onOpen={() => void run(() => openExistingCompany(window.api))}
      onRecheck={() => void recheck()}
    />
  )
}
