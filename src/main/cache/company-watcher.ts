import { watch, type FSWatcher } from 'chokidar'
import { isProtectedPath } from '../integrity/protected-files'
import { relativeInside, classifyPath } from './watch-paths'
import type { RefreshKind } from './cached-repository'

export interface CompanyWatcherOptions {
  /** 회사 폴더의 realpath (SafeFs.root). */
  root: string
  /** 변경된 종류를 모아 한 번에 호출한다. 실패는 onError로 넘기고 감시는 계속한다. */
  onChange: (kinds: RefreshKind[]) => Promise<void>
  /** 보호 대상 파일(직원, org.md, project.md, archive, 정책)이 바뀌면 디바운스 뒤 한 번 호출한다 (T-052 변경 감지). */
  onProtectedChange?: () => Promise<void>
  onError?: (e: unknown) => void
  /** 이벤트가 멈춘 뒤 기다릴 시간. 에디터의 저장 폭풍/임시 파일 교체를 한 번으로 합친다. */
  debounceMs?: number
  /** 테스트 훅: 분류 전의 원시 이벤트 (root 밖이면 rel이 null). */
  onRawEvent?: (abs: string, rel: string | null) => void
}

/** 관심 있는 하위 경로만 감시해 회사 폴더의 `.git` 등 큰 트리를 훑지 않는다. */
function shouldIgnore(root: string, abs: string): boolean {
  const rel = relativeInside(root, abs)
  if (rel === null) return true // 루트 밖
  if (rel === '') return false
  const parts = rel.split('/')
  // 디렉터리 후보(최상위 company, .claude)는 내려가야 하므로 classify 대신 접두어로 판단한다.
  if (parts[0] !== 'company' && parts[0] !== '.claude') return true
  if (parts.length === 1) return false
  if (parts[0] === '.claude') return parts[1] !== 'agents' || parts.length > 3
  if (
    ![
      'org.md',
      'project.md',
      'tickets',
      'decisions',
      'reports',
      'archive',
      'policies',
      'recurring.md'
    ].includes(parts[1])
  )
    return true
  return parts.length > 4
}

export class CompanyWatcher {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private readonly dirty = new Set<RefreshKind>()
  private protectedDirty = false
  private flushing: Promise<void> = Promise.resolve()

  constructor(private readonly opts: CompanyWatcherOptions) {}

  /** 초기 스캔이 끝나 이벤트를 받을 준비가 되면 resolve. */
  start(): Promise<void> {
    if (this.watcher) return Promise.reject(new Error('watcher already started'))
    const { root } = this.opts
    const w = watch(root, {
      ignoreInitial: true,
      // 링크를 따라가면 회사 폴더 밖 경로가 감시 대상이 된다.
      followSymlinks: false,
      ignored: (p) => shouldIgnore(root, p),
      depth: 4
    })
    this.watcher = w
    const onEvent = (path: string): void => {
      const rel = relativeInside(root, path)
      this.opts.onRawEvent?.(path, rel)
      if (rel === null) return
      const kind = classifyPath(rel)
      const prot = this.opts.onProtectedChange !== undefined && isProtectedPath(rel)
      if (prot) this.protectedDirty = true
      if (kind) this.mark(kind)
      else if (prot) this.mark(null)
    }
    w.on('add', onEvent)
      .on('change', onEvent)
      .on('unlink', onEvent)
      .on('addDir', onEvent)
      .on('unlinkDir', onEvent)
    return new Promise((resolve, reject) => {
      let ready = false
      w.once('ready', () => {
        ready = true
        resolve()
      })
      // ready 전 오류(권한, 폴더 없음 등)는 start 실패로, 이후 오류는 onError로 보고한다.
      w.on('error', (e) => {
        if (ready) this.opts.onError?.(e)
        else {
          this.watcher = null
          void w.close()
          reject(e instanceof Error ? e : new Error('watch failed'))
        }
      })
    })
  }

  private mark(kind: RefreshKind | null): void {
    if (kind !== null) this.dirty.add(kind)
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.flushing = this.flushing.then(() => this.flush())
    }, this.opts.debounceMs ?? 250)
  }

  private async flush(): Promise<void> {
    const kinds = [...this.dirty]
    const prot = this.protectedDirty
    this.dirty.clear()
    this.protectedDirty = false
    if (kinds.length > 0) {
      try {
        await this.opts.onChange(kinds)
      } catch (e) {
        this.opts.onError?.(e)
      }
    }
    if (prot) {
      try {
        await this.opts.onProtectedChange?.()
      } catch (e) {
        this.opts.onError?.(e)
      }
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.dirty.clear()
    await this.watcher?.close()
    this.watcher = null
    await this.flushing
  }
}
