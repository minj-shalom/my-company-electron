import { useState } from 'react'
import {
  PROVIDER_CLI_IDS,
  type ProviderCliId,
  type ProviderDetection
} from '../../../shared/provider'
import type { ProviderSelection } from '../../../shared/provider-selection'
import { connectionTestView, detectView, providerBadge } from '../onboarding/detection-view'
import type { DetectionStatus } from '../onboarding/use-detection'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { CONNECTION_TEST_WARNING, PROVIDER_NAMES } from './limit-wording'
import { EFFECTIVE_NOTE, setDefaultProvider } from './settings-model'

type TestState =
  | { kind: 'running' }
  | { kind: 'done'; label: string; help: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }
  | { kind: 'error' }

/** 회사 기본 제공자 선택, CLI 설치 상태, 사용자가 따로 누르는 연결 테스트. API 키 입력은 없다. */
export function ProvidersSection({
  selection,
  detection,
  onRecheck,
  onSaved
}: {
  /** null = 불러오지 못함. */
  selection: ProviderSelection | null
  detection: DetectionStatus
  onRecheck: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [current, setCurrent] = useState(selection?.defaultProvider ?? null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [tests, setTests] = useState<Partial<Record<ProviderCliId, TestState>>>({})
  const loading = detection.kind === 'loading'
  const found = (id: ProviderCliId): ProviderDetection | null =>
    detection.kind === 'ready' ? (detection.items.find((d) => d.provider === id) ?? null) : null

  const choose = async (id: ProviderCliId): Promise<void> => {
    setCurrent(id)
    const r = await setDefaultProvider(window.api, id)
    if (r.ok) {
      setCurrent(r.value.defaultProvider)
      setMessage({ kind: 'ok', text: `${PROVIDER_NAMES[id]}로 바꿨어요. ${EFFECTIVE_NOTE}` })
      onSaved()
    } else {
      setCurrent(selection?.defaultProvider ?? null)
      setMessage({
        kind: 'error',
        text: '바꾸지 못했어요. 설치 상태를 확인하고 다시 시도해 주세요.'
      })
    }
  }

  const runTest = async (id: ProviderCliId): Promise<void> => {
    setTests((t) => ({ ...t, [id]: { kind: 'running' } }))
    try {
      const r = await window.api.testProviderConnection(id)
      setTests((t) => ({
        ...t,
        [id]: r.ok ? { kind: 'done', ...connectionTestView(r.value.state) } : { kind: 'error' }
      }))
    } catch {
      setTests((t) => ({ ...t, [id]: { kind: 'error' } }))
    }
  }

  return (
    <Panel title="AI 제공자">
      {selection === null ? (
        <p role="alert" className="error">
          제공자 선택을 불러오지 못했어요. 화면 위의 다시 불러오기 버튼을 눌러 주세요.
        </p>
      ) : (
        <p className="hint">
          직원에게 따로 지정하지 않으면 여기서 고른 제공자를 써요. 직원별 지정은 인사 관리의 직원
          상세에서 바꿔요. {EFFECTIVE_NOTE}
        </p>
      )}
      {detection.kind === 'error' && (
        <p role="alert" className="error">
          {detection.message}
        </p>
      )}
      <div role="radiogroup" aria-label="회사 기본 제공자" className="provider-list">
        {PROVIDER_CLI_IDS.map((id) => {
          const d = found(id)
          const badge = providerBadge(d, loading)
          const t = tests[id]
          const notInstalled = d !== null && d.state !== 'ok'
          return (
            <div className="provider-item" key={id}>
              <label className="provider-item__choice">
                <input
                  type="radio"
                  name="default-provider"
                  checked={current === id}
                  disabled={selection === null}
                  onChange={() => void choose(id)}
                />
                <span>{PROVIDER_NAMES[id]}</span>
              </label>
              <Badge tone={badge.tone}>{badge.label}</Badge>
              <Button
                size="small"
                disabled={t?.kind === 'running'}
                aria-describedby="connection-test-warning"
                onClick={() => void runTest(id)}
              >
                {t?.kind === 'running' ? '테스트 중…' : '연결 테스트'}
              </Button>
              {notInstalled && (
                <p className="hint provider-item__note">
                  {detectView(d.state).help} 이 제공자를 고르면 다음 실행에서 다른 제공자로 바뀔 수
                  있어요.
                </p>
              )}
              <div role="status" aria-live="polite" className="provider-item__note">
                {t?.kind === 'done' && (
                  <p className="hint">
                    <Badge tone={t.tone}>{t.label}</Badge> {t.help}
                  </p>
                )}
                {t?.kind === 'error' && <p className="error">테스트를 하지 못했어요.</p>}
              </div>
            </div>
          )
        })}
      </div>
      <p className="hint" id="connection-test-warning">
        {CONNECTION_TEST_WARNING}
      </p>
      <div className="toolbar">
        <Button onClick={onRecheck} aria-disabled={loading} disabled={loading}>
          {loading ? '확인 중…' : 'CLI 연결 다시 확인'}
        </Button>
      </div>
      <p className="hint">설치와 버전만 확인해요. 로그인 정보는 읽지 않아요.</p>
      <div role="status" aria-live="polite">
        {message && <p className={message.kind === 'error' ? 'error' : 'hint'}>{message.text}</p>}
      </div>
    </Panel>
  )
}
