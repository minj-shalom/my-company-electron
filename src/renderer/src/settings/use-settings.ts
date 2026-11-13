import { useCallback, useEffect, useState } from 'react'
import type { WindowApi } from '../../../shared/api'
import type { WeeklyLimit } from '../../../shared/provider'
import type { ProviderSelection } from '../../../shared/provider-selection'
import type { UsageWidgetData } from '../../../shared/usage'
import { loadDetection, type DetectionStatus } from '../onboarding/use-detection'
import type { BreakdownNames } from './settings-model'

export interface SettingsData {
  widget: UsageWidgetData
  /** null = 불러오지 못함 (화면에서 안내하고 입력은 막는다). */
  limits: WeeklyLimit[] | null
  selection: ProviderSelection | null
  names: BreakdownNames
}

export type SettingsLoad =
  { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; data: SettingsData }

const LOAD_ERROR = '설정과 사용량을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'

type LoadApi = Pick<
  WindowApi,
  'getUsageWidget' | 'getWeeklyLimits' | 'getProviderSelection' | 'getOrg' | 'listProjects'
>

/** 사용량 위젯이 필수다. 한도·제공자 선택·이름 정보는 실패해도 가능한 만큼 보여 준다. */
export async function loadSettings(api: LoadApi): Promise<SettingsLoad> {
  try {
    const [widget, limits, selection, org, projects] = await Promise.all([
      api.getUsageWidget(),
      api.getWeeklyLimits().catch(() => null),
      api.getProviderSelection().catch(() => null),
      api.getOrg().catch(() => null),
      api.listProjects().catch(() => null)
    ])
    if (!widget.ok) return { kind: 'error', message: LOAD_ERROR }
    const names: BreakdownNames = {
      projectNames: new Map(projects?.ok ? projects.value.items.map((p) => [p.id, p.name]) : []),
      employeeNames: new Map(
        org?.ok
          ? org.value.org.members.flatMap((m): [string, string][] =>
              m.agentId ? [[m.agentId, m.title]] : []
            )
          : []
      ),
      employeeProjects: new Map(
        org?.ok
          ? org.value.agents.map((a): [string, string[]] => [
              a.id,
              (a.projects ?? []).filter((p) => p.active !== false).map((p) => p.name)
            ])
          : []
      )
    }
    return {
      kind: 'ready',
      data: {
        widget: widget.value,
        limits: limits?.ok ? limits.value : null,
        selection: selection?.ok ? selection.value : null,
        names
      }
    }
  } catch {
    return { kind: 'error', message: LOAD_ERROR }
  }
}

export function useSettings(): {
  load: SettingsLoad
  reload: () => void
  detection: DetectionStatus
  recheck: () => void
} {
  const [load, setLoad] = useState<SettingsLoad>({ kind: 'loading' })
  const [detection, setDetection] = useState<DetectionStatus>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  const [detectTick, setDetectTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    void loadSettings(window.api).then((next) => {
      if (!cancelled) setLoad(next)
    })
    return () => {
      cancelled = true
    }
  }, [tick])

  // 설치·버전 확인만 한다. 사용량이 드는 연결 테스트는 사용자가 따로 눌러야 한다.
  useEffect(() => {
    let cancelled = false
    void loadDetection(window.api).then((next) => {
      if (!cancelled) setDetection(next)
    })
    return () => {
      cancelled = true
    }
  }, [detectTick])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  const recheck = useCallback(() => {
    setDetection({ kind: 'loading' })
    setDetectTick((n) => n + 1)
  }, [])
  return { load, reload, detection, recheck }
}
