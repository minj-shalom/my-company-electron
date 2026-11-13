import type { ChatHrRequestInfo, ChatHrStatusList } from '../../shared/chat'
import { HR_REQUESTS_DIR, MAX_REQUEST_CHARS, listHrRequests } from '../hr/hr-request'
import { FsGuardError, type SafeFs } from '../repository/safe-fs'
import { sharedRepository } from '../repository/shared-repository'

const MAX_PENDING = 10
const MAX_SHOWN = 20
const EXCERPT = 120

export class HrRequestRejected extends Error {
  constructor(readonly code: 'too-many' | 'invalid') {
    super(code)
  }
}

/** 본문 줄이 `## 요청` 같은 절 머리글이나 상태 줄로 해석되지 않게 머리글 표시를 이스케이프한다. */
function escapeBody(text: string): string {
  return text.replace(/^(\s*)#/gm, '$1\\#').replace(/^(\s*)- \*\*/gm, '$1\\- **')
}

/**
 * 인사 지시를 요청 파일(T-052 형식, 지시자 `ceo-via-coo`)로 접수한다. 파일은 앱이 만들고 LLM은 쓰지 않는다.
 * 처리는 hr 전용 실행이 한다. 번호는 기존 최댓값 + 1이고, 동시 접수와 겹치면 다음 번호로 다시 시도한다.
 */
export async function submitHrRequest(fs: SafeFs, text: string): Promise<{ id: string }> {
  const repo = sharedRepository(fs)
  return repo.runExclusive(async () => {
    const { items } = await listHrRequests(fs)
    if (items.filter((r) => r.status === 'pending' || r.status === 'running').length >= MAX_PENDING)
      throw new HrRequestRejected('too-many')
    const body = escapeBody(text)
    if (body.length > MAX_REQUEST_CHARS) throw new HrRequestRejected('invalid')
    const { files } = await fs.listMarkdown(HR_REQUESTS_DIR)
    let next = Math.max(0, ...files.map((f) => Number(/^(\d{3,6})\.md$/.exec(f)?.[1] ?? 0))) + 1
    for (let attempt = 0; attempt < 5; attempt++, next++) {
      const id = String(next).padStart(3, '0')
      const doc = `# 인사 요청 ${id}\n\n- **지시자:** ceo-via-coo\n- **상태:** pending\n\n## 요청\n${body}\n`
      try {
        await fs.writeText(`${HR_REQUESTS_DIR}/${id}.md`, doc, false)
        return { id }
      } catch (e) {
        if (!(e instanceof FsGuardError && e.kind === 'exists')) throw e
      }
    }
    throw new Error('hr-request-id-conflict')
  })
}

/** CEO가 낸 요청(`ceo-via-coo`)만 보여준다. COO 자신이 낸 요청은 대화 상태에 섞지 않는다. */
export async function hrRequestStatuses(
  fs: SafeFs,
  pendingApprovals: number
): Promise<ChatHrStatusList> {
  const { items } = await listHrRequests(fs)
  const mine: ChatHrRequestInfo[] = items
    .filter((r) => r.requester === 'ceo-via-coo')
    .reverse()
    .slice(0, MAX_SHOWN)
    .map((r) => ({ id: r.id, status: r.status, excerpt: r.body.slice(0, EXCERPT) }))
  return { items: mine, pendingApprovals }
}
