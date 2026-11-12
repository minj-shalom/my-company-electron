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

interface AgentSeed {
  file: string
  name: string
  description: string
  tools: string
  model: string
  role: string
  duties: string[]
}

const AGENTS: AgentSeed[] = [
  {
    file: 'cto',
    name: 'cto',
    description: '기술 계획, 설계, 기술 검토 담당.',
    tools: 'Read, Grep, Glob',
    model: 'opus',
    role: 'CTO',
    duties: ['기술 계획과 설계를 작성한다.', '결과(티켓 초안, 설계 문서)를 COO에게 반환한다.']
  },
  {
    file: 'cfo',
    name: 'cfo',
    description: '사용량과 예산 점검 담당.',
    tools: 'Read, Write, Edit, Grep, Glob',
    model: 'sonnet',
    role: 'CFO',
    duties: ['`company/finance/`의 사용량을 집계하고 한도 근접 시 COO에게 알린다.']
  },
  {
    file: 'pm',
    name: 'pm',
    description: '목표를 티켓으로 분해하고 우선순위를 정하는 담당.',
    tools: 'Read, Write, Edit, Grep, Glob',
    model: 'sonnet',
    role: 'PM',
    duties: ['`company/tickets/backlog/`에 티켓을 작성하고 번호 순으로 우선순위를 관리한다.']
  },
  {
    file: 'developer',
    name: 'developer',
    description: '범용 구현 담당.',
    tools: 'Read, Write, Edit, Grep, Glob, Bash',
    model: 'sonnet',
    role: '개발자',
    duties: ['티켓의 완료 조건에 맞게 구현하고 결과를 보고한다.']
  }
]

function agentMarkdown(a: AgentSeed): string {
  return `---
name: ${a.name}
description: ${a.description}
tools: ${a.tools}
model: ${a.model}
---

# ${a.role}

## 담당 범위
${a.duties.map((d) => `- ${d}`).join('\n')}

## 하지 말아야 할 것
- 담당 범위 밖의 수정, 다른 직원 호출 (실행 배정은 COO만 한다).
`
}

function orgMarkdown(name: string): string {
  return `# 조직도

> 이 파일이 조직의 원본이다. CEO(사용자)는 COO하고만 대화한다.

## 조직도
\`\`\`
CEO (사용자)
 └─ COO (메인 세션)
     ├─ CTO ── 개발팀 (developer)
     ├─ CFO
     └─ 기획팀 (pm)
\`\`\`

## 직원 목록
| 직급 | 직원 파일 | 부서 | 보고 대상 | 역할 |
|---|---|---|---|---|
| CEO | (사용자) | 경영 | - | 비전·미션 설정, 최종 결정 |
| COO | \`CLAUDE.md\` | 경영 | CEO | 업무 하달, 진행 관리, CEO 보고 |
| CTO | \`cto\` | R&D | COO | 기술 계획, 설계, 기술 검토 |
| CFO | \`cfo\` | 재무 | COO | 사용량·예산 관리 |
| PM | \`pm\` | 기획팀 | COO | 목표를 티켓으로 분해 |
| 개발자 | \`developer\` | 개발팀 | CTO | 범용 구현 |

회사 이름: ${name}
`
}

function claudeMarkdown(name: string): string {
  return `# ${name}

AI 직원들이 일하는 회사 폴더다. 이 세션의 메인 에이전트는 **COO**다.

@company/org.md

- COO는 직접 구현하지 않고 목표 → 티켓 → 담당 배정 → 결과 취합 → CEO 보고를 맡는다.
- 직원 정의는 \`.claude/agents/\`, 티켓은 \`company/tickets/\`, 결정 카드는 \`company/decisions/\`, 보고서는 \`company/reports/\`에 둔다.
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
  for (const a of AGENTS) files[`.claude/agents/${a.file}.md`] = agentMarkdown(a)
  for (const dir of KEEP_DIRS) files[`${dir}/.gitkeep`] = ''
  return files
}
