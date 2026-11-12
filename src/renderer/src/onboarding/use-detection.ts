import { useCallback, useEffect, useState } from 'react'
import type { ProviderDetection } from '../../../shared/provider'

export type DetectionStatus =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: ProviderDetection[] }

/** 마운트 시 한 번 감지하고, refresh로 다시 확인한다. 연결 테스트는 여기서 부르지 않는다 (사용량이 든다). */
export function useDetection(): { status: DetectionStatus; refresh: () => void } {
  const [status, setStatus] = useState<DetectionStatus>({ kind: 'loading' })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    window.api
      .detectProviders()
      .then((r) => {
        if (cancelled) return
        setStatus(
          r.ok
            ? { kind: 'ready', items: r.value }
            : {
                kind: 'error',
                message:
                  r.code === 'not-implemented'
                    ? '이 버전의 앱은 아직 설치 확인을 지원하지 않아요. 아래 안내대로 설치와 로그인을 진행해 주세요.'
                    : '설치 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
              }
        )
      })
      .catch(() => {
        if (!cancelled)
          setStatus({
            kind: 'error',
            message: '설치 상태를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
          })
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
