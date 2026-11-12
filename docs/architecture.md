# My Company: 제품 아키텍처 (초안)

> `TODO`는 아직 결정이나 조사가 필요한 부분이다. 초기 결정은 개발 회사(`my-company-cli`)의 `company/decisions/done/D-001-initial-decisions.md`에 있다.

## 스택
- Electron, TypeScript, electron-vite
- renderer: React + Vite, 가상 사무실은 PixiJS
- main: Node/TS, better-sqlite3 (지금은 Electron이 DB를 쥔다. 나중에 서버로 전환 예정)

## 프로세스 구조
```
renderer (React, PixiJS)  --window.api-->  preload (contextBridge)  --IPC-->  main (Node/TS)
                                                                              ├─ 제공자 어댑터 (Claude / ChatGPT / Gemini CLI)
                                                                              ├─ 오토파일럿 스케줄러, COO 틱 실행기
                                                                              ├─ 폴더 감시
                                                                              └─ 데이터 접근 계층 (Repository) → SQLite 캐시
```
- `contextIsolation: true`, `nodeIntegration: false`. 보안 규칙 상세는 개발 회사(`my-company-cli`)의 `.claude/rules/ipc-security.md`.
- renderer는 파일/프로세스에 직접 접근하지 않는다.

## AI 제공자 어댑터 (Claude, ChatGPT, Gemini)
- 앱은 각 제공자의 **공식 CLI**를 실행한다. 인증은 CLI가 처리하고 앱은 토큰·로그인 정보를 읽거나 저장하지 않는다.
- 공통 어댑터 인터페이스: 설치/버전 확인, 실행(스트림 이벤트), 취소, 사용량 추출, 직원 정의 변환.
- 모든 제공자의 출력은 공통 이벤트(시작, 메시지, 도구 사용, 결과, 에러, 종료)로 변환해 IPC로 renderer에 보낸다.
- 첫 어댑터는 Claude(`claude -p ... --output-format stream-json`, `spawn` + 인자 배열). ChatGPT(Codex CLI)와 Gemini(Gemini CLI)는 이후 어댑터로 추가한다.
- TODO: ChatGPT/Gemini CLI의 비대화형 실행 옵션과 출력 형식 (설치된 버전에서 확인)
- TODO: 직원(서브에이전트) 개념이 없는 제공자에서 부서/위임 구조를 어떻게 흉내 낼지

## 직원 정의 전달
- 직원 파일의 원본은 회사 폴더의 `.claude/agents/*.md`(서브에이전트 형식)다. Claude는 회사 폴더를 작업 디렉터리로 실행하면 그대로 읽는다.
- 다른 제공자는 어댑터가 실행 직전에 직원 정의를 해당 CLI의 지침 파일(예: 저장소 지침 파일)로 변환한다.

## 오토파일럿: COO 실행 방식
CEO가 몇 시간에 한 번 방문해 결정만 내리면 회사가 자동으로 돌아간다.
- **틱(tick):** 스케줄러가 일정 간격으로 COO를 비대화형으로 실행한다. 작업 디렉터리는 회사 폴더이고, 회사 폴더의 `CLAUDE.md`와 `.claude/loop.md` 절차를 수행한다. 상태는 파일(티켓, 결정, 보고서)이 원본이라 대화 이어가기에 의존하지 않는다.
- **브리핑:** 틱이 끝나면 한 일/결과/막힌 점/결정 요청을 `company/reports/`에 남긴다. CEO는 방문 때 이것과 결재함만 보면 된다.
- **결정 → 자동 재개:** CEO가 결재함에서 결정하면 카드가 `decisions/done/`으로 이동하고 다음 틱이 즉시 예약된다.
- **권한 거부 → 결정 카드:** 비대화형 실행에서 허용되지 않은 동작은 실행 결과의 거부 정보를 결정 카드로 바꾼다. 승인하면 회사 폴더의 로컬 설정에 허용 규칙을 추가하고 재실행한다. 사용자 승인 없이 규칙을 추가하지 않는다.
- **CEO 대화:** 채팅은 별도 COO 세션으로 이어 가고(세션 재개), 자동 틱과는 큐/잠금으로 충돌을 막는다.
- **한도 점검:** 틱 시작 전에 CFO 점검 결과를 보고, 주간 한도 초과 위험이면 실행하지 않고 결정 카드를 남긴다.
- **스케줄:** 간격 + 활동 시간 + `지금 실행`. 설정은 회사 폴더의 `company/schedule.md`. 한 번에 한 틱만 실행(잠금). 밀린 실행은 앱 시작 시 한 번만 수행한다. cron 표현식은 MVP에서 지원하지 않는다.
- 앱이 꺼져 있으면 돌지 않는다. 트레이(백그라운드)에서 동작하도록 한다. TODO: 슬립/종료 중 동작 방식, 서버 전환 후의 실행 위치

## CLI 설치·연결 (온보딩)
- 시작 시 각 제공자 CLI의 설치 여부와 버전을 확인한다 (시간 제한 포함. Windows의 `.cmd` 실행 파일 포함).
- 미설치면 OS별 설치 방법과 복사 가능한 명령을 안내한다. 로그인은 사용자가 터미널에서 직접 한다.
- 로그인 여부는 사용자가 누르는 `연결 테스트`로만 확인한다 (자동으로 사용량을 쓰지 않는다).
- 이 단계에서 제공자별 **주간 한도**를 입력받아 예산 기준으로 쓴다.

## 데이터 모델과 데이터 계층
- **원본:** 회사 폴더의 마크다운 파일 (직원, 티켓, 결정 카드, 보고서, `org.md`, `schedule.md`).
- **캐시:** SQLite. 목록/검색/집계를 빠르게 하기 위한 것이며 폴더에서 언제든 재생성할 수 있어야 한다.
- 쓰기는 마크다운 파일에 먼저 한 뒤 캐시를 갱신한다. 폴더 감시가 외부 변경을 반영한다.
- **직원 파일 형식:** Claude Code 서브에이전트 형식(`name`, `description`, `tools`, `model`, 본문). 부서와 보고 라인은 `org.md`에만 둔다.
- **회사 폴더 구조:** 개발 회사의 `company/` 구조와 같다 (`tickets/{backlog,in-progress,done}`, `decisions/{pending,done}`, `reports/`, `templates/`, `finance/`, `org.md`).
  - 생성 결과 (`company:create`, `src/main/company/`): 루트에 `CLAUDE.md`, `.claude/agents/*.md`(기본 직원 cto, cfo, pm, developer), `company/{org.md, mission.md, schedule.md}`, `company/tickets/{backlog,in-progress,done}`, `company/decisions/{pending,done}`, `company/reports/`, `company/templates/`, `company/finance/{budget.md,usage/}`.
  - 회사 폴더 표식: `CLAUDE.md`와 `company/org.md`가 모두 있으면 회사 폴더로 인식한다 (폴더 감시/캐시용).
  - 이름 규칙: 1~50자, 앞뒤 공백/`.` 시작·끝 금지, `<>:"/\|?*`와 제어 문자 금지, Windows 예약 이름 금지. 이름이 그대로 폴더 이름이다.
- **서버 전환 대비:** 저장소 접근은 모두 Repository 인터페이스 뒤에 둔다. 지금은 파일 + SQLite 구현을 쓰고, 나중에 서버 구현으로 교체한다. 전환 설계는 별도 문서로 정리한다.
- TODO: SQLite 스키마와 재생성(rebuild) 절차 상세

## 조직 모델
- 조직(부서, 보고 라인)의 원본은 회사 폴더의 `org.md`(마크다운)다. 앱은 이를 읽어 조직도와 가상 사무실의 부서 공간을 만든다.
- 기본 조직: CEO(사용자) → COO(메인 세션) → CTO(개발팀), CFO, 기획팀. 부서는 확장 가능하다.
- 실행은 COO만 배정한다. 임원급 직원은 계획·검토를 반환하고 COO가 개발팀에 배정한다 (Claude Code 서브에이전트는 다른 서브에이전트를 호출할 수 없음).

## 가상 사무실 UI (게더타운 스타일)
- renderer에 PixiJS 기반 2D 사무실 맵을 둔다. 부서별 공간에 직원 아바타를 배치한다.
- 처음에는 `org.md`의 부서 기준 자동 배치(고정 레이아웃)로 만들고, 이후 사용자 편집 기능을 추가한다.
- 아바타 상태는 실행 이벤트와 티켓 상태에서 만든다: 대기, 작업 중, 승인 대기.
- 직원/COO를 클릭하면 로그 뷰나 대화 창이 열린다. 결정 인박스는 CEO 결재함으로 표시한다.
- 브라우저 모드(`--host`)에서도 mock 데이터로 사무실이 보여야 한다.
- 에셋은 퍼미시브 라이선스(CC0 등)만 쓰고 출처를 문서화한다.

## CFO와 사용량
- 사용량은 제공자 어댑터가 실행 결과 이벤트에서 추출해 `company/finance/usage/`에 기록한다 (인증·토큰 값은 기록하지 않는다).
- 예산 기준은 사용자가 온보딩에서 입력한 **제공자별 주간 한도**다. 기본 경고 기준은 80%다.
- 제공자마다 한도 체계(구독 한도, API 금액)가 달라서 기준을 따로 둔다. 사용량 정보가 없는 제공자는 '알 수 없음'으로 표시한다.
- TODO: 기록 파일 스키마 (필드, 형식, 보관 기간)
- TODO: 구독 한도의 현재 사용률을 앱에서 가져올 방법 (공식 API가 없으면 사용자 입력/추정)

## IPC / window.api
- `src/shared/`에 `window.api` 인터페이스 타입을 정의한다 (main/preload/renderer 공용).
- 개발 중 브라우저(`npm run dev -- --host`)에서는 mock 구현을 주입해 UI만 확인할 수 있게 한다.
- 채널명 규칙: `도메인:동작` (예: `ticket:list`, `run:start`, `run:event`).
- 모든 입력은 main에서 검증한다.

## 폴더 구성
```
my-company-electron/
  src/main/      # main 프로세스
  src/preload/   # contextBridge
  src/renderer/  # React UI, PixiJS
  src/shared/    # 공용 타입 (window.api 등)
  assets/        # 아이콘 등 (icon.svg)
  docs/          # 제품 문서
```
- `src/main/company/`: 회사 폴더 생성 (`scaffold.ts` 검증·생성, `templates.ts` 기본 마크다운). IPC는 `src/main/company-ipc.ts`.
- TODO: 나머지 모듈(스케줄러, 폴더 감시, Repository)이 추가되면 구조를 갱신

## 패키징과 배포
- electron-builder, better-sqlite3 네이티브 rebuild (macOS, Windows 각각).
- 첫 릴리스는 서명 없이 만들고 SmartScreen/Gatekeeper 경고 우회 방법을 안내한다. 이후 macOS 서명·공증, Windows 코드 서명을 도입한다.
- 자동 업데이트는 electron-updater + GitHub Releases.
- 경로 처리, 줄바꿈, CLI 실행 파일 탐색(`claude` vs `claude.cmd`)은 두 OS 모두에서 동작해야 한다.
- **배포 (확정):** 제품 소개 랜딩 페이지(별도 레포 `my-company-landing`)에서 사용자가 macOS 또는 Windows 설치 파일을 내려받는다. 파일 호스팅은 GitHub Releases를 재사용한다. 설치 파일 이름에서 버전을 빼 `releases/latest/download/<파일명>` 고정 링크로 최신 파일을 가리킨다.
- TODO: 패키지 매니저(Homebrew, winget) 병행 시점, 커스텀 도메인
- TODO: Windows 코드 서명 방식 (인증서 종류와 조달)
