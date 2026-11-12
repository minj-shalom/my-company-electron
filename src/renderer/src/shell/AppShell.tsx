import { useId, useState } from 'react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { Tabs, type TabItem } from '../ui/Tabs'
import { ThemeToggle } from '../ui/ThemeToggle'

const SIDE_TABS: readonly (TabItem & { empty: string })[] = [
  { id: 'logs', label: '직원 로그', empty: '아직 일하는 직원이 없어요.' },
  { id: 'tickets', label: '티켓', empty: '아직 티켓이 없어요.' },
  { id: 'decisions', label: '결재함', empty: '결재를 기다리는 일이 없어요.' }
]

/** 앱 셸. 맵(T-020)과 각 탭의 실제 내용은 후속 티켓에서 채우고, 여기서는 자리와 빈 상태만 둔다. */
export function AppShell({ companyName }: { companyName: string }): React.JSX.Element {
  const [panelOpen, setPanelOpen] = useState(true)
  const [tab, setTab] = useState(SIDE_TABS[0].id)
  const panelId = useId()
  const current = SIDE_TABS.find((t) => t.id === tab) ?? SIDE_TABS[0]

  return (
    <div className="app-shell">
      <header className="statusbar">
        <span className="statusbar__name">{companyName}</span>
        <span className="statusbar__usage">사용량: 아직 집계 전</span>
        <Badge>결재 0</Badge>
        <ThemeToggle />
        <Button
          size="small"
          aria-expanded={panelOpen}
          aria-controls={panelId}
          onClick={() => setPanelOpen((v) => !v)}
        >
          {panelOpen ? '패널 접기' : '패널 열기'}
        </Button>
      </header>
      <div className="shell__body" data-panel={panelOpen ? 'open' : 'closed'}>
        <main className="map-area" aria-label="사무실 맵">
          <div className="map-area__note">
            <Panel title="사무실 맵">
              <p className="hint">가상 사무실이 들어올 자리예요. 곧 만나요.</p>
            </Panel>
          </div>
        </main>
        <aside className="side-panel" id={panelId} hidden={!panelOpen} aria-label="업무 패널">
          <Tabs label="업무 종류" tabs={SIDE_TABS} selectedId={tab} onSelect={setTab}>
            <p className="empty-state">{current.empty}</p>
          </Tabs>
        </aside>
      </div>
    </div>
  )
}
