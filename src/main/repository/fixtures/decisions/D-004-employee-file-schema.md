# D-004: 직원 파일 frontmatter 스키마와 기본 회사 폴더 구조 확정

- **관련 티켓:** T-003
- **작성일:** 2026-11-12
- **상태:** pending

## 질문
앱이 만드는 직원 파일(`.claude/agents/<name>.md`)의 frontmatter를 Claude Code 서브에이전트 형식(`name`, `description`, `tools`, `model`)으로 고정해도 됩니까? 부서·보고 라인은 `org.md`에만 둡니다.

## 선택지
1. **A. 서브에이전트 형식 그대로 (임시안)** — Claude가 바로 읽는다. 앱 전용 필드는 두지 않는다.
2. **B. 앱 전용 필드 추가** — `department`, `avatar` 등을 frontmatter에 넣는다. 사무실 UI에 편하지만 Claude Code 형식과 달라지고 `org.md`와 이중 관리가 된다.
3. **C. 앱 전용 필드를 별도 파일로** — 예: `company/avatars.md`. 직원 파일은 순수 유지.

## 추천안과 이유
- 추천: A (필요해지면 C)
- 이유: `docs/architecture.md`의 결정(원본은 서브에이전트 형식, 부서는 `org.md`)과 일치하고 Claude 직접 호환.

## 영향
- A 선택 시: 현재 구현 그대로. 기본 직원은 cto, cfo, pm, developer 4명, 폴더 구조는 `docs/architecture.md` 반영분.
- B/C 선택 시: 템플릿(`src/main/company/templates.ts`)과 후속 캐시 파서 수정.
- 결정이 늦어지면: A 임시안으로 진행 (T-003 구현 완료됨).

## 결정 (사람이 작성)
- 선택:
- 메모:

## 영향 갱신 (2026-11-12)
- CEO 확정: 제품의 기본 직원은 cto, cfo, hr 3명이다. pm과 developer는 hr을 통해 추가한다. 이 카드의 "기본 직원 4명" 가정은 3명(T-051)으로 바뀐다. 직원 파일 스키마 임시안 A 자체는 영향 없음.
