import { lstat, mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
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
        return typeof path === 'string' && path.length <= MAX_PATH_LENGTH && isAbsolute(path)
          ? path
          : null
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
}

/**
 * main이 보관하는 "열린 회사 1개" 단일 컨텍스트.
 * 다른 핸들러는 경로를 받지 않고 `requireOpenCompany().fs`로만 SafeFs를 얻는다.
 * 열기는 읽기만 한다 (표식 검사 외에 회사 폴더에 아무것도 쓰지 않는다).
 */
export class CompanyContext {
  private readonly store: LastCompanyStore
  private readonly fsPort: CompanyFsPort
  private current: OpenCompany | null = null
  private state: CompanyState = { status: 'none' }

  constructor(deps: CompanyContextDeps) {
    this.store = deps.store
    this.fsPort = deps.fs ?? nodeCompanyFs
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

  /** 경로를 검증해 회사를 연다. 실패하면 기존 컨텍스트는 그대로다. */
  async open(path: unknown): Promise<CompanyOpenResult> {
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
      return { ok: true, company: await this.describe(company) }
    } catch (e) {
      if (e instanceof OpenError) return { ok: false, code: e.code, message: e.message }
      // 원본 오류에는 내부 경로가 들어 있을 수 있어 renderer에 보내지 않는다.
      return { ok: false, code: 'open-failed', message: '회사 폴더를 열지 못했습니다.' }
    }
  }

  /** 시작 시 마지막 회사를 연다. 폴더가 사라져도 기억한 경로는 지우지 않는다 (복구 가능성). */
  async restoreLast(): Promise<CompanyState> {
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
      this.state = {
        status: 'open',
        company: await this.describe(await this.activate(await this.verify(last)))
      }
    } catch (e) {
      if (e instanceof OpenError && e.code === 'not-found') this.state = { status: 'missing', name }
      else if (e instanceof OpenError && e.code === 'not-company')
        this.state = { status: 'invalid', name, message: e.message }
      else this.state = { status: 'missing', name }
    }
    return this.state
  }

  private async activate(root: string): Promise<OpenCompany> {
    const company: OpenCompany = { root, name: basename(root), fs: await SafeFs.open(root) }
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
    const info: CompanyInfo = { name: company.name, dir: company.root, mission }
    this.state = { status: 'open', company: info }
    return info
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
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        throw new OpenError('not-found', '폴더를 찾을 수 없습니다.')
      throw new OpenError('open-failed', '회사 폴더를 열지 못했습니다.')
    }
    if (!(await this.fsPort.isDirectory(root)))
      throw new OpenError('invalid-path', '폴더를 선택해야 합니다.')
    const missing: string[] = []
    for (const marker of COMPANY_MARKER_FILES) {
      if (!(await this.fsPort.isRegularFile(join(root, ...marker.split('/'))))) missing.push(marker)
    }
    if (missing.length > 0)
      throw new OpenError(
        'not-company',
        `회사 폴더가 아닙니다. 필요한 파일이 없어요: ${missing.join(', ')}`
      )
    return root
  }
}
