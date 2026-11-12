import { useEffect, useId, useRef, useState } from 'react'
import { MAX_COMPANY_NAME_LENGTH } from '../../../shared/company-name'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Panel } from '../ui/Panel'
import { ThemeToggle } from '../ui/ThemeToggle'

export interface StartScreenProps {
  /** 마지막 회사 상태 안내. 폴더 이름만 받는다. */
  notice?: { reason: 'missing' | 'invalid'; name: string }
  /** 동작 실패 메시지 (사용자 문구). */
  error?: string
  /** 'name'이면 이름 입력과 오류를 연결한다. */
  errorField?: 'name'
  /** 재확인 결과 같은 중립 안내 (role=status). */
  info?: string
  busy: boolean
  onCreate: (name: string) => void
  onOpen: () => void
  onRecheck: () => void
}

const NOTICE_TEXT: Record<'missing' | 'invalid', string> = {
  missing: '회사 폴더를 찾을 수 없어요',
  invalid: '이 폴더는 더 이상 회사 폴더가 아니에요'
}

export function StartScreen({
  notice,
  error,
  errorField,
  info,
  busy,
  onCreate,
  onOpen,
  onRecheck
}: StartScreenProps): React.JSX.Element {
  const [name, setName] = useState('')
  const nameId = useId()
  const errorId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const nameError = error !== undefined && errorField === 'name'

  // 화면이 바뀌면(로딩 뒤 등장) 제목으로 포커스를 옮겨 스크린리더가 화면 전환을 알게 한다.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="onboarding start">
      <main className="wizard start__main" aria-busy={busy}>
        <div className="wizard__top">
          <h1 ref={headingRef} tabIndex={-1}>
            My Company 시작하기
          </h1>
          <ThemeToggle />
        </div>

        {notice && (
          <div className="start__notice" role="alert">
            <strong>{NOTICE_TEXT[notice.reason]}</strong>
            <p>
              마지막으로 열었던 회사 “{notice.name}”을(를) 열 수 없어요. 폴더를 제자리에 돌려놓고
              다시 확인하거나, 회사 폴더를 다시 골라 주세요. 기억해 둔 정보는 지우지 않았어요.
            </p>
          </div>
        )}
        {error && (
          <p className="error start__error" role="alert" id={errorId}>
            {error}
          </p>
        )}

        <div className="start__grid">
          <Panel title="새 회사 만들기">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                onCreate(name)
              }}
            >
              <div className="field">
                <label htmlFor={nameId}>회사 이름</label>
                <Input
                  id={nameId}
                  value={name}
                  maxLength={MAX_COMPANY_NAME_LENGTH}
                  autoComplete="off"
                  disabled={busy}
                  aria-invalid={nameError || undefined}
                  aria-describedby={nameError ? errorId : undefined}
                  onChange={(e) => setName(e.target.value)}
                />
                <p className="hint">이 이름으로 폴더가 만들어져요. 다음에 위치를 골라요.</p>
              </div>
              <Button type="submit" variant="primary" disabled={busy}>
                위치 고르고 만들기
              </Button>
            </form>
          </Panel>
          <Panel title="기존 회사 열기">
            <p>이미 만든 회사 폴더가 있으면 골라서 열어요. 폴더 안의 파일은 바꾸지 않아요.</p>
            <Button onClick={onOpen} disabled={busy}>
              회사 폴더 열기
            </Button>
          </Panel>
        </div>

        <p className="start__recheck">
          <Button size="small" onClick={onRecheck} disabled={busy}>
            마지막 회사 확인
          </Button>
          <span className="hint"> 마지막으로 열었던 회사를 다시 찾아봐요.</span>
        </p>
        <p className="start__info hint" role="status">
          {busy ? '처리 중이에요.' : (info ?? '')}
        </p>
      </main>
    </div>
  )
}
