import { useCallback, useEffect, useState } from 'react'
import { OnboardingWizard } from '../onboarding/OnboardingWizard'
import { AppShell } from '../shell/AppShell'
import {
  createAndOpenCompany,
  loadCompanyOnStartup,
  loadCompanyState,
  openExistingCompany,
  type ActionResult,
  type GateState
} from './company-flow'
import { StartScreen } from './StartScreen'

/** 앱 시작 분기: 회사 상태에 따라 시작 화면, (새 회사) 온보딩, 앱 셸을 고른다. */
export function CompanyGate(): React.JSX.Element {
  const [gate, setGate] = useState<GateState>({ kind: 'loading' })
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [onboarded, setOnboarded] = useState(false)

  useEffect(() => {
    let alive = true
    void loadCompanyOnStartup(window.api).then((g) => alive && setGate(g))
    return () => {
      alive = false
    }
  }, [])

  const run = useCallback(async (action: () => Promise<ActionResult>) => {
    setBusy(true)
    setError(undefined)
    const r = await action()
    if (r.kind === 'opened') setGate({ kind: 'open', company: r.company, fresh: r.fresh })
    else if (r.kind === 'error') setError(r.message)
    setBusy(false)
  }, [])

  const recheck = useCallback(async () => {
    setBusy(true)
    setError(undefined)
    const g = await loadCompanyState(window.api)
    if (g.kind === 'error') setError(g.message)
    else setGate(g)
    setBusy(false)
  }, [])

  if (gate.kind === 'loading') {
    return (
      <div className="start start--center" role="status" aria-live="polite">
        마지막 회사를 확인하고 있어요...
      </div>
    )
  }
  if (gate.kind === 'open') {
    if (gate.fresh && !onboarded) return <OnboardingWizard onFinish={() => setOnboarded(true)} />
    return <AppShell companyName={gate.company.name} />
  }
  const notice = gate.kind === 'notice' ? { reason: gate.reason, name: gate.name } : undefined
  return (
    <StartScreen
      notice={notice}
      error={error ?? (gate.kind === 'error' ? gate.message : undefined)}
      busy={busy}
      onCreate={(name) => void run(() => createAndOpenCompany(window.api, name))}
      onOpen={() => void run(() => openExistingCompany(window.api))}
      onRecheck={() => void recheck()}
    />
  )
}
