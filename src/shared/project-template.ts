import type { ProjectType } from './project'
import type { PolicyFlow } from './policy'

/** 프로젝트 유형 템플릿(T-048). 앱 번들에 든 읽기 전용 목록이며 사용자 정의 템플릿은 없다. */
export const PROJECT_TEMPLATE_IDS = ['dev-web-app', 'content-blog', 'content-video'] as const
export type ProjectTemplateId = (typeof PROJECT_TEMPLATE_IDS)[number]

/** 추천 직원 한 명. `templateId`는 직원 템플릿 라이브러리(`employee:list-templates`)의 id다. */
export interface RecommendedStaff {
  templateId: string
  /** 담당 PM 후보. 목록의 첫 항목이며 PM 필요 상태를 해소하려면 가장 먼저 채용한다. */
  isPm: boolean
  reason: string
}

export interface ProjectTemplateInfo {
  id: ProjectTemplateId
  title: string
  description: string
  type: ProjectType
  flow: PolicyFlow
  /** 기본 정책 요약 (화면 표시용 문구). */
  policySummary: string[]
  /** PM이 첫 항목이다. 직접 채용·배정하지 않는 제안 목록이다. */
  recommendedStaff: RecommendedStaff[]
}

export interface ProjectApplyTemplateRequest {
  projectId: string
  templateId: ProjectTemplateId
}

export interface ProjectApplyTemplateResult {
  projectId: string
  templateId: ProjectTemplateId
  /** 만든 정책 파일의 revision (이후 `getPolicy`/`savePolicy`의 기준). */
  policyRevision: string
  /** 추천 직원 구성. 채용·배정은 호출 쪽(UI 확인, 인사팀 요청, 제안 카드)이 한다. */
  recommendedStaff: RecommendedStaff[]
}
