import type { AssignmentIssue } from '../../../shared/project'
import { describeAssignmentIssue } from './assign-model'

/** project.md의 직원·PM 줄에서 찾은 경고. 오류로 막지 않고 알리기만 한다. */
export function AssignmentIssues({
  issues
}: {
  issues: readonly AssignmentIssue[]
}): React.JSX.Element | null {
  if (issues.length === 0) return null
  return (
    <details className="notice assigned__issues">
      <summary>프로젝트 배정 경고 {issues.length}건</summary>
      <ul>
        {issues.map((i, n) => (
          <li key={n}>{describeAssignmentIssue(i)}</li>
        ))}
      </ul>
    </details>
  )
}
