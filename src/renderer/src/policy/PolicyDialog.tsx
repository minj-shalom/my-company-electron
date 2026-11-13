import { useId, useState } from 'react'
import type { PolicyAction, PolicyValues, ReviewStage } from '../../../shared/policy'
import { POLICY_FLOWS, REVIEW_STAGES, type PolicyFlow } from '../../../shared/policy'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import type { ProjectType } from '../../../shared/project'
import { Modal } from '../ui/Modal'
import { AutoConfirmDialog } from './AutoConfirmDialog'
import { ModeRow } from './ModeFields'
import {
  flowLabels,
  immutableRules,
  autoChanges,
  checkDraft,
  formatAt,
  latestFirst,
  uniqueMessages,
  type SaveStatus,
  visibleActions,
  warningText
} from './policy-model'
import { wordingFor } from './policy-wording'
import { usePolicyEditor } from './use-policy'

const REVIEW_LABELS: Record<ReviewStage, string> = {
  required: 'reviewer-qa 필수',
  recommended: '권장'
}

/** 프로젝트 하나의 "작업 흐름" 편집 대화. 로딩/오류/정상, 저장 중/성공/위반/충돌 상태를 모두 다룬다. */
export function PolicyDialog({
  projectId,
  projectName,
  projectType = 'development',
  onClose,
  onSaved
}: {
  projectId: string
  projectName: string
  projectType?: ProjectType
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const titleId = useId()
  const ed = usePolicyEditor(projectId, onSaved, projectType)
  const [confirming, setConfirming] = useState<PolicyAction[] | null>(null)
  const [localErrors, setLocalErrors] = useState<string[]>([])
  const saving = ed.save.kind === 'saving'
  const state = ed.load.kind === 'ready' ? ed.load.state : null

  const trySave = (): void => {
    if (!state || !ed.draft || saving) return
    const errors = checkDraft(ed.draft, projectName, projectType)
    setLocalErrors(errors)
    if (errors.length > 0) return
    const changed = autoChanges(state.values, ed.draft)
    if (changed.length > 0) setConfirming(changed)
    else void ed.submit(false)
  }

  return (
    <Modal labelledBy={titleId} busy={saving} onClose={onClose}>
      <h2 id={titleId} className="modal__title">
        작업 흐름 &middot; {projectName}
      </h2>
      <div className="modal__body policy">
        {ed.load.kind === 'loading' && (
          <p role="status" className="hint">
            정책을 불러오고 있어요…
          </p>
        )}
        {ed.load.kind === 'error' && (
          <div>
            <p role="alert" className="error">
              {ed.load.message}
            </p>
            <Button onClick={ed.reload}>다시 시도</Button>
          </div>
        )}
        {state && ed.draft && (
          <>
            {!state.exists && (
              <p className="notice" role="note">
                아직 정책 파일이 없어요. {wordingFor(projectType).noPolicyFile} &ldquo;매번
                컨펌&rdquo;으로 처리돼요.
              </p>
            )}
            {state.warnings.length > 0 && (
              <div className="notice policy__warnings" role="note">
                <strong>확인이 필요한 값 {state.warnings.length}건</strong>
                <ul>
                  {uniqueMessages(state.warnings.map((w) => warningText(w.code, projectType))).map(
                    (t) => (
                      <li key={t}>{t}</li>
                    )
                  )}
                </ul>
              </div>
            )}
            <ImmutableRules type={projectType} />
            <PolicyForm
              draft={ed.draft}
              projectName={projectName}
              projectType={projectType}
              disabled={saving}
              onChange={ed.setDraft}
            />
            <History entries={state.history} />
          </>
        )}
        <SaveFeedback status={ed.save} errors={localErrors} onReload={ed.reload} />
      </div>
      <div className="modal__actions">
        <Button aria-disabled={saving} onClick={() => !saving && onClose()}>
          닫기
        </Button>
        {state && (
          <Button
            variant="primary"
            aria-disabled={saving || !ed.dirty}
            onClick={() => ed.dirty && trySave()}
          >
            {saving ? '저장하는 중…' : '저장'}
          </Button>
        )}
      </div>
      {confirming && ed.draft && (
        <AutoConfirmDialog
          actions={confirming}
          draft={ed.draft}
          projectName={projectName}
          projectType={projectType}
          busy={saving}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            await ed.submit(true)
            setConfirming(null)
          }}
        />
      )}
    </Modal>
  )
}

function ImmutableRules({ type }: { type: ProjectType }): React.JSX.Element {
  const id = useId()
  return (
    <section className="policy__rules" aria-labelledby={id}>
      <h3 id={id}>항상 지켜져요</h3>
      <ul>
        {immutableRules(type).map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="hint">이 규칙은 자동 모드에서도 바꿀 수 없어요.</p>
    </section>
  )
}

function PolicyForm({
  draft,
  projectName,
  projectType,
  disabled,
  onChange
}: {
  draft: PolicyValues
  projectName: string
  projectType: ProjectType
  disabled: boolean
  onChange: (v: PolicyValues) => void
}): React.JSX.Element {
  const id = useId()
  const w = wordingFor(projectType)
  const flows = flowLabels(projectType)
  const dev = draft.flow !== 'content-draft-approve'
  const content = draft.flow !== 'dev-git-pr'
  return (
    <form className="policy__form" aria-label="작업 흐름 편집" onSubmit={(e) => e.preventDefault()}>
      <div className="field">
        <label htmlFor={`${id}-flow`}>흐름</label>
        <select
          id={`${id}-flow`}
          className="input"
          disabled={disabled}
          value={draft.flow}
          onChange={(e) => onChange({ ...draft, flow: e.target.value as PolicyFlow })}
        >
          {POLICY_FLOWS.map((f) => (
            <option key={f} value={f}>
              {flows[f]}
            </option>
          ))}
        </select>
      </div>
      <p className="policy__lead">
        동작마다 CEO 컨펌 방식을 정해요. 자동 모드는 기본으로 꺼져 있고, 켜면 컨펌 없이 실행돼요.
      </p>
      {visibleActions(draft.flow).map((a) => (
        <ModeRow
          key={a}
          action={a}
          draft={draft}
          projectName={projectName}
          projectType={projectType}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
      {dev && (
        <fieldset className="policy__group" disabled={disabled}>
          <legend>{w.devGroupLegend}</legend>
          <div className="field">
            <label htmlFor={`${id}-prefix`}>{w.prefixLabel}</label>
            <Input
              id={`${id}-prefix`}
              value={draft.branchPrefix}
              onChange={(e) => onChange({ ...draft, branchPrefix: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-base`}>{w.baseLabel}</label>
            <Input
              id={`${id}-base`}
              value={draft.baseBranch ?? ''}
              onChange={(e) => onChange({ ...draft, baseBranch: e.target.value || null })}
            />
          </div>
          <label className="policy__check">
            <input
              type="checkbox"
              checked={draft.usePr}
              onChange={(e) => onChange({ ...draft, usePr: e.target.checked })}
            />
            <span>{w.usePrLabel}</span>
          </label>
          <div className="field">
            <label htmlFor={`${id}-review`}>검수 단계</label>
            <select
              id={`${id}-review`}
              className="input"
              value={draft.reviewStage}
              onChange={(e) => onChange({ ...draft, reviewStage: e.target.value as ReviewStage })}
            >
              {REVIEW_STAGES.map((s) => (
                <option key={s} value={s}>
                  {s === 'required' ? w.reviewRequired : REVIEW_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </fieldset>
      )}
      {content && (
        <fieldset className="policy__group" disabled={disabled}>
          <legend>콘텐츠 흐름</legend>
          <div className="field">
            <label htmlFor={`${id}-goal`}>하루 산출 목표 (0~20)</label>
            <Input
              id={`${id}-goal`}
              type="number"
              min={0}
              max={20}
              extraClass="policy-auto__num"
              value={draft.dailyOutputGoal}
              onChange={(e) => onChange({ ...draft, dailyOutputGoal: Number(e.target.value) })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-dir`}>산출물 폴더 (프로젝트 폴더 기준)</label>
            <Input
              id={`${id}-dir`}
              value={draft.outputDir}
              onChange={(e) => onChange({ ...draft, outputDir: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-adapter`}>발행 어댑터 (직접 발행은 manual)</label>
            <Input
              id={`${id}-adapter`}
              value={draft.publishAdapter}
              onChange={(e) => onChange({ ...draft, publishAdapter: e.target.value })}
            />
          </div>
        </fieldset>
      )}
      <div className="field">
        <label htmlFor={`${id}-hours`}>활동 요일·시간 (선택)</label>
        <Input
          id={`${id}-hours`}
          disabled={disabled}
          value={draft.activeHours ?? ''}
          onChange={(e) => onChange({ ...draft, activeHours: e.target.value || null })}
        />
      </div>
      <div className="field">
        <label htmlFor={`${id}-memo`}>메모 (선택)</label>
        <textarea
          id={`${id}-memo`}
          className="input policy__memo"
          rows={3}
          maxLength={500}
          disabled={disabled}
          value={draft.memo ?? ''}
          onChange={(e) => onChange({ ...draft, memo: e.target.value || null })}
        />
      </div>
    </form>
  )
}

function History({
  entries
}: {
  entries: { at: string; actor: string; summary: string }[]
}): React.JSX.Element {
  const id = useId()
  return (
    <section className="policy__history" aria-labelledby={id}>
      <h3 id={id}>변경 이력</h3>
      {entries.length === 0 ? (
        <p className="empty-state">아직 변경 이력이 없어요</p>
      ) : (
        <ol>
          {latestFirst(entries).map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <time dateTime={h.at}>{formatAt(h.at)}</time> <Badge>{h.actor}</Badge>
              <span className="policy__summary">{h.summary}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function SaveFeedback({
  status,
  errors,
  onReload
}: {
  status: SaveStatus
  errors: string[]
  onReload: () => void
}): React.JSX.Element {
  const list = status.kind === 'violations' ? status.messages : errors
  return (
    <div aria-live="polite" className="policy__feedback">
      {status.kind === 'saved' && (
        <p className="notice" role="status">
          저장했어요. 변경 이력에 남았어요.
        </p>
      )}
      {status.kind === 'conflict' && (
        <div role="alert" className="error">
          <p>다른 곳에서 정책이 먼저 바뀌었어요. 최신 내용을 불러온 뒤 다시 편집해 주세요.</p>
          <Button onClick={onReload}>최신 내용 불러오기</Button>
        </div>
      )}
      {status.kind === 'error' && (
        <p role="alert" className="error">
          {status.message}
        </p>
      )}
      {list.length > 0 && (
        <div role="alert" className="error">
          <p>저장하지 못했어요. 아래를 확인해 주세요.</p>
          <ul>
            {list.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
