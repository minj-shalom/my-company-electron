/** 인사 변경 가드레일(T-052) 공용 타입. 검증 결과는 `OrgIssue`와 같은 코드 체계를 확장한다. */
import type { OrgIssueCode } from './org'

export type IntegrityIssueCode =
  | OrgIssueCode
  | 'chart-mismatch' // 조직도 코드 블록과 직원 표가 다름
  | 'agent-unparsable' // frontmatter 파싱 실패
  | 'agent-name-mismatch' // name이 파일 이름과 다름
  | 'agent-model' // 허용 목록 밖의 model
  | 'agent-tools' // tools 형식 오류
  | 'agent-body-size' // 본문 크기 상한 초과
  | 'project-line-changed' // project.md에서 `직원:`·`PM:` 외 줄이 바뀜
  | 'project-block-unreadable' // 바뀐 뒤 프로젝트 블록을 읽을 수 없음
  | 'assignee-unknown' // `직원:`의 직원이 org.md에 없음
  | 'pm-unknown' // `PM:`의 직원이 org.md에 없음
  | 'pm-not-pm' // `PM:`의 직원이 PM 직급이 아님
  | 'pm-duplicate' // `PM:` 줄이 둘 이상
  | 'pm-format' // `PM:` 줄 형식 오류
  | 'pm-needed' // 상태 변화: PM이 없어짐 (위반 아님)
  | 'policy-changed' // 정책 파일이 앱 밖에서 바뀜
  | 'snapshot-secret' // 비밀 패턴 때문에 스냅샷 중단
  | 'snapshot-oversize' // 크기 상한 초과로 복원 불가
  | 'sensitive-change' // 승인되지 않은 민감 변경

export interface IntegrityIssue {
  code: IntegrityIssueCode
  /** 고정 한국어 문장. 파일 내용과 내부 경로를 담지 않는다. */
  message: string
  /** 회사 폴더 기준 상대 경로. */
  file: string
  /** 위반이면 'violation', 상태 변화 알림이면 'info'. */
  severity: 'violation' | 'info'
}

export const CHANGE_ACTORS = ['hr-direct', 'ceo-ui', 'approved-proposal', 'unknown'] as const
export type ChangeActor = (typeof CHANGE_ACTORS)[number]

export type IntegrityActionResult =
  | { ok: true; restored?: number }
  | {
      ok: false
      code: 'not-restorable' | 'no-baseline' | 'validation-failed' | 'busy'
      files: string[]
    }
