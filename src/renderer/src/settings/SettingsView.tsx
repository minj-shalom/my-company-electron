import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import { BreakdownSection } from './BreakdownSection'
import { CompanyProfileSection } from './CompanyProfileSection'
import { LimitsSection } from './LimitsSection'
import { PrefsSection } from './PrefsSection'
import { ProvidersSection } from './ProvidersSection'
import { ThemeSection } from './ThemeSection'
import { UsageSection } from './UsageSection'
import { useSettings } from './use-settings'

/** 설정·예산 화면. 상태: 로딩, 오류(다시 시도), 정상. 사용량이 비어 있어도 설정 입력은 쓸 수 있다. */
export function SettingsView({
  onProfileDirtyChange = () => undefined,
  onCompanyNameSaved = () => undefined
}: {
  onProfileDirtyChange?: (dirty: boolean) => void
  onCompanyNameSaved?: (name: string) => void
}): React.JSX.Element {
  const { load, reload, detection, recheck } = useSettings()
  return (
    <section className="settings" aria-labelledby="settings-heading">
      <div className="org__head">
        <h2 id="settings-heading" tabIndex={-1}>
          설정·예산
        </h2>
        <Button size="small" onClick={reload} disabled={load.kind === 'loading'}>
          다시 불러오기
        </Button>
      </div>
      <div
        role="status"
        aria-live="polite"
        className={load.kind === 'loading' ? 'hint' : 'visually-hidden'}
      >
        {load.kind === 'loading' && '설정과 사용량을 불러오고 있어요…'}
      </div>
      <div className="settings__profile">
        <CompanyProfileSection
          onDirtyChange={onProfileDirtyChange}
          onNameSaved={onCompanyNameSaved}
        />
      </div>
      {load.kind === 'error' && (
        <Panel>
          <p role="alert" className="error">
            {load.message}
          </p>
          <Button onClick={reload}>다시 시도</Button>
        </Panel>
      )}
      {load.kind === 'ready' && (
        <div className="settings__grid">
          <UsageSection widget={load.data.widget} />
          <BreakdownSection widget={load.data.widget} names={load.data.names} />
          {/* key: 불러오기에 실패했다가 성공하면 입력 초기값을 다시 잡는다. 저장 직후에는 입력과 안내 문구를 유지한다. */}
          <LimitsSection
            key={load.data.limits === null ? 'none' : 'loaded'}
            limits={load.data.limits}
            onSaved={reload}
          />
          <PrefsSection settings={load.data.widget.settings} onSaved={reload} />
          <ProvidersSection
            key={load.data.selection === null ? 'none' : 'loaded'}
            selection={load.data.selection}
            detection={detection}
            onRecheck={recheck}
            onSaved={reload}
          />
          <ThemeSection />
        </div>
      )}
    </section>
  )
}
