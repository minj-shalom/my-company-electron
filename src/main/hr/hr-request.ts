import { FsGuardError, type SafeFs } from '../repository/safe-fs'

export const HR_REQUESTS_DIR = 'company/hr-requests'
export const MAX_REQUEST_CHARS = 8_000

export const HR_REQUEST_STATUSES = ['pending', 'running', 'done', 'failed'] as const
export type HrRequestStatus = (typeof HR_REQUEST_STATUSES)[number]
export const HR_REQUESTERS = ['coo', 'ceo-via-coo'] as const
export type HrRequester = (typeof HR_REQUESTERS)[number]

export interface HrRequestFile {
  /** 파일 이름의 번호 (`007`). */
  id: string
  requester: HrRequester
  status: HrRequestStatus
  /** `## 요청` 절의 본문. 신뢰할 수 없는 텍스트다. */
  body: string
}

const FILE = /^(\d{3,6})\.md$/
const STATUS_LINE = /^- \*\*상태:\*\* *(\S+) *$/m
const REQUESTER_LINE = /^- \*\*지시자:\*\* *(\S+) *$/m

const isOneOf = <T extends string>(list: readonly T[], v: string): v is T =>
  (list as readonly string[]).includes(v)

/** 요청 파일 하나를 엄격하게 해석한다. 형식이 어긋나면 null (실행하지 않는다). */
export function parseHrRequest(fileName: string, text: string): HrRequestFile | null {
  const name = FILE.exec(fileName)
  if (name === null || text.length > MAX_REQUEST_CHARS * 2) return null
  const status = STATUS_LINE.exec(text)?.[1]
  const requester = REQUESTER_LINE.exec(text)?.[1]
  if (status === undefined || requester === undefined) return null
  if (!isOneOf(HR_REQUEST_STATUSES, status) || !isOneOf(HR_REQUESTERS, requester)) return null
  const at = text.indexOf('\n## 요청')
  if (at < 0) return null
  const rest = text.slice(at + '\n## 요청'.length)
  const next = rest.search(/\n## /)
  const body = (next < 0 ? rest : rest.slice(0, next)).trim()
  if (body === '' || body.length > MAX_REQUEST_CHARS) return null
  return { id: name[1], requester, status, body }
}

export async function listHrRequests(
  fs: SafeFs
): Promise<{ items: HrRequestFile[]; invalid: number }> {
  const { files } = await fs.listMarkdown(HR_REQUESTS_DIR)
  const items: HrRequestFile[] = []
  let invalid = 0
  for (const f of files) {
    try {
      const r = parseHrRequest(f, await fs.readText(`${HR_REQUESTS_DIR}/${f}`))
      if (r === null) invalid++
      else items.push(r)
    } catch (e) {
      if (!(e instanceof FsGuardError)) throw e
      invalid++
    }
  }
  items.sort((a, b) => Number(a.id) - Number(b.id))
  return { items, invalid }
}

/**
 * 상태는 앱만 바꾼다 (hr은 이 폴더에 쓸 수 없다). 상태 줄 하나만 교체하고 결과 한 줄을 덧붙인다.
 * `result`는 앱이 만든 고정 문장이다 (hr의 출력이나 경로를 담지 않는다).
 */
export async function setHrRequestStatus(
  fs: SafeFs,
  id: string,
  status: HrRequestStatus,
  result?: string
): Promise<void> {
  if (!/^\d{3,6}$/.test(id)) throw new Error('invalid-request-id')
  const path = `${HR_REQUESTS_DIR}/${id}.md`
  const text = await fs.readText(path)
  if (!STATUS_LINE.test(text)) throw new Error('invalid-request')
  let next = text.replace(STATUS_LINE, `- **상태:** ${status}`)
  if (result !== undefined) {
    const line = `- ${result.replace(/[\r\n]+/g, ' ').slice(0, 300)}`
    next = /\n## 처리 결과\n/.test(next)
      ? `${next.trimEnd()}\n${line}\n`
      : `${next.trimEnd()}\n\n## 처리 결과\n${line}\n`
  }
  await fs.writeText(path, next)
}
