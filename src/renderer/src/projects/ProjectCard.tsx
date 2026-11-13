import type { OrgSnapshot } from '../../../shared/org'
import type { ProjectInfo } from '../../../shared/project'
import { ProjectPeople } from '../assign/ProjectPeople'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { TYPE_LABELS, gitView, stateBadge } from './project-model'

export type ProjectAction = 'rename' | 'archive' | 'restore' | 'assign-pm' | 'clear-pm'

/** 프로젝트 한 건. 이름·경로·PM은 모두 React 텍스트로만 렌더링한다. */
export function ProjectCard({
  project,
  current,
  onAction,
  people
}: {
  project: ProjectInfo
  current: boolean
  onAction: (action: ProjectAction, project: ProjectInfo) => void
  /** 주어지면 "함께 일하는 직원"을 보인다 (조직 조회 상태와 변경 후 새로고침). */
  people?: { org: OrgSnapshot | null; onChanged: () => void }
}): React.JSX.Element {
  const state = stateBadge(project)
  const git = gitView(project)
  const archived = project.status === 'archived'
  const label = (verb: string): string => `${project.name} ${verb}`
  return (
    <li className="project-card" data-state={project.state}>
      <div className="project-card__head">
        <h3 className="project-card__name">{project.name}</h3>
        <Badge tone={state.tone}>{state.label}</Badge>
        <Badge tone="neutral">{TYPE_LABELS[project.type]}</Badge>
        {current ? <Badge tone="info">보는 중</Badge> : null}
      </div>
      <dl className="project-card__meta">
        <dt>경로</dt>
        <dd>
          <code>{project.path}</code>
        </dd>
        <dt>브랜치</dt>
        <dd>
          {git.branch !== null ? <code>{git.branch}</code> : <span>{git.branchText}</span>}
          <span className="project-card__dirty">
            <Badge tone={git.tone}>{git.dirtyText}</Badge>
          </span>
        </dd>
        <dt>담당 PM</dt>
        <dd>
          {project.pm ? (
            project.pm.name
          ) : (
            <span className={project.state === 'pm-required' ? 'project-card__nopm' : undefined}>
              {archived
                ? '없음'
                : project.pmId
                  ? `없음 (${project.pmId}를 찾을 수 없어요)`
                  : '없음'}
            </span>
          )}
        </dd>
      </dl>
      {project.state === 'pm-required' && (
        <p className="notice project-card__warn" role="note">
          PM이 없으면 이 프로젝트의 티켓이 실행되지 않아요. 티켓은 만들 수 있어요.
        </p>
      )}
      {people && <ProjectPeople project={project} org={people.org} onChanged={people.onChanged} />}
      <div className="project-card__actions">
        {!archived && (
          <Button
            size="small"
            variant={project.state === 'pm-required' ? 'primary' : 'default'}
            aria-label={label(project.pm ? '담당 PM 변경' : '담당 PM 지정')}
            onClick={() => onAction('assign-pm', project)}
          >
            {project.pm ? 'PM 변경' : '담당 PM 지정'}
          </Button>
        )}
        {!archived && project.pmId !== null && (
          <Button
            size="small"
            aria-label={label('담당 PM 해제')}
            onClick={() => onAction('clear-pm', project)}
          >
            PM 해제
          </Button>
        )}
        <Button
          size="small"
          aria-label={label('이름 수정')}
          onClick={() => onAction('rename', project)}
        >
          이름 수정
        </Button>
        {archived ? (
          <Button
            size="small"
            aria-label={label('복원')}
            onClick={() => onAction('restore', project)}
          >
            복원
          </Button>
        ) : (
          <Button
            size="small"
            aria-label={label('보관')}
            onClick={() => onAction('archive', project)}
          >
            보관
          </Button>
        )}
      </div>
    </li>
  )
}
