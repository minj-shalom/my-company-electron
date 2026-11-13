import type { PermissionDenial } from '../../shared/run'
import type { GateCards } from '../gate/gate-cards'
import type { SafeFs } from '../repository/safe-fs'
import { deriveAllowRule, revalidateRule } from './permission-rule'
import type { PermissionStore } from './permission-store'
import { addAllowRule } from './settings-local'
import { appendTicketBlocker } from './ticket-blocker'

export const APPROVE_KEY = 'A'
export const REJECT_KEY = 'B'
/** 한 틱이 만들 수 있는 권한 카드 수. 거부가 많아도 결정함이 넘치지 않게 한다. */
export const MAX_CARDS_PER_RUN = 3

export interface PermissionServiceDeps {
  fs: SafeFs
  cards: GateCards
  store: PermissionStore
  /** 티켓·카드 쓰기와 같은 직렬화 큐 (FileCompanyRepository.runExclusive). */
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
  now?: () => Date
}

export interface RaiseResult {
  cardIds: string[]
  /** 규칙으로 바꿀 수 없거나(보호 대상, 지원하지 않는 도구) 이미 요청된 거부의 수. */
  skipped: number
}

export type ResolveOutcome = 'allowed' | 'rejected' | 'failed' | 'ignored'

const oneLine = (v: string, max: number): string =>
  v.replace(/[\r\n\u2028\u2029]+/g, ' ').slice(0, max)

/**
 * 비대화형 실행에서 거부된 동작의 결정 카드화(T-017)와 승인 후 처리.
 * 허용 규칙은 `onResolved`가 사용자의 승인 선택(A)을 받은 뒤에만 쓴다. 이 서비스의 다른 경로는 규칙을 쓰지 않는다.
 */
export class PermissionService {
  constructor(private readonly deps: PermissionServiceDeps) {}

  private get companyKey(): string {
    return this.deps.fs.root
  }

  async raise(ticketId: string | null, denials: readonly PermissionDenial[]): Promise<RaiseResult> {
    const out: RaiseResult = { cardIds: [], skipped: 0 }
    const seen = new Set<string>()
    for (const d of denials) {
      const allow = await deriveAllowRule(d, this.companyKey)
      if (allow === null || seen.has(allow.rule)) {
        out.skipped++
        continue
      }
      seen.add(allow.rule)
      if (
        out.cardIds.length >= MAX_CARDS_PER_RUN ||
        (await this.deps.store.has(allow.rule, ticketId, this.companyKey))
      ) {
        out.skipped++
        continue
      }
      const id = await this.deps.cards.create({
        kind: 'permission',
        title: `권한 요청: ${oneLine(allow.summary, 60)}`,
        ticketId,
        question: `${ticketId ?? '회사 업무'} 실행 중 거부된 동작입니다. ${oneLine(allow.summary, 200)} 를 허용하고 다시 실행할까요?`,
        options: [
          {
            key: APPROVE_KEY,
            label: '허용하고 다시 실행',
            description: '이 동작만 로컬 설정의 허용 규칙에 추가하고 다음 틱에서 다시 실행합니다.'
          },
          {
            key: REJECT_KEY,
            label: '거절',
            description: '허용하지 않고 해당 티켓에 막힌 점으로 기록합니다.'
          }
        ],
        reason: '자동 실행은 허용되지 않은 동작을 멈추고 사람의 확인을 기다립니다.',
        impact:
          '승인하면 회사 폴더의 로컬 설정(.claude/settings.local.json)에 허용 규칙 한 줄이 추가됩니다.'
      })
      await this.deps.store.put(id, { rule: allow.rule, ticketId, companyKey: this.companyKey })
      out.cardIds.push(id)
    }
    return out
  }

  /** 권한 카드가 결정된 뒤 부른다. 앱 데이터에 기록된 요청이 없으면 아무것도 하지 않는다. */
  async onResolved(cardId: string, choice: string): Promise<ResolveOutcome> {
    if (choice !== APPROVE_KEY && choice !== REJECT_KEY) return 'ignored'
    const approve = choice === APPROVE_KEY
    const rec = await this.deps.store.take(
      cardId,
      this.companyKey,
      approve ? 'approved' : 'rejected'
    )
    if (rec === null) return 'ignored'
    if (approve) {
      // 저장된 값도 다시 검증한다: 규칙은 안전한 형태일 때만 쓴다.
      const ok = await revalidateRule(rec.rule, this.companyKey)
      const added =
        ok === null
          ? 'unreadable'
          : await this.deps.exclusive(() => addAllowRule(this.deps.fs, ok.rule))
      if (added === 'added' || added === 'exists') return 'allowed'
      await this.block(rec.ticketId, '허용 규칙을 추가하지 못해 이 동작은 여전히 막혀 있어요.')
      return 'failed'
    }
    await this.block(rec.ticketId, '필요한 동작의 권한 요청이 거절됐어요.')
    return 'rejected'
  }

  private async block(ticketId: string | null, text: string): Promise<void> {
    if (ticketId === null) return
    const date = (this.deps.now?.() ?? new Date()).toISOString().slice(0, 10)
    await this.deps
      .exclusive(() => appendTicketBlocker(this.deps.fs, ticketId, text, date))
      .catch(() => false)
  }
}
