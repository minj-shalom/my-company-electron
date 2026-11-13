import { useCallback, useEffect, useRef, useState } from 'react'
import type { FirstHireRole } from '../../../shared/company-hire'
import { runExclusive } from '../lib/refresh'
import { FirstHireView, type HirePhase } from './FirstHireView'
import {
  defaultSelection,
  loadFirstHire,
  rolesToHire,
  runFirstHire,
  type FirstHireLoad
} from './hire-model'

/** 첫 채용 화면. 온보딩 직후나 사무실·조직도의 안내에서 열린다. */
export function FirstHireScreen({
  onClose
}: {
  onClose: (changed: boolean) => void
}): React.JSX.Element {
  const [load, setLoad] = useState<FirstHireLoad>({ kind: 'loading' })
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [phase, setPhase] = useState<HirePhase>({ kind: 'idle' })
  const [tick, setTick] = useState(0)
  // state 반영 전의 연타도 막는다.
  const lock = useRef(false)

  useEffect(() => {
    let cancelled = false
    void loadFirstHire(window.api).then((next) => {
      if (cancelled) return
      setLoad(next)
      if (next.kind === 'ready') setSelected(defaultSelection(next.cards))
    })
    return () => {
      cancelled = true
    }
  }, [tick])

  const onToggle = useCallback((id: FirstHireRole) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  const onHire = useCallback(() => {
    if (load.kind !== 'ready') return
    const roles = rolesToHire(load.cards, selected)
    if (roles.length === 0) return
    void runExclusive(lock, async () => {
      setPhase({ kind: 'busy' })
      setPhase(await runFirstHire(window.api, roles))
    })
  }, [load, selected])

  return (
    <FirstHireView
      load={load}
      selected={selected}
      phase={phase}
      onToggle={onToggle}
      onHire={onHire}
      onRetry={() => {
        setLoad({ kind: 'loading' })
        setTick((n) => n + 1)
      }}
      onClose={onClose}
    />
  )
}
