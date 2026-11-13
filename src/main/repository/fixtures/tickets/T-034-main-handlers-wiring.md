# T-034: main 핸들러 연결 (org:get, 제공자 감지, 연결 테스트, 주간 한도)

- **상태:** backlog
- **담당:** electron-main-dev
- **부서:** 개발팀
- **브랜치:** feature/T-034
- **의존:** T-008, T-009, T-010, T-011

## 목표
renderer가 `notImplemented`로 받던 채널들을 main에 연결해 실제 앱에서 화면이 동작하게 한다.

## 완료 조건
- [x] `org:get`: `loadOrg(fs)` 결과와 에이전트 파일 frontmatter(name, description, model, tools 콤마 분리)로 `OrgSnapshot`을 만든다
- [x] 제공자 감지, 연결 테스트(사용자 클릭 시에만 실행, 종료 정리 훅), 주간 한도 저장 채널 연결
- [x] 모든 핸들러에 `isTrustedSender`와 입력 검증, 에러 메시지에 내부 경로 비노출
- [x] `main/window.ts` `openExternal` 호스트 허용 목록
- [ ] (미확인, CEO 결정으로 진행) 실제 Electron 창에서 온보딩, 조직도, 사무실을 확인한다

## 메모
- 제품 모델(CEO 확정: 회사 1개, 프로젝트 N개): `org:get`이 읽는 회사 폴더는 T-041의 "열린 회사 컨텍스트"(단일 회사 루트)다. T-041 1단계를 이 티켓 직전 또는 함께 한다 (의존에 T-041 추가 권장).
- 보류 중인 결정: D-014(macOS GUI PATH 감지), D-016(주간 한도 단위). 임시 제안으로 진행하고 카드에 기록한다.
