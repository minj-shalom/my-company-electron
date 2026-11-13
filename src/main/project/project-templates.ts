import type { ApiResult } from '../../shared/result'
import type { PolicyValues } from '../../shared/policy'
import { PROJECT_ID, type ProjectType } from '../../shared/project'
import {
  PROJECT_TEMPLATE_IDS,
  type ProjectApplyTemplateResult,
  type ProjectTemplateId,
  type ProjectTemplateInfo
} from '../../shared/project-template'
import { findTemplate } from '../employee/templates'
import { defaultValues } from '../policy/policy-doc'
import type { PolicyService } from '../policy/policy-service'
import type { DocProject } from './project-doc'

interface TemplateDef {
  info: ProjectTemplateInfo
  /** 템플릿이 정하는 정책 값. 모든 동작은 `매번 컨펌`이고 자동 모드를 켜지 않는다 (T-047). */
  values: (project: DocProject) => PolicyValues
}

const content =
  (goal: number) =>
  (project: DocProject): PolicyValues => ({
    ...defaultValues('content', project.defaultBranch),
    dailyOutputGoal: goal
  })

/** 코드에 내장한 읽기 전용 템플릿 라이브러리. 추천 직원의 첫 항목은 항상 담당 PM이다. */
const LIBRARY: readonly TemplateDef[] = Object.freeze([
  {
    info: {
      id: 'dev-web-app',
      title: '웹 앱 개발',
      description:
        'git 레포로 웹 앱을 만든다. feature 브랜치와 PR로 작업하고 푸시·머지마다 컨펌한다.',
      type: 'development',
      flow: 'dev-git-pr',
      policySummary: [
        'feature 브랜치에서 작업하고 PR로 합친다',
        '푸시와 머지는 매번 컨펌',
        '검수(reviewer-qa) 필수'
      ],
      recommendedStaff: [
        { templateId: 'pm-dev', isPm: true, reason: '티켓 분해와 브랜치·PR 흐름 관리' },
        { templateId: 'developer', isPm: false, reason: '티켓 구현' },
        { templateId: 'reviewer-qa', isPm: false, reason: '필수 검수' }
      ]
    },
    values: (p) => defaultValues('development', p.defaultBranch)
  },
  {
    info: {
      id: 'content-blog',
      title: '블로그 콘텐츠',
      description: '블로그 글을 하루 1건 초안으로 만든다. 초안마다 CEO가 승인한 뒤에만 발행한다.',
      type: 'content',
      flow: 'content-draft-approve',
      policySummary: ['초안마다 CEO 승인', '일일 산출 목표 1건', '발행은 매번 컨펌'],
      recommendedStaff: [
        { templateId: 'pm-content', isPm: true, reason: '일일 산출 계획과 승인 흐름 관리' },
        { templateId: 'writer', isPm: false, reason: '글 초안 작성' },
        { templateId: 'editor', isPm: false, reason: '초안 검토와 교정' }
      ]
    },
    values: content(1)
  },
  {
    info: {
      id: 'content-video',
      title: '영상 콘텐츠',
      description: '영상 기획과 대본을 하루 1건 초안으로 만든다. 영상 편집과 업로드는 범위 밖이다.',
      type: 'content',
      flow: 'content-draft-approve',
      policySummary: ['초안마다 CEO 승인', '일일 산출 목표 1건', '기획·대본까지만 작성'],
      recommendedStaff: [
        { templateId: 'pm-content', isPm: true, reason: '일일 산출 계획과 승인 흐름 관리' },
        { templateId: 'researcher', isPm: false, reason: '주제 조사와 근거 정리' },
        { templateId: 'script-writer', isPm: false, reason: '대본 초안 작성' }
      ]
    },
    values: content(1)
  }
])

const find = (id: unknown): TemplateDef | undefined =>
  PROJECT_TEMPLATE_IDS.find((x) => x === id) === undefined
    ? undefined
    : LIBRARY.find((t) => t.info.id === id)

/** `project:list-templates`. 호출마다 복사본을 돌려줘 상수가 바뀌지 않게 한다. */
export function listProjectTemplates(): ProjectTemplateInfo[] {
  return structuredClone(LIBRARY.map((t) => t.info))
}

/** 추천 직원이 모두 직원 템플릿 라이브러리에 있는지 (테스트용 점검). */
export const missingStaffTemplates = (): string[] =>
  LIBRARY.flatMap((t) => t.info.recommendedStaff.map((s) => s.templateId)).filter(
    (id) => findTemplate(id) === undefined
  )

export interface TemplateServiceDeps {
  policy: PolicyService
  readProjects: () => Promise<DocProject[]>
}

const fail = (code: 'invalid-request' | 'not-found' | 'conflict' | 'internal', message: string) =>
  ({ ok: false, code, message }) as const

/**
 * 템플릿 적용: 정책 파일 기본값만 만든다. 직원 채용·배정은 하지 않고 추천 목록을 돌려준다.
 * 정책 값은 `PolicyService.apply`(T-047 검증)를 그대로 거치므로 불변 규칙과 자동 모드 요건이 똑같이 적용된다.
 */
export async function applyProjectTemplate(
  deps: TemplateServiceDeps,
  raw: unknown
): Promise<ApiResult<ProjectApplyTemplateResult>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return fail('invalid-request', '요청이 올바르지 않습니다.')
  const req = raw as Record<string, unknown>
  if (Object.keys(req).some((k) => k !== 'projectId' && k !== 'templateId'))
    return fail('invalid-request', '요청이 올바르지 않습니다.')
  if (typeof req.projectId !== 'string' || !PROJECT_ID.test(req.projectId))
    return fail('invalid-request', '프로젝트 id가 올바르지 않습니다.')
  const def = find(req.templateId)
  if (def === undefined) return fail('invalid-request', '알 수 없는 템플릿입니다.')

  let projects: DocProject[]
  try {
    projects = await deps.readProjects()
  } catch {
    return fail('internal', '프로젝트 목록을 읽지 못했습니다.')
  }
  const project = projects.find((p) => p.id === req.projectId)
  if (project === undefined) return fail('not-found', '등록된 프로젝트가 아닙니다.')
  const type: ProjectType = project.type
  if (type !== def.info.type)
    return fail('invalid-request', '프로젝트 유형과 맞지 않는 템플릿입니다.')

  const current = await deps.policy.get({ projectId: project.id })
  if (!current.ok) return current
  if (current.value.exists)
    return fail('conflict', '이미 정책 파일이 있어 템플릿을 적용하지 않았어요.')

  const saved = await deps.policy.save({
    projectId: project.id,
    revision: current.value.revision,
    values: def.values(project)
  })
  if (!saved.ok) return saved
  if (!saved.value.saved) return fail('internal', '템플릿 정책이 규칙을 통과하지 못했습니다.')
  return {
    ok: true,
    value: {
      projectId: project.id,
      templateId: def.info.id as ProjectTemplateId,
      policyRevision: saved.value.state.revision,
      recommendedStaff: structuredClone(def.info.recommendedStaff)
    }
  }
}
