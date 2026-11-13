import type { DecisionKind } from '../../shared/decision'
import { leadingId } from '../repository/ids'
import { DECISION_DIRS } from '../repository/parse-decision'
import { FsGuardError, type SafeFs } from '../repository/safe-fs'

export interface GateCardRequest {
  kind: Extract<
    DecisionKind,
    | 'git-confirm'
    | 'content-approval'
    | 'decision'
    | 'integrity-warning'
    | 'revert-suggestion'
    | 'proposal'
    | 'permission'
  >
  title: string
  ticketId: string | null
  question: string
  /** 선택지 두 개(승인/거부) 또는 한 개(확인). */
  options: { key: string; label: string; description: string }[]
  impact: string
  /** 추천 이유 문장. 없으면 자동 모드 게이트의 기본 문장을 쓴다. */
  reason?: string
  /** `proposal` 카드(T-046): 제안자와 본문 `proposal` 블록(앱이 파서로 검증한 텍스트). */
  proposedBy?: 'hr' | 'coo'
  block?: string
}

export interface GateCards {
  /** 새 pending 카드를 만들고 번호(D-NNN)를 돌려준다. */
  create(req: GateCardRequest): Promise<string>
}

const MAX_ATTEMPTS = 8

const LINE_BREAKS = /[\r\n\u2028\u2029]+/g
const oneLine = (v: string, max: number): string => v.replace(LINE_BREAKS, ' ').trim().slice(0, max)

/** 카드는 템플릿 형식의 마크다운이다. 제목·본문에는 브랜치명, PR 번호, 초안 경로와 해시 같은 값만 넣는다 (자격 증명·URL 쿼리 없음). */
export function renderCard(id: string, date: string, r: GateCardRequest): string {
  const options = r.options
    .map(
      (o, i) => `${i + 1}. **${o.key}. ${oneLine(o.label, 60)}** — ${oneLine(o.description, 200)}`
    )
    .join('\n')
  return `# ${id}: ${oneLine(r.title, 100)}

- **관련 티켓:** ${r.ticketId ?? '없음'}
- **작성일:** ${date}
- **상태:** pending
- **유형:** ${r.kind}${r.proposedBy ? `\n- **제안자:** ${r.proposedBy}` : ''}

## 질문
${oneLine(r.question, r.block !== undefined ? 1500 : 500)}${r.block !== undefined ? `\n\n\`\`\`proposal\n${r.block}\n\`\`\`` : ''}

## 선택지
${options}

## 추천안과 이유
- 추천: ${r.options[0]?.key ?? 'A'}
- 이유: ${oneLine(r.reason ?? '자동 모드 게이트가 컨펌 없이 실행하지 않고 사람의 확인을 요청했습니다.', 200)}

## 영향
- ${oneLine(r.impact, 300)}

## 결정 (사람이 작성)
- 선택:
- 메모:
`
}

export interface FileGateCardsDeps {
  fs: SafeFs
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
  now?: () => Date
}

/** 결정 카드를 파일로 만든다. 번호는 pending·done의 최댓값+1이고, 겹치면(CLI 동시 생성) 새 번호로 다시 시도한다. */
export function createFileGateCards(deps: FileGateCardsDeps): GateCards {
  return {
    create: (req) =>
      deps.exclusive(async () => {
        const date = (deps.now?.() ?? new Date()).toISOString().slice(0, 10)
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
          let max = 0
          for (const dir of Object.values(DECISION_DIRS)) {
            const { files } = await deps.fs.listMarkdown(dir)
            for (const f of files) {
              const id = leadingId(f, 'D')
              if (id !== null) max = Math.max(max, Number(id.slice(2)))
            }
          }
          const id = `D-${String(max + 1).padStart(3, '0')}`
          try {
            await deps.fs.writeText(
              `${DECISION_DIRS.pending}/${id}-gate-${req.kind}.md`,
              renderCard(id, date, req),
              false
            )
            return id
          } catch (e) {
            if (!(e instanceof FsGuardError && e.kind === 'exists')) throw e
          }
        }
        throw new Error('card-id-conflict')
      })
  }
}
