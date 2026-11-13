import type { ApiResult } from '../../shared/result'
import {
  MAX_PROFILE_BODY_BYTES,
  PROFILE_PATH,
  type CompanyProfile
} from '../../shared/company-profile'
import { validateCompanyName } from '../../shared/company-name'
import { FsGuardError, type SafeFs } from '../repository/safe-fs'
import { applyProfile, parseProfile, revisionOf, type ParsedProfile } from './profile-doc'

export interface ProfileServiceDeps {
  fs: SafeFs
  /** 같은 회사의 쓰기를 직렬화한다. */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
}

const fail = (
  code: 'invalid-request' | 'not-found' | 'conflict' | 'internal',
  message: string
): ApiResult<never> => ({ ok: false, code, message })

// 줄바꿈(\n)과 탭은 본문에 필요하다. 나머지 제어 문자와 줄 구분 문자는 제거한다.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/g
const clean = (s: string): string => s.replace(/\r\n?/g, '\n').replace(CONTROL, '')

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

type Parsed = { req: ParsedProfile & { revision: string } } | { error: string }

function parseRequest(raw: unknown): Parsed {
  if (!isRecord(raw)) return { error: '요청 형식이 올바르지 않습니다.' }
  const { name, vision, mission, principles, revision } = raw
  if (
    typeof name !== 'string' ||
    typeof vision !== 'string' ||
    typeof mission !== 'string' ||
    typeof principles !== 'string' ||
    typeof revision !== 'string' ||
    revision.length === 0 ||
    revision.length > 64
  )
    return { error: '요청 형식이 올바르지 않습니다.' }
  const cleanName = clean(name).replace(/\n/g, ' ').trim()
  const nameError = validateCompanyName(cleanName)
  if (nameError) return { error: nameError }
  const body = {
    vision: clean(vision).trim(),
    mission: clean(mission).trim(),
    principles: clean(principles).trim()
  }
  // 본문 줄이 `## `로 시작하면 저장 후 섹션이 갈라져 구조가 깨진다.
  for (const v of Object.values(body))
    if (/^##[ \t]/m.test(v)) return { error: '본문 줄은 "## "로 시작할 수 없습니다.' }
  const bytes = Buffer.byteLength(body.vision + body.mission + body.principles, 'utf8')
  if (bytes > MAX_PROFILE_BODY_BYTES) return { error: '본문이 너무 깁니다. (합계 64KB 이하)' }
  return { req: { name: cleanName, ...body, revision } }
}

export class ProfileService {
  constructor(private readonly deps: ProfileServiceDeps) {}

  private async read(): Promise<ApiResult<string>> {
    try {
      return { ok: true, value: await this.deps.fs.readText(PROFILE_PATH) }
    } catch (e) {
      if (e instanceof FsGuardError && e.kind === 'missing')
        return fail('not-found', '회사 정보 파일이 없습니다.')
      return fail('internal', '회사 정보를 읽지 못했습니다.')
    }
  }

  async get(): Promise<ApiResult<CompanyProfile>> {
    const r = await this.read()
    if (!r.ok) return r
    return { ok: true, value: { ...parseProfile(r.value), revision: revisionOf(r.value) } }
  }

  async save(raw: unknown): Promise<ApiResult<CompanyProfile>> {
    const p = parseRequest(raw)
    if ('error' in p) return fail('invalid-request', p.error)
    const { revision, ...next } = p.req
    return this.deps.exclusive(async () => {
      // 검증 후 쓰기 직전에 다시 읽어, 그 사이 외부에서 바뀐 파일을 덮어쓰지 않는다.
      const r = await this.read()
      if (!r.ok) return r
      if (revisionOf(r.value) !== revision)
        return fail('conflict', '다른 곳에서 회사 정보가 바뀌었습니다. 새로 불러오세요.')
      const text = applyProfile(r.value, next)
      try {
        if (text !== r.value) await this.deps.fs.writeText(PROFILE_PATH, text)
      } catch {
        return fail('internal', '회사 정보를 저장하지 못했습니다.')
      }
      return { ok: true, value: { ...parseProfile(text), revision: revisionOf(text) } }
    })
  }
}
