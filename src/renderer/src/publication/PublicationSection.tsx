import { useId, useRef, useState } from 'react'
import type { PublicationEntry } from '../../../shared/publication'
import type { ProjectInfo } from '../../../shared/project'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { PublicationItem, type ItemActions } from './PublicationItem'
import {
  markPublishedFlow,
  progressText,
  publishFlow,
  requestApprovalFlow,
  UNTRUSTED_NOTE,
  type DraftsLoad
} from './publication-model'
import { usePublication } from './use-publication'

/** 프로젝트 화면의 "산출물·발행" 구역. 목록은 항상 앱이 폴더를 훑은 뒤의 기록이고, 발행 기록 파일은 이 화면에서 직접 고치지 않는다. */
export function PublicationSection({
  projects
}: {
  projects: readonly ProjectInfo[]
}): React.JSX.Element {
  const usable = projects.filter((p) => p.status === 'active')
  // 콘텐츠 프로젝트를 먼저 보여 준다.
  const sorted = [...usable].sort(
    (a, b) => Number(b.type === 'content') - Number(a.type === 'content')
  )
  const [picked, setPicked] = useState<string | null>(null)
  const projectId = sorted.find((p) => p.id === picked)?.id ?? sorted[0]?.id ?? null
  const { load, refreshing, reload } = usePublication(projectId)
  const selectId = useId()
  return (
    <section className="publication" aria-labelledby="publication-heading">
      <div className="projects__head">
        <h2 id="publication-heading">산출물·발행</h2>
        <Button
          size="small"
          aria-disabled={projectId === null || refreshing}
          onClick={() => projectId !== null && !refreshing && reload()}
        >
          다시 불러오기
        </Button>
      </div>
      <p className="hint projects__lead">
        직원이 쓴 초안을 확인하고 승인해요. 발행은 앱이 하거나 직접 올린 뒤 표시해요.{' '}
        {UNTRUSTED_NOTE}
      </p>
      {sorted.length === 0 ? (
        <Panel>
          <p className="empty-state">초안을 볼 프로젝트가 아직 없어요</p>
        </Panel>
      ) : (
        <>
          <div className="field pub__select">
            <label htmlFor={selectId}>프로젝트</label>
            <select
              id={selectId}
              className="input"
              value={projectId ?? ''}
              onChange={(e) => setPicked(e.target.value)}
            >
              {sorted.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          {projectId !== null && (
            <PublicationBody
              load={load}
              refreshing={refreshing}
              projectId={projectId}
              reload={reload}
            />
          )}
        </>
      )}
    </section>
  )
}

export function PublicationBody({
  load,
  refreshing,
  projectId,
  reload
}: {
  load: DraftsLoad
  refreshing: boolean
  projectId: string
  reload: () => void
}): React.JSX.Element {
  const [notice, setNotice] = useState<string | null>(null)
  const lock = useRef(false)

  if (load.kind === 'loading')
    return (
      <p className="hint" role="status">
        초안을 불러오고 있어요…
      </p>
    )
  if (load.kind === 'error')
    return (
      <Panel>
        <p role="alert" className="error">
          {load.message}
        </p>
        <Button onClick={reload}>다시 시도</Button>
      </Panel>
    )

  const { list, progress } = load
  const locked = list.unreadable > 0
  const drafts = list.items.filter((e) => e.status === 'draft')

  // 성공하면 목록을 다시 읽고, 실패 문구만 돌려준다.
  const wrap = async (
    task: () => Promise<{ ok: boolean; message: string }>
  ): Promise<string | null> => {
    if (lock.current) return null
    lock.current = true
    try {
      const r = await task()
      reload()
      if (r.ok) {
        setNotice(r.message)
        return null
      }
      return r.message
    } finally {
      lock.current = false
    }
  }
  const actions: ItemActions = {
    approve: (e: PublicationEntry) =>
      wrap(() => requestApprovalFlow(window.api, projectId, [e.id])),
    publish: (e) => wrap(() => publishFlow(window.api, projectId, e)),
    mark: (e, link) => wrap(() => markPublishedFlow(window.api, projectId, e.id, link))
  }

  return (
    <>
      <div role="status" aria-live="polite" className={refreshing ? 'hint' : 'visually-hidden'}>
        {refreshing && '목록을 새로 읽고 있어요…'}
      </div>
      {progress && <p className="pub__progress">{progressText(progress)}</p>}
      {locked && (
        <p className="notice" role="alert">
          읽지 못한 발행 기록이 {list.unreadable}건 있어요. 기록이 꼬이지 않도록 승인 요청과 발행
          표시는 잠시 막아 뒀어요. 발행 기록 파일을 확인해 주세요.
        </p>
      )}
      {notice && (
        <div className="notice projects__notice" role="status">
          <span>{notice}</span>
          <Button size="small" onClick={() => setNotice(null)}>
            닫기
          </Button>
        </div>
      )}
      {list.items.length === 0 ? (
        <Panel>
          <p className="empty-state">아직 초안이 없어요</p>
          <p className="hint">직원이 산출물 폴더에 초안을 만들면 여기에 나타나요.</p>
        </Panel>
      ) : (
        <>
          <div className="pub__bulk">
            <Button
              size="small"
              variant="primary"
              aria-disabled={drafts.length === 0 || locked}
              onClick={() =>
                drafts.length > 0 &&
                !locked &&
                void wrap(() => requestApprovalFlow(window.api, projectId))
              }
            >
              승인 대기 {drafts.length}건 승인 요청
            </Button>
          </div>
          <ul className="pub-list" aria-label="초안 목록">
            {list.items.map((e) => (
              <PublicationItem
                key={e.id}
                entry={e}
                projectId={projectId}
                locked={locked}
                actions={actions}
              />
            ))}
          </ul>
        </>
      )}
    </>
  )
}
