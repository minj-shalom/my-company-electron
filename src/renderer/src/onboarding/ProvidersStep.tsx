import { useState } from 'react'
import { ProviderCard } from './ProviderCard'
import { OS_LABELS, PROVIDER_GUIDES, guessOs, type OsKind } from './provider-guide'
import { useDetection } from './use-detection'

export function ProvidersStep(): React.JSX.Element {
  const { status, refresh } = useDetection()
  const [os, setOs] = useState<OsKind>(() => guessOs(navigator.userAgent))

  return (
    <div>
      <p>
        AI를 쓰려면 컴퓨터에 AI 프로그램(CLI)이 설치되어 있고 로그인되어 있어야 해요. 쓰고 싶은 AI만
        설정해도 괜찮아요. 하나 이상 연결하면 시작할 수 있어요.
      </p>
      <fieldset className="os-select">
        <legend>내 컴퓨터</legend>
        {(Object.keys(OS_LABELS) as OsKind[]).map((k) => (
          <label key={k}>
            <input type="radio" name="os" value={k} checked={os === k} onChange={() => setOs(k)} />
            {OS_LABELS[k]}
          </label>
        ))}
      </fieldset>
      <div className="toolbar">
        <button type="button" onClick={refresh} disabled={status.kind === 'loading'}>
          다시 확인
        </button>
        <span role="status" aria-live="polite">
          {status.kind === 'loading' && '설치 상태를 확인하고 있어요…'}
        </span>
      </div>
      {status.kind === 'error' && (
        <p role="alert" className="error">
          {status.message}
        </p>
      )}
      {PROVIDER_GUIDES.map((g) => (
        <ProviderCard
          key={g.id}
          guide={g}
          os={os}
          detection={
            status.kind === 'ready' ? (status.items.find((d) => d.provider === g.id) ?? null) : null
          }
          detectionLoading={status.kind === 'loading'}
        />
      ))}
    </div>
  )
}
