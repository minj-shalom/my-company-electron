import type {
  CompanyCreateRequest,
  CompanyCreateResult,
  CompanySelectFolderResult
} from './company'
import type { RunEvent, RunStartRequest, RunStartResult } from './run'

/** main/preload/renderer 공용 `window.api` 계약. 채널을 추가하면 여기와 preload를 함께 갱신한다. */
export interface WindowApi {
  /** IPC 왕복 확인용. main이 'pong'을 돌려준다. */
  ping: () => Promise<string>
  /** claude CLI 실행을 시작한다. 이벤트는 onRunEvent로 받는다. */
  startRun: (req: RunStartRequest) => Promise<RunStartResult>
  /** 실행 중인 run을 취소한다. 대상이 없으면 false. */
  cancelRun: (runId: string) => Promise<boolean>
  /** 새 회사 폴더(구조 + 기본 템플릿)를 만든다. 기존 폴더는 덮어쓰지 않는다. */
  createCompany: (req: CompanyCreateRequest) => Promise<CompanyCreateResult>
  /** 회사 폴더를 만들 위치를 main의 폴더 선택 다이얼로그로 고른다. 취소하면 null. */
  selectCompanyFolder: () => Promise<CompanySelectFolderResult>
  /** run 이벤트 구독. 반환된 함수로 해제한다. */
  onRunEvent: (listener: (event: RunEvent) => void) => () => void
}

/** IPC 채널명 (`도메인:동작`). */
export const IPC_CHANNELS = {
  ping: 'app:ping',
  runStart: 'run:start',
  runCancel: 'run:cancel',
  runEvent: 'run:event',
  companyCreate: 'company:create',
  companySelectFolder: 'company:select-folder'
} as const
