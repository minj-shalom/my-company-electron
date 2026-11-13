import type { OrgSnapshot } from '../../../shared/org'
import { Panel } from '../ui/Panel'
import { unassignedEmployees } from './assign-model'

/** "아직 프로젝트가 없는 직원". 이들은 회사 공통 업무만 맡는다. 조직 조회 상태에 따라 로딩/오류/빈 상태를 보인다. */
export function UnassignedSection({
  org,
  failed
}: {
  org: OrgSnapshot | null
  failed: boolean
}): React.JSX.Element {
  const list = org ? unassignedEmployees(org) : []
  return (
    <Panel title="아직 프로젝트가 없는 직원" as="section">
      {failed ? (
        <p role="alert" className="error">
          직원 정보를 불러오지 못했어요. 위의 다시 불러오기를 눌러 주세요.
        </p>
      ) : org === null ? (
        <p role="status" className="hint">
          직원 정보를 불러오고 있어요…
        </p>
      ) : list.length === 0 ? (
        <p className="hint">모든 직원이 프로젝트에 배정되어 있어요.</p>
      ) : (
        <>
          <p className="hint">프로젝트가 없는 직원은 회사 공통 업무만 맡아요.</p>
          <ul className="unassigned-list" aria-label="프로젝트가 없는 직원">
            {list.map((e) => (
              <li key={e.id}>{e.title}</li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}
