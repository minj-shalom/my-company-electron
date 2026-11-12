import { useCallback, useEffect, useState } from 'react'
import type { WindowApi } from '../../../shared/api'
import type { ProviderDetection } from '../../../shared/provider'

export type DetectionStatus =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: ProviderDetection[] }

const GENERIC_ERROR = '설치 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
const NOT_IMPLEMENTED =
  '이 버전의 앱은 아직 설치 확인을 지원하지 않아요. 아래 안내대로 설치와 로그인을 진행해 주세요.'

/**
 * 자동 경로(마운트/다시 확인)가 쓰는 감지 호출. 타입으로 detectProviders만 받게 해서
 * 사용량이 드는 연결 테스트가 여기서 호출될 수 없도록 고정한다.
 */
export async function loadDetection(
  api: Pick<WindowApi, 'detectProviders'>
): Promise<DetectionStatus> {
  try {
    const r = await api.detectProviders()
    if (r.ok) return { kind: 'ready', items: r.value }
    return {
      kind: 'error',
      message: r.code === 'not-implemented' ? NOT_IMPLEMENTED : GENERIC_ERROR
    }
  } catch {
    return { kind: 'error', message: GENERIC_ERROR }
  }
}

/** 마운트 시 한 번 감지하고, refresh로 다시 확인한다. 연결 테스트는 여기서 부르지 않는다 (사용량이 든다). */
export function useDetection(): { status: DetectionStatus; refresh: () => void } {
  const [status, setStatus] = useState<DetectionStatus>({ kind: 'loading' })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    void loadDetection(window.api).then((next) => {
      if (!cancelled) setStatus(next)
    })
    return () => {
      cancelled = true
    }
  }, [tick])

  const refresh = useCallback(() => {
    setStatus({ kind: 'loading' })
    setTick((n) => n + 1)
  }, [])

  return { status, refresh }
}
