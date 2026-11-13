import type { AuditSummary, KillSwitchState } from '../../shared/gate'
import { PROJECT_ID } from '../../shared/project'
import {
  VISIT_LIST_LIMIT,
  type VisitItem,
  type VisitSummary,
  type VisitSummaryRequest
} from '../../shared/visit'
import { asString, firstHeading, splitFrontmatter } from '../repository/markdown'
import { leadingId } from '../repository/ids'
import { parseTicket, TICKET_DIRS } from '../repository/parse-ticket'
import { DECISION_DIRS } from '../repository/parse-decision'
import { relPath, type SafeFs } from '../repository/safe-fs'
import type { VisitStore } from './visit-store'

const REPORTS_DIR = 'company/reports'
const BRIEFING_FILE = /^briefing-\d{14}(?:-\d+)?\.md$/
const FAILED_OUTCOME = /^- \*\*결과:\*\*\s*(실패|시간 초과)\s*$/m
const MAX_AUDIT_RANGE_MS = 365 * 24 * 3600 * 1000
const MAX_TITLE = 200

export interface VisitServiceDeps {
  fs: SafeFs
  /** 회사 경로 해시. 방문 상태를 회사별로 나눈다. */
  companyTag: string
  store: VisitStore
  now?: () => Date
  /** 자동 실행 요약과 킬 스위치. 없거나 실패하면 null로 둔다 (요약 전체가 깨지지 않게). */
  audit?: (from: Date, to: Date) => Promise<AuditSummary>
  killSwitch?: () => Promise<KillSwitchState>
}

interface Entry {
  file: string
  mtime: number
}

export class VisitService {
  private readonly now: () => Date

  constructor(private readonly deps: VisitServiceDeps) {
    this.now = deps.now ?? ((): Date => new Date())
  }

  /** mtime이 since보다 큰(경계 제외) 일반 파일만, 최신이 먼저. */
  private async changedSince(
    dir: string,
    since: number,
    filter?: (f: string) => boolean
  ): Promise<Entry[]> {
    const { files } = await this.deps.fs.listMarkdown(dir)
    const out: Entry[] = []
    for (const file of files) {
      if (filter && !filter(file)) continue
      const mtime = await this.deps.fs.mtimeMs(relPath(dir, file))
      if (mtime !== null && mtime > since) out.push({ file, mtime })
    }
    return out.sort((a, b) => b.mtime - a.mtime || (a.file < b.file ? 1 : -1))
  }

  private async titleOf(rel: string, id: string): Promise<string> {
    try {
      const { data, body } = splitFrontmatter(await this.deps.fs.readText(rel))
      const t = asString(data.title) ?? firstHeading(body) ?? id
      return t.replace(/^(T|D)-\d+\s*[:：]\s*/, '').slice(0, MAX_TITLE)
    } catch {
      return id
    }
  }

  /** 마지막 방문 이후 새로 생긴 pending 카드. 알림이 같은 기준을 쓴다. */
  async newPendingDecisions(since: number): Promise<VisitItem[]> {
    const items: VisitItem[] = []
    for (const { file } of await this.changedSince(DECISION_DIRS.pending, since)) {
      const id = leadingId(file, 'D')
      if (id === null) continue
      items.push({
        id,
        title: await this.titleOf(relPath(DECISION_DIRS.pending, file), id),
        projectId: null
      })
      if (items.length >= VISIT_LIST_LIMIT) break
    }
    return items
  }

  async summary(req: VisitSummaryRequest = {}): Promise<VisitSummary> {
    const until = this.now()
    const state = await this.deps.store.load(this.deps.companyTag)
    if (state.lastVisitAt === null) {
      // 첫 방문은 비교 기준이 없다. 지금을 기준으로 삼아 다음 방문부터 비교한다.
      await this.deps.store.save(this.deps.companyTag, { ...state, lastVisitAt: until.getTime() })
      return {
        since: null,
        until: until.toISOString(),
        firstVisit: true,
        reports: [],
        completedTickets: [],
        newDecisions: [],
        failedTicks: 0,
        audit: null,
        killSwitch: await this.killSwitch()
      }
    }
    const since = state.lastVisitAt
    const [reports, failedTicks] = await this.briefings(since)
    const summary: VisitSummary = {
      since: new Date(since).toISOString(),
      until: until.toISOString(),
      firstVisit: false,
      reports,
      completedTickets: await this.completedTickets(since, req.projectId),
      newDecisions: await this.newPendingDecisions(since),
      failedTicks,
      audit: await this.audit(since, until.getTime()),
      killSwitch: await this.killSwitch()
    }
    return summary
  }

  private async briefings(since: number): Promise<[VisitItem[], number]> {
    const entries = await this.changedSince(REPORTS_DIR, since, (f) => BRIEFING_FILE.test(f))
    const items: VisitItem[] = []
    let failed = 0
    for (const { file } of entries) {
      const id = file.replace(/\.md$/, '')
      const rel = relPath(REPORTS_DIR, file)
      try {
        if (FAILED_OUTCOME.test(await this.deps.fs.readText(rel))) failed += 1
      } catch {
        // 읽을 수 없는 브리핑은 실패로 세지 않는다.
      }
      if (items.length < VISIT_LIST_LIMIT)
        items.push({ id, title: await this.titleOf(rel, id), projectId: null })
    }
    return [items, failed]
  }

  private async completedTickets(since: number, projectId?: string): Promise<VisitItem[]> {
    const items: VisitItem[] = []
    for (const { file } of await this.changedSince(TICKET_DIRS.done, since)) {
      try {
        const t = parseTicket(
          file,
          await this.deps.fs.readText(relPath(TICKET_DIRS.done, file)),
          'done'
        )
        const pid = t.projectId ?? null
        if (projectId !== undefined && pid !== projectId) continue
        items.push({ id: t.id, title: t.title.slice(0, MAX_TITLE), projectId: pid })
        if (items.length >= VISIT_LIST_LIMIT) break
      } catch {
        // 손상 티켓은 건너뛴다. 목록 화면이 따로 알린다.
      }
    }
    return items
  }

  private async audit(since: number, until: number): Promise<AuditSummary | null> {
    if (!this.deps.audit) return null
    try {
      const from = Math.max(since, until - MAX_AUDIT_RANGE_MS + 1000)
      return await this.deps.audit(new Date(from), new Date(Math.max(until, from + 1)))
    } catch {
      return null
    }
  }

  private async killSwitch(): Promise<KillSwitchState | null> {
    try {
      return (await this.deps.killSwitch?.()) ?? null
    } catch {
      return null
    }
  }

  /** 요약을 확인했을 때 호출한다. 시각은 서버(main) 시계로만 기록하고 입력을 받지 않는다. */
  async markSeen(): Promise<Date> {
    const at = this.now()
    const state = await this.deps.store.load(this.deps.companyTag)
    await this.deps.store.save(this.deps.companyTag, { ...state, lastVisitAt: at.getTime() })
    return at
  }

  /**
   * 알림 대상 점검. 마지막 방문 이후 새로 생겼고 아직 알리지 않은 카드만 돌려주고 알림 기록에 남긴다.
   * 방문 기록이 없으면 지금을 기준으로 삼고 알리지 않는다 (기존 카드 폭주 방지).
   */
  async takeUnnotified(): Promise<VisitItem[]> {
    const state = await this.deps.store.load(this.deps.companyTag)
    if (state.lastVisitAt === null) {
      await this.deps.store.save(this.deps.companyTag, {
        notified: [],
        lastVisitAt: this.now().getTime()
      })
      return []
    }
    const fresh = (await this.newPendingDecisions(state.lastVisitAt)).filter(
      (d) => !state.notified.includes(d.id)
    )
    if (fresh.length > 0)
      await this.deps.store.save(this.deps.companyTag, {
        ...state,
        notified: [...state.notified, ...fresh.map((d) => d.id)]
      })
    return fresh
  }
}

export const isProjectId = (v: unknown): v is string => typeof v === 'string' && PROJECT_ID.test(v)
