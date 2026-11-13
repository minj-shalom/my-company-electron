import { MAX_PROFILE_BODY_BYTES, type CompanyProfile } from '../../../shared/company-profile'

export const MAX_NAME_LENGTH = 50

export interface ProfileDraft {
  name: string
  vision: string
  mission: string
  principles: string
}

export const toDraft = (p: CompanyProfile): ProfileDraft => ({
  name: p.name,
  vision: p.vision,
  mission: p.mission,
  principles: p.principles
})

export const isDirty = (a: ProfileDraft, b: ProfileDraft): boolean =>
  a.name !== b.name ||
  a.vision !== b.vision ||
  a.mission !== b.mission ||
  a.principles !== b.principles

/** 본문 합계(UTF-8 바이트). main의 상한과 같은 기준이다. */
export function bodyBytes(d: ProfileDraft): number {
  const enc = new TextEncoder()
  return (
    enc.encode(d.vision).length + enc.encode(d.mission).length + enc.encode(d.principles).length
  )
}

/** 편의용 사전 검증. 최종 검증은 main이 한다. 문제가 없으면 null. */
export function validateDraft(d: ProfileDraft): { field: 'name' | 'body'; message: string } | null {
  const name = d.name.trim()
  if (name.length === 0) return { field: 'name', message: '회사 이름을 입력해 주세요.' }
  if (name.length > MAX_NAME_LENGTH)
    return { field: 'name', message: `회사 이름은 ${MAX_NAME_LENGTH}자 이하로 적어 주세요.` }
  if (bodyBytes(d) > MAX_PROFILE_BODY_BYTES)
    return {
      field: 'body',
      message: '비전, 미션, 운영 원칙의 합계가 너무 길어요. 조금 줄여 주세요.'
    }
  return null
}

export const bodyUsage = (d: ProfileDraft): string =>
  `${Math.ceil(bodyBytes(d) / 1024)}KB / ${MAX_PROFILE_BODY_BYTES / 1024}KB`
