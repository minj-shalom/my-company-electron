import { useEffect, useRef, useState } from 'react'
import { MAX_PROFILE_BODY_BYTES, type CompanyProfile } from '../../../shared/company-profile'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Panel } from '../ui/Panel'
import { MAX_NAME_LENGTH, bodyUsage, isDirty, toDraft, validateDraft } from './profile-model'
import { useCompanyProfile } from './use-company-profile'

type Message = { kind: 'ok' | 'error'; text: string } | null

/**
 * 회사 정보 폼 (이름, 비전, 미션, 운영 원칙). 원본은 회사 폴더의 마크다운이고 여기서는 평문으로만 편집한다.
 * 상태: 로딩, 오류(다시 시도), 정상(변경 없음/있음, 저장 중, 성공, 오류, 충돌).
 */
export function CompanyProfileSection({
  onDirtyChange,
  onNameSaved
}: {
  onDirtyChange: (dirty: boolean) => void
  onNameSaved: (name: string) => void
}): React.JSX.Element {
  const { load, reload } = useCompanyProfile()
  return (
    <Panel title="회사 정보">
      {load.kind === 'loading' && (
        <p role="status" aria-live="polite" className="hint">
          회사 정보를 불러오고 있어요…
        </p>
      )}
      {load.kind === 'error' && (
        <>
          <p role="alert" className="error">
            {load.message}
          </p>
          {!load.noCompany && <Button onClick={reload}>다시 시도</Button>}
        </>
      )}
      {load.kind === 'ready' && (
        <ProfileForm
          key={load.profile.revision}
          profile={load.profile}
          onReload={reload}
          onDirtyChange={onDirtyChange}
          onNameSaved={onNameSaved}
        />
      )}
    </Panel>
  )
}

function ProfileForm({
  profile,
  onReload,
  onDirtyChange,
  onNameSaved
}: {
  profile: CompanyProfile
  onReload: () => void
  onDirtyChange: (dirty: boolean) => void
  onNameSaved: (name: string) => void
}): React.JSX.Element {
  // 저장에 성공하면 main이 돌려준 값을 기준선으로 삼는다 (revision이 바뀌므로 key로 다시 마운트하지 않고 상태로 갱신).
  const [saved, setSaved] = useState(profile)
  const [draft, setDraft] = useState(toDraft(profile))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const [conflict, setConflict] = useState(false)
  const [fieldError, setFieldError] = useState<{ field: 'name' | 'body'; message: string } | null>(
    null
  )
  const nameRef = useRef<HTMLInputElement>(null)
  const visionRef = useRef<HTMLTextAreaElement>(null)
  const dirty = isDirty(draft, toDraft(saved))

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  // 저장하지 않은 변경이 있는 채 창을 닫거나 새로고침하면 브라우저/앱이 확인을 띄운다.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent): void => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const edit = (patch: Partial<typeof draft>): void => {
    setDraft((d) => ({ ...d, ...patch }))
    setMessage(null)
    setFieldError(null)
  }

  const submit = async (e: React.SyntheticEvent): Promise<void> => {
    e.preventDefault()
    const invalid = validateDraft(draft)
    setFieldError(invalid)
    if (invalid) {
      if (invalid.field === 'name') nameRef.current?.focus()
      else visionRef.current?.focus()
      return
    }
    setSaving(true)
    setMessage(null)
    try {
      const r = await window.api.saveCompanyProfile({
        ...draft,
        name: draft.name.trim(),
        revision: saved.revision
      })
      if (r.ok) {
        setSaved(r.value)
        setDraft(toDraft(r.value))
        setConflict(false)
        setMessage({ kind: 'ok', text: '저장했어요. 이제 COO가 이 내용을 기준으로 일해요.' })
        onNameSaved(r.value.name)
      } else if (r.code === 'conflict') {
        setConflict(true)
        setMessage({
          kind: 'error',
          text: '다른 곳에서 회사 정보가 바뀌었어요. 새로 불러오면 지금 입력한 내용은 사라져요.'
        })
      } else if (r.code === 'invalid-request') {
        setMessage({ kind: 'error', text: r.message })
      } else {
        setMessage({ kind: 'error', text: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' })
      }
    } catch {
      setMessage({ kind: 'error', text: '저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.' })
    } finally {
      setSaving(false)
    }
  }

  const empty = !profile.vision && !profile.mission && !profile.principles
  const areas = [
    {
      key: 'vision',
      id: 'profile-vision',
      label: '비전',
      hint: '회사가 앞으로 이루려는 모습이에요.'
    },
    {
      key: 'mission',
      id: 'profile-mission',
      label: '미션',
      hint: '회사가 지금 하는 일과 이유예요.'
    },
    {
      key: 'principles',
      id: 'profile-principles',
      label: '운영 원칙',
      hint: '회사 전체가 일하는 방식이에요. 회사 운영 원칙과 프로젝트 정책이 충돌하면 앱 불변 안전 규칙이 우선해요.'
    }
  ] as const

  return (
    <form onSubmit={submit} noValidate>
      {empty && (
        <p className="hint">
          아직 비전, 미션, 운영 원칙이 비어 있어요. 적어 두면 COO가 이 내용을 기준으로 일해요.
        </p>
      )}
      <div className="field">
        <label htmlFor="profile-name">회사 이름</label>
        <Input
          ref={nameRef}
          id="profile-name"
          type="text"
          autoComplete="off"
          maxLength={MAX_NAME_LENGTH * 2}
          value={draft.name}
          aria-invalid={fieldError?.field === 'name' ? true : undefined}
          aria-describedby="profile-name-hint"
          onChange={(e) => edit({ name: e.target.value })}
        />
        <p className="hint" id="profile-name-hint">
          {draft.name.trim().length}/{MAX_NAME_LENGTH}자. 화면에 보이는 이름이에요. 회사 폴더 이름과
          다를 수 있고, 여기서 바꿔도 폴더 이름은 그대로예요.
        </p>
        {fieldError?.field === 'name' && (
          <p role="alert" className="error">
            {fieldError.message}
          </p>
        )}
      </div>
      {areas.map((a) => (
        <div className="field" key={a.key}>
          <label htmlFor={a.id}>{a.label}</label>
          <textarea
            ref={a.key === 'vision' ? visionRef : undefined}
            id={a.id}
            className="input profile-textarea"
            rows={a.key === 'principles' ? 7 : 4}
            value={draft[a.key]}
            aria-invalid={fieldError?.field === 'body' ? true : undefined}
            aria-describedby={`${a.id}-hint`}
            onChange={(e) => edit({ [a.key]: e.target.value })}
          />
          <p className="hint" id={`${a.id}-hint`}>
            {a.hint}
          </p>
        </div>
      ))}
      <p className="hint" aria-live="off">
        비전, 미션, 운영 원칙 합계 {bodyUsage(draft)} (최대 {MAX_PROFILE_BODY_BYTES / 1024}KB). 글자
        모양 없이 그대로 저장돼요.
      </p>
      {fieldError?.field === 'body' && (
        <p role="alert" className="error">
          {fieldError.message}
        </p>
      )}
      <div className="toolbar">
        <Button type="submit" variant="primary" disabled={saving || !dirty}>
          {saving ? '저장 중…' : '저장'}
        </Button>
        {dirty && <span className="hint profile-dirty">저장하지 않은 변경이 있어요</span>}
        {conflict && (
          <Button onClick={onReload} disabled={saving}>
            새로 불러오기
          </Button>
        )}
      </div>
      <div role="status" aria-live="polite">
        {message?.kind === 'ok' && <p className="hint">{message.text}</p>}
      </div>
      {message?.kind === 'error' && (
        <p role="alert" className="error">
          {message.text}
        </p>
      )}
    </form>
  )
}
