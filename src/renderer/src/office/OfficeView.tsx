import { memo, useContext, useId, useMemo, useState } from 'react'
import type { AvatarStatus, OfficeStatusMap } from '../../../shared/office'
import type { OrgMember, OrgSnapshot } from '../../../shared/org'
import { HireBanners } from '../hire/HireBanners'
import { IssueList } from '../org/IssueList'
import { MemberDetail } from '../org/MemberDetail'
import { RovingList } from '../org/RovingList'
import { TabbableContext } from '../org/tabbable-context'
import {
  groupByDepartment,
  memberDetail,
  toneByTitle,
  type DepartmentGroup,
  type OrgIssueView
} from '../org/org-view'
import { useOrg } from '../org/use-org'
import { Badge, type BadgeTone } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { computeLayout, toOfficeGroups } from './layout'
import { OfficeCanvas } from './OfficeCanvas'
import { STATUS_LABEL, countByStatus, hasLiveStatusSource, statusOf } from './status'
import { useOfficeStatuses } from './use-office-statuses'

const STATUS_TONE: Record<AvatarStatus, BadgeTone> = {
  idle: 'neutral',
  working: 'good',
  'awaiting-approval': 'warn'
}

/** 사무실 맵 화면. 조직 데이터 상태(로딩/오류/빈/정상)를 나누고 정상일 때만 맵과 목록을 그린다. */
export function OfficeView({ onFirstHire }: { onFirstHire?: () => void }): React.JSX.Element {
  const { status, refreshing, refresh } = useOrg()
  const loading = status.kind === 'loading' || refreshing
  return (
    <section className="office" aria-labelledby="office-heading">
      <div className="office__head">
        <h2 id="office-heading">사무실 맵</h2>
        <Button size="small" aria-disabled={loading} onClick={() => !loading && refresh()}>
          다시 불러오기
        </Button>
      </div>
      <div role="status" aria-live="polite" className={loading ? 'hint' : 'visually-hidden'}>
        {loading && '사무실을 불러오고 있어요…'}
      </div>
      {status.kind === 'error' && (
        <Panel>
          <p role="alert" className="error">
            {status.message}
          </p>
          <Button onClick={refresh}>다시 시도</Button>
        </Panel>
      )}
      {status.kind === 'empty' && (
        <Panel>
          <p className="empty-state">
            {status.issues.length > 0
              ? '사무실을 만들 수 없어요. 아래 문제를 해결하면 직원이 나타나요.'
              : '아직 등록된 직원이 없어요. company/org.md의 직원 목록 표에 직원을 추가하면 사무실이 생겨요.'}
          </p>
          <IssueList issues={status.issues} />
        </Panel>
      )}
      {status.kind === 'ready' && (
        <OfficeReady
          snapshot={status.snapshot}
          issues={status.issues}
          onFirstHire={onFirstHire}
          onChanged={refresh}
        />
      )}
    </section>
  )
}

function OfficeReady({
  snapshot,
  issues,
  onFirstHire,
  onChanged
}: {
  snapshot: OrgSnapshot
  issues: OrgIssueView[]
  onFirstHire?: () => void
  onChanged: () => void
}): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const groups = useMemo(() => groupByDepartment(snapshot), [snapshot])
  const layout = useMemo(() => computeLayout(toOfficeGroups(groups)), [groups])
  const titles = useMemo(() => layout.seats.map((s) => s.title), [layout])
  const tones = useMemo(() => toneByTitle(groups), [groups])
  const statuses = useOfficeStatuses(titles)
  const member = snapshot.org.members.find((m) => m.title === selected) ?? null
  const counts = countByStatus(titles, statuses)
  const detailId = useId()

  return (
    <>
      <HireBanners snapshot={snapshot} onFirstHire={onFirstHire} onChanged={onChanged} />
      <IssueList issues={issues} />
      {!hasLiveStatusSource() && (
        <p className="office__notice hint">상태 연동 전이라 모두 대기로 보여요.</p>
      )}
      <ul className="office__legend" aria-label="상태 요약">
        {(Object.keys(STATUS_LABEL) as AvatarStatus[]).map((s) => (
          <li key={s}>
            <Badge tone={STATUS_TONE[s]}>
              {STATUS_LABEL[s]} {counts[s]}명
            </Badge>
          </li>
        ))}
      </ul>
      <OfficeCanvas
        layout={layout}
        statuses={statuses}
        selected={selected}
        onSelect={setSelected}
      />
      <div className="office__below">
        <div id={detailId} className="office__detail">
          <Panel title="직원 상세" as="section">
            {member ? (
              <>
                <p className="office__detail-status">
                  지금 상태:{' '}
                  <Badge tone={STATUS_TONE[statusOf(statuses, member.title)]}>
                    {STATUS_LABEL[statusOf(statuses, member.title)]}
                  </Badge>
                </p>
                <div aria-live="polite" aria-atomic="true">
                  <MemberDetail
                    detail={memberDetail(member, snapshot.agents)}
                    tone={tones.get(member.title) ?? null}
                  />
                </div>
              </>
            ) : (
              <p className="hint">
                지도의 직원이나 목록의 이름을 고르면 역할, 모델, 도구가 여기에 보여요.
              </p>
            )}
          </Panel>
        </div>
        <Panel title="직원 목록">
          <OfficeRoster
            groups={groups}
            statuses={statuses}
            selected={selected}
            onSelect={setSelected}
            controls={detailId}
          />
        </Panel>
      </div>
    </>
  )
}

/** 지도와 같은 정보를 키보드로 쓰는 목록. 위/아래 화살표로 이동하고 Enter/Space로 고른다. */
const OfficeRoster = memo(function OfficeRoster({
  groups,
  statuses,
  selected,
  onSelect,
  controls
}: {
  groups: readonly DepartmentGroup[]
  statuses: OfficeStatusMap
  selected: string | null
  onSelect: (title: string) => void
  controls: string
}): React.JSX.Element {
  const order = groups.flatMap((g) => g.members.map((m) => m.title))
  return (
    <RovingList titles={order} selected={selected}>
      <div className="org-depts">
        {groups.map((g) => (
          <section
            key={g.name}
            className="org-dept"
            data-tone={g.tone}
            aria-label={`${g.name} 부서`}
          >
            <h3 className="org-dept__name">
              {g.name} <span className="hint">{g.members.length}명</span>
            </h3>
            <ul>
              {g.members.map((m) => (
                <li key={m.title}>
                  <RosterButton
                    member={m}
                    status={statusOf(statuses, m.title)}
                    selected={selected === m.title}
                    onSelect={onSelect}
                    controls={controls}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </RovingList>
  )
})

function RosterButton({
  member,
  status,
  selected,
  onSelect,
  controls
}: {
  member: OrgMember
  status: AvatarStatus
  selected: boolean
  onSelect: (title: string) => void
  controls: string
}): React.JSX.Element {
  const tabbable = useContext(TabbableContext)
  return (
    <button
      type="button"
      className="org-member"
      tabIndex={tabbable === undefined || tabbable === member.title ? 0 : -1}
      data-org-item={member.title}
      aria-current={selected ? 'true' : undefined}
      aria-controls={controls}
      onClick={() => onSelect(member.title)}
    >
      <span className="org-member__title">{member.title}</span>
      <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
    </button>
  )
}
