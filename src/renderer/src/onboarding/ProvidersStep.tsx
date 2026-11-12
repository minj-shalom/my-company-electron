import { useState } from 'react'
import type { ProviderCliId, ProviderDetection } from '../../../shared/provider'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Tabs, type TabItem } from '../ui/Tabs'
import { providerBadge } from './detection-view'
import { ProviderCard } from './ProviderCard'
import { OS_LABELS, PROVIDER_GUIDES, guessOs, type OsKind } from './provider-guide'
import { useDetection } from './use-detection'

export function ProvidersStep(): React.JSX.Element {
  const { status, refresh } = useDetection()
  const [selected, setSelected] = useState<ProviderCliId>(PROVIDER_GUIDES[0].id)
  const [os, setOs] = useState<OsKind>(() => guessOs(navigator.userAgent))

  const loading = status.kind === 'loading'
  const detectionOf = (id: ProviderCliId): ProviderDetection | null =>
    status.kind === 'ready' ? (status.items.find((d) => d.provider === id) ?? null) : null
  const guide = PROVIDER_GUIDES.find((g) => g.id === selected) ?? PROVIDER_GUIDES[0]
  // 탭마다 상태를 보여 줘서 다른 AI를 열어 보지 않고도 어디가 남았는지 알 수 있다.
  const tabs: TabItem[] = PROVIDER_GUIDES.map((g) => {
    const b = providerBadge(detectionOf(g.id), loading, false)
    return {
      id: g.id,
      label: g.name,
      extra: (
        <Badge tone={b.tone} compact>
          {b.label}
        </Badge>
      )
    }
  })

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
        <Button onClick={refresh} disabled={status.kind === 'loading'}>
          다시 확인
        </Button>
        <span role="status" aria-live="polite">
          {status.kind === 'loading' && '설치 상태를 확인하고 있어요…'}
        </span>
      </div>
      {status.kind === 'error' && (
        <p role="alert" className="error">
          {status.message}
        </p>
      )}
      <Tabs
        label="AI 선택"
        tabs={tabs}
        selectedId={selected}
        onSelect={(id) => setSelected(id as ProviderCliId)}
      >
        <ProviderCard
          key={guide.id}
          guide={guide}
          os={os}
          detection={detectionOf(guide.id)}
          detectionLoading={loading}
        />
      </Tabs>
    </div>
  )
}
