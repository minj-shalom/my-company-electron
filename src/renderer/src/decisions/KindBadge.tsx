import type { Decision } from '../../../shared/decision'
import { Badge } from '../ui/Badge'
import { KIND_META, kindOf } from './decision-view'

/** 유형 아이콘(글자 표식) + 유형 배지. 색만으로 구분하지 않도록 글자 라벨을 항상 둔다. */
export function KindBadge({ decision }: { decision: Pick<Decision, 'kind'> }): React.JSX.Element {
  const kind = kindOf(decision)
  const meta = KIND_META[kind]
  return (
    <span className="kind" data-kind={kind}>
      <span className="kind__icon" aria-hidden="true">
        {meta.glyph}
      </span>
      <Badge tone={meta.tone}>{meta.label}</Badge>
    </span>
  )
}
