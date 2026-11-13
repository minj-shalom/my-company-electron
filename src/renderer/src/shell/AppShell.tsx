import { useEffect, useId, useRef, useState } from 'react'
import { DecisionInbox } from '../decisions/DecisionInbox'
import { pendingCount } from '../decisions/decision-view'
import { useDecisions } from '../decisions/use-decisions'
import { KillSwitchControl } from '../gate/KillSwitchControl'
import { useAuditSummary } from '../gate/use-audit-summary'
import { useKillSwitch } from '../gate/use-kill-switch'
import { usePolicySummaries } from '../policy/use-policy'
import { FirstHireScreen } from '../hire/FirstHireScreen'
import { OfficeView } from '../office/OfficeView'
import { OrgView } from '../org/OrgView'
import { ProjectFilter } from '../projects/ProjectFilter'
import { ProjectsView } from '../projects/ProjectsView'
import { pmRequiredCount, resolveCurrent } from '../projects/project-model'
import { useProjects } from '../projects/use-projects'
import { SettingsView } from '../settings/SettingsView'
import { ProjectStatusView } from '../status/ProjectStatusView'
import { buildStatusView } from '../status/status-model'
import { RunLogView } from '../runs/RunLogView'
import { useRunLog } from '../runs/use-run-log'
import { TicketBoard } from '../tickets/TicketBoard'
import { useTickets } from '../tickets/use-tickets'
import { initialPanelOpen, shouldCollapsePanel } from './panel-rules'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Tabs, type TabItem } from '../ui/Tabs'
import { ThemeToggle } from '../ui/ThemeToggle'

const SIDE_TABS: readonly TabItem[] = [
  { id: 'logs', label: '직원 로그' },
  { id: 'tickets', label: '티켓' },
  { id: 'decisions', label: '결재함' }
]

const MAIN_VIEWS: readonly TabItem[] = [
  { id: 'map', label: '사무실 맵' },
  { id: 'org', label: '인사 관리' },
  { id: 'projects', label: '프로젝트' },
  { id: 'status', label: '현황' },
  { id: 'settings', label: '설정·예산' }
]

/** 앱 셸. 사이드 패널 탭: 직원 로그(실행 이벤트), 티켓 보드, 결재함. */
export function AppShell({
  companyName,
  initialFirstHire = false
}: {
  companyName: string
  /** 온보딩 직후처럼 첫 채용 화면을 먼저 보여 줄지. */
  initialFirstHire?: boolean
}): React.JSX.Element {
  const [hiring, setHiring] = useState(initialFirstHire)
  const returnFocus = useRef(false)
  const closeHiring = (): void => {
    setHiring(false)
    returnFocus.current = true
  }
  // 채용 화면을 닫으면 열었던 CTA(없으면 화면 제목)로 포커스를 돌려 키보드 위치를 잃지 않게 한다.
  useEffect(() => {
    if (!hiring && returnFocus.current) {
      returnFocus.current = false
      document
        .querySelector<HTMLElement>('[data-first-hire-cta], #office-heading, #org-heading')
        ?.focus()
    }
  }, [hiring])
  // 채용 화면을 닫으면 사무실·조직도가 다시 마운트되어 새 조직을 읽는다.
  const [panelOpen, setPanelOpen] = useState(() =>
    initialPanelOpen(window.matchMedia?.('(max-width: 899px)').matches ?? false)
  )
  const [tab, setTab] = useState(SIDE_TABS[0].id)
  const [view, setView] = useState(MAIN_VIEWS[0].id)
  const panelId = useId()
  const decisions = useDecisions()
  const tickets = useTickets()
  const runLog = useRunLog()
  const projects = useProjects()
  const ks = useKillSwitch()
  const audit = useAuditSummary()
  const policies = usePolicySummaries()
  const autoProjectCount = [...policies.byId.values()].filter(
    (p) => p.autoActions.length > 0
  ).length
  // 현재 프로젝트는 보기 필터일 뿐이라 저장하지 않는다. null = 전체, '' = 회사 공통.
  // 보관 등으로 사라지면 전체로 돌아간다. 티켓 보드의 프로젝트 칩과 이 값을 공유한다.
  const [currentProject, setCurrentProject] = useState<string | null>(null)
  const projectItems = projects.load.kind === 'ready' ? projects.load.list.items : []
  const scope = currentProject === '' ? '' : resolveCurrent(currentProject, projectItems)
  const currentId = scope === '' ? null : scope
  const statusView = buildStatusView(tickets.state, projects.load, decisions.state)
  const goAssignPm = (): void => {
    setHiring(false)
    setView('projects')
  }
  const needPm = pmRequiredCount(projectItems)
  const mainViews = MAIN_VIEWS.map((v) =>
    v.id === 'projects' && needPm > 0
      ? { ...v, extra: <Badge tone="warn">PM 필요 {needPm}</Badge> }
      : v
  )
  const pending = pendingCount(decisions.state)
  // 새 카드가 있으면 탭에도 개수를 붙여, 다른 탭을 보고 있어도 알아차리게 한다.
  const sideTabs = SIDE_TABS.map((t) =>
    t.id === 'decisions' && pending > 0 ? { ...t, extra: <Badge tone="warn">{pending}</Badge> } : t
  )

  return (
    <div className="app-shell">
      <header className="statusbar">
        <span className="statusbar__name">{companyName}</span>
        <span className="statusbar__usage">사용량: 아직 집계 전</span>
        <Badge tone={pending > 0 ? 'warn' : 'neutral'}>
          <span aria-live="polite">결재 {pending}</span>
        </Badge>
        <KillSwitchControl ks={ks} autoProjectCount={autoProjectCount} />
        <ProjectFilter items={projectItems} value={scope} onChange={setCurrentProject} />
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
      <div
        className="shell__body"
        data-panel={panelOpen ? 'open' : 'closed'}
        data-wide={tab === 'tickets'}
      >
        <main className="map-area" aria-label="메인 화면">
          <Tabs
            label="화면 선택"
            tabs={mainViews}
            selectedId={view}
            onSelect={(id) => {
              const narrow = window.matchMedia?.('(max-width: 899px)').matches ?? false
              // 좁은 화면에서는 하단 시트가 조직도를 가리므로 접는다 (버튼으로 다시 열 수 있다).
              if (shouldCollapsePanel(view, id, narrow)) setPanelOpen(false)
              setHiring(false)
              setView(id)
            }}
          >
            {hiring ? (
              <FirstHireScreen onClose={closeHiring} />
            ) : view === 'settings' ? (
              <SettingsView />
            ) : view === 'status' ? (
              <ProjectStatusView
                view={statusView}
                current={scope}
                onRetry={() => {
                  void tickets.refresh({ force: true })
                  projects.reload()
                }}
                onAssignPm={goAssignPm}
                onViewTickets={(next) => {
                  setCurrentProject(next)
                  setTab('tickets')
                  setPanelOpen(true)
                }}
              />
            ) : view === 'projects' ? (
              <ProjectsView
                {...projects}
                currentId={currentId}
                gate={{ ks, audit: audit.load, onReload: audit.reload }}
              />
            ) : view === 'org' ? (
              <OrgView onFirstHire={() => setHiring(true)} />
            ) : (
              <OfficeView
                onFirstHire={() => setHiring(true)}
                onOpenLog={() => {
                  setTab('logs')
                  setPanelOpen(true)
                }}
              />
            )}
          </Tabs>
        </main>
        <aside className="side-panel" id={panelId} hidden={!panelOpen} aria-label="업무 패널">
          <Tabs label="업무 종류" tabs={sideTabs} selectedId={tab} onSelect={setTab}>
            {tab === 'decisions' ? (
              <DecisionInbox {...decisions} />
            ) : tab === 'tickets' ? (
              <TicketBoard
                {...tickets}
                onAssignPm={goAssignPm}
                projects={projects.load.kind === 'ready' ? projectItems : null}
                scope={scope}
                onScopeChange={setCurrentProject}
              />
            ) : (
              <RunLogView {...runLog} />
            )}
          </Tabs>
        </aside>
      </div>
    </div>
  )
}
