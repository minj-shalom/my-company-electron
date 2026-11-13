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

- 앱은 각 제공자의 **공식 CLI**를 실행한다. 제공자 로그인은 CLI가 처리하고 앱은 제공자 토큰·로그인 정보를 읽거나 저장하지 않는다. 외부 발행용 자격 증명은 별도 보관소(아래 "외부 발행 자격 증명 보관소")가 다룬다.
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
- 미설치면 OS별 설치 방법과 복사 가능한 명령을 안내한다. 제공자 CLI 로그인은 사용자가 터미널에서 직접 하며 앱은 그 토큰·로그인 정보를 다루지 않는다.
- 제공자 CLI의 로그인 여부는 사용자가 누르는 `연결 테스트`로만 확인한다 (자동으로 사용량을 쓰지 않는다).
- 이 단계에서 제공자별 **주간 한도**를 입력받아 예산 기준으로 쓴다.

## 데이터 모델과 데이터 계층

- **원본:** 회사 폴더의 마크다운 파일 (직원, 티켓, 결정 카드, 보고서, `org.md`, `schedule.md`).
- **캐시:** SQLite. 목록/검색/집계를 빠르게 하기 위한 것이며 폴더에서 언제든 재생성할 수 있어야 한다.
- 쓰기는 마크다운 파일에 먼저 한 뒤 캐시를 갱신한다. 폴더 감시가 외부 변경을 반영한다.
- **직원 파일 형식:** Claude Code 서브에이전트 형식(`name`, `description`, `tools`, `model`, 본문). 부서와 보고 라인은 `org.md`에만 둔다.
- **회사 폴더 구조:** 개발 회사의 `company/` 구조와 같다 (`tickets/{backlog,in-progress,done}`, `decisions/{pending,done}`, `reports/`, `templates/`, `finance/`, `org.md`).
  - 생성 결과 (`company:create`, `src/main/company/`): 루트에 `CLAUDE.md`, `.claude/agents/*.md`(기본 직원 cto, cfo, hr), `company/{org.md, mission.md, schedule.md}`, `company/tickets/{backlog,in-progress,done}`, `company/decisions/{pending,done}`, `company/reports/`, `company/templates/`, `company/finance/{budget.md,usage/}`.
  - 회사 폴더 표식: `CLAUDE.md`와 `company/org.md`가 모두 있으면 회사 폴더로 인식한다 (폴더 감시/캐시용).
  - 이름 규칙: 1~50자, 앞뒤 공백/`.` 시작·끝 금지, `<>:"/\|?*`와 제어 문자 금지, Windows 예약 이름 금지. 이름이 그대로 폴더 이름이다.
- **서버 전환 대비:** 저장소 접근은 모두 Repository 인터페이스 뒤에 둔다. 지금은 파일 + SQLite 구현을 쓰고, 나중에 서버 구현으로 교체한다. 전환 설계는 별도 문서로 정리한다.
- TODO: SQLite 스키마와 재생성(rebuild) 절차 상세

## 조직 모델

- 조직(부서, 보고 라인)의 원본은 회사 폴더의 `org.md`(마크다운)다. 앱은 이를 읽어 조직도와 가상 사무실의 부서 공간을 만든다.
- 기본 조직: CEO(사용자) → COO(메인 세션) → CTO, CFO, 인사팀(hr). pm과 developer는 기본에 없고 인사팀(hr)을 통해 채용한다(앱의 "첫 채용"으로 바로 채용도 가능). 기획팀·개발팀은 그 직원이 들어오면 생긴다. pm이 없으면 COO가 직접 티켓을 작성한다. 부서는 확장 가능하다.
  - 인수인계(T-052): hr 프롬프트는 `company/project.md`의 `직원:` 줄과 PM 지정용 `PM:` 줄을 쓰게 한다. T-052 편집 후 검증기도 hr의 `PM:` 줄 변경을 허용해야 한다 (그 외 프로젝트 설정 줄은 거부).
- 실행은 COO만 배정한다. 임원급 직원은 계획·검토를 반환하고 COO가 개발팀에 배정한다 (Claude Code 서브에이전트는 다른 서브에이전트를 호출할 수 없음).

## 가상 사무실 UI (게더타운 스타일)

- renderer에 PixiJS 기반 2D 사무실 맵을 둔다. 부서별 공간에 직원 아바타를 배치한다.
- 처음에는 `org.md`의 부서 기준 자동 배치(고정 레이아웃)로 만들고, 이후 사용자 편집 기능을 추가한다.
- 아바타 상태는 실행 이벤트와 티켓 상태에서 만든다: 대기, 작업 중, 승인 대기.
- 직원/COO를 클릭하면 로그 뷰나 대화 창이 열린다. 결정 인박스는 CEO 결재함으로 표시한다.
- 브라우저 모드(`--host`)에서도 mock 데이터로 사무실이 보여야 한다.
- 에셋은 퍼미시브 라이선스(CC0 등)만 쓰고 출처를 문서화한다.
- 구현(T-020, `src/renderer/src/office/`): 레이아웃/카메라/상태는 순수 함수(`layout.ts`, `camera.ts`, `status.ts`), PixiJS는 `scene.ts` 한 곳, 에셋 접근은 `sprites.ts` 한 곳이다. 렌더링은 변화가 있을 때만 하고(ticker 없음), 탭을 떠나면 장면을 destroy한다. CSP를 유지하려고 `pixi.js/unsafe-eval`을 쓴다.
- 상태 계약은 `src/shared/office.ts`(`OfficeStatusSource`). 실제 공급자(실행 이벤트 + 티켓/결재 상태)는 아직 없고, 기본값은 모두 대기, 개발 모드 mock만 순환한다. 실제 공급자는 `setOfficeStatusSource`로 교체한다.
- 지도는 마우스/터치용이다(휠 확대, 드래그 이동, 클릭 선택). 지도 위에서는 휠이 확대에 쓰여 페이지 스크롤이 막히고, `touch-action: none`이라 터치로 캔버스 위에서 페이지를 스크롤할 수 없으며 핀치 줌은 지원하지 않는다. 키보드와 스크린리더는 같은 정보를 담은 직원 목록(위/아래 화살표)을 쓴다.

## CFO와 사용량

- 사용량은 제공자 어댑터가 실행 결과 이벤트에서 추출해 `company/finance/usage/`에 기록한다 (인증·토큰 값은 기록하지 않는다).
- 예산 기준은 사용자가 온보딩에서 입력한 **제공자별 주간 한도**다. 기본 경고 기준은 80%다.
- 제공자마다 한도 체계(구독 한도, API 금액)가 달라서 기준을 따로 둔다. 사용량 정보가 없는 제공자는 '알 수 없음'으로 표시한다.
- 기록 위치와 형식 (T-019, `src/main/usage/`): `company/finance/usage/YYYY-MM-DD.md`(기록 시각의 로컬 날짜). 파일 하나에 제목과 기록 한 건당 `- {json}` 한 줄이다. 앱만 쓰며 SafeFs로 읽고 쓴다. 하루 단위라 크기 한도에 걸리지 않고 집계는 주간 구간에 걸친 파일만 읽는다. 보관 기간 제한과 자동 삭제는 없다.
- 기록 스키마 v1 (`src/shared/usage.ts`의 `UsageRecord`): `at`(ISO UTC), `provider`, `project`(T-037 안정 id, null = 회사 공통), `employee`(직원 id, null = 미분류), `ticket`(T-NNN, null = 미분류), `requests`, `costUsd`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`, `durationMs`. 숫자는 CLI가 알려 준 값만 담고 모르면 null이다 (0으로 채우지 않는다). 계정·토큰 값·인증 헤더 필드는 없다.
- 귀속: 직원은 실행을 맡긴 직원 id(틱의 담당자, hr 실행은 `hr`), 티켓·프로젝트는 틱이 고른 티켓의 값이다. 알 수 없으면 null이며 추정하지 않는다. `run:start`처럼 직원·티켓을 모르는 실행은 모두 null이다. 읽을 때 형식에 맞지 않거나 없는 귀속 필드는 null(미분류)로 읽으므로 과거 기록도 집계가 깨지지 않는다. `project`는 id라서 이름 수정·보관 뒤에도 유지된다.
- 집계 (회사 단위 합계): 주간 구간은 사용자 설정의 초기화 요일·시각(기본 월요일 0시, 이 기기 로컬 시간)으로 정해지는 `[시작, 시작+7일)`이다. 구간이 바뀌면 집계는 0에서 다시 시작한다. 제공자별·프로젝트별·직원별 합계와 위젯 데이터는 `usage:widget`이 돌려준다 (화면은 T-038). 범위는 D-021 임시안을 따른다.
- 표시 단위 (D-016): `WeeklyLimitUnit`은 `usd`(종량제: 달러와 사용자 환율의 한화 환산)와 `subscription-percent`(구독제: 사용자 입력 기준값 대비 추정 %, 위젯은 `estimated: true`)다. 요금제는 사용자가 고르며(앱이 인증 정보를 읽지 않음) 그 선택이 한도의 단위다. 요청 수·토큰 수는 두 경우 모두 별도 지표다. CLI가 비용을 알려 주지 않는 제공자는 한도가 있어도 `unknown`(알 수 없음)이다. 구독의 실제 사용률을 가져올 공식 방법은 없어 사용자 입력 기준값과 CLI가 보고한 비용으로 추정한다.
- 설정: 경고 기준(기본 80%), 환율(기본 1400원/달러, 네트워크 조회 없음), 초기화 요일·시각은 이 기기 `userData/usage-settings.json`에 둔다 (`usage:settings-get`/`usage:settings-save`).
- 경고: 기록할 때마다 그 제공자를 점검한다. 경고 기준 이상(`warn`)이거나 100% 이상(`exceeded`)이면 결정 카드를 만들고, `company/finance/usage/alerts.md`에 (제공자, 구간 시작, 단계)를 남겨 같은 구간에서 같은 단계의 카드를 다시 만들지 않는다. 틱의 한도 점검(`checkLimit`)은 100% 이상인 제공자가 있으면 실행하지 않는다.

## 외부 발행 자격 증명 보관소

외부 플랫폼(블로그, 유튜브 등) 자동 발행을 위한 권한(OAuth 등)을 앱이 보관하는 방식이다 (D-019, T-054 1단계 구현). 제공자 CLI(Claude/Codex/Gemini)의 로그인·토큰은 여기에 포함되지 않으며 앱이 다루지 않는다.

### 구현
- **보관:** `src/main/credentials/credential-vault.ts`. Electron `safeStorage`(OS 보안 저장소)만 쓴다. 암호화를 쓸 수 없으면 거부하고 평문으로 대체하지 않는다. 암호문은 앱 userData의 `credentials/vault.json`(파일 0600, 폴더 0700)에만 두며 회사 폴더·git 밖이다. 키는 `어댑터id:계정id` 형식이고 어댑터 id는 허용 목록이어야 한다. 값 읽기(`get`)는 main 내부 API이고 IPC·preload에 연결하지 않는다.
- **IPC:** `credentials:status`, `credentials:disconnect` 두 채널뿐이다 (`isTrustedSender`). 상태(연결됨/해제됨/만료 임박/오류), 만료 시각, 계정 표시명, 스코프 설명만 돌려준다. 값을 반환하는 채널은 없고 테스트(채널 목록·preload·`window.api` 이름 검사)로 고정한다.
- **발행 어댑터 계약:** `src/shared/publisher.ts`(id, displayName, scopes, connect, status, disconnect, publish, dryRun). 레지스트리는 어댑터 id 허용 목록을 두고 정책의 `발행 어댑터`가 이 id를 참조한다. 기본 어댑터 `manual`은 아무것도 보관하지 않는다. 가짜 어댑터는 테스트 전용이다.
- **게이트 발행자:** 발행은 main 코드가 한다. `createGatePublishers`가 발행 시점에 초안을 다시 읽어 해시가 승인된 값과 같을 때만 어댑터를 호출한다. LLM은 초안과 발행 요청까지만 한다.
- **OAuth:** 시스템 브라우저(허용 목록 `openExternal`)와 `127.0.0.1` 임의 포트 루프백, PKCE, `state` 검증, 타임아웃을 쓴다. 앱 내 웹뷰는 쓰지 않는다. 최소 권한 스코프만 요청한다.
- **마스킹:** 보관소가 다룬 값을 등록해 로그·오류 문자열에서 가리고(`redact.ts`), Bearer·JWT 같은 토큰 모양도 가린다. 어댑터 오류는 내용을 버리고 닫힌 코드로만 바꾼다. 값이 로그·오류·IPC 결과·파일에 나타나지 않음을 문자열 스캔 테스트로 확인한다. 회사 폴더, git, 결정 카드, 보고서, 사용량·감사 기록에도 값을 넣지 않는다.
- **환경변수:** CLI 자식 프로세스 환경은 허용 목록(`buildCliEnv`)만 통과시킨다. 보관소 값은 `process.env`에 들어가지 않으며 LLM이 읽는 파일·프롬프트에도 포함하지 않는다.
- **연결 해제:** 서버 측 토큰 폐기를 시도하고, 성공 여부와 무관하게 로컬 값을 모두 삭제한다.
- 개발·테스트에서는 실제 토큰을 쓰지 않고 가짜 어댑터와 더미 값만 쓴다. 플랫폼별 연동은 개별 티켓으로 진행한다.

### 값이 남을 수 있는 경우와 사용자가 직접 할 일
앱이 값을 지워 줄 수 없는 상황이 있다. 이때는 사용자가 직접 정리해야 한다.
- **앱 삭제:** 앱을 지워도 userData의 `credentials/vault.json`과 OS 보안 저장소의 암호화 키 항목이 남을 수 있다. 앱을 지우기 전에 "외부 연결"에서 먼저 연결을 해제한다. 이미 지웠다면 userData 폴더의 `credentials` 폴더를 직접 삭제하고, OS 키 관리 도구(macOS 키체인 접근, Windows 자격 증명 관리자)에서 앱 항목을 삭제한다.
- **회사 삭제:** 값은 회사 폴더가 아니라 앱 userData에 있으므로 회사 폴더를 지워도 값은 남는다. 연결은 회사가 아니라 앱 기준이다. 더 이상 쓰지 않으면 연결을 해제한다.
- **OS 계정 변경·초기화:** 암호문은 해당 OS 사용자의 보안 저장소 키로만 풀린다. 다른 계정이나 초기화된 환경에서는 복호화되지 않아 값을 쓸 수 없지만 파일은 남는다. 이전 계정의 userData는 그 계정에서 해제하거나 파일을 삭제한다.
- **서버 측 폐기 실패:** 오프라인 등으로 폐기에 실패하면 로컬 값만 삭제되고 서버의 토큰은 유효할 수 있다 (연결 해제 결과의 `revoked: false`). 이 경우 해당 플랫폼의 계정 설정(연결된 앱 관리)에서 직접 접근 권한을 취소한다.
- **잔여 위험:** 같은 OS 사용자의 다른 프로세스는 보안 저장소 접근을 시도할 수 있다 (macOS는 접근 허용 프롬프트). 서명되지 않은 첫 릴리스에서는 키체인 프롬프트가 더 잦을 수 있다.

## IPC / window.api

- `src/shared/`에 `window.api` 인터페이스 타입을 정의한다 (main/preload/renderer 공용).
- 개발 중 브라우저(`npm run dev -- --host`)에서는 mock 구현을 주입해 UI만 확인할 수 있게 한다.
- 채널명 규칙: `도메인:동작` (예: `ticket:list`, `run:start`, `run:event`).
- 모든 입력은 main에서 검증한다.
- 도메인 쓰기 채널은 `decision:resolve`(카드 pending → done), `ticket:move`(티켓 상태 폴더 이동 + 상태 줄 갱신)와 직원 변경 4종 `employee:create`, `employee:update`, `employee:move`, `employee:retire`(T-035)다. 모두 열린 회사의 SafeFs로만 접근하고, 같은 프로세스의 쓰기는 한 줄로 직렬화하며, 새 위치에 먼저 쓰고(덮어쓰지 않음) 옛 파일을 지우고, 실패하면 되돌린다. 목록 조회(`decision:list`, `ticket:list`)는 읽지 못한 파일이 있어도 나머지를 돌려주고 `unreadable`로 알린다. 티켓 본문은 20만 자까지만 renderer로 보낸다.
- 직원 변경(`src/main/employee/`)은 직원 파일(`.claude/agents/<id>.md`)과 `org.md` 행을 한 연산으로 묶고(같은 쓰기 큐, 파일은 no-clobber로 먼저 만들고 행 추가가 실패하면 되돌림), 쓰기 전에 다시 파싱해 의도한 필드가 보존되는지 검증한다. 한 줄 값(description)은 줄바꿈 변형·제어 문자를 거부하고 본문은 `\n`으로 정규화한다. 퇴사는 삭제가 아니라 `company/archive/employees/`로 보관한다. `employee:list-templates`는 앱 번들 상수(템플릿)만 돌려준다. renderer 요청은 항상 `ceo-ui`로 처리되고 `approved-proposal`은 main 코드만 쓴다. 민감 변경(COO·CTO·CFO·hr 변경, 퇴사, tools에 Bash/쓰기 도구 확대)은 승인된(done) 결정 카드 번호가 없으면 `approval-required`, COO·CEO 행은 `forbidden`이다. 변경마다 `ChangeRecord`를 돌려줘 감사 줄(T-046)에 쓰게 한다.
  - 승인 카드는 done 상태이고 결정(`chosen`)이 기록된 것만 인정한다. 알려진 한계: 카드가 어떤 직원·동작을 승인했는지는 묶지 않아 같은 카드를 다른 변경에 재사용할 수 있다 (T-046에서 대상 id·action 바인딩 예정). 신규 채용(create)은 템플릿 tools에 Bash 등이 있어도 확대로 보지 않는다 (id·직급이 민감할 때만 승인 필요). tools 비교는 대소문자를 구분하지 않고 Bash, Write, Edit, MultiEdit, NotebookEdit, Task, Agent, Skill, `mcp__*` 추가를 확대로 본다.
  - 알려진 한계: 퇴사 중 원본 재검증과 삭제 사이에 외부(CLI 에이전트 등)가 직원 파일을 고치면 그 변경이 보관본에 없을 수 있다 (파일 잠금 없음). 채용 중 앱이 파일 생성 직후 종료되면 org.md에 행이 없는 고아 직원 파일이 남고, 같은 이름의 재채용은 `conflict`가 된다 (사람이 파일을 정리해야 한다).

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

- `src/main/company/`: 회사 폴더 생성 (`scaffold.ts` 검증·생성, `templates.ts` 기본 마크다운). IPC는 `src/main/company-ipc.ts`. 열린 회사 1개는 `company-context.ts`가 보관하고(핸들러는 `requireOpenCompany().fs`로만 SafeFs를 얻는다), 마지막 회사 경로는 userData의 `last-company.json`에 기억한다. `company-service.ts`가 `company:select-folder`/`create`/`open`/`current`를 다이얼로그 경로 허용 방식(D-005 B)으로 처리한다.
- TODO: 나머지 모듈(스케줄러, 폴더 감시, Repository)이 추가되면 구조를 갱신

## 패키징과 배포

- electron-builder, better-sqlite3 네이티브 rebuild (macOS, Windows 각각).
- 첫 릴리스는 서명 없이 만들고 SmartScreen/Gatekeeper 경고 우회 방법을 안내한다. 이후 macOS 서명·공증, Windows 코드 서명을 도입한다.
- 자동 업데이트는 electron-updater + GitHub Releases.
- 경로 처리, 줄바꿈, CLI 실행 파일 탐색(`claude` vs `claude.cmd`)은 두 OS 모두에서 동작해야 한다.
- **배포 (확정):** 제품 소개 랜딩 페이지(별도 레포 `my-company-landing`)에서 사용자가 macOS 또는 Windows 설치 파일을 내려받는다. 파일 호스팅은 GitHub Releases를 재사용한다. 설치 파일 이름에서 버전을 빼 `releases/latest/download/<파일명>` 고정 링크로 최신 파일을 가리킨다.
- TODO: 패키지 매니저(Homebrew, winget) 병행 시점, 커스텀 도메인
- TODO: Windows 코드 서명 방식 (인증서 종류와 조달)

## 프로젝트 관리 (T-037 1단계, main)

- 원본: 회사 폴더 `company/project.md`. 코드는 `src/main/project/`, 계약은 `src/shared/project.ts`.
- 형식: 프로젝트마다 `## 프로젝트: 이름` 블록과 `- 키: 값` 줄(`id`, `유형`, `경로`, `dev 명령`, `기본 브랜치`, `상태`, `PM`). 알 수 없는 줄(`직원:`, 정책, 스크립트용 `- project_dir:` 등)과 다른 섹션은 원문 그대로 보존한다. `- 키: 값` 줄 파서(`field-lines.ts`)는 `PM:`·`직원:`(T-045)·T-052가 공용으로 쓴다.
- 기존 단일 형식(`project_dir`, `extra_project_dirs`)은 읽을 때 프로젝트로 해석만 하고, 변경 저장 때 원문 뒤에 블록을 붙여 변환한다 (스크립트용 키는 그대로).
- 쓰기: 쓰기 직렬화 큐(`runExclusive`) -> 재파싱 검증 -> 쓰기 직전 재읽기(conflict) -> 원자 쓰기(파일이 없으면 no-clobber) -> 읽어서 확인, 실패 시 롤백.
- 경로: `project:select-folder`(main 다이얼로그)가 돌려준 경로의 실제 경로만 승인 목록(최대 8, 추가 성공 시 소비)에 들어가고 `project:add`가 그것만 받는다. 검증은 절대·`..`·실존·심볼릭 해소·회사 폴더 포함 관계·홈/루트·중복. development는 `.git`과 최상위 폴더 일치 필요.
- git 조회는 `spawn` + 인자 배열의 `rev-parse`, `status --porcelain`만 (`--no-optional-locks`, `core.fsmonitor=false`, 최소 환경변수, 3초 시간 제한). 폴더에 `.git`이 없으면 조회하지 않는다. 레포 폴더는 쓰지 않는다.
- `projectState(project, org)`: `ready | pm-required | archived`. PM이 없거나 org.md의 PM 직급 직원이 아니면 `pm-required`.
- 채널: `project:select-folder|list|add|rename|archive|restore|set-type|set-pm|clear-pm` (모두 trustedHandler, 고정 오류 문구, ApiResult).
