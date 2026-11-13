import { PROJECT_ID } from '../../shared/project'
import type { KillSwitchState } from '../../shared/gate'
import type { StateStore } from './state-store'

export interface KillSwitchDeps {
  store: StateStore
  now?: () => Date
  /** 정책 변경 이력에 남긴다. projectId가 null이면 회사 전체. 실패해도 중지 자체는 유지한다. */
  recordHistory?: (projectId: string | null, summary: string) => Promise<void>
}

type Listener = (scope: { projectId: string | null }) => void

function parse(raw: unknown): KillSwitchState {
  const base: KillSwitchState = { company: false, projects: [], updatedAt: null }
  if (typeof raw !== 'object' || raw === null) return base
  const r = raw as Partial<KillSwitchState>
  return {
    company: r.company === true,
    projects: Array.isArray(r.projects)
      ? r.projects.filter((p): p is string => typeof p === 'string' && PROJECT_ID.test(p))
      : [],
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null
  }
}

/**
 * 회사 전체·프로젝트별 즉시 중지. 상태는 userData에 저장한다.
 * 게이트 도구 경로는 `isEngaged`만 쓸 수 있고 `set`은 IPC 핸들러(신뢰한 발신자)에서만 호출한다 (에이전트 경로로 해제 불가).
 * 상태를 읽지 못하면 중지된 것으로 본다 (안전한 쪽).
 */
export class KillSwitch {
  private state: KillSwitchState | null = null
  private loadFailed = false
  private queue: Promise<unknown> = Promise.resolve()
  private readonly listeners = new Set<Listener>()

  constructor(private readonly deps: KillSwitchDeps) {}

  onEngage(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private async load(): Promise<KillSwitchState> {
    if (this.state !== null) return this.state
    try {
      this.state = parse(await this.deps.store.load())
      this.loadFailed = false
    } catch {
      this.loadFailed = true
      return { company: true, projects: [], updatedAt: null }
    }
    return this.state
  }

  async get(): Promise<KillSwitchState> {
    const s = await this.load()
    return { ...s, projects: [...s.projects] }
  }

  async isEngaged(projectId: string): Promise<boolean> {
    const s = await this.load()
    return this.loadFailed || s.company || s.projects.includes(projectId)
  }

  /** 켜기는 즉시 반영하고 진행 중인 작업에 알린다. 저장이 실패해도 메모리 상태는 켠 채로 둔다. */
  set(req: {
    scope: 'company' | 'project'
    projectId?: string
    engaged: boolean
  }): Promise<KillSwitchState> {
    const run = this.queue.then(async () => {
      const cur = await this.load()
      if (this.loadFailed && !req.engaged) throw new Error('state-unreadable')
      const next: KillSwitchState = { ...cur, projects: [...cur.projects] }
      let projectId: string | null = null
      if (req.scope === 'company') next.company = req.engaged
      else {
        if (req.projectId === undefined || !PROJECT_ID.test(req.projectId))
          throw new Error('invalid-project')
        projectId = req.projectId
        const set = new Set(next.projects)
        if (req.engaged) set.add(projectId)
        else set.delete(projectId)
        next.projects = [...set].sort()
      }
      next.updatedAt = (this.deps.now?.() ?? new Date()).toISOString()
      this.state = next
      this.loadFailed = false
      if (req.engaged) for (const l of this.listeners) l({ projectId })
      await this.deps.store.save(next)
      const what = projectId === null ? '회사 전체' : `프로젝트 ${projectId}`
      await this.deps
        .recordHistory?.(projectId, `킬 스위치 ${req.engaged ? '켬' : '해제'}: ${what}`)
        .catch(() => undefined)
      return { ...next, projects: [...next.projects] }
    })
    this.queue = run.catch(() => undefined)
    return run
  }
}
