import type { UsageWidgetData } from '../../../shared/usage'
import { Badge } from '../ui/Badge'
import { Panel } from '../ui/Panel'
import { PROVIDER_NAMES } from './limit-wording'
import { formatReset, formatWindow, usageRow } from './settings-model'

/** 사용량 현황. 제공자별 막대와 숫자. 알 수 없음/한도 미설정은 막대 대신 안내를 보여 준다. */
export function UsageSection({ widget }: { widget: UsageWidgetData }): React.JSX.Element {
  const { settings } = widget
  return (
    <Panel title="이번 주 사용량">
      <p className="hint">
        {formatWindow(widget.windowStart, widget.windowEnd)} · {formatReset(settings)}에 초기화돼요.
        경고 기준은 {settings.warnPercent}%예요.
      </p>
      {widget.providers.length === 0 ? (
        <p className="empty-state">
          아직 기록된 사용량이 없어요. AI 직원이 일을 시작하면 여기에 보여요.
        </p>
      ) : (
        <ul className="usage-list" aria-label="제공자별 사용량">
          {widget.providers.map((p) => {
            const row = usageRow(p, settings.krwPerUsd)
            const name = PROVIDER_NAMES[p.provider]
            return (
              <li key={p.provider} className="usage-item" data-tone={row.tone}>
                <div className="usage-item__head">
                  <strong>{name}</strong>
                  <Badge tone={row.tone}>{row.statusText}</Badge>
                  <span className="usage-item__percent">{row.percentText}</span>
                </div>
                {row.barPercent !== null ? (
                  <div
                    className="usage-bar"
                    role="progressbar"
                    aria-label={`${name} 사용률`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(row.barPercent)}
                    aria-valuetext={row.percentText}
                  >
                    <div className="usage-bar__fill" style={{ width: `${row.barPercent}%` }} />
                    <span
                      className="usage-bar__mark"
                      style={{ left: `${settings.warnPercent}%` }}
                      aria-hidden="true"
                    />
                  </div>
                ) : (
                  <div className="usage-bar usage-bar--empty" aria-hidden="true" />
                )}
                {row.note && <p className="hint">{row.note}</p>}
                <dl className="usage-metrics">
                  <dt>비용</dt>
                  <dd>{row.costText}</dd>
                  <dt>요청</dt>
                  <dd>{row.requestsText}</dd>
                  <dt>토큰</dt>
                  <dd>{row.tokensText}</dd>
                </dl>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
