# 조직도

> 이 파일이 조직의 원본이다. CEO(사용자)는 COO(메인 세션, `CLAUDE.md`)하고만 대화한다.
> 보고 라인은 책임과 보고 경로를 뜻한다. 실제 업무 배정은 COO만 한다 (서브에이전트는 다른 서브에이전트를 호출할 수 없다).

## 조직도

```
CEO (사용자)
 └─ COO (메인 세션)
     ├─ CTO ── 개발팀 (developer, electron-main-dev, ui-dev, web-frontend-dev, devops, reviewer-qa)
     ├─ CFO
     ├─ 인사팀 (hr)
     └─ 기획팀 (pm)
```

## 직원 목록

| 직급          | 직원 파일               | 부서   | 보고 대상 | 역할                                                 |
| ------------- | ----------------------- | ------ | --------- | ---------------------------------------------------- |
| CEO           | (사용자)                | 경영   | -         | 비전·미션 설정, 최종 결정                            |
| COO           | `CLAUDE.md` (메인 세션) | 경영   | CEO       | 부서에 업무 하달, 진행 관리, CEO 보고                |
| CTO           | `cto`                   | R&D    | COO       | 기술 계획, 설계, 기술 검토                           |
| CFO           | `cfo`                   | 재무   | COO       | Claude Code 사용량·예산 관리                         |
| 인사          | `hr`                    | 인사팀 | COO       | 직원 채용, 직원 파일·조직도 정리, 인사 변경 제안     |
| PM            | `pm`                    | 기획팀 | COO       | 목표를 티켓으로 분해, 우선순위                       |
| 개발자        | `developer`             | 개발팀 | CTO       | 범용 구현                                            |
| Main 개발자   | `electron-main-dev`     | 개발팀 | CTO       | main 프로세스, CLI 러너, 스케줄러, SQLite, IPC       |
| UI 개발자     | `ui-dev`                | 개발팀 | CTO       | React UI, 가상 사무실, 티켓 보드, 결정 인박스        |
| DevOps        | `devops`                | 개발팀 | CTO       | 패키징, 네이티브 rebuild, 서명/공증 (macOS, Windows) |
| 웹 프론트엔드 | `web-frontend-dev`      | 개발팀 | CTO       | 랜딩 페이지(`my-company-landing`) 구현               |
| QA            | `reviewer-qa`           | 개발팀 | CTO       | 읽기 전용 검수                                       |

## 부서 추가/직원 추가 방법

1. `.claude/agents/<직원>.md`를 만든다 (서브에이전트 형식: name, description, tools, model).
2. 위 표에 직급, 부서, 보고 대상, 역할을 한 줄 추가한다.
3. 새 부서면 조직도 블록도 갱신한다 (예: 콘텐츠팀).
4. 프리셋(`presets/`)을 적용하면 해당 스택의 전문 직원이 들어온다. 그 직원도 표에 추가한다.

## 원칙

- 한 직원은 한 부서에 속하고 보고 대상은 한 명이다.
- 직원 파일은 서브에이전트 형식을 유지한다. 부서와 보고 라인은 이 파일에만 둔다.
