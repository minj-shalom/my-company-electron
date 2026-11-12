import type { WindowApi } from '../../shared/api'
import type { Decision, DecisionKind, UnreadableDecision } from '../../shared/decision'

/** 브라우저 개발 모드 전용. `?mock-decisions=empty|many|error|conflict`로 상태를 고른다 (없으면 샘플 7종). */
export type DecisionScenario = 'samples' | 'empty' | 'many' | 'error' | 'conflict'
const SCENARIOS: readonly DecisionScenario[] = ['samples', 'empty', 'many', 'error', 'conflict']

export function parseDecisionScenario(search: string): DecisionScenario {
  const v = new URLSearchParams(search).get('mock-decisions')
  return SCENARIOS.find((s) => s === v) ?? 'samples'
}

const yesNo = (yes: string, no: string): Decision['options'] => [
  { key: 'A', label: '승인', description: yes },
  { key: 'B', label: '거절', description: no }
]

function card(
  n: number,
  kind: DecisionKind,
  title: string,
  question: string,
  extra: Partial<Decision> = {}
): Decision {
  return {
    id: `D-${String(n).padStart(3, '0')}`,
    title,
    status: 'pending',
    ticketId: null,
    question,
    options: yesNo('요청대로 진행합니다.', '진행하지 않고 보류합니다.'),
    recommended: 'A',
    chosen: null,
    memo: '',
    kind,
    proposedBy: null,
    ...extra
  }
}

const SAMPLES: Decision[] = [
  card(
    1,
    'decision',
    'T-002 푸시 승인',
    'feature/T-002를 푸시하고 PR을 올릴까요?\n\n영향: 원격 저장소에 브랜치가 생깁니다.',
    { ticketId: 'T-002' }
  ),
  card(
    2,
    'permission',
    '직원이 npm 설치 권한을 요청',
    'developer가 `npm install`을 실행하려다 거부되었습니다.\n허용하면 이 티켓 동안만 적용됩니다.',
    { ticketId: 'T-017' }
  ),
  card(
    3,
    'proposal',
    '디자이너 직원 채용 제안',
    '랜딩 페이지 작업이 늘어 디자이너 직원이 필요합니다.\n영향: org.md와 직원 파일이 추가됩니다.',
    { proposedBy: 'hr', ticketId: 'T-046' }
  ),
  card(
    4,
    'content-approval',
    '블로그 초안 발행 승인',
    '"AI 직원 회사 시작하기" 초안을 발행할까요?\n<b>이 태그는 글자 그대로 보입니다</b>',
    { ticketId: 'T-050' }
  ),
  card(
    5,
    'integrity-warning',
    '직원 파일 검증 실패',
    'hr가 편집한 reviewer-qa.md가 형식 검증에 실패했습니다. 직전 스냅샷으로 복원할까요?',
    {
      options: [
        { key: 'A', label: '복원', description: '스냅샷으로 되돌립니다.' },
        { key: 'B', label: '유지', description: '현재 파일을 그대로 둡니다.' }
      ],
      recommended: 'A',
      ticketId: 'T-052'
    }
  ),
  card(
    6,
    'revert-suggestion',
    '미승인 정책 변경 감지',
    '승인 없이 수정된 company/policy.md가 있습니다. 되돌리거나 사후 승인할 수 있습니다.',
    {
      options: [
        { key: 'A', label: '되돌리기', description: '변경을 취소합니다.' },
        { key: 'B', label: '사후 승인', description: '변경을 인정합니다.' },
        { key: 'C', label: '직원 격리', description: '해당 직원을 격리합니다.' }
      ],
      recommended: 'A',
      ticketId: 'T-052'
    }
  ),
  card(
    7,
    'git-confirm',
    'T-014 PR 머지 컨펌',
    'feature/T-014를 develop에 머지할까요?\n검수: 통과',
    { ticketId: 'T-014' }
  ),
  card(8, 'decision', '유형 줄이 없는 옛 카드', '기본 제공자는 무엇으로 할까요?', {
    kind: undefined
  }),
  {
    ...card(0, 'decision', '초기 결정', '기본 제공자는?', {
      options: [{ key: 'A', label: 'Claude', description: 'Claude Code CLI' }],
      ticketId: null
    }),
    status: 'done',
    chosen: 'A',
    memo: '처음엔 Claude로 시작'
  },
  {
    ...card(9, 'permission', '쓰기 권한 요청', '문서 폴더 쓰기를 허용할까요?'),
    status: 'done',
    chosen: 'B',
    memo: '이번엔 보류\n다음 주에 다시 보기'
  }
]

const UNREADABLE: UnreadableDecision[] = [
  { path: 'decisions/pending/D-020-broken.md', reason: 'unreadable' },
  { path: 'decisions/pending/D-003-copy.md', reason: 'duplicate' },
  { path: 'decisions/pending/D-021-huge.md', reason: 'too-large' },
  { path: 'decisions/done/D-004-old.md', reason: 'duplicate' }
]

function seed(scenario: DecisionScenario): { items: Decision[]; unreadable: UnreadableDecision[] } {
  if (scenario === 'empty') return { items: [], unreadable: [] }
  const items = structuredClone(SAMPLES)
  if (scenario === 'many') {
    const kinds: DecisionKind[] = [
      'decision',
      'permission',
      'proposal',
      'content-approval',
      'git-confirm'
    ]
    for (let i = 0; i < 16; i += 1) {
      items.push(
        card(30 + i, kinds[i % kinds.length], `대기 중인 결재 ${i + 1}`, `샘플 질문 ${i + 1}`, {
          proposedBy: kinds[i % kinds.length] === 'proposal' ? 'coo' : null
        })
      )
    }
  }
  return { items, unreadable: structuredClone(UNREADABLE) }
}

type DecisionApi = Pick<WindowApi, 'listDecisions' | 'resolveDecision'>

export function createMockDecisionApi(
  scenario: DecisionScenario,
  delayMs = 0
): { api: DecisionApi; reset: () => void } {
  let state = seed(scenario)
  const wait = (): Promise<void> => new Promise((r) => setTimeout(r, delayMs))
  const api: DecisionApi = {
    listDecisions: async (status) => {
      if (scenario === 'error')
        return { ok: false, code: 'internal', message: 'mock: /secret/path failed' }
      return {
        ok: true,
        value: {
          items: structuredClone(state.items.filter((d) => !status || d.status === status)),
          unreadable: structuredClone(state.unreadable)
        }
      }
    },
    resolveDecision: async (req) => {
      await wait()
      const d = state.items.find((x) => x.id === req.id)
      if (!d) return { ok: false, code: 'not-found', message: 'mock' }
      if (d.status === 'done' || scenario === 'conflict') {
        // conflict 시나리오: 다른 곳에서 이미 처리된 것처럼 카드를 done으로 옮기고 충돌을 돌려준다.
        d.status = 'done'
        d.chosen ??= d.options[0]?.key ?? null
        return { ok: false, code: 'conflict', message: 'mock' }
      }
      if (!d.options.some((o) => o.key === req.choice))
        return { ok: false, code: 'invalid-request', message: 'mock' }
      d.status = 'done'
      d.chosen = req.choice
      d.memo = req.memo ?? ''
      return { ok: true, value: structuredClone(d) }
    }
  }
  return { api, reset: () => (state = seed(scenario)) }
}
