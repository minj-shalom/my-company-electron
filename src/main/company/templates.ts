import { buildAgentFile } from '../employee/agent-file'
import { findTemplate } from '../employee/templates'

/** 새 회사 폴더에 쓰는 기본 마크다운. 폴더 구조는 docs/architecture.md의 "회사 폴더 구조"와 같다. */

/** 폴더 감시/캐시가 회사 폴더로 인식하는 표식 파일 (상대 경로). */
export const COMPANY_MARKER_FILES = ['CLAUDE.md', 'company/org.md'] as const

export const COMPANY_DIRS = [
  '.claude/agents',
  'company/tickets/backlog',
  'company/tickets/in-progress',
  'company/tickets/done',
  'company/decisions/pending',
  'company/decisions/done',
  'company/reports',
  'company/templates',
  'company/finance/usage'
] as const

/** 빈 디렉터리가 git/감시에서 사라지지 않게 두는 파일을 넣을 디렉터리. */
export const KEEP_DIRS = COMPANY_DIRS.filter(
  (d) => !d.startsWith('.claude') && d !== 'company/templates'
)

/** 기본 직원 id. 직원 파일은 직원 템플릿 라이브러리(T-035)에서 그대로 만든다. */
const BASE_AGENT_IDS = ['cto', 'cfo', 'hr'] as const

/**
 * 새 회사와 "복구 채용"이 같은 파일을 만들도록 본문·tools·model을 라이브러리에서 한 번만 정의한다.
 * cto/cfo tools는 두 정의 중 더 적은 권한(Read, Grep, Glob)으로 통일했다. 최소 권한 원칙이고 둘 다 읽기만으로 충분하다.
 * model은 라이브러리 값(sonnet)을 따른다.
 */
function agentMarkdown(id: string): string {
  const t = findTemplate(id)
  if (!t) throw new Error(`template missing: ${id}`)
  return buildAgentFile(
    { name: t.id, description: t.description, tools: t.tools.join(', '), model: t.model },
    `${t.body.trim()}\n`
  )
}

function orgMarkdown(name: string): string {
  return `# 조직도

> 이 파일이 조직의 원본이다. CEO(사용자)는 COO하고만 대화한다.

## 조직도
\`\`\`
CEO (사용자)
 └─ COO (메인 세션)
     ├─ CTO ── R&D
     ├─ CFO
     └─ 인사팀 (hr)
\`\`\`

## 직원 목록
| 직급 | 직원 파일 | 부서 | 보고 대상 | 역할 |
|---|---|---|---|---|
| CEO | (사용자) | 경영 | - | 비전·미션 설정, 최종 결정 |
| COO | \`CLAUDE.md\` | 경영 | CEO | 업무 하달, 진행 관리, CEO 보고 |
| CTO | \`cto\` | R&D | COO | 기술 계획, 설계, 기술 검토 |
| CFO | \`cfo\` | 재무 | COO | 사용량·예산 관리 |
| 인사 | \`hr\` | 인사팀 | COO | 직원 채용, 직원 파일·조직도 정리 |

회사 이름: ${name}
`
}

function claudeMarkdown(name: string): string {
  return `# ${name}

AI 직원들이 일하는 회사 폴더다. 이 세션의 메인 에이전트는 **COO**다.

@company/org.md

- COO는 직접 구현하지 않고 목표 → 티켓 → 담당 배정 → 결과 취합 → CEO 보고를 맡는다.
- 직원 정의는 \`.claude/agents/\`, 티켓은 \`company/tickets/\`, 결정 카드는 \`company/decisions/\`, 보고서는 \`company/reports/\`에 둔다.
- 기본 직원은 CTO, CFO, 인사(hr)다. PM과 개발자는 인사팀(hr)을 통해 채용한다. 기획팀과 개발팀은 그 직원이 들어오면 생긴다.
- pm이 없으면 COO가 직접 \`company/templates/ticket.md\` 형식으로 티켓을 만든다 (목표, 측정 가능한 완료 조건 필수, 담당은 비워 두거나 존재하는 직원). pm이 채용되면 티켓 분해는 pm에게 위임한다.
- 구현을 맡을 직원이 없으면 티켓을 \`company/tickets/backlog/\`에 두고 "채용 필요"를 CEO에게 보고하며 hr에 채용을 요청한다.
- 인사(채용, 직원 파일 수정, 부서 개편, 배정, 퇴사)는 hr에 위임한다. COO·CTO·CFO·hr 자신의 변경, 직원 삭제, 도구 권한 확대 같은 민감한 변경은 CEO 승인 카드(\`company/decisions/pending/\`)를 거쳐야 한다.
- **승인 전 민감 변경 금지.** 민감한 변경은 승인 전에 적용하지 않는다. 승인 카드는 \`유형: proposal\`, \`제안자: coo\`, 선택지 A 승인 / B 거절로 쓰고, 질문 섹션에 \`- 키: 값\` 줄로 된 코드 펜스(\`\`\`proposal)를 둔다. 액션은 assign, unassign, hire, update, move, retire, policy-change 중 하나이고 블록당 최대 10개다. 승인 뒤 적용은 앱이 한다 (CEO 승인 클릭이 유일한 적용 경로이며 hr은 카드를 쓰지 못한다).
- 사람의 판단이 필요하면 멈추지 않고 \`company/decisions/pending/\`에 결정 카드를 남기고 다른 일로 넘어간다.
`
}

const TICKET_TEMPLATE = `# T-000: 티켓 제목

- **상태:** backlog | in-progress | done
- **담당:** 직원 이름
- **부서:** 부서 이름

## 목표
한두 문장.

## 완료 조건
- [ ] 조건

## 메모
`

const DECISION_TEMPLATE = `# D-000: 결정 제목

- **관련 티켓:** T-000
- **작성일:** YYYY-MM-DD
- **상태:** pending | done

## 질문

## 선택지
1. **A. 이름** — 설명
2. **B. 이름** — 설명

## 추천안과 이유

## 결정 (사람이 작성)
- 선택:
- 메모:
`

const REPORT_TEMPLATE = `# 보고서 제목

## 한 일

## 결과

## 막힌 점

## CEO 결정 요청
`

const MISSION_TEMPLATE = (name: string): string => `# ${name}: 미션

> CEO가 비전과 미션을 적는다. COO가 이를 바탕으로 목표와 티켓을 만든다.

## 비전

## 미션
`

const SCHEDULE_TEMPLATE = `# 스케줄

- interval_minutes: 180
- active_hours: 09:00-22:00
- enabled: false
`

const BUDGET_TEMPLATE = `# 예산

> 제공자별 주간 한도와 경고 기준. 인증·토큰 값은 적지 않는다.

- warn_ratio: 0.8
`

/** 상대 경로(항상 '/') → 파일 내용. */
export function buildCompanyFiles(name: string): Record<string, string> {
  const files: Record<string, string> = {
    'CLAUDE.md': claudeMarkdown(name),
    'company/org.md': orgMarkdown(name),
    'company/mission.md': MISSION_TEMPLATE(name),
    'company/schedule.md': SCHEDULE_TEMPLATE,
    'company/finance/budget.md': BUDGET_TEMPLATE,
    'company/templates/ticket.md': TICKET_TEMPLATE,
    'company/templates/decision-card.md': DECISION_TEMPLATE,
    'company/templates/report.md': REPORT_TEMPLATE
  }
  for (const id of BASE_AGENT_IDS) files[`.claude/agents/${id}.md`] = agentMarkdown(id)
  for (const dir of KEEP_DIRS) files[`${dir}/.gitkeep`] = ''
  return files
}
