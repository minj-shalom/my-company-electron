import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CompanyContext } from '../company/company-context'
import { createDomainHandlers } from '../domain-ipc'
import { ProviderService } from '../providers/provider-service'
import { createWeeklyLimitsStore } from '../settings/weekly-limits-store'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function open(userData?: boolean): Promise<{
  h: ReturnType<typeof createDomainHandlers>
  dir: string
}> {
  const dir = await mkdtemp(join(tmpdir(), 'mc-pipc-'))
  dirs.push(dir)
  const ud = userData ? await mkdtemp(join(tmpdir(), 'mc-pipc-ud-')) : undefined
  if (ud) dirs.push(ud)
  for (const [rel, text] of [
    ['CLAUDE.md', '# c\n'],
    ['company/org.md', '# 조직도\n'],
    [
      'company/decisions/pending/D-030-p.md',
      `# D-030: 제안

- **관련 티켓:** 없음
- **작성일:** 2026-11-13
- **상태:** pending
- **유형:** proposal
- **제안자:** hr

## 질문
요약

## 선택지
1. **A. 승인** — x
2. **B. 거절** — y

## 결정 (사람이 작성)
- 선택:
- 메모:
`
    ]
  ] as const) {
    await mkdir(dirname(join(dir, rel)), { recursive: true })
    await writeFile(join(dir, rel), text)
  }
  const context = new CompanyContext({
    store: { load: async () => null, save: async () => undefined },
    homeDir: '/nonexistent-home'
  })
  expect((await context.open(dir)).ok).toBe(true)
  const h = createDomainHandlers({
    context,
    providers: new ProviderService(),
    limits: createWeeklyLimitsStore(dir),
    userDataDir: ud
  })
  return { h, dir }
}

describe('proposal IPC wiring', () => {
  it('decision:resolve cannot approve a proposal card without applying it', async () => {
    const { h, dir } = await open()
    const r = await h.resolveDecision({ id: 'D-030', choice: 'A' })
    expect(r).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(await readdir(join(dir, 'company/decisions/pending'))).toContain('D-030-p.md')
    // 거절은 일반 경로로도 처리된다.
    expect((await h.resolveDecision({ id: 'D-030', choice: 'B' })).ok).toBe(true)
  })

  it('proposal:apply refuses without a state directory and validates its input', async () => {
    const none = await open()
    expect(await none.h.applyProposal({ id: 'D-030', choice: 'A' })).toMatchObject({
      ok: false,
      code: 'internal'
    })
    const { h } = await open(true)
    for (const bad of [null, 'D-030', { id: 'D-030' }, { id: 'D-030', choice: 'A', path: '/etc' }])
      expect(await h.applyProposal(bad)).toMatchObject({ ok: false, code: 'invalid-request' })
    // 내용이 없는 카드는 적용 가능한 블록이 없다.
    expect(await h.applyProposal({ id: 'D-030', choice: 'A' })).toMatchObject({
      ok: true,
      value: { ok: false, code: 'not-actionable' }
    })
  })
})
