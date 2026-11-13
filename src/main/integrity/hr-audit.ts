import type { ChangeActor } from '../../shared/integrity'
import { sanitizeCell } from '../gate/audit-log'
import { FsGuardError, type SafeFs } from '../repository/safe-fs'

export const HR_AUDIT_FILE = 'company/audit/hr.md'
const ROTATE_BYTES = 400 * 1024
const HEADER = '| 일시 | 변경 파일 | 요약 | 주체 | 검증 | 카드 | 이전 해시 | 이후 해시 |'
const HEAD = `# 인사 변경 감사 기록\n\n> 앱이 보호 대상 파일 변경을 감지할 때마다 한 줄 추가합니다. 직접 수정하지 마세요.\n\n${HEADER}\n|---|---|---|---|---|---|---|---|\n`

export interface HrAuditEntry {
  at: Date
  file: string
  /** 줄 단위 추가·삭제·수정 요약 (예: `+2 -1 ~1`). */
  summary: string
  actor: ChangeActor
  /** `ok`, `info:<코드>`, `violation:<코드>`, `unapproved`, `restored`, `accepted` 같은 짧은 값. */
  result: string
  card: string | null
  beforeHash: string
  afterHash: string
}

const shortHash = (h: string): string => (/^[0-9a-f]{64}$/.test(h) ? h.slice(0, 12) : h)

export function formatHrAuditLine(e: HrAuditEntry): string {
  const cells = [
    e.at.toISOString(),
    e.file,
    e.summary,
    e.actor,
    e.result,
    e.card ?? '-',
    shortHash(e.beforeHash),
    shortHash(e.afterHash)
  ].map(sanitizeCell)
  return `| ${cells.join(' | ')} |`
}

/** 줄 다중집합 비교로 만든 요약. 같은 줄 수만큼은 수정(~)으로 센다. */
export function summarizeDiff(before: string | null, after: string | null): string {
  if (before === null && after === null) return '-'
  const count = (t: string | null): Map<string, number> => {
    const m = new Map<string, number>()
    if (t !== null) for (const l of t.split(/\r?\n/)) m.set(l, (m.get(l) ?? 0) + 1)
    return m
  }
  const b = count(before)
  const a = count(after)
  let add = 0
  let del = 0
  for (const [l, n] of a) add += Math.max(0, n - (b.get(l) ?? 0))
  for (const [l, n] of b) del += Math.max(0, n - (a.get(l) ?? 0))
  const mod = Math.min(add, del)
  return `+${add - mod} -${del - mod} ~${mod}`
}

export interface HrAuditDeps {
  fs: SafeFs
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
}

/** `company/audit/hr.md`는 앱만 추가한다 (hr은 `company/audit/**` 쓰기 금지, 변조는 변경 감지가 본다). */
export class HrAudit {
  constructor(private readonly deps: HrAuditDeps) {}

  async append(entries: HrAuditEntry[]): Promise<void> {
    if (entries.length === 0) return
    const lines = entries.map(formatHrAuditLine).join('\n')
    await this.deps.exclusive(async () => {
      let text: string | null = null
      try {
        text = await this.deps.fs.readText(HR_AUDIT_FILE)
      } catch (e) {
        if (!(e instanceof FsGuardError && e.kind === 'missing')) throw e
      }
      if (text !== null && Buffer.byteLength(text, 'utf8') > ROTATE_BYTES) {
        const stamp = entries[0].at.toISOString().slice(0, 10).replace(/-/g, '')
        for (let n = 0; n < 100; n++) {
          try {
            await this.deps.fs.writeText(`company/audit/hr.${stamp}-${n}.md`, text, false)
            break
          } catch (e) {
            if (!(e instanceof FsGuardError && e.kind === 'exists') || n === 99) throw e
          }
        }
        text = null
      }
      const base = text !== null && text.trim() !== '' ? text.replace(/\n*$/, '\n') : HEAD
      await this.deps.fs.writeText(HR_AUDIT_FILE, `${base}${lines}\n`)
    })
  }
}
