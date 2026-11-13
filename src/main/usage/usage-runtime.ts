import type { ProviderCliId } from '../../shared/provider'
import type { CompanyContext } from '../company/company-context'
import { createFileGateCards } from '../gate/gate-cards'
import type { ProviderUsage } from '../providers/types'
import { sharedRepository } from '../repository/shared-repository'
import { createWeeklyLimitsStore } from '../settings/weekly-limits-store'
import { createUsageAlertLog } from './usage-alerts'
import type { UsageAttribution } from './usage-record'
import { createUsageSettingsStore } from './usage-settings-store'
import { UsageService } from './usage-service'
import { createUsageStore } from './usage-store'

export interface UsageRuntimeDeps {
  context: CompanyContext
  userDataDir: string
}

/** 열린 회사 하나에 묶인 서비스. 회사가 열려 있지 않으면 `requireOpenCompany`가 던진다. */
export function usageServiceFor(deps: UsageRuntimeDeps): UsageService {
  const { fs } = deps.context.requireOpenCompany()
  const repo = sharedRepository(fs)
  return new UsageService({
    root: fs.root,
    store: createUsageStore(fs),
    alerts: createUsageAlertLog(fs),
    cards: createFileGateCards({ fs, exclusive: (t) => repo.runExclusive(t) }),
    limits: createWeeklyLimitsStore(deps.userDataDir),
    settings: createUsageSettingsStore(deps.userDataDir)
  })
}

/**
 * 어댑터의 `onUsage`에 연결하는 기록 함수. 기록 실패(회사 없음, 디스크 오류)가 실행을 깨지 않도록 삼킨다.
 * 회사가 어댑터를 만든 뒤 바뀌었어도 기록은 호출 시점의 열린 회사에 남는다 (실행은 한 번에 한 회사만 한다).
 */
export function usageRecorder(
  deps: UsageRuntimeDeps,
  provider: ProviderCliId,
  attribution: Partial<UsageAttribution>
): (runId: string, usage: ProviderUsage) => void {
  return (_runId, usage) => {
    try {
      void usageServiceFor(deps)
        .record(provider, usage, attribution)
        .catch(() => undefined)
    } catch {
      // 열린 회사가 없으면 기록할 곳이 없다.
    }
  }
}
