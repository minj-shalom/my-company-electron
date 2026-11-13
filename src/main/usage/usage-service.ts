import type { ProviderCliId } from '../../shared/provider'
import type { UsageWidgetData } from '../../shared/usage'
import type { GateCards } from '../gate/gate-cards'
import type { ProviderUsage } from '../providers/types'
import type { WeeklyLimitsStore } from '../settings/weekly-limits-store'
import type { LimitCheck } from '../tick/tick-types'
import { buildWidgetData } from './usage-aggregate'
import type { AlertLevel, UsageAlertLog } from './usage-alerts'
import { buildUsageRecord, type UsageAttribution } from './usage-record'
import type { UsageSettingsStore } from './usage-settings-store'
import { serialFor, type UsageStore } from './usage-store'
import { weekWindow } from './usage-window'

export interface UsageServiceDeps {
  root: string
  store: UsageStore
  alerts: UsageAlertLog
  cards: GateCards
  limits: WeeklyLimitsStore
  settings: UsageSettingsStore
  now?: () => Date
}

const LABEL: Record<ProviderCliId, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' }

export class UsageService {
  constructor(private readonly deps: UsageServiceDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /**
   * 실행 결과의 사용량 한 건을 기록하고 경고 기준을 점검한다. 실행을 막지 않도록 호출 측은 실패를 삼킨다.
   * 사용량 숫자가 하나도 없는 이벤트(비용·토큰 모두 null)도 요청 한 건으로 센다.
   */
  async record(
    provider: ProviderCliId,
    usage: ProviderUsage,
    attribution: Partial<UsageAttribution>
  ): Promise<void> {
    const at = this.now()
    await this.deps.store.append(buildUsageRecord(provider, usage, attribution, at))
    await this.ensureAlert(provider, at)
  }

  widget(): Promise<UsageWidgetData> {
    return this.widgetAt(this.now())
  }

  /**
   * 틱 실행 전 점검: 이번 틱에서 쓸 제공자 중 100%에 도달한 것이 있을 때만 막는다. 다른 제공자 실행은 막지 않는다.
   * 경고 기준(80%) 도달은 카드로만 알린다. 기록 없이 한도만 낮춰 초과가 된 경우에도 카드가 남도록 여기서도 카드를 보장한다.
   */
  async checkLimit(providers: readonly ProviderCliId[]): Promise<LimitCheck> {
    const data = await this.widget()
    const hit = data.providers.find(
      (p) => providers.includes(p.provider) && p.status === 'exceeded'
    )
    if (hit === undefined) return { ok: true, reason: '' }
    await this.ensureAlert(hit.provider, this.now()).catch(() => undefined)
    return {
      ok: false,
      cardHandled: true,
      reason: `${LABEL[hit.provider]} 주간 사용량이 한도의 ${Math.floor(hit.percent ?? 100)}%에 도달했습니다.`
    }
  }

  private ensureAlert(provider: ProviderCliId, at: Date): Promise<void> {
    // 기록이 연달아 들어와도 같은 구간에서 카드가 두 번 만들어지지 않게 한 줄로 세운다.
    return serialFor(`${this.deps.root}#alerts`, async () => {
      const data = await this.widgetAt(at)
      const view = data.providers.find((p) => p.provider === provider)
      if (view === undefined || (view.status !== 'warn' && view.status !== 'exceeded')) return
      const level: AlertLevel = view.status
      if (await this.deps.alerts.has(provider, data.windowStart, level)) return
      const pct = Math.floor(view.percent ?? 0)
      const estimate = view.estimated ? ' (사용자 입력 기준값 대비 추정치)' : ''
      const exceeded = level === 'exceeded'
      await this.deps.cards.create({
        kind: 'decision',
        title: `${LABEL[provider]} 주간 사용량 ${pct}% 도달`,
        ticketId: null,
        question: exceeded
          ? `${LABEL[provider]} 주간 한도의 ${pct}%를 사용했습니다${estimate}. 이 제공자를 쓰는 자동 실행(틱)은 한도가 초기화되는 ${data.windowEnd} 까지 멈춥니다.`
          : `${LABEL[provider]} 주간 한도의 ${pct}%를 사용했습니다${estimate}. 경고 기준은 ${data.settings.warnPercent}%이며 실행은 계속됩니다.`,
        options: exceeded
          ? [
              {
                key: 'A',
                label: '확인 (구간 끝까지 대기)',
                description: '한도가 초기화될 때까지 이 제공자의 자동 실행을 멈춘 채로 둡니다.'
              },
              {
                key: 'B',
                label: '한도 올리기',
                description: '설정에서 주간 한도를 올리면 다음 틱부터 재개됩니다.'
              }
            ]
          : [
              { key: 'A', label: '계속 진행', description: '지금처럼 작업을 이어 갑니다.' },
              {
                key: 'B',
                label: '사용량 줄이기',
                description: '자동 실행을 줄이거나 한도를 조정하도록 직접 지시합니다.'
              }
            ],
        impact: `주간 구간 시작 ${data.windowStart} 이후의 합계입니다. 같은 구간에서는 이 단계의 카드를 다시 만들지 않습니다.`,
        reason: '사용량이 경고 기준에 도달해 CFO가 사람의 확인을 요청했습니다.'
      })
      // 카드 생성 직후 표시한다. 두 단계 사이에 앱이 종료되면 다음 점검에서 카드가 한 번 더 생길 수 있다(알림 누락보다 중복을 택함).
      await this.deps.alerts.mark(provider, data.windowStart, level)
    })
  }

  private async widgetAt(at: Date): Promise<UsageWidgetData> {
    const settings = await this.deps.settings.load()
    const w = weekWindow(at, settings)
    const [records, limits] = await Promise.all([
      this.deps.store.readWindow(w),
      this.deps.limits.load()
    ])
    return buildWidgetData(records, limits, settings, w)
  }
}
