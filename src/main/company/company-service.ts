import { realpath } from 'node:fs/promises'
import {
  COMPANY_FOLDER_PURPOSES,
  type CompanyCreateResult,
  type CompanyFolderPurpose,
  type CompanyOpenResult,
  type CompanySelectFolderResult,
  type CompanyState
} from '../../shared/company'
import type { CompanyContext } from './company-context'
import { createCompanyFolder } from './scaffold'

/** 선택 다이얼로그를 띄운다. electron `dialog`는 IPC 계층이 이 함수로 감싸 주입한다. */
export type FolderPicker = (purpose: CompanyFolderPurpose) => Promise<string | null>

const MAX_APPROVED_PER_PURPOSE = 8

export interface CompanyServiceDeps {
  context: CompanyContext
  createFolder?: typeof createCompanyFolder
  realpath?: (path: string) => Promise<string>
}

/**
 * 회사 만들기/열기 유스케이스. D-005 B: renderer가 임의 경로를 보내지 못하고,
 * main의 선택 다이얼로그가 돌려준 경로(용도별)만 create/open에 쓸 수 있다.
 */
export class CompanyService {
  private readonly context: CompanyContext
  private readonly createFolder: typeof createCompanyFolder
  private readonly resolveReal: (path: string) => Promise<string>
  private readonly pendingSelect: Partial<
    Record<CompanyFolderPurpose, Promise<CompanySelectFolderResult>>
  > = {}
  private readonly approved: Record<CompanyFolderPurpose, string[]> = {
    'create-location': [],
    open: []
  }

  constructor(deps: CompanyServiceDeps) {
    this.context = deps.context
    this.createFolder = deps.createFolder ?? createCompanyFolder
    this.resolveReal = deps.realpath ?? realpath
  }

  /** 용도가 허용 목록 밖이면 예외를 던진다 (IPC 입력 검증). */
  static parsePurpose(input: unknown): CompanyFolderPurpose {
    if (input === undefined) return 'create-location'
    if (COMPANY_FOLDER_PURPOSES.includes(input as CompanyFolderPurpose))
      return input as CompanyFolderPurpose
    throw new Error('Invalid purpose')
  }

  /** 같은 용도의 다이얼로그가 열려 있는 동안의 요청은 같은 결과를 공유한다 (다이얼로그 중복 방지). */
  selectFolder(
    purpose: CompanyFolderPurpose,
    pick: FolderPicker
  ): Promise<CompanySelectFolderResult> {
    const pending = this.pendingSelect[purpose]
    if (pending !== undefined) return pending
    const run = this.selectNow(purpose, pick).finally(() => {
      delete this.pendingSelect[purpose]
    })
    this.pendingSelect[purpose] = run
    return run
  }

  private async selectNow(
    purpose: CompanyFolderPurpose,
    pick: FolderPicker
  ): Promise<CompanySelectFolderResult> {
    const picked = await pick(purpose)
    if (picked === null) return null
    const real = await this.resolveReal(picked).catch(() => null)
    // 방금 고른 폴더가 사라졌으면 쓸 수 없는 선택이므로 취소와 같이 다룬다.
    if (real === null) return null
    this.approve(purpose, real)
    return picked
  }

  async create(req: unknown): Promise<CompanyCreateResult> {
    if (typeof req !== 'object' || req === null)
      return { ok: false, code: 'invalid-request', message: '요청 형식이 올바르지 않습니다.' }
    const { name, path } = req as Record<string, unknown>
    const approvedPath =
      typeof path === 'string' ? await this.approvedReal('create-location', path) : null
    if (approvedPath === null)
      return {
        ok: false,
        code: 'path-not-allowed',
        message: '폴더 선택 화면에서 고른 위치만 쓸 수 있어요.'
      }
    const result = await this.createFolder(name, approvedPath)
    // 방금 만든 폴더는 main이 만든 것이므로, 같은 경로로 바로 열 수 있게 한다.
    if (result.ok)
      this.approve('open', await this.resolveReal(result.companyDir).catch(() => result.companyDir))
    return result
  }

  async open(req: unknown): Promise<CompanyOpenResult> {
    if (typeof req !== 'object' || req === null)
      return { ok: false, code: 'invalid-request', message: '요청 형식이 올바르지 않습니다.' }
    const { path } = req as Record<string, unknown>
    if (typeof path !== 'string')
      return { ok: false, code: 'invalid-request', message: '경로가 올바르지 않습니다.' }
    const approvedPath = await this.approvedReal('open', path)
    if (approvedPath === null)
      return {
        ok: false,
        code: 'path-not-allowed',
        message: '폴더 선택 화면에서 고른 폴더만 열 수 있어요.'
      }
    // 승인 시점에 해소한 실제 경로를 넘겨, 선택 이후 링크가 바뀌어도 다른 폴더가 열리지 않게 한다.
    return this.context.open(approvedPath)
  }

  current(): CompanyState {
    return this.context.getState()
  }

  private approve(purpose: CompanyFolderPurpose, real: string): void {
    const list = this.approved[purpose]
    if (!list.includes(real)) list.push(real)
    // 오래된 승인부터 버려 무한히 쌓이지 않게 한다.
    while (list.length > MAX_APPROVED_PER_PURPOSE) list.shift()
  }

  /** 승인된 경로면 해소한 실제 경로를, 아니면 null을 돌려준다. */
  private async approvedReal(purpose: CompanyFolderPurpose, path: string): Promise<string | null> {
    const real = await this.resolveReal(path).catch(() => null)
    return real !== null && this.approved[purpose].includes(real) ? real : null
  }
}
