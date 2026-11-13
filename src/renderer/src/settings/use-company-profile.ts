import { useCallback, useEffect, useState } from 'react'
import type { CompanyProfile } from '../../../shared/company-profile'

export type ProfileLoad =
  | { kind: 'loading' }
  | { kind: 'error'; message: string; noCompany: boolean }
  | { kind: 'ready'; profile: CompanyProfile }

/** 회사 정보를 불러온다. 다시 불러오기(reload)는 충돌 해소에도 쓴다. */
export function useCompanyProfile(): { load: ProfileLoad; reload: () => void } {
  const [load, setLoad] = useState<ProfileLoad>({ kind: 'loading' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    window.api
      .getCompanyProfile()
      .then((r) => {
        if (!live) return
        setLoad(
          r.ok
            ? { kind: 'ready', profile: r.value }
            : {
                kind: 'error',
                noCompany: r.code === 'no-company',
                message:
                  r.code === 'no-company'
                    ? '열려 있는 회사가 없어요.'
                    : r.code === 'not-found'
                      ? '회사 정보 문서를 찾지 못했어요. 회사 폴더의 company/mission.md를 확인해 주세요.'
                      : '회사 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
              }
        )
      })
      .catch(() => {
        if (live)
          setLoad({
            kind: 'error',
            noCompany: false,
            message: '회사 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.'
          })
      })
    return () => {
      live = false
    }
  }, [tick])
  const reload = useCallback(() => {
    setLoad({ kind: 'loading' })
    setTick((t) => t + 1)
  }, [])
  return { load, reload }
}
