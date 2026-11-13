import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProposalAction, ProposalApplyResult } from '../../shared/proposal'
import { EmployeeService } from '../employee/employee-service'
import { createFileGateCards } from '../gate/gate-cards'
import { createMemoryStateStore } from '../gate/state-store'
import { HR_AUDIT_FILE, HrAudit } from '../integrity/hr-audit'
import { IntegrityService } from '../integrity/integrity-service'
import { IntegrityStateStore } from '../integrity/integrity-state'
import { filesWithSecrets, sha256 } from '../integrity/protected-files'
import { SnapshotStore } from '../integrity/snapshot-store'
import { cleanup, company, put } from '../integrity/test-kit'
import { PolicyService } from '../policy/policy-service'
import { createAssignmentSource } from '../project/assignments-store'
import { ProjectService } from '../project/project-service'
import { createProposalCards } from './proposal-cards'
import { renderProposalBlock } from './proposal-block'
import { ProposalService } from './proposal-service'

const tmp: string[] = []
afterEach(async () => {
  await cleanup()
  for (const d of tmp.splice(0)) await rm(d, { recursive: true, force: true })
})

interface Setup {
  c: Awaited<ReturnType<typeof company>>
  svc: ProposalService
  policy: PolicyService
  integrity: IntegrityService
  cards: ReturnType<typeof createFileGateCards>
  read: (rel: string) => Promise<string>
  make: (actions: ProposalAction[], by?: 'hr' | 'coo') => Promise<string>
  apply: (id: string, choice?: string, extra?: object) => Promise<ProposalApplyResult>
  pendingIds: () => Promise<string[]>
  audit: () => Promise<string[]>
}

async function setup(): Promise<Setup> {
  const c = await company()
  const snapDir = await mkdtemp(join(tmpdir(), 'mc-psnap-'))
  tmp.push(snapDir)
  const exclusive = <T>(t: () => Promise<T>): Promise<T> => c.repo.runExclusive(t)
  const cards = createFileGateCards({ fs: c.fs, exclusive })
  const integrity = new IntegrityService({
    fs: c.fs,
    exclusive,
    snapshots: new SnapshotStore(snapDir, () => new Date(), filesWithSecrets),
    state: new IntegrityStateStore(createMemoryStateStore()),
    audit: new HrAudit({ fs: c.fs, exclusive }),
    cards
  })
  await integrity.reconcile()
  const project = new ProjectService({
    fs: c.fs,
    exclusive,
    inProgress: { list: async () => ({ tickets: [], unreadable: 0 }) },
    homeDir: '/nonexistent-home'
  })
  const policy = new PolicyService({ fs: c.fs, exclusive })
  const svc = new ProposalService({
    fs: c.fs,
    exclusive,
    repo: c.repo,
    employeeFor: (cardId) =>
      new EmployeeService({
        fs: c.fs,
        exclusive,
        isApproved: async (id) => id === cardId,
        assignments: createAssignmentSource(c.fs)
      }),
    project,
    policy,
    integrity
  })
  const read = (rel: string): Promise<string> => readFile(join(c.dir, rel), 'utf8')
  const make = async (actions: ProposalAction[], by: 'hr' | 'coo' = 'hr'): Promise<string> => {
    const r = await createProposalCards(
      cards,
      by,
      `\`\`\`proposal\n${renderProposalBlock(actions)}\n\`\`\``
    )
    expect(r.rejected).toBe(0)
    return r.cardIds[0]
  }
  const apply = async (
    id: string,
    choice = 'A',
    extra: object = {}
  ): Promise<ProposalApplyResult> => {
    const r = await svc.apply({ id, choice, ...extra })
    if (!r.ok) throw new Error(`api ${r.code}`)
    return r.value
  }
  const pendingIds = async (): Promise<string[]> =>
    (await readdir(join(c.dir, 'company/decisions/pending'))).filter((f) => f.includes('-gate-'))
  const audit = async (): Promise<string[]> =>
    (await c.fs.readText(HR_AUDIT_FILE)).split('\n').filter((l) => l.startsWith('| 20'))
  return { c, svc, policy, integrity, cards, read, make, apply, pendingIds, audit }
}

const CARD = `# D-090: 두 블록

- **관련 티켓:** 없음
- **상태:** pending
- **유형:** proposal
- **제안자:** coo

## 질문
요약

\`\`\`proposal
- action: assign
- project: alpha
- employee: devops
\`\`\`

\`\`\`proposal
- action: retire
- id: pm
\`\`\`

## 선택지
1. **A. 승인** — x
2. **B. 거절** — y
`

const HIRE: ProposalAction = {
  action: 'hire',
  template: 'designer',
  id: 'designer',
  department: '디자인팀',
  reportsTo: 'COO'
}

describe('proposal cards from hr output', () => {
  it('creates a proposal card per valid block and counts rejected blocks', async () => {
    const s = await setup()
    const text = [
      '```proposal\n- action: assign\n- project: alpha\n- employee: pm\n```',
      '```proposal\n- action: rm -rf\n```',
      '```proposal\n- action: retire\n- id: ../etc/passwd\n```'
    ].join('\n')
    const r = await createProposalCards(s.cards, 'hr', text)
    expect(r.cardIds).toHaveLength(1)
    expect(r.rejected).toBe(2)
    const card = await s.c.repo.getDecision(r.cardIds[0])
    expect(card.ok && card.value.kind).toBe('proposal')
    expect(card.ok && card.value.proposedBy).toBe('hr')
    expect(card.ok && card.value.options.map((o) => o.label)).toEqual(['승인', '거절'])
  })
})

describe('proposal:apply', () => {
  it('rejects malformed requests without touching anything', async () => {
    const s = await setup()
    for (const bad of [
      null,
      [],
      'D-001',
      { id: 'D-1' },
      { id: '../x', choice: 'A' },
      { id: 'D-001', choice: 'A', actor: 'ceo-ui' },
      { id: 'D-001', choice: 'A', stateHash: 'zz' },
      { id: 'D-001', choice: 'A'.repeat(30) },
      Object.assign(Object.create({ inherited: 1 }), { id: 'D-001', choice: 'A' })
    ])
      expect((await s.svc.apply(bad)).ok).toBe(false)
  })

  it('applies an approved assignment, records the audit with the card, and is idempotent', async () => {
    const s = await setup()
    const id = await s.make([{ action: 'assign', project: 'alpha', employee: 'devops' }])
    expect(await s.apply(id)).toEqual({ ok: true, status: 'applied', applied: 1 })
    expect(await s.read('company/project.md')).toContain('devops')
    expect((await s.c.repo.getDecision(id)).ok).toBe(true)
    const line = (await s.audit()).find((l) => l.includes('company/project.md'))
    expect(line).toContain('approved-proposal')
    expect(line).toContain(id)
    // 승인된 적용은 되돌리기 카드를 만들지 않는다.
    expect((await s.pendingIds()).filter((f) => f.includes('revert'))).toEqual([])
    expect(await s.apply(id)).toEqual({ ok: true, status: 'already-applied' })
    expect(await s.apply(id, 'B')).toEqual({ ok: true, status: 'already-applied' })
  })

  it('rejecting writes nothing and a rejected card cannot be applied later', async () => {
    const s = await setup()
    const before = await s.read('company/project.md')
    const id = await s.make([{ action: 'assign', project: 'alpha', employee: 'devops' }])
    expect(await s.apply(id, 'B')).toEqual({ ok: true, status: 'rejected' })
    expect(await s.read('company/project.md')).toBe(before)
    expect(await s.apply(id, 'A')).toEqual({ ok: true, status: 'already-rejected' })
    expect(await s.read('company/project.md')).toBe(before)
  })

  it('hires with the card as approval and retires a sensitive agent without a revert card', async () => {
    const s = await setup()
    const id = await s.make([HIRE])
    expect((await s.apply(id)).ok).toBe(true)
    expect(await s.read('.claude/agents/designer.md')).toContain('designer')
    expect(await s.read('company/org.md')).toContain('designer')
    const id2 = await s.make([{ action: 'retire', id: 'devops' }])
    expect((await s.apply(id2)).ok).toBe(true)
    await expect(s.read('.claude/agents/devops.md')).rejects.toThrow()
    expect((await s.pendingIds()).filter((f) => f.includes('revert'))).toEqual([])
    // 직원 파일과 조직도 변경은 승인된 앱 변경으로 인정되어 미승인(민감 변경)으로 판정되지 않는다.
    // 조직도 코드 블록 불일치는 org-store가 블록을 갱신하지 않는 기존 한계라 여기서는 보지 않는다.
    expect((await s.audit()).filter((l) => l.includes('unapproved'))).toEqual([])
    expect(await s.integrity.quarantined()).not.toContain('devops')
  })

  it('is atomic: a failing action rolls back earlier ones and keeps the card pending with a note', async () => {
    const s = await setup()
    const before = { p: await s.read('company/project.md'), o: await s.read('company/org.md') }
    const id = await s.make([
      { action: 'assign', project: 'alpha', employee: 'devops' },
      { ...HIRE, reportsTo: 'NoSuchTitle' }
    ])
    expect(await s.apply(id)).toEqual({ ok: false, code: 'rejected-by-rule' })
    expect(await s.read('company/project.md')).toBe(before.p)
    expect(await s.read('company/org.md')).toBe(before.o)
    const pending = await readdir(join(s.c.dir, 'company/decisions/pending'))
    const file = pending.find((f) => f.startsWith(`${id}-`))
    expect(file).toBeDefined()
    const text = await s.read(`company/decisions/pending/${file}`)
    expect(text).toContain('## 처리 오류')
    expect(text).toContain('rejected-by-rule')
    // 롤백은 되돌리기 카드를 남기지 않는다.
    expect((await s.pendingIds()).filter((f) => f.includes('revert'))).toEqual([])
  })

  it('rejects stale proposals before writing anything', async () => {
    const s = await setup()
    const base = sha256(await s.read('.claude/agents/developer.md'))
    const id = await s.make([{ action: 'update', id: 'developer', description: '새 설명', base }])
    await put(
      s.c.dir,
      '.claude/agents/developer.md',
      (await s.read('.claude/agents/developer.md')) + '\n'
    )
    const prev = await s.read('.claude/agents/developer.md')
    expect(await s.apply(id)).toEqual({ ok: false, code: 'stale' })
    expect(await s.read('.claude/agents/developer.md')).toBe(prev)
  })

  it('applies a policy change with the current revision and reports an old one as stale', async () => {
    const s = await setup()
    const st = await s.policy.get({ projectId: 'alpha' })
    if (!st.ok) throw new Error('policy')
    const values = { ...st.value.values, modes: { ...st.value.values.modes, push: 'batch' } }
    const old = await s.make([
      { action: 'policy-change', project: 'alpha', revision: 'old', values }
    ])
    expect(await s.apply(old)).toEqual({ ok: false, code: 'stale' })
    const id = await s.make([
      { action: 'policy-change', project: 'alpha', revision: st.value.revision, values }
    ])
    expect(await s.apply(id)).toEqual({ ok: true, status: 'applied', applied: 1 })
    expect(await s.read('company/policies/alpha.md')).toContain('묶음 컨펌')
    const lines = await s.audit()
    expect(
      lines.some((l) => l.includes('policies/alpha.md') && l.includes('approved-proposal'))
    ).toBe(true)
  })

  it('refuses immutable-rule relaxation even when approved', async () => {
    const s = await setup()
    const id = await s.make([
      { action: 'policy-change', project: 'alpha', revision: 'none', values: { forcePush: true } }
    ])
    // 값 검증이 revision 비교보다 먼저라 불변 규칙 완화는 항상 protected다.
    expect(await s.apply(id)).toEqual({ ok: false, code: 'protected' })
    expect(await readdir(join(s.c.dir, 'company')).then((l) => l.includes('policies'))).toBe(false)
  })

  it('does not let a card approve a different change by reusing its number', async () => {
    const s = await setup()
    // 승인 서비스는 카드 번호 하나에만 묶인다: 다른 번호로는 민감 변경이 거부된다.
    const other = new EmployeeService({
      fs: s.c.fs,
      exclusive: (t) => s.c.repo.runExclusive(t),
      isApproved: async (id) => id === 'D-001'
    })
    const r = await other.retire({ id: 'developer', approval: 'D-999' }, 'approved-proposal')
    expect(r.ok).toBe(false)
  })

  it('only treats cards with the exact approve/reject contract as actionable', async () => {
    const s = await setup()
    const id = await s.cards.create({
      kind: 'proposal',
      title: 't',
      ticketId: null,
      question: 'q',
      options: [
        { key: 'A', label: '실행', description: 'x' },
        { key: 'B', label: '거절', description: 'y' }
      ],
      impact: 'i',
      proposedBy: 'hr',
      block: renderProposalBlock([{ action: 'retire', id: 'devops' }])
    })
    expect(await s.apply(id)).toEqual({ ok: false, code: 'not-actionable' })
    // 알 수 없는 액션이 든 카드는 거절만 할 수 있다.
    const unknown = await s.cards.create({
      kind: 'proposal',
      title: 't',
      ticketId: null,
      question: 'q',
      options: [
        { key: 'A', label: '승인', description: 'x' },
        { key: 'B', label: '거절', description: 'y' }
      ],
      impact: 'i',
      proposedBy: 'coo',
      block: '- action: format-disk'
    })
    expect(await s.apply(unknown)).toEqual({ ok: false, code: 'not-actionable' })
    expect(await s.apply(unknown, 'B')).toEqual({ ok: true, status: 'rejected' })
    const generic = await s.cards.create({
      kind: 'decision',
      title: 't',
      ticketId: null,
      question: 'q',
      options: [{ key: 'A', label: '확인', description: 'x' }],
      impact: 'i'
    })
    expect(await s.apply(generic)).toEqual({ ok: false, code: 'not-actionable' })
  })

  it('refuses a hand-written card with two proposal fences', async () => {
    const s = await setup()
    await put(s.c.dir, 'company/decisions/pending/D-090-two.md', CARD)
    expect(await s.apply('D-090')).toEqual({ ok: false, code: 'not-actionable' })
    expect(await s.read('company/project.md')).not.toContain('devops')
  })
})

describe('approval records and T-052', () => {
  const edit = async (s: Setup): Promise<{ next: string; base: string; after: string }> => {
    const cur = await s.read('.claude/agents/cto.md')
    const next = cur.replace(/description: .*/, 'description: 새로운 CTO 설명')
    return { next, base: sha256(cur), after: sha256(next) }
  }

  it('hr re-edit matching the approved hash is clean; the approval is consumed', async () => {
    const s = await setup()
    const { next, base, after } = await edit(s)
    const id = await s.make([{ action: 'update', id: 'cto', base, after }])
    expect(await s.apply(id)).toEqual({ ok: true, status: 'approved-pending-edit', applied: 1 })
    await put(s.c.dir, '.claude/agents/cto.md', next)
    const r = await s.integrity.reconcile()
    expect(r.status).toBe('clean')
    expect(await s.integrity.quarantined()).toEqual([])
    // 승인은 한 번만 쓰인다: 같은 변경을 되돌렸다 다시 하면 미승인이다.
    await put(s.c.dir, '.claude/agents/cto.md', next.replace('새로운 CTO 설명', '또 다른'))
    expect((await s.integrity.reconcile()).status).toBe('flagged')
  })

  it('hr edit with a different hash is detected as unapproved and quarantined', async () => {
    const s = await setup()
    const { next, base, after } = await edit(s)
    const id = await s.make([{ action: 'update', id: 'cto', base, after }])
    await s.apply(id)
    await put(s.c.dir, '.claude/agents/cto.md', `${next}\n- 몰래 추가한 지침\n`)
    const r = await s.integrity.reconcile()
    expect(r.status).toBe('flagged')
    expect(await s.integrity.quarantined()).toContain('cto')
  })

  it('without approval the same edit is flagged', async () => {
    const s = await setup()
    const { next } = await edit(s)
    await put(s.c.dir, '.claude/agents/cto.md', next)
    expect((await s.integrity.reconcile()).status).toBe('flagged')
  })

  it('refuses an approval-only update whose base no longer matches', async () => {
    const s = await setup()
    const { base, after } = await edit(s)
    const id = await s.make([{ action: 'update', id: 'cto', base: 'f'.repeat(64), after }])
    expect(await s.apply(id)).toEqual({ ok: false, code: 'stale' })
    void base
  })
})

describe('integrity cards', () => {
  const unapproved = async (s: Setup): Promise<string> => {
    const cur = await s.read('.claude/agents/cto.md')
    await put(
      s.c.dir,
      '.claude/agents/cto.md',
      cur.replace(/description: .*/, 'description: 무단 변경')
    )
    const r = await s.integrity.reconcile()
    expect(r.cardIds).toHaveLength(1)
    return r.cardIds[0]
  }

  it('restore choice restores, releases quarantine and resolves the card', async () => {
    const s = await setup()
    const original = await s.read('.claude/agents/cto.md')
    const id = await unapproved(s)
    expect(await s.integrity.quarantined()).toEqual(['cto'])
    expect(await s.apply(id, 'A')).toEqual({ ok: true, status: 'restored' })
    expect(await s.read('.claude/agents/cto.md')).toBe(original)
    expect(await s.integrity.quarantined()).toEqual([])
    expect((await s.pendingIds()).some((f) => f.startsWith(id))).toBe(false)
  })

  it('late-approval choice accepts the current state', async () => {
    const s = await setup()
    const id = await unapproved(s)
    expect(await s.apply(id, 'B')).toEqual({ ok: true, status: 'accepted' })
    expect(await s.read('.claude/agents/cto.md')).toContain('무단 변경')
    expect(await s.integrity.quarantined()).toEqual([])
  })

  it('a stale state hash refuses restore and keeps the card pending', async () => {
    const s = await setup()
    const id = await unapproved(s)
    const r = await s.apply(id, 'A', { stateHash: '0'.repeat(64) })
    expect(r).toEqual({ ok: false, code: 'stale' })
    expect((await s.pendingIds()).some((f) => f.startsWith(id))).toBe(true)
    expect(await s.integrity.quarantined()).toEqual(['cto'])
  })
})

describe('review fixes', () => {
  const revertCard = (hash: string | null): string => `# D-091: 되돌리기

- **관련 티켓:** 없음
- **상태:** pending
- **유형:** revert-suggestion

## 질문
무단 변경

## 선택지
1. **A. 되돌리기** — x
2. **B. 사후 승인** — y

## 영향
- 격리 안내.${hash === null ? '' : ` 상태 해시: ${hash}`}
`

  it('restore and accept need the state hash in the card and refuse without it', async () => {
    const s = await setup()
    await put(s.c.dir, 'company/decisions/pending/D-091-r.md', revertCard(null))
    for (const choice of ['A', 'B'])
      expect(await s.apply('D-091', choice)).toEqual({ ok: false, code: 'not-actionable' })
    // 요청의 해시로 카드의 누락을 대신할 수 없다.
    expect(await s.apply('D-091', 'A', { stateHash: 'a'.repeat(64) })).toEqual({
      ok: false,
      code: 'not-actionable'
    })
  })

  it('uses the card hash when the request omits it and is stale after later changes', async () => {
    const s = await setup()
    const cur = await s.read('.claude/agents/cto.md')
    await put(s.c.dir, '.claude/agents/cto.md', cur.replace(/description: .*/, 'description: 무단'))
    const id = (await s.integrity.reconcile()).cardIds[0]
    // 카드를 만든 뒤 상태가 더 바뀌었다: 요청에 해시가 없어도 카드의 해시로 stale이 된다.
    await put(
      s.c.dir,
      '.claude/agents/cto.md',
      cur.replace(/description: .*/, 'description: 또 무단')
    )
    expect(await s.apply(id, 'A')).toEqual({ ok: false, code: 'stale' })
    expect(await s.read('.claude/agents/cto.md')).toContain('또 무단')
    // 요청 해시가 카드와 다르면 거부한다.
    expect(await s.apply(id, 'B', { stateHash: 'c'.repeat(64) })).toEqual({
      ok: false,
      code: 'stale'
    })
  })

  it('summary shows tools/model/policy values and collapses beyond five actions', async () => {
    const s = await setup()
    const acts: ProposalAction[] = [
      { action: 'update', id: 'developer', tools: ['Read', 'Bash'], model: 'opus' },
      { action: 'policy-change', project: 'alpha', revision: 'r', values: { flow: 'x' } },
      ...['pm', 'ui-dev', 'devops', 'cfo', 'cto', 'hr'].map((id): ProposalAction => ({
        action: 'retire',
        id
      }))
    ]
    const id = await s.make(acts)
    const d = await s.c.repo.getDecision(id)
    if (!d.ok) throw new Error('card')
    expect(d.value.question).toContain('도구: Read, Bash')
    expect(d.value.question).toContain('모델: opus')
    expect(d.value.question).toContain('"flow":"x"')
    expect(d.value.question).toContain('외 3건')
  })

  it('rolls back when the approval record cannot be saved', async () => {
    const s = await setup()
    const cur = await s.read('.claude/agents/cto.md')
    const next = cur.replace(/description: .*/, 'description: 새 설명')
    const projectBefore = await s.read('company/project.md')
    const id = await s.make([
      { action: 'assign', project: 'alpha', employee: 'devops' },
      { action: 'update', id: 'cto', base: sha256(cur), after: sha256(next) }
    ])
    vi.spyOn(s.integrity, 'approve').mockRejectedValue(new Error('disk'))
    expect(await s.apply(id)).toEqual({ ok: false, code: 'failed' })
    expect(await s.read('company/project.md')).toBe(projectBefore)
    expect((await s.pendingIds()).some((f) => f.startsWith(id))).toBe(true)
  })

  it('removes approval records saved before a later record fails to save', async () => {
    const s = await setup()
    const cto = await s.read('.claude/agents/cto.md')
    const ctoNext = cto.replace(/description: .*/, 'description: 새로운 CTO 설명')
    const cfo = await s.read('.claude/agents/cfo.md')
    const cfoNext = cfo.replace(/description: .*/, 'description: 새로운 CFO 설명')
    const id = await s.make([
      { action: 'update', id: 'cto', base: sha256(cto), after: sha256(ctoNext) },
      { action: 'update', id: 'cfo', base: sha256(cfo), after: sha256(cfoNext) }
    ])
    const real = s.integrity.approve.bind(s.integrity)
    let calls = 0
    vi.spyOn(s.integrity, 'approve').mockImplementation(async (f, b, a) => {
      if (++calls === 2) throw new Error('disk')
      await real(f, b, a)
    })
    expect(await s.apply(id)).toEqual({ ok: false, code: 'failed' })
    expect(calls).toBe(2)
    // 첫 승인이 남아 있으면 이 편집이 승인된 변경으로 통과한다. 지워졌으니 미승인으로 걸려야 한다.
    await put(s.c.dir, '.claude/agents/cto.md', ctoNext)
    expect((await s.integrity.reconcile()).status).toBe('flagged')
  })

  it('treats hire, move and retire against a changed company as stale', async () => {
    const s = await setup()
    const before = await s.read('company/org.md')
    const hire = await s.make([{ ...HIRE, id: 'developer', template: 'developer' }])
    expect(await s.apply(hire)).toEqual({ ok: false, code: 'stale' })
    const gone = await s.make([{ action: 'retire', id: 'nobody' }])
    expect(await s.apply(gone)).toEqual({ ok: false, code: 'stale' })
    const mv = await s.make([{ action: 'move', id: 'nobody', department: '기획팀' }])
    expect(await s.apply(mv)).toEqual({ ok: false, code: 'stale' })
    expect(await s.read('company/org.md')).toBe(before)
  })

  it('reports rollback-failed instead of swallowing a failed restore', async () => {
    const s = await setup()
    const id = await s.make([
      { action: 'assign', project: 'alpha', employee: 'devops' },
      { ...HIRE, reportsTo: 'NoSuchTitle' }
    ])
    const real = s.c.fs.writeText.bind(s.c.fs)
    let projectWrites = 0
    vi.spyOn(s.c.fs, 'writeText').mockImplementation(async (rel, content, overwrite) => {
      if (rel === 'company/project.md' && ++projectWrites >= 2) throw new Error('disk')
      return real(rel, content, overwrite)
    })
    expect(await s.apply(id)).toEqual({ ok: false, code: 'rollback-failed' })
  })
})
