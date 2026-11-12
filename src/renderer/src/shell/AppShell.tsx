import { useId, useState } from 'react'
import { DecisionInbox } from '../decisions/DecisionInbox'
import { pendingCount } from '../decisions/decision-view'
import { useDecisions } from '../decisions/use-decisions'
import { OfficeView } from '../office/OfficeView'
import { OrgView } from '../org/OrgView'
import { initialPanelOpen, shouldCollapsePanel } from './panel-rules'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Tabs, type TabItem } from '../ui/Tabs'
import { ThemeToggle } from '../ui/ThemeToggle'

const SIDE_TABS: readonly (TabItem & { empty: string })[] = [
  { id: 'logs', label: '직원 로그', empty: '아직 일하는 직원이 없어요.' },
  { id: 'tickets', label: '티켓', empty: '아직 티켓이 없어요.' },
  { id: 'decisions', label: '결재함', empty: '' }
]

const MAIN_VIEWS: readonly TabItem[] = [
  { id: 'map', label: '사무실 맵' },
  { id: 'org', label: '조직도' }
]

/** 앱 셸. 사이드 패널 탭의 실제 내용은 후속 티켓에서 채우고, 여기서는 자리와 빈 상태만 둔다. */
export function AppShell({ companyName }: { companyName: string }): React.JSX.Element {
  const [panelOpen, setPanelOpen] = useState(() =>
    initialPanelOpen(window.matchMedia?.('(max-width: 899px)').matches ?? false)
  )
  const [tab, setTab] = useState(SIDE_TABS[0].id)
  const [view, setView] = useState(MAIN_VIEWS[0].id)
  const panelId = useId()
  const decisions = useDecisions()
  const pending = pendingCount(decisions.state)
  // 새 카드가 있으면 탭에도 개수를 붙여, 다른 탭을 보고 있어도 알아차리게 한다.
  const sideTabs = SIDE_TABS.map((t) =>
    t.id === 'decisions' && pending > 0 ? { ...t, extra: <Badge tone="warn">{pending}</Badge> } : t
  )
  const current = SIDE_TABS.find((t) => t.id === tab) ?? SIDE_TABS[0]

  return (
    <div className="app-shell">
      <header className="statusbar">
        <span className="statusbar__name">{companyName}</span>
        <span className="statusbar__usage">사용량: 아직 집계 전</span>
        <Badge tone={pending > 0 ? 'warn' : 'neutral'}>
          <span aria-live="polite">결재 {pending}</span>
        </Badge>
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
        <main className="map-area" aria-label="메인 화면">
          <Tabs
            label="화면 선택"
            tabs={MAIN_VIEWS}
            selectedId={view}
            onSelect={(id) => {
              const narrow = window.matchMedia?.('(max-width: 899px)').matches ?? false
              // 좁은 화면에서는 하단 시트가 조직도를 가리므로 접는다 (버튼으로 다시 열 수 있다).
              if (shouldCollapsePanel(view, id, narrow)) setPanelOpen(false)
              setView(id)
            }}
          >
            {view === 'org' ? <OrgView /> : <OfficeView />}
          </Tabs>
        </main>
        <aside className="side-panel" id={panelId} hidden={!panelOpen} aria-label="업무 패널">
          <Tabs label="업무 종류" tabs={sideTabs} selectedId={tab} onSelect={setTab}>
            {tab === 'decisions' ? (
              <DecisionInbox {...decisions} />
            ) : (
              <p className="empty-state">{current.empty}</p>
            )}
          </Tabs>
        </aside>
      </div>
    </div>
  )
}
