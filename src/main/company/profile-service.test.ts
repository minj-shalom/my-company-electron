import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CompanyProfile } from '../../shared/company-profile'
import type { ApiResult } from '../../shared/result'
import { SafeFs } from '../repository/safe-fs'
import { ProfileService } from './profile-service'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

const DOC = `# 회사 미션 (Acme)

> 머리말 인용

## 비전

옛 비전

## 이 회사가 만드는 것

- 직접 쓴 내용
\`\`\`
## 코드 안 제목
\`\`\`

## 미션

옛 미션

## 운영 원칙

- 원칙 1
`

async function setup(doc: string | null = DOC): Promise<{ svc: ProjectService; file: string }> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'mc-profile-')))
  dirs.push(dir)
  await mkdir(join(dir, 'company'), { recursive: true })
  const file = join(dir, 'company/mission.md')
  if (doc !== null) await writeFile(file, doc)
  const svc = new ProfileService({ fs: await SafeFs.open(dir), exclusive: (t) => t() })
  return { svc, file }
}
type ProjectService = ProfileService
const ok = <T>(r: ApiResult<T>): T => {
  if (!r.ok) throw new Error(`expected ok: ${r.code}`)
  return r.value
}
const code = (r: ApiResult<unknown>): string => (r.ok ? 'ok' : r.code)
const req = (p: CompanyProfile, patch: Partial<CompanyProfile> = {}): unknown => ({
  ...p,
  ...patch
})

describe('company profile', () => {
  it('reads name and sections', async () => {
    const { svc } = await setup()
    const p = ok(await svc.get())
    expect(p).toMatchObject({
      name: 'Acme',
      vision: '옛 비전',
      mission: '옛 미션',
      principles: '- 원칙 1'
    })
  })

  it('keeps unknown sections, order and untouched sections', async () => {
    const { svc, file } = await setup()
    const p = ok(await svc.get())
    const saved = ok(await svc.save(req(p, { vision: '새 비전', name: 'Beta' })))
    expect(saved).toMatchObject({ name: 'Beta', vision: '새 비전', mission: '옛 미션' })
    const text = await readFile(file, 'utf8')
    expect(text).toBe(DOC.replace('(Acme)', '(Beta)').replace('옛 비전', '새 비전'))
  })

  it('does not write when nothing changed', async () => {
    const { svc, file } = await setup()
    const p = ok(await svc.get())
    ok(await svc.save(req(p)))
    expect(await readFile(file, 'utf8')).toBe(DOC)
  })

  it('appends a missing section and handles the template title', async () => {
    const { svc, file } = await setup('# Acme: 미션\n\n## 비전\n\n## 미션\n')
    const p = ok(await svc.get())
    expect(p.name).toBe('Acme')
    ok(await svc.save(req(p, { principles: '규칙', name: 'Zed' })))
    expect(await readFile(file, 'utf8')).toBe(
      '# Zed: 미션\n\n## 비전\n\n## 미션\n\n## 운영 원칙\n\n규칙\n'
    )
  })

  it('returns conflict when the file changed after reading', async () => {
    const { svc, file } = await setup()
    const p = ok(await svc.get())
    await writeFile(file, `${DOC}\n외부 수정\n`)
    expect(code(await svc.save(req(p, { vision: 'x' })))).toBe('conflict')
    expect(await readFile(file, 'utf8')).toBe(`${DOC}\n외부 수정\n`)
  })

  it('rejects invalid input', async () => {
    const { svc, file } = await setup()
    const p = ok(await svc.get())
    for (const patch of [
      { name: '' },
      { name: 'a'.repeat(51) },
      { name: 'a/b' },
      { vision: 'x'.repeat(40 * 1024), mission: 'y'.repeat(30 * 1024) },
      { mission: 'a\n## 가짜 섹션' },
      { vision: 5 as unknown as string }
    ])
      expect(code(await svc.save(req(p, patch)))).toBe('invalid-request')
    expect(code(await svc.save(null))).toBe('invalid-request')
    expect(await readFile(file, 'utf8')).toBe(DOC)
  })

  it('strips control characters', async () => {
    const { svc } = await setup()
    const p = ok(await svc.get())
    const s = ok(await svc.save(req(p, { vision: 'a\u0000b\u001bc\r\nd', name: 'N\u0007ame' })))
    expect(s.vision).toBe('abc\nd')
    expect(s.name).toBe('Name')
  })

  it('errors when the file is missing without creating it, hiding paths', async () => {
    const { svc, file } = await setup(null)
    const g = await svc.get()
    expect(code(g)).toBe('not-found')
    expect(JSON.stringify(g)).not.toContain('mc-profile')
    const s = await svc.save({ name: 'A', vision: '', mission: '', principles: '', revision: 'x' })
    expect(code(s)).toBe('not-found')
    await expect(readFile(file)).rejects.toThrow()
  })
})
