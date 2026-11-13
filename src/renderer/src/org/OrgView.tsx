import { useCallback, useContext, useEffect, useId, useRef, useState } from 'react'
import type { OrgMember, OrgSnapshot, OrgTreeNode } from '../../../shared/org'
import { Badge } from '../ui/Badge'
import { HireEntry } from '../employee/HireEntry'
import { LeaveDialog, MemberManager } from '../employee/MemberManager'
import { useNewHire } from '../employee/use-new-hire'
import { HireBanners } from '../hire/HireBanners'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import {
  groupByDepartment,
  memberDetail,
  toneByTitle,
  type DeptTone,
  type OrgIssueView,
  type OrgStatus
} from './org-view'
import { IssueList } from './IssueList'
import { MemberDetail } from './MemberDetail'
import { RovingList } from './RovingList'
import { TabbableContext } from './tabbable-context'
import { useOrg } from './use-org'

/** 조직도 화면. 상태(로딩/오류/빈/정상)를 나누고 정상일 때만 본문을 그린다. 직원 텍스트는 모두 React 텍스트로 렌더링한다. */
export function OrgView({ onFirstHire }: { onFirstHire?: () => void }): React.JSX.Element {
  const { status, refreshing, refresh } = useOrg()
  const loading = status.kind === 'loading' || refreshing
  return (
    <section className="org" aria-labelledby="org-heading">
      <div className="org__head">
        <h2 id="org-heading" tabIndex={-1}>
          조직도
        </h2>
        <Button size="small" aria-disabled={loading} onClick={() => !loading && refresh()}>
          다시 불러오기
        </Button>
      </div>
      <div role="status" aria-live="polite" className={loading ? 'hint' : 'visually-hidden'}>
        {loading && '조직도를 불러오고 있어요…'}
      </div>
      <OrgBody status={status} onRetry={refresh} onFirstHire={onFirstHire} />
    </section>
  )
}

function OrgBody({
  status,
  onRetry,
  onFirstHire
}: {
  status: OrgStatus
  onRetry: () => void
  onFirstHire?: () => void
}): React.JSX.Element | null {
  switch (status.kind) {
    case 'loading':
      return null
    case 'error':
      return (
        <Panel>
          <p role="alert" className="error">
            {status.message}
          </p>
          <Button onClick={onRetry}>다시 시도</Button>
        </Panel>
      )
    case 'empty':
      return (
        <Panel>
          <p className="empty-state">
            {status.issues.length > 0
              ? '조직도를 그릴 수 없어요. 아래 문제를 해결하면 직원이 나타나요.'
              : '아직 등록된 직원이 없어요. company/org.md의 직원 목록 표에 직원을 추가해 주세요.'}
          </p>
          <IssueList issues={status.issues} />
        </Panel>
      )
    case 'ready':
      return (
        <OrgReady
          snapshot={status.snapshot}
          issues={status.issues}
          onFirstHire={onFirstHire}
          onChanged={onRetry}
        />
      )
  }
}

function OrgReady({
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
  // 편집 중 변경이 있으면 다른 직원을 고르기 전에 확인한다.
  const dirtyRef = useRef(false)
  const [pendingSelect, setPendingSelect] = useState<string | null>(null)
  const setDirty = useCallback((d: boolean) => {
    dirtyRef.current = d
  }, [])
  const requestSelect = (title: string): void => {
    if (dirtyRef.current && title !== selected) setPendingSelect(title)
    else setSelected(title)
  }
  const listsRef = useRef<HTMLDivElement>(null)
  const { onHired, notice } = useNewHire(snapshot, setSelected, listsRef, onChanged)
  const groups = groupByDepartment(snapshot)
  const tones = toneByTitle(groups)
  const member = snapshot.org.members.find((m) => m.title === selected) ?? null
  const detailId = useId()
  const detailRef = useRef<HTMLDivElement>(null)
  // 좁은 화면에서는 상세가 목록 위에 있으므로, 선택하면 보이는 위치로 옮긴다.
  useEffect(() => {
    if (selected) detailRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])
  const orderedTree = snapshot.org.tree.flatMap(flatten)
  const orderedDept = groups.flatMap((g) => g.members.map((m) => m.title))

  return (
    <>
      <HireBanners snapshot={snapshot} onFirstHire={onFirstHire} onChanged={onChanged} />
      <IssueList issues={issues} />
      <HireEntry snapshot={snapshot} onHired={onHired} />
      <div role="status" aria-live="polite" className={notice ? 'hire-notice' : 'visually-hidden'}>
        {notice}
      </div>
      <div className="org__layout" data-selected={member ? 'true' : 'false'}>
        <div
          className="org__detail"
          id={detailId}
          ref={detailRef}
          aria-live="polite"
          aria-atomic="true"
        >
          <Panel title="직원 상세" as="section">
            {member ? (
              <>
                <MemberDetail
                  detail={memberDetail(member, snapshot.agents)}
                  tone={tones.get(member.title) ?? null}
                />
                <MemberManager
                  key={member.title}
                  member={member}
                  snapshot={snapshot}
                  onDirtyChange={setDirty}
                  onChanged={onChanged}
                  onRetired={() => setSelected(null)}
                />
              </>
            ) : (
              <p className="hint">직원을 선택하면 역할, 모델, 도구가 여기에 보여요.</p>
            )}
          </Panel>
        </div>
        <div className="org__lists" ref={listsRef}>
          <Panel title="보고 라인">
            <RovingList titles={orderedTree} selected={selected}>
              <ul className="org-tree" aria-label="보고 라인 트리">
                {snapshot.org.tree.map((n) => (
                  <TreeNode
                    key={n.member.title}
                    node={n}
                    tones={tones}
                    selected={selected}
                    onSelect={requestSelect}
                    controls={detailId}
                  />
                ))}
              </ul>
            </RovingList>
          </Panel>
          <Panel title="부서별 직원">
            <RovingList titles={orderedDept} selected={selected}>
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
                          <MemberButton
                            member={m}
                            tone={g.tone}
                            selected={selected === m.title}
                            onSelect={requestSelect}
                            controls={detailId}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </RovingList>
          </Panel>
        </div>
      </div>
      {pendingSelect && (
        <LeaveDialog
          onStay={() => setPendingSelect(null)}
          onLeave={() => {
            dirtyRef.current = false
            setSelected(pendingSelect)
            setPendingSelect(null)
          }}
        />
      )}
    </>
  )
}

function flatten(node: OrgTreeNode): string[] {
  return [node.member.title, ...node.children.flatMap(flatten)]
}

function TreeNode({
  node,
  tones,
  selected,
  onSelect,
  controls
}: {
  node: OrgTreeNode
  tones: Map<string, DeptTone>
  selected: string | null
  onSelect: (title: string) => void
  controls: string
}): React.JSX.Element {
  const { member } = node
  return (
    <li>
      <MemberButton
        member={member}
        tone={tones.get(member.title) ?? null}
        selected={selected === member.title}
        onSelect={onSelect}
        controls={controls}
      />
      {node.children.length > 0 && (
        <ul className="org-tree__children">
          {node.children.map((c) => (
            <TreeNode
              key={c.member.title}
              node={c}
              tones={tones}
              selected={selected}
              onSelect={onSelect}
              controls={controls}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function MemberButton({
  member,
  tone,
  selected,
  onSelect,
  controls
}: {
  member: OrgMember
  tone: DeptTone | null
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
      data-tone={tone ?? undefined}
      data-kind={member.kind}
      aria-current={selected ? 'true' : undefined}
      aria-controls={controls}
      onClick={() => onSelect(member.title)}
    >
      <span className="org-member__title">{member.title}</span>
      <span className="org-member__role">{member.role.trim() || '역할 정보 없음'}</span>
      {(member.kind === 'invalid' || (member.kind === 'agent' && !member.fileExists)) && (
        <Badge tone="warn">파일 확인</Badge>
      )}
    </button>
  )
}
