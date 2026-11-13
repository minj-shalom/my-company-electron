import { readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ApiResult } from '../../shared/result'
import type { PolicySaveResult, PolicyState, PolicyValues } from '../../shared/policy'
import { makeProjectTest, type ProjectTest } from '../project/test-project-company'
import { PolicyService } from './policy-service'

const tests: ProjectTest[] = []
afterEach(async () => {
  for (const t of tests.splice(0))
    for (const d of t.dirs) await rm(d, { recursive: true, force: true })
})

const ID = 'my-company'
const NAME = 'My Company'

async function setup(): Promise<{ t: ProjectTest; svc: PolicyService; file: string }> {
  const t = await makeProjectTest()
  tests.push(t)
  const svc = new PolicyService({
    fs: t.c.fs,
    exclusive: (task) => t.c.repo.runExclusive(task),
    now: () => new Date('2026-11-13T09:00:00.000Z')
  })
  return { t, svc, file: join(t.c.dir, 'company/policies', `${ID}.md`) }
}
const ok = <T>(r: ApiResult<T>): T => {
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`)
  return r.value
}
const code = (r: ApiResult<unknown>): string => (r.ok ? 'ok' : r.code)
const get = async (svc: PolicyService, id = ID): Promise<PolicyState> =>
  ok(await svc.get({ projectId: id }))

function req(
  state: PolicyState,
  patch: Partial<PolicyValues>,
  extra: Record<string, unknown> = {}
): unknown {
  return {
    projectId: state.projectId,
    revision: state.revision,
    values: { ...state.values, ...patch },
    ...extra
  }
}
const saved = (r: ApiResult<PolicySaveResult>): PolicyState => {
  const v = ok(r)
  if (!v.saved) throw new Error(`rejected: ${v.violations.map((x) => x.code).join(',')}`)
  return v.state
}
const violations = (r: ApiResult<PolicySaveResult>): string[] => {
  const v = ok(r)
  return v.saved ? [] : v.violations.map((x) => x.code)
}
const autoMerge: Partial<PolicyValues> = {
  modes: { push: 'every', merge: 'auto', publish: 'every', 'draft-approve': 'every' },
  dailyLimits: { merge: 2 },
  autoMergeBranches: ['develop']
}

describe('policy:get defaults', () => {
  it('returns conservative defaults for a project without a policy file', async () => {
    const { svc, file } = await setup()
    const s = await get(svc)
    expect(s.exists).toBe(false)
    expect(Object.values(s.effective.modes)).toEqual(['every', 'every', 'every', 'every'])
    expect(s.warnings).toEqual([])
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })
  it('rejects unknown and path-escaping project ids without touching the disk', async () => {
    const { svc } = await setup()
    expect(code(await svc.get({ projectId: 'nope' }))).toBe('not-found')
    for (const id of ['../org', '../../etc/passwd', 'a/b', 'A', '', 5, null])
      expect(code(await svc.get({ projectId: id }))).toBe('invalid-request')
    expect(code(await svc.get(null))).toBe('invalid-request')
    const r = await svc.save({ projectId: '../x', revision: 'none', values: {} })
    expect(code(r)).toBe('invalid-request')
  })
})

describe('policy:save', () => {
  it('writes the file with known lines and a history entry, then reads it back', async () => {
    const { svc, file } = await setup()
    const s0 = await get(svc)
    const s1 = saved(
      await svc.save(req(s0, { modes: { ...s0.values.modes, push: 'batch' }, memo: '주 3회' }))
    )
    expect(s1.exists).toBe(true)
    expect(s1.values.modes.push).toBe('batch')
    expect(s1.history).toHaveLength(1)
    expect(s1.history[0]).toMatchObject({ actor: 'CEO 직접', at: '2026-11-13T09:00:00.000Z' })
    expect(s1.history[0].summary).toContain('푸시: 매번 컨펌→묶음 컨펌')
    const text = await readFile(file, 'utf8')
    expect(text).toContain('- 푸시: 묶음 컨펌')
    expect(text).toContain('## 변경 이력')
    expect(text).not.toContain('주 3회\n- 2026') // 메모 내용은 이력에 넣지 않는다
    expect(s1.history[0].summary).not.toContain('주 3회')
  })
  it('preserves unknown lines and prior history on later saves', async () => {
    const { svc, file } = await setup()
    saved(await svc.save(req(await get(svc), {})))
    const text = await readFile(file, 'utf8')
    await writeFile(
      file,
      text.replace(
        '# 정책: my-company',
        '# 정책: my-company\n\n직접 쓴 지침이에요.\n- 담당자 메모: 보존'
      )
    )
    const s = await get(svc)
    const s2 = saved(await svc.save(req(s, { usePr: false })))
    const out = await readFile(file, 'utf8')
    expect(out).toContain('직접 쓴 지침이에요.')
    expect(out).toContain('- 담당자 메모: 보존')
    expect(s2.history).toHaveLength(2)
  })
  it('does not write when nothing changed', async () => {
    const { svc, file } = await setup()
    const s1 = saved(await svc.save(req(await get(svc), { usePr: false })))
    const before = await readFile(file, 'utf8')
    const s2 = saved(await svc.save(req(s1, {})))
    expect(await readFile(file, 'utf8')).toBe(before)
    expect(s2.revision).toBe(s1.revision)
  })
  it('detects conflicts from a stale revision and from external edits', async () => {
    const { svc, file } = await setup()
    const s0 = await get(svc)
    saved(await svc.save(req(s0, { usePr: false })))
    expect(code(await svc.save(req(s0, { usePr: true })))).toBe('conflict')
    const s1 = await get(svc)
    await writeFile(file, `${await readFile(file, 'utf8')}\n외부 수정\n`)
    expect(code(await svc.save(req(s1, { usePr: true })))).toBe('conflict')
  })
  it('refuses oversized files and bad shapes', async () => {
    const { svc, file } = await setup()
    const s0 = await get(svc)
    saved(await svc.save(req(s0, {})))
    await writeFile(file, 'x'.repeat(70 * 1024))
    expect(code(await svc.get({ projectId: ID }))).toBe('internal')
    const s = { projectId: ID, revision: 'none' }
    expect(code(await svc.save({ ...s, values: 5 }))).toBe('ok') // 값 검증 위반은 saved:false로 돌려준다
    expect(violations(await svc.save({ ...s, values: 5 }))).toEqual(['invalid-value'])
    expect(code(await svc.save({ projectId: ID, values: s0.values }))).toBe('invalid-request')
  })
  it('rejects invalid field values with reasons', async () => {
    const { svc } = await setup()
    const s = await get(svc)
    const bads: Partial<PolicyValues>[] = [
      { outputDir: '../outside' },
      { outputDir: '/etc' },
      { dailyOutputGoal: 21 },
      { publishAdapter: 'Bad Adapter' },
      { branchPrefix: '--force' },
      { memo: 'a\nb' },
      { autoPushPrefixes: ['x y'] },
      { flow: 'x' as never }
    ]
    for (const b of bads) expect(violations(await svc.save(req(s, b)))).toContain('invalid-value')
    expect(
      violations(await svc.save({ ...(req(s, {}) as object), values: { ...s.values, extra: 1 } }))
    ).toContain('invalid-value')
  })
})

describe('immutable rules', () => {
  it('rejects values that relax immutable items', async () => {
    const { svc, file } = await setup()
    const s = await get(svc)
    for (const key of [
      'forcePush',
      'outsideWrite',
      'exposeCredentials',
      'disableAudit',
      'disableKillSwitch',
      'unlimited'
    ]) {
      const r = await svc.save({ ...(req(s, {}) as object), values: { ...s.values, [key]: true } })
      expect(violations(r)).toEqual(['immutable-relaxed'])
    }
    await expect(readFile(file, 'utf8')).rejects.toThrow()
  })
  it('warns about and ignores relaxing lines edited by hand', async () => {
    const { svc, file } = await setup()
    saved(await svc.save(req(await get(svc), {})))
    await writeFile(
      file,
      `${await readFile(file, 'utf8')}`.replace(
        '- 흐름',
        '- 강제 푸시: 허용\n- 감사 기록: 항상 유지\n- 흐름'
      )
    )
    const s = await get(svc)
    expect(s.warnings.filter((w) => w.code === 'immutable-relaxed')).toHaveLength(1)
    expect(Object.values(s.effective.modes)).toEqual(['every', 'every', 'every', 'every'])
  })
})

describe('auto mode', () => {
  it('requires the CEO path: agent actor cannot enable auto', async () => {
    const { svc } = await setup()
    const s = await get(svc)
    const r = await svc.apply(req(s, autoMerge, { confirmAuto: true }), { kind: 'agent' })
    expect(violations(r)).toContain('auto-needs-ceo')
    expect((await get(svc)).exists).toBe(false)
  })
  it('requires confirmAuto from the UI path', async () => {
    const { svc } = await setup()
    expect(violations(await svc.save(req(await get(svc), autoMerge)))).toEqual([
      'auto-needs-confirm'
    ])
  })
  it('records the activation and history when the CEO turns auto on, and off again', async () => {
    const { svc, file } = await setup()
    const s1 = saved(await svc.save(req(await get(svc), autoMerge, { confirmAuto: true })))
    expect(s1.activation).toMatchObject({ by: 'ceo-ui', at: '2026-11-13T09:00:00.000Z' })
    expect(s1.effective.modes.merge).toBe('auto')
    expect(s1.effective.dailyLimits).toEqual({ merge: 2 })
    expect(s1.history.at(-1)?.summary).toContain('자동 모드 켬')
    expect(s1.warnings).toEqual([])
    const s2 = saved(await svc.save(req(s1, { modes: { ...s1.values.modes, merge: 'every' } })))
    expect(s2.activation).toBeNull()
    expect(s2.history.at(-1)?.summary).toContain('자동 모드 끔')
    expect(await readFile(file, 'utf8')).not.toContain('자동 활성화')
  })
  it('records the approval card number via the proposal path', async () => {
    const { svc, file } = await setup()
    const s = await get(svc)
    expect(code(await svc.applyProposal(req(s, autoMerge), 'bad'))).toBe('invalid-request')
    const r = saved(await svc.applyProposal(req(s, autoMerge), 'D-021'))
    expect(r.activation?.by).toBe('D-021')
    expect(r.history.at(-1)?.actor).toBe('제안 D-021')
    expect(await readFile(file, 'utf8')).toContain('| D-021 |')
  })
  it('rejects auto without a limit, with too large a limit, or without targets', async () => {
    const { svc } = await setup()
    const s = await get(svc)
    const c = { confirmAuto: true }
    expect(violations(await svc.save(req(s, { ...autoMerge, dailyLimits: {} }, c)))).toContain(
      'auto-limit-missing'
    )
    expect(
      violations(await svc.save(req(s, { ...autoMerge, dailyLimits: { merge: 11 } }, c)))
    ).toContain('auto-limit-exceeded')
    expect(
      violations(await svc.save(req(s, { ...autoMerge, autoMergeBranches: [] }, c)))
    ).toContain('auto-target-missing')
    const push = {
      modes: { ...s.values.modes, push: 'auto' as const },
      dailyLimits: { push: 51 },
      autoPushPrefixes: ['feature/']
    }
    expect(violations(await svc.save(req(s, push, c)))).toContain('auto-limit-exceeded')
    const pub = {
      modes: { ...s.values.modes, publish: 'auto' as const },
      dailyLimits: { publish: 21 }
    }
    expect(violations(await svc.save(req(s, pub, c)))).toContain('auto-limit-exceeded')
    expect(violations(await svc.save(req(s, { ...autoMerge, usePr: false }, c)))).toContain(
      'auto-requirement-missing'
    )
    expect(
      violations(await svc.save(req(s, { ...autoMerge, reviewStage: 'recommended' }, c)))
    ).toContain('auto-requirement-missing')
  })
  it('does not allow protected branches as auto push targets', async () => {
    const { svc } = await setup()
    const s = await get(svc)
    const push = {
      modes: { ...s.values.modes, push: 'auto' as const },
      dailyLimits: { push: 5 },
      autoPushPrefixes: ['main/']
    }
    expect(violations(await svc.save(req(s, push, { confirmAuto: true })))).toContain(
      'auto-target-invalid'
    )
  })
  it('keeps the activation when an auto config is saved unchanged', async () => {
    const { svc } = await setup()
    const s1 = saved(await svc.save(req(await get(svc), autoMerge, { confirmAuto: true })))
    const s2 = saved(await svc.apply(req(s1, { memo: '메모만' }), { kind: 'agent' }))
    expect(s2.activation).toEqual(s1.activation)
  })
})

describe('protected branch auto merge', () => {
  const prot = (over: Partial<PolicyValues> = {}): Partial<PolicyValues> => ({
    ...autoMerge,
    autoMergeBranches: ['develop', 'master'],
    confirmInput: NAME,
    dailyLimits: { merge: 1 },
    ...over
  })
  it('is off by default', async () => {
    const { svc } = await setup()
    const s = await get(svc)
    expect(s.effective.protectedMergeEnabled).toBe(false)
    expect(s.values.autoMergeBranches).toEqual([])
  })
  it('turns on only with name confirmation, limit 1..2, and CEO activation', async () => {
    const { svc } = await setup()
    const s = await get(svc)
    const c = { confirmAuto: true }
    const on = saved(await svc.save(req(s, prot(), c)))
    expect(on.effective.protectedMergeEnabled).toBe(true)
    expect(on.history.at(-1)?.summary).toContain('보호 브랜치 자동 머지 켬')
  })
  it('rejects a mismatching name, limit 3, and a missing confirmation', async () => {
    const { svc } = await setup()
    const s = await get(svc)
    const c = { confirmAuto: true }
    expect(violations(await svc.save(req(s, prot({ confirmInput: 'my company' }), c)))).toContain(
      'protected-merge-unconfirmed'
    )
    expect(violations(await svc.save(req(s, prot({ confirmInput: null }), c)))).toContain(
      'protected-merge-unconfirmed'
    )
    expect(violations(await svc.save(req(s, prot({ dailyLimits: { merge: 3 } }), c)))).toContain(
      'protected-limit-exceeded'
    )
    expect(violations(await svc.save(req(s, prot({ dailyLimits: { merge: 0 } }), c)))).toContain(
      'protected-limit-exceeded'
    )
    expect(violations(await svc.save(req(s, prot(), {})))).toEqual(['auto-needs-confirm'])
  })
  it('falls back to confirm-every-time when the file is hand edited', async () => {
    const { svc, file } = await setup()
    const on = saved(await svc.save(req(await get(svc), prot(), { confirmAuto: true })))
    const text = await readFile(file, 'utf8')
    // 활성화 기록 삭제
    await writeFile(file, text.replace(/- 자동 활성화: .*\n/, ''))
    let s = await get(svc)
    expect(s.effective.modes.merge).toBe('every')
    expect(s.effective.protectedMergeEnabled).toBe(false)
    expect(s.warnings.map((w) => w.code)).toContain('auto-not-activated')
    // 상한을 손으로 올림: 설정 지문이 달라져 기록이 무효
    await writeFile(file, text.replace('머지=1', '머지=9'))
    s = await get(svc)
    expect(s.effective.modes.merge).toBe('every')
    expect(s.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['auto-activation-stale', 'protected-limit-exceeded'])
    )
    // 확인 입력을 손으로 바꿈
    await writeFile(file, text.replace(`확인 입력: ${NAME}`, '확인 입력: Other'))
    s = await get(svc)
    expect(s.effective.protectedMergeEnabled).toBe(false)
    expect(on.revision).not.toBe(s.revision)
  })
})

describe('hand edited files', () => {
  it('collects warnings and substitutes defaults', async () => {
    const { svc, file } = await setup()
    saved(await svc.save(req(await get(svc), {})))
    await writeFile(
      file,
      [
        '# 정책: my-company',
        '',
        '- 흐름: 마음대로',
        '- 푸시: 자동',
        '- 머지: 매번 컨펌',
        '- 머지: 자동',
        '- 일일 상한: 푸시=999999',
        '- 산출물 폴더: ../../etc',
        '- 일일 산출 목표: 500',
        ''
      ].join('\n')
    )
    const s = await get(svc)
    const codes = s.warnings.map((w) => w.code)
    expect(codes).toEqual(
      expect.arrayContaining(['invalid-value', 'duplicate-field', 'auto-not-activated'])
    )
    expect(s.values.flow).toBe('dev-git-pr')
    expect(s.values.outputDir).toBe('drafts/')
    expect(s.effective.modes.push).toBe('every')
    expect(s.effective.modes.merge).toBe('every')
  })
  it('summarizes auto actions for badges', async () => {
    const { svc } = await setup()
    saved(await svc.save(req(await get(svc), autoMerge, { confirmAuto: true })))
    const list = ok(await svc.listSummaries())
    expect(list.find((p) => p.projectId === ID)?.autoActions).toEqual(['merge'])
    expect(list.find((p) => p.projectId !== ID)?.autoActions).toEqual([])
  })
})

describe('path safety and errors', () => {
  it('refuses a symlinked policies folder without leaking paths', async () => {
    const { t, svc } = await setup()
    const s0 = await get(svc)
    await rm(join(t.c.dir, 'company/policies'), { recursive: true, force: true })
    await symlink(t.ws, join(t.c.dir, 'company/policies'))
    const r = await svc.save(req(s0, { usePr: false }))
    expect(code(r)).toBe('internal')
    const g = await svc.get({ projectId: ID })
    expect(code(g)).toBe('internal')
    for (const x of [r, g]) if (!x.ok) expect(x.message).not.toContain(t.ws)
  })
})

describe('protected branch detection', () => {
  const merge = (branches: string[]): Partial<PolicyValues> => ({
    ...autoMerge,
    autoMergeBranches: branches
  })
  it('treats ref-style and case variants of protected names as protected (needs confirmation)', async () => {
    const { svc } = await setup()
    const s = await get(svc)
    for (const b of ['Main', 'MASTER', 'trunk', 'stable', 'production', 'release/1.0'])
      expect(violations(await svc.save(req(s, merge([b]), { confirmAuto: true })))).toContain(
        'protected-merge-unconfirmed'
      )
  })
  it('rejects ref-style names as auto targets and still flags them as protected', async () => {
    const { svc } = await setup()
    const s = await get(svc)
    for (const b of [
      'refs/heads/main',
      'heads/main',
      'origin/main',
      'refs/remotes/origin/master'
    ]) {
      const v = violations(await svc.save(req(s, merge([b]), { confirmAuto: true })))
      expect(v).toContain('auto-target-invalid')
      expect(v).toContain('protected-merge-unconfirmed')
    }
  })
  it('rejects push prefixes that cover protected names or lack a trailing slash', async () => {
    const { svc } = await setup()
    const s = await get(svc)
    const push = (p: string[]): Partial<PolicyValues> => ({
      modes: { ...s.values.modes, push: 'auto' },
      dailyLimits: { push: 5 },
      autoPushPrefixes: p
    })
    for (const p of [
      'ma/',
      'mas/',
      'pro/',
      'main/',
      'Trunk/',
      'stable/',
      'release/',
      'refs/heads/',
      'origin/main/'
    ])
      expect(violations(await svc.save(req(s, push([p]), { confirmAuto: true })))).toContain(
        'auto-target-invalid'
      )
    for (const p of ['ma', 'mas', 'pro', 'feature'])
      expect(violations(await svc.save(req(s, push([p]), { confirmAuto: true })))).toContain(
        'invalid-value'
      )
    expect(
      saved(await svc.save(req(s, push(['feature/', 'fix/']), { confirmAuto: true }))).effective
        .autoPushPrefixes
    ).toEqual(['feature/', 'fix/'])
  })

  it('appendHistory adds a history line without touching value lines or the activation record', async () => {
    const { svc, file } = await setup()
    const st = await get(svc)
    saved(await svc.save(req(st, { memo: '메모' })))
    const before = await readFile(file, 'utf8')
    await svc.appendHistory(ID, '킬 스위치 켬: 회사 전체')
    const after = await readFile(file, 'utf8')
    expect(after.startsWith(before.replace(/\n*$/, '\n'))).toBe(true)
    expect(after.split('\n').filter((l) => l.includes('킬 스위치 켬'))).toHaveLength(1)
    expect((await get(svc)).history.at(-1)?.summary).toBe('킬 스위치 켬: 회사 전체')
  })
})
