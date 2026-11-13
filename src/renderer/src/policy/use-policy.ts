import { useCallback, useEffect, useRef, useState } from 'react'
import type { PolicySummary, PolicyValues } from '../../../shared/policy'
import type { ProjectType } from '../../../shared/project'
import { loadPolicy, submitPolicy, type PolicyLoad, type SaveStatus } from './policy-model'

export interface PolicyEditor {
  load: PolicyLoad
  draft: PolicyValues | null
  setDraft: (v: PolicyValues) => void
  save: SaveStatus
  dirty: boolean
  reload: () => void
  submit: (confirmAuto: boolean) => Promise<void>
}

/** 한 프로젝트의 정책 편집 상태. 저장 성공·충돌 뒤 최신 상태로 다시 맞춘다. */
export function usePolicyEditor(
  projectId: string,
  onSaved: () => void,
  type: ProjectType = 'development'
): PolicyEditor {
  const [load, setLoad] = useState<PolicyLoad>({ kind: 'loading' })
  const [draft, setDraftState] = useState<PolicyValues | null>(null)
  const [save, setSave] = useState<SaveStatus>({ kind: 'idle' })
  const [tick, setTick] = useState(0)
  const lock = useRef(false)

  useEffect(() => {
    let cancelled = false
    void loadPolicy(window.api, projectId).then((next) => {
      if (cancelled) return
      setLoad(next)
      setDraftState(next.kind === 'ready' ? structuredClone(next.state.values) : null)
    })
    return () => {
      cancelled = true
    }
  }, [projectId, tick])

  const reload = useCallback(() => {
    setLoad({ kind: 'loading' })
    setSave({ kind: 'idle' })
    setTick((n) => n + 1)
  }, [])

  const setDraft = useCallback((v: PolicyValues) => {
    setDraftState(v)
    setSave((s) => (s.kind === 'saving' || s.kind === 'conflict' ? s : { kind: 'idle' }))
  }, [])

  const submit = useCallback(
    async (confirmAuto: boolean) => {
      if (lock.current || load.kind !== 'ready' || !draft) return
      lock.current = true
      setSave({ kind: 'saving' })
      try {
        const r = await submitPolicy(
          window.api,
          {
            projectId,
            revision: load.state.revision,
            values: draft,
            ...(confirmAuto ? { confirmAuto: true } : {})
          },
          type
        )
        setSave(r.status)
        if (r.state) {
          setLoad({ kind: 'ready', state: r.state })
          setDraftState(structuredClone(r.state.values))
          onSaved()
        }
      } finally {
        lock.current = false
      }
    },
    [projectId, load, draft, onSaved, type]
  )

  const dirty =
    load.kind === 'ready' &&
    draft !== null &&
    JSON.stringify(draft) !== JSON.stringify(load.state.values)
  return { load, draft, setDraft, save, dirty, reload, submit }
}

/** 프로젝트 목록 배지용 요약. 실패해도 목록은 그대로 보여 주므로 빈 값으로 둔다. */
export function usePolicySummaries(): { byId: Map<string, PolicySummary>; reload: () => void } {
  const [list, setList] = useState<PolicySummary[]>([])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    void window.api
      .listPolicySummaries()
      .then((r) => {
        if (!cancelled) setList(r.ok ? r.value : [])
      })
      .catch(() => {
        if (!cancelled) setList([])
      })
    return () => {
      cancelled = true
    }
  }, [tick])
  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { byId: new Map(list.map((s) => [s.projectId, s])), reload }
}
