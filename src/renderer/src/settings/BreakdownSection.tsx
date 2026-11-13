import type { UsageWidgetData } from '../../../shared/usage'
import { Panel } from '../ui/Panel'
import { UNKNOWN_TEXT } from './limit-wording'
import {
  attributionMissing,
  breakdownRows,
  type BreakdownNames,
  type BreakdownRow
} from './settings-model'

/** 프로젝트별·직원별 사용량 비교 표. 경고 기준에는 영향이 없다(경고는 회사 합계). 귀속 정보가 없으면 추정하지 않는다. */
export function BreakdownSection({
  widget,
  names
}: {
  widget: UsageWidgetData
  names: BreakdownNames
}): React.JSX.Element {
  const projectRows = breakdownRows('project', widget.byProject, widget.total, names)
  const employeeRows = breakdownRows('employee', widget.byEmployee, widget.total, names)
  return (
    <Panel title="프로젝트·직원별 사용량 비교">
      <p className="hint">
        이번 주 집계 기준이에요. 비교는 참고용이고 경고는 회사 전체 합계로 판단해요.
      </p>
      <BreakdownTable
        caption="프로젝트별"
        firstHead="프로젝트"
        rows={projectRows}
        missing={attributionMissing(widget.byProject, widget.total)}
        showProjects={false}
      />
      <BreakdownTable
        caption="직원별"
        firstHead="직원"
        rows={employeeRows}
        missing={attributionMissing(widget.byEmployee, widget.total)}
        showProjects
      />
    </Panel>
  )
}

function BreakdownTable({
  caption,
  firstHead,
  rows,
  missing,
  showProjects
}: {
  caption: string
  firstHead: string
  rows: BreakdownRow[]
  missing: boolean
  showProjects: boolean
}): React.JSX.Element {
  if (missing) {
    return (
      <div className="usage-table">
        <h3 className="usage-table__title">{caption}</h3>
        <p className="hint">
          {UNKNOWN_TEXT}: 누가 쓴 사용량인지 기록이 없어 나누어 보여 줄 수 없어요.
        </p>
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="usage-table">
        <h3 className="usage-table__title">{caption}</h3>
        <p className="empty-state">아직 비교할 사용량이 없어요.</p>
      </div>
    )
  }
  return (
    <div className="usage-table">
      <h3 className="usage-table__title">{caption}</h3>
      <div
        className="usage-table__scroll"
        tabIndex={0}
        role="region"
        aria-label={`${caption} 사용량 표`}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">{firstHead}</th>
              {showProjects && <th scope="col">담당 프로젝트</th>}
              <th scope="col">비용</th>
              <th scope="col">회사 합계 대비</th>
              <th scope="col">요청</th>
              <th scope="col">토큰</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key ?? '__none__'}>
                <th scope="row">{r.label}</th>
                {showProjects && <td>{r.projects}</td>}
                <td>{r.costText}</td>
                <td>{r.ratioText}</td>
                <td>{r.requestsText}</td>
                <td>{r.tokensText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
