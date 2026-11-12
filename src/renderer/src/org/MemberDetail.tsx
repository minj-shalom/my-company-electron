import { Badge } from '../ui/Badge'
import { EMPTY_VALUE, type DeptTone, type MemberDetailView } from './org-view'

/** 직원 상세. 모든 값은 React 텍스트로만 렌더링한다 (직원 파일 내용은 신뢰하지 않는다). */
export function MemberDetail({
  detail,
  tone
}: {
  detail: MemberDetailView
  tone: DeptTone | null
}): React.JSX.Element {
  return (
    <div className="org-detail" data-tone={tone ?? undefined}>
      <h3 className="org-detail__title">
        {detail.title} <Badge tone="info">{detail.kindLabel}</Badge>
      </h3>
      {detail.fileNote && <p className="notice">{detail.fileNote}</p>}
      <dl className="org-detail__list">
        <dt>역할</dt>
        <dd>{detail.role}</dd>
        <dt>모델</dt>
        <dd>
          {detail.model === EMPTY_VALUE ? (
            <span className="hint">{detail.model}</span>
          ) : (
            <code>{detail.model}</code>
          )}
        </dd>
        <dt>도구</dt>
        <dd>
          {detail.tools.length > 0 ? (
            <ul className="org-tools" aria-label="사용 가능한 도구">
              {detail.tools.map((t) => (
                <li key={t}>
                  <code>{t}</code>
                </li>
              ))}
            </ul>
          ) : (
            <span className="hint">{EMPTY_VALUE}</span>
          )}
        </dd>
        <dt>부서</dt>
        <dd>{detail.department}</dd>
        <dt>보고 대상</dt>
        <dd>{detail.reportsTo}</dd>
        {detail.name && (
          <>
            <dt>에이전트 이름</dt>
            <dd>
              <code>{detail.name}</code>
            </dd>
          </>
        )}
        <dt>설명</dt>
        <dd>{detail.description}</dd>
      </dl>
    </div>
  )
}
