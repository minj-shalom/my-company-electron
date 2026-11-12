import { Badge } from '../ui/Badge'
import { splitIssues, type OrgIssueView } from './org-view'

export function IssueList({ issues }: { issues: OrgIssueView[] }): React.JSX.Element | null {
  const { blocking, warnings } = splitIssues(issues)
  if (issues.length === 0) return null
  return (
    <div className="org__issues">
      {blocking.length > 0 && (
        <div className="notice org__issues--blocking" role="alert" aria-label="조직도 문서 오류">
          <p>
            <Badge tone="bad">고쳐야 해요 {blocking.length}건</Badge>
          </p>
          <ul>
            {blocking.map((it, i) => (
              <li key={i}>{it.text}</li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="notice" role="group" aria-label="조직도 문서 경고">
          <p>
            <Badge tone="warn">확인 필요 {warnings.length}건</Badge>
          </p>
          <ul>
            {warnings.map((it, i) => (
              <li key={i}>{it.text}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
