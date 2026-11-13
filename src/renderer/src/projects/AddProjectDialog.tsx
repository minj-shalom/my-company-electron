import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { WindowApi } from '../../../shared/api'
import type { EmployeeTemplateInfo } from '../../../shared/employee-change'
import type { OrgSnapshot } from '../../../shared/org'
import { PROJECT_TYPES, MAX_PROJECT_NAME, type ProjectType } from '../../../shared/project'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Modal } from '../ui/Modal'
import { PmFields } from './PmFields'
import { StaffStep, TemplateStep, NO_TEMPLATE, type TemplateLoad } from './TemplateSteps'
import {
  TYPE_LABELS,
  defaultPmChoice,
  suggestName,
  validateAddForm,
  type AddInput,
  type AddOutcome,
  type PmCandidate,
  type PmChoice
} from './project-model'
import {
  buildStaffRows,
  emptyProgress,
  runTemplateSetup,
  templatesForType,
  type SetupProgress
} from './template-flow'

type PickResult = { path: string } | { error: string } | null

export type AddProjectApi = Pick<
  WindowApi,
  | 'listProjectTemplates'
  | 'listEmployeeTemplates'
  | 'addProject'
  | 'applyProjectTemplate'
  | 'createEmployee'
  | 'assignProjectEmployee'
  | 'setProjectPm'
>

/**
 * 프로젝트 추가: 1 폴더·이름·유형, 2 시작 방법(템플릿), 3 담당 PM 또는 추천 직원 확인.
 * 템플릿을 고르면 추가 -> 기본 규칙 -> 채용 -> 배정 -> PM 지정을 한 번에 실행하고, 중간에 멈추면 이어서 할 수 있다.
 */
export function AddProjectDialog({
  pms,
  snapshot,
  api,
  onPickFolder,
  onSubmit,
  onFinished,
  onCancel
}: {
  pms: readonly PmCandidate[]
  snapshot: OrgSnapshot | null
  api: AddProjectApi
  onPickFolder: () => Promise<PickResult>
  /** 템플릿 없이 추가할 때. */
  onSubmit: (input: AddInput) => Promise<AddOutcome>
  /** 템플릿으로 추가한 프로젝트가 만들어진 뒤 닫을 때 (목록 새로고침과 안내 문구는 부모가 한다). */
  onFinished: (message: string) => void
  onCancel: () => void
}): React.JSX.Element {
  const titleId = useId()
  const ids = { name: useId(), type: useId(), nameErr: useId() }
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [path, setPath] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [type, setType] = useState<ProjectType>('development')
  const [pm, setPm] = useState<PmChoice>(() => defaultPmChoice(pms))
  const [busy, setBusy] = useState(false)
  const [picking, setPicking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [templateChoice, setTemplateChoice] = useState<string | null>(null)
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(new Set())
  const [progress, setProgress] = useState<SetupProgress | null>(null)
  const [tpl, setTpl] = useState<TemplateLoad>({ kind: 'loading' })
  const [catalog, setCatalog] = useState<EmployeeTemplateInfo[]>([])
  const [tick, setTick] = useState(0)
  const lock = useRef(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.listProjectTemplates(), api.listEmployeeTemplates()])
      .then(([t, c]) => {
        if (cancelled) return
        if (t.ok && c.ok) {
          setCatalog(c.value)
          setTpl({ kind: 'ready', templates: t.value })
        } else setTpl({ kind: 'error' })
      })
      .catch(() => !cancelled && setTpl({ kind: 'error' }))
    return () => {
      cancelled = true
    }
  }, [api, tick])

  const retryTemplates = useCallback(() => {
    setTpl({ kind: 'loading' })
    setTick((n) => n + 1)
  }, [])

  const matching = useMemo(
    () => (tpl.kind === 'ready' ? templatesForType(tpl.templates, type) : []),
    [tpl, type]
  )
  // 고른 값이 현재 유형에 없으면(유형을 바꾼 경우) 첫 추천 템플릿, 없으면 "템플릿 없이 시작"으로 되돌린다.
  const selected =
    templateChoice === NO_TEMPLATE || matching.some((t) => t.id === templateChoice)
      ? (templateChoice as string)
      : (matching[0]?.id ?? NO_TEMPLATE)
  const template = matching.find((t) => t.id === selected) ?? null
  const rows = useMemo(
    () => (template && snapshot ? buildStaffRows(template, catalog, snapshot) : []),
    [template, catalog, snapshot]
  )
  const checkedRows = rows.filter((r) => !unchecked.has(r.templateId))
  const checked = new Set(checkedRows.map((r) => r.templateId))

  const errors = validateAddForm({ name })
  const showNameError = (nameTouched || name !== '') && errors.name
  const canNext = path !== null && Object.keys(errors).length === 0
  const started = progress !== null && progress.projectId !== null
  const lastStep = step === 3
  const staffMode = template !== null

  const pick = async (): Promise<void> => {
    setPicking(true)
    setMessage(null)
    const r = await onPickFolder()
    setPicking(false)
    if (r === null) return
    if ('error' in r) return setMessage(r.error)
    setPath(r.path)
    if (name === '') setName(suggestName(r.path))
  }

  const finishText = (p: SetupProgress, count: number): string =>
    `"${name}" 프로젝트를 추가하고 추천 직원 ${count}명을 준비했어요.` +
    (p.policy === 'kept' ? ' 이미 있던 기본 규칙은 그대로 두었어요.' : '')

  const submitTemplate = async (): Promise<void> => {
    if (path === null || !template || !snapshot || lock.current) return
    lock.current = true
    setBusy(true)
    setMessage(null)
    try {
      const next = await runTemplateSetup(
        api,
        { path, name, template, rows: checkedRows, catalog, snapshot },
        progress ?? emptyProgress(),
        type
      )
      setProgress(next)
      if (next.failed === null) return onFinished(finishText(next, checkedRows.length))
      // 프로젝트가 만들어지기 전에 멈췄으면 아무것도 바뀐 게 없으므로 1단계에서 고칠 수 있게 한다.
      if (next.projectId === null) {
        setMessage(next.message)
        setProgress(null)
        setStep(1)
      } else setMessage(next.message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  const submitPlain = async (): Promise<void> => {
    if (path === null || busy) return
    setBusy(true)
    setMessage(null)
    const outcome = await onSubmit({ path, name, type, pm })
    if (outcome.kind === 'error') {
      setBusy(false)
      setMessage(outcome.message)
      setStep(1)
    }
  }

  const leaveWithPartial = (): void => {
    const p = progress
    onFinished(
      `"${name}" 프로젝트는 추가했지만 직원 준비가 끝나지 않았어요.` +
        (p?.message ? ` ${p.message}` : '') +
        ' 프로젝트 카드에서 직원 배정과 담당 PM을 이어서 정할 수 있어요.'
    )
  }

  const stepTitle = ['폴더·이름·유형', '시작 방법', staffMode ? '추천 직원 확인' : '담당 PM'][
    step - 1
  ]

  return (
    <Modal labelledBy={titleId} busy={busy} onClose={started ? leaveWithPartial : onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (step === 1 && canNext) setStep(2)
          else if (step === 2) setStep(3)
          else if (step === 3) void (staffMode ? submitTemplate() : submitPlain())
        }}
      >
        <h2 id={titleId} className="modal__title">
          프로젝트 추가{' '}
          <span className="hint">
            ({step}/3 {stepTitle})
          </span>
        </h2>
        {step === 1 && (
          <div className="modal__body">
            <div className="field">
              <span id={`${titleId}-folder`}>폴더</span>
              <div className="field__row">
                <code className="code-box" aria-labelledby={`${titleId}-folder`}>
                  {path ?? '아직 고르지 않았어요'}
                </code>
                <Button aria-disabled={picking} onClick={() => !picking && void pick()}>
                  {path ? '다른 폴더' : '폴더 선택'}
                </Button>
              </div>
              <p className="hint">
                폴더는 선택 창에서만 고를 수 있어요. 새 폴더도 만들 수 있고, 폴더 안 파일은 바꾸지
                않아요.
              </p>
            </div>
            <div className="field">
              <label htmlFor={ids.name}>이름 (1~{MAX_PROJECT_NAME}자)</label>
              <Input
                id={ids.name}
                value={name}
                autoComplete="off"
                aria-invalid={Boolean(showNameError)}
                aria-describedby={ids.nameErr}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setNameTouched(true)}
              />
              <p id={ids.nameErr} className={showNameError ? 'error' : 'hint'}>
                {showNameError || '화면에 보이는 이름이에요. 나중에 고칠 수 있어요.'}
              </p>
            </div>
            <div className="field">
              <label htmlFor={ids.type}>유형</label>
              <select
                id={ids.type}
                className="input"
                value={type}
                onChange={(e) => setType(e.target.value as ProjectType)}
              >
                {PROJECT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <p className="hint">
                {type === 'development'
                  ? '개발: git 레포 폴더(.git이 있는 최상위 폴더)여야 해요.'
                  : '콘텐츠·기타: 어떤 폴더든 괜찮아요.'}
              </p>
            </div>
          </div>
        )}
        {step === 2 && (
          <div className="modal__body">
            <TemplateStep
              load={tpl}
              templates={matching}
              selected={selected}
              disabled={busy}
              onSelect={setTemplateChoice}
              onRetry={retryTemplates}
            />
          </div>
        )}
        {step === 3 && (
          <div className="modal__body">
            {staffMode ? (
              snapshot ? (
                <>
                  <p>
                    <strong>{name}</strong>에 함께할 직원을 확인해 주세요.
                  </p>
                  <StaffStep
                    rows={rows}
                    checked={checked}
                    disabled={busy}
                    progress={progress}
                    onToggle={(id) =>
                      setUnchecked((s) => {
                        const n = new Set(s)
                        if (n.has(id)) n.delete(id)
                        else n.add(id)
                        return n
                      })
                    }
                  />
                </>
              ) : (
                <p role="alert" className="error">
                  직원 정보를 불러오지 못해서 추천 직원을 확인할 수 없어요. 이전으로 돌아가
                  &ldquo;템플릿 없이 시작&rdquo;을 고르거나 잠시 뒤 다시 시도해 주세요.
                </p>
              )
            ) : (
              <>
                <p>
                  <strong>{name}</strong>을(를) 맡을 PM을 정해 주세요.
                </p>
                <PmFields pms={pms} choice={pm} disabled={busy} onChange={setPm} />
              </>
            )}
          </div>
        )}
        <div role="status" aria-live="polite" className={busy ? 'hint' : 'visually-hidden'}>
          {busy && '프로젝트와 직원을 준비하고 있어요…'}
        </div>
        {message && (
          <p role="alert" className="error modal__error">
            {message}
          </p>
        )}
        <div className="modal__actions">
          {started ? (
            <Button aria-disabled={busy} onClick={() => !busy && leaveWithPartial()}>
              나중에 하기
            </Button>
          ) : (
            <Button aria-disabled={busy} onClick={() => !busy && onCancel()}>
              취소
            </Button>
          )}
          {step > 1 && !started && (
            <Button aria-disabled={busy} onClick={() => !busy && setStep(step === 3 ? 2 : 1)}>
              이전
            </Button>
          )}
          {!lastStep ? (
            <Button variant="primary" type="submit" aria-disabled={step === 1 && !canNext}>
              다음
            </Button>
          ) : (
            <Button
              variant="primary"
              type="submit"
              aria-disabled={busy || (staffMode && !snapshot)}
            >
              {busy
                ? '준비하는 중…'
                : started
                  ? '이어서 하기'
                  : staffMode
                    ? '확인하고 시작'
                    : '프로젝트 추가'}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  )
}
