import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, normalize } from 'node:path'
import type {
  CompanyInfo,
  CompanyOpenErrorCode,
  CompanyOpenResult,
  CompanyState
} from '../../shared/company'
import { SafeFs } from '../repository/safe-fs'
import { COMPANY_MARKER_FILES } from './templates'

const MAX_PATH_LENGTH = 1024

/** 테스트에서 바꿔 끼울 수 있는 파일 시스템 접근. 열기 검증은 읽기 전용 호출만 쓴다. */
export interface CompanyFsPort {
  realpath(path: string): Promise<string>
  isDirectory(path: string): Promise<boolean>
  /** 심볼릭 링크를 따라가지 않고 일반 파일인지 본다. 없으면 false. */
  isRegularFile(path: string): Promise<boolean>
}

export const nodeCompanyFs: CompanyFsPort = {
  realpath: (p) => realpath(p),
  isDirectory: async (p) => (await stat(p)).isDirectory(),
  isRegularFile: async (p) => {
    try {
      return (await lstat(p)).isFile()
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw e
    }
  }
}

/** 마지막으로 연 회사 경로 1개의 저장소. 회사 폴더가 아니라 앱 userData에 둔다. */
export interface LastCompanyStore {
  load(): Promise<string | null>
  save(path: string): Promise<void>
}

const LAST_COMPANY_FILE = 'last-company.json'

function isPlausibleStoredPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= MAX_PATH_LENGTH &&
    !path.includes('\0') &&
    isAbsolute(path) &&
    !path.split(/[\\/]/).includes('..')
  )
}

export function createLastCompanyStore(userDataDir: string): LastCompanyStore {
  const file = join(userDataDir, LAST_COMPANY_FILE)
  return {
    async load() {
      let raw: string
      try {
        raw = await readFile(file, 'utf8')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw e
      }
      try {
        const data: unknown = JSON.parse(raw)
        const path =
          typeof data === 'object' && data !== null ? (data as { path?: unknown }).path : null
        // 손상되었거나 다른 형태의 파일은 "기억 없음"으로 본다. 파일 내용을 경로로 신뢰하지 않으려고 형태를 다시 검사한다.
        return typeof path === 'string' && isPlausibleStoredPath(path) ? path : null
      } catch {
        return null
      }
    },
    async save(path) {
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      await writeFile(tmp, JSON.stringify({ path }), 'utf8')
      await rename(tmp, file)
    }
  }
}

/** 열린 회사. `root`는 심볼릭 링크를 해소한 실제 경로다. */
export interface OpenCompany {
  root: string
  name: string
  /** 이 회사 폴더에 묶인 파일 접근기. 다른 핸들러는 이것만 쓴다. */
  fs: SafeFs
}

export class NoCompanyError extends Error {
  constructor() {
    super('열린 회사가 없습니다.')
  }
}

class OpenError extends Error {
  constructor(
    readonly code: CompanyOpenErrorCode,
    message: string
  ) {
    super(message)
  }
}

export interface CompanyContextDeps {
  store: LastCompanyStore
  fs?: CompanyFsPort
  /** 회사 폴더로 쓸 수 없는 홈 디렉터리. 테스트에서 바꿔 끼운다. */
  homeDir?: string
}

/**
 * main이 보관하는 "열린 회사 1개" 단일 컨텍스트.
 * 다른 핸들러는 경로를 받지 않고 `requireOpenCompany().fs`로만 SafeFs를 얻는다.
 * 열기는 읽기만 한다 (표식 검사 외에 회사 폴더에 아무것도 쓰지 않는다).
 */
export class CompanyContext {
  private readonly store: LastCompanyStore
  private readonly fsPort: CompanyFsPort
  private readonly homeDir: string
  private current: OpenCompany | null = null
  private state: CompanyState = { status: 'none' }
  // open/restoreLast가 겹치면 "이미 열림" 판정과 current 설정 사이에 await가 끼어 불변식이 깨진다. 한 줄로 세운다.
  private queue: Promise<unknown> = Promise.resolve()

  constructor(deps: CompanyContextDeps) {
    this.store = deps.store
    this.fsPort = deps.fs ?? nodeCompanyFs
    this.homeDir = deps.homeDir ?? homedir()
  }

  getState(): CompanyState {
    return this.state
  }

  getOpenCompany(): OpenCompany | null {
    return this.current
  }

  requireOpenCompany(): OpenCompany {
    if (this.current === null) throw new NoCompanyError()
    return this.current
  }

  /** 경로를 검증해 회사를 연다. 실패하면 기존 컨텍스트는 그대로다. 호출은 순서대로 처리된다. */
  open(path: unknown): Promise<CompanyOpenResult> {
    return this.serialize(() => this.openNow(path))
  }

  /** 시작 시 마지막 회사를 연다. 폴더가 사라져도 기억한 경로는 지우지 않는다 (복구 가능성). */
  restoreLast(): Promise<CompanyState> {
    return this.serialize(() => this.restoreNow())
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async openNow(path: unknown): Promise<CompanyOpenResult> {
    try {
      const root = await this.verify(path)
      if (this.current !== null) {
        if (this.current.root !== root)
          throw new OpenError('already-open', '다른 회사가 이미 열려 있습니다.')
        return { ok: true, company: await this.describe(this.current) }
      }
      const company = await this.activate(root)
      try {
        await this.store.save(root)
      } catch {
        // 기억하지 못해도 이번 실행은 정상이다. 다음 시작 때 시작 화면으로 돌아갈 뿐이라 열기를 실패로 만들지 않는다.
      }
      const info = await this.describe(company)
      this.state = { status: 'open', company: info }
      return { ok: true, company: info }
    } catch (e) {
      if (e instanceof OpenError) return { ok: false, code: e.code, message: e.message }
      // 원본 오류에는 내부 경로가 들어 있을 수 있어 renderer에 보내지 않는다.
      return { ok: false, code: 'open-failed', message: '회사 폴더를 열지 못했습니다.' }
    }
  }

  private async restoreNow(): Promise<CompanyState> {
    if (this.current !== null) return this.state
    let last: string | null
    try {
      last = await this.store.load()
    } catch {
      last = null
    }
    if (last === null) return this.state
    const name = basename(last)
    try {
      const company = await this.activate(await this.verify(last))
      this.state = { status: 'open', company: await this.describe(company) }
    } catch (e) {
      if (e instanceof OpenError && e.code === 'not-found') this.state = { status: 'missing', name }
      // 권한 오류 등은 "없음"이 아니다. 사용자가 폴더가 사라졌다고 오해하지 않게 별도 상태로 둔다.
      else if (e instanceof OpenError) this.state = { status: 'invalid', name, message: e.message }
      else this.state = { status: 'invalid', name, message: '회사 폴더를 열지 못했습니다.' }
    }
    return this.state
  }

  private async activate(root: string): Promise<OpenCompany> {
    const fs = await SafeFs.open(root)
    // verify 이후 경로가 바뀌어 SafeFs가 다른 폴더를 열었다면 검증하지 않은 폴더이므로 거부한다.
    if (fs.root !== root) throw new OpenError('open-failed', '회사 폴더를 열지 못했습니다.')
    const company: OpenCompany = { root, name: basename(root), fs }
    this.current = company
    return company
  }

  private async describe(company: OpenCompany): Promise<CompanyInfo> {
    let mission = ''
    try {
      mission = await company.fs.readText('company/mission.md')
    } catch {
      // mission.md는 선택 파일이다. 없거나 읽을 수 없으면 빈 문자열로 둔다.
    }
    return { name: company.name, dir: company.root, mission }
  }

  /** 입력 형태 -> 실제 경로(심볼릭 링크 해소) -> 폴더 -> 표식 파일 순으로 검사해 실제 경로를 돌려준다. */
  private async verify(path: unknown): Promise<string> {
    if (typeof path !== 'string' || path.length === 0 || path.length > MAX_PATH_LENGTH)
      throw new OpenError('invalid-request', '경로가 올바르지 않습니다.')
    if (path.includes('\0') || !isAbsolute(path))
      throw new OpenError('invalid-path', '절대 경로여야 합니다.')
    if (path.split(/[\\/]/).includes('..'))
      throw new OpenError('invalid-path', '경로에 ..을 쓸 수 없습니다.')
    let root: string
    try {
      root = await this.fsPort.realpath(normalize(path))
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR')
        throw new OpenError('not-found', '폴더를 찾을 수 없습니다.')
      throw new OpenError('open-failed', '회사 폴더를 열지 못했습니다.')
    }
    // 파일 시스템 루트와 홈 디렉터리는 회사 폴더로 쓰지 않는다 (scaffold의 루트 거부와 같은 방식).
    if (dirname(root) === root || root === this.homeDir)
      throw new OpenError('invalid-path', '이 폴더는 회사 폴더로 쓸 수 없습니다.')
    const missing: string[] = []
    try {
      if (!(await this.fsPort.isDirectory(root)))
        throw new OpenError('invalid-path', '폴더를 선택해야 합니다.')
      for (const marker of COMPANY_MARKER_FILES) {
        if (!(await this.fsPort.isRegularFile(join(root, ...marker.split('/')))))
          missing.push(marker)
      }
    } catch (e) {
      if (e instanceof OpenError) throw e
      // 권한 오류 등. 원본 메시지에는 경로가 있을 수 있어 일반 문구로 바꾼다.
      throw new OpenError('open-failed', '폴더를 읽을 수 없어요. 접근 권한을 확인해 주세요.')
    }
    if (missing.length > 0)
      throw new OpenError(
        'not-company',
        `회사 폴더가 아닙니다. 필요한 파일이 없어요: ${missing.join(', ')}`
      )
    return root
  }
}
