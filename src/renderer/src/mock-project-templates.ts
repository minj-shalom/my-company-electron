import type { WindowApi } from '../../shared/api'
import type { ProjectTemplateInfo } from '../../shared/project-template'

/** 브라우저 개발 모드 전용 최소 mock. 실제 라이브러리는 main에 있고 이 값은 화면 확인용이다. */
const TEMPLATES: ProjectTemplateInfo[] = [
  {
    id: 'dev-web-app',
    title: '웹 앱 개발',
    description: 'git 레포로 웹 앱을 만든다.',
    type: 'development',
    flow: 'dev-git-pr',
    policySummary: ['푸시와 머지는 매번 컨펌', '검수 필수'],
    recommendedStaff: [
      { templateId: 'pm-dev', isPm: true, reason: '티켓 분해와 PR 흐름 관리' },
      { templateId: 'developer', isPm: false, reason: '티켓 구현' },
      { templateId: 'reviewer-qa', isPm: false, reason: '필수 검수' }
    ]
  },
  {
    id: 'content-blog',
    title: '블로그 콘텐츠',
    description: '블로그 글을 하루 1건 초안으로 만든다.',
    type: 'content',
    flow: 'content-draft-approve',
    policySummary: ['초안마다 CEO 승인', '일일 산출 목표 1건'],
    recommendedStaff: [
      { templateId: 'pm-content', isPm: true, reason: '일일 산출 계획 관리' },
      { templateId: 'writer', isPm: false, reason: '글 초안 작성' },
      { templateId: 'editor', isPm: false, reason: '초안 검토' }
    ]
  },
  {
    id: 'content-video',
    title: '영상 콘텐츠',
    description: '영상 기획과 대본을 하루 1건 초안으로 만든다.',
    type: 'content',
    flow: 'content-draft-approve',
    policySummary: ['초안마다 CEO 승인', '일일 산출 목표 1건'],
    recommendedStaff: [
      { templateId: 'pm-content', isPm: true, reason: '일일 산출 계획 관리' },
      { templateId: 'researcher', isPm: false, reason: '주제 조사' },
      { templateId: 'script-writer', isPm: false, reason: '대본 초안 작성' }
    ]
  }
]

export const mockProjectTemplateApi: Pick<
  WindowApi,
  'listProjectTemplates' | 'applyProjectTemplate'
> = {
  listProjectTemplates: async () => ({ ok: true, value: structuredClone(TEMPLATES) }),
  applyProjectTemplate: async (req) => {
    const t = TEMPLATES.find((x) => x.id === req.templateId)
    if (!t) return { ok: false, code: 'invalid-request', message: '알 수 없는 템플릿입니다.' }
    return {
      ok: true,
      value: {
        projectId: req.projectId,
        templateId: t.id,
        policyRevision: 'mock',
        recommendedStaff: structuredClone(t.recommendedStaff)
      }
    }
  }
}
