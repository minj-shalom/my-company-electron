import { mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectInfo } from '../../shared/project'
import type { TicketCreateRequest, TicketUpdateRequest } from '../../shared/ticket'
import { makeCompany, type TestCompany } from '../employee/test-company'
import { TicketService } from './ticket-service'
import { renderTicket, rewriteTicket, slugify } from './ticket-text'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

const proj = (id: string, over: Partial<ProjectInfo> = {}): ProjectInfo =>
  ({
    id,
    name: id,
    status: 'active',
    pmId: 'pm',
    state: 'ready',
    ...over
  }) as ProjectInfo

async function setup(
  projects: ProjectInfo[] = [
    proj('web'),
    proj('old', { status: 'archived', state: 'archived' }),
    proj('nopm', { pmId: null, state: 'pm-required' })
  ]
): Promise<{
  c: TestCompany
  svc: TicketService
  put: (rel: string, text: string) => Promise<void>
  read: (rel: string) => Promise<string>
  names: (status: string) => Promise<string[]>
}> {
  const c = await makeCompany()
  dirs.push(c.dir)
  const svc = new TicketService({
    fs: c.fs,
    exclusive: (t) => c.repo.runExclusive(t),
    employeeIds: async () => new Set((await c.repo.listEmployees()).org.employees.map((e) => e.id)),
    projects: async () => projects,
    getTicket: (id) => c.repo.getTicket(id)
  })
  const put = async (rel: string, text: string): Promise<void> => {
    await mkdir(dirname(join(c.dir, rel)), { recursive: true })
    await writeFile(join(c.dir, rel), text)
  }
  return {
    c,
    svc,
    put,
    read: (rel) => readFile(join(c.dir, rel), 'utf8'),
    names: (s) => readdir(join(c.dir, 'company/tickets', s)).catch(() => [])
  }
}

const req = (over: Partial<TicketCreateRequest> = {}): TicketCreateRequest => ({
  title: 'Add login page',
  goal: '로그인 화면을 만든다.',
  criteria: ['폼이 보인다', '오류가 보인다'],
  ...over
})

const OLD = `# T-007: Old title

- **상태:** backlog
- **담당:** developer
- **부서:** 개발팀
- **브랜치:** feature/T-007
- **의존:** T-001

## 목표
옛 목표

## 완료 조건
- [ ] 옛 조건

## 메모
지켜야 할 메모
`

function upd(body: string, over: Partial<TicketUpdateRequest> = {}): TicketUpdateRequest {
  return {
    id: 'T-007',
    expectedBody: body,
    title: 'New title',
    goal: '새 목표',
    criteria: ['새 조건 1', '새 조건 2'],
    assignee: 'pm',
    department: '기획팀',
    projectId: 'web',
    ...over
  }
}

describe('slugify', () => {
  it('허용 문자만 남긴다', () => {
    expect(slugify('Add Login, Page!')).toBe('add-login-page')
    expect(slugify('../../etc/passwd')).toBe('etc-passwd')
    expect(slugify('로그인 화면')).toBe('ticket')
    expect(slugify('a'.repeat(80)).length).toBe(50)
    expect(slugify('  --x--  ')).toBe('x')
  })
})

describe('ticket:create', () => {
  it('backlog에 템플릿 형식으로 쓰고 번호는 전체 최대 + 1', async () => {
    const t = await setup()
    await t.put('company/tickets/done/T-009-x.md', '# T-009: x\n')
    await t.put('company/tickets/in-progress/T-012-y.md', '# T-012: y\n')
    const r = await t.svc.create(
      req({ assignee: 'developer', department: '개발팀', projectId: 'web' })
    )
    expect(r.ok && r.value.id).toBe('T-013')
    expect(r.ok && r.value.status).toBe('backlog')
    expect(r.ok && r.value.assignee).toBe('developer')
    const text = await t.read('company/tickets/backlog/T-013-add-login-page.md')
    expect(text).toContain('# T-013: Add login page')
    expect(text).toContain('- **프로젝트:** web')
    expect(text).toContain('- [ ] 폼이 보인다')
  })

  it('티켓이 없으면 T-001부터, 담당 없음과 회사 공통을 허용한다', async () => {
    const t = await setup()
    const r = await t.svc.create(req({ assignee: null }))
    expect(r.ok && r.value.id).toBe('T-001')
    expect(r.ok && r.value.assignee).toBeNull()
    const text = await t.read('company/tickets/backlog/T-001-add-login-page.md')
    expect(text).toContain('- **담당:** 없음')
    expect(text).not.toContain('프로젝트:')
  })

  it('담당을 생략하면 프로젝트의 담당 PM이 기본값이고 PM 필요 프로젝트는 담당 없음', async () => {
    const t = await setup()
    const a = await t.svc.create(req({ projectId: 'web' }))
    expect(a.ok && a.value.assignee).toBe('pm')
    const b = await t.svc.create(req({ projectId: 'nopm' }))
    expect(b.ok && b.value.assignee).toBeNull()
  })

  it('동시 호출도 번호가 겹치지 않는다', async () => {
    const t = await setup()
    const rs = await Promise.all([1, 2, 3, 4].map(() => t.svc.create(req())))
    expect(rs.map((r) => r.ok && r.value.id).sort()).toEqual(['T-001', 'T-002', 'T-003', 'T-004'])
  })

  it('같은 이름 파일이 다른 쓰기로 먼저 생기면 번호를 다시 계산해 1회 재시도한다', async () => {
    const t = await setup()
    let calls = 0
    const real = t.c.fs.listMarkdown.bind(t.c.fs)
    // 번호 계산(백로그 스캔) 직후 CLI 에이전트가 같은 번호 파일을 만든 상황을 흉내 낸다.
    t.c.fs.listMarkdown = async (d: string) => {
      const out = await real(d)
      if (d.endsWith('/done') && ++calls === 1)
        await t.put('company/tickets/backlog/T-001-add-login-page.md', '# T-001: other\n')
      return out
    }
    const r = await t.svc.create(req())
    expect(r.ok && r.value.id).toBe('T-002')
    expect(await t.read('company/tickets/backlog/T-001-add-login-page.md')).toBe('# T-001: other\n')
  })

  it('재시도도 충돌하면 conflict이고 기존 파일은 그대로다', async () => {
    const t = await setup()
    const real = t.c.fs.listMarkdown.bind(t.c.fs)
    let n = 0
    t.c.fs.listMarkdown = async (d: string) => {
      const out = await real(d)
      if (d.endsWith('/done')) {
        n++
        await t.put(`company/tickets/backlog/T-00${n}-add-login-page.md`, `# T-00${n}: other\n`)
      }
      return out
    }
    const r = await t.svc.create(req())
    expect(r).toMatchObject({ ok: false, code: 'conflict' })
    expect(await t.read('company/tickets/backlog/T-001-add-login-page.md')).toBe('# T-001: other\n')
  })

  it('`../` 제목은 파일명에 영향을 주지 않고 backlog 밖에 쓰지 않는다', async () => {
    const t = await setup()
    const r = await t.svc.create(req({ title: '../../../evil' }))
    expect(r.ok).toBe(true)
    expect(await t.names('backlog')).toEqual(['T-001-evil.md'])
    expect(await readdir(join(t.c.dir, 'company'))).not.toContain('evil.md')
  })

  it('줄 구조를 바꾸는 입력은 제거하거나 거부한다', async () => {
    const t = await setup()
    const r = await t.svc.create(
      req({ title: 'a\n- **담당:** hacker b', criteria: ['x\r\n## 목표'] })
    )
    expect(r.ok && r.value.title).toBe('a - **담당:** hackerb')
    expect(await t.svc.create(req({ goal: 'ok\n## 새 섹션' }))).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
    expect(await t.svc.create(req({ goal: '```\nx' }))).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
  })

  it('입력 한도를 검증한다', async () => {
    const t = await setup()
    const bad = async (o: Partial<TicketCreateRequest>): Promise<void> =>
      expect(await t.svc.create(req(o))).toMatchObject({ ok: false, code: 'invalid-request' })
    await bad({ title: '' })
    await bad({ title: ' ​ ' })
    await bad({ title: 'x'.repeat(101) })
    await bad({ goal: 'x'.repeat(2001) })
    await bad({ criteria: [] })
    await bad({ criteria: Array.from({ length: 21 }, () => 'c') })
    await bad({ criteria: ['x'.repeat(301)] })
    await bad({ criteria: ['ok', '  '] })
    await bad({ assignee: 'ghost' })
    await bad({ assignee: '../x' })
    await bad({ projectId: 'unknown' })
    await bad({ projectId: 'old' })
    await bad({ title: 5 as unknown as string })
    expect(await t.svc.create({ ...req(), id: 'T-999' })).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
    expect(await t.svc.create({ ...req(), status: 'done' })).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
    expect(await t.svc.create(null)).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(await t.names('backlog')).toEqual([])
  })

  it('경계 길이는 허용한다', async () => {
    const t = await setup()
    const r = await t.svc.create(
      req({
        title: 'x'.repeat(100),
        goal: 'g'.repeat(2000),
        criteria: Array.from({ length: 20 }, () => 'c'.repeat(300))
      })
    )
    expect(r.ok).toBe(true)
  })

  it('오류 메시지에 내부 경로가 없다', async () => {
    const t = await setup()
    await rm(join(t.c.dir, 'company/tickets'), { recursive: true, force: true })
    await symlink(t.c.dir, join(t.c.dir, 'company/tickets'))
    const r = await t.svc.create(req())
    expect(r.ok).toBe(false)
    expect(JSON.stringify(r)).not.toContain(t.c.dir)
  })
})

describe('ticket:update', () => {
  it('제목, 담당, 부서, 프로젝트, 목표, 완료 조건을 바꾸고 나머지는 보존한다', async () => {
    const t = await setup()
    await t.put('company/tickets/backlog/T-007-old.md', OLD)
    const r = await t.svc.update(upd(OLD))
    expect(r.ok && r.value).toMatchObject({
      id: 'T-007',
      title: 'New title',
      assignee: 'pm',
      department: '기획팀'
    })
    const text = await t.read('company/tickets/backlog/T-007-old.md')
    expect(text).toContain('- **프로젝트:** web')
    expect(text).toContain('- **의존:** T-001')
    expect(text).toContain('지켜야 할 메모')
    expect(text).toContain('- [ ] 새 조건 2')
    expect(text).not.toContain('옛')
    expect(await t.names('backlog')).toEqual(['T-007-old.md'])
  })

  it('담당 없음, 부서와 프로젝트 제거', async () => {
    const t = await setup()
    const withProject = OLD.replace('- **부서:**', '- **프로젝트:** web\n- **부서:**')
    await t.put('company/tickets/backlog/T-007-old.md', withProject)
    const r = await t.svc.update(
      upd(withProject, { assignee: null, department: null, projectId: null })
    )
    expect(r.ok && r.value.assignee).toBeNull()
    const text = await t.read('company/tickets/backlog/T-007-old.md')
    expect(text).toContain('- **담당:** 없음')
    expect(text).not.toContain('부서:')
    expect(text).not.toContain('프로젝트:')
  })

  it.each(['in-progress', 'done'])('%s 티켓 편집은 거부하고 파일을 바꾸지 않는다', async (st) => {
    const t = await setup()
    await t.put(`company/tickets/${st}/T-007-old.md`, OLD)
    const r = await t.svc.update(upd(OLD))
    expect(r).toMatchObject({ ok: false, code: 'forbidden' })
    expect(await t.read(`company/tickets/${st}/T-007-old.md`)).toBe(OLD)
  })

  it('없는 티켓은 not-found, 잘못된 id는 invalid-request', async () => {
    const t = await setup()
    expect(await t.svc.update(upd(OLD))).toMatchObject({ ok: false, code: 'not-found' })
    expect(await t.svc.update(upd(OLD, { id: '../T-007' }))).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
  })

  it('편집 시작 후 파일이 바뀌었으면 conflict', async () => {
    const t = await setup()
    await t.put('company/tickets/backlog/T-007-old.md', OLD + '추가\n')
    expect(await t.svc.update(upd(OLD))).toMatchObject({ ok: false, code: 'conflict' })
    expect(await t.read('company/tickets/backlog/T-007-old.md')).toBe(OLD + '추가\n')
  })

  it('쓰기 직전 재읽기에서 바뀌었으면 conflict', async () => {
    const t = await setup()
    await t.put('company/tickets/backlog/T-007-old.md', OLD)
    const real = t.c.fs.readText.bind(t.c.fs)
    let reads = 0
    t.c.fs.readText = async (rel: string) => {
      const out = await real(rel)
      if (rel.endsWith('T-007-old.md') && ++reads === 1)
        await t.put('company/tickets/backlog/T-007-old.md', OLD + '외부 수정\n')
      return out
    }
    expect(await t.svc.update(upd(OLD))).toMatchObject({ ok: false, code: 'conflict' })
    expect(await t.read('company/tickets/backlog/T-007-old.md')).toBe(OLD + '외부 수정\n')
  })

  it('깨진 파일은 덮어쓰지 않는다', async () => {
    const t = await setup()
    const broken = '제목이 없는 파일\n'
    await t.put('company/tickets/backlog/T-007-old.md', broken)
    expect(await t.svc.update(upd(broken))).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(await t.read('company/tickets/backlog/T-007-old.md')).toBe(broken)
  })

  it('frontmatter가 담당을 덮는 형식은 의도와 다르게 읽히므로 거부한다', async () => {
    const t = await setup()
    const fm = `---\nassignee: developer\n---\n${OLD}`
    await t.put('company/tickets/backlog/T-007-old.md', fm)
    expect(await t.svc.update(upd(fm))).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(await t.read('company/tickets/backlog/T-007-old.md')).toBe(fm)
  })

  it('보관된 프로젝트는 기존 소속 유지만 허용한다', async () => {
    const t = await setup()
    const archived = OLD.replace('- **부서:**', '- **프로젝트:** old\n- **부서:**')
    await t.put('company/tickets/backlog/T-007-old.md', archived)
    expect(
      await t.svc.update(upd(archived, { projectId: 'old', department: '개발팀' }))
    ).toMatchObject({ ok: true })
    const fresh = await setup()
    await fresh.put('company/tickets/backlog/T-007-old.md', OLD)
    expect(await fresh.svc.update(upd(OLD, { projectId: 'old' }))).toMatchObject({
      ok: false,
      code: 'invalid-request'
    })
  })

  it('CRLF 줄바꿈과 코드 펜스 안의 같은 모양 줄을 보존한다', async () => {
    const t = await setup()
    const crlf = OLD.replace('## 메모\n', '## 메모\n```\n- **담당:** fake\n## 목표\n```\n').replace(
      /\n/g,
      '\r\n'
    )
    await t.put('company/tickets/backlog/T-007-old.md', crlf)
    const r = await t.svc.update(upd(crlf))
    expect(r.ok).toBe(true)
    const text = await t.read('company/tickets/backlog/T-007-old.md')
    expect(text).toContain('- **담당:** fake\r\n## 목표\r\n```')
    expect(text).not.toMatch(/[^\r]\n/)
  })

  it('저장한 결과를 다시 편집해도 같다 (멱등)', async () => {
    const t = await setup()
    await t.put('company/tickets/backlog/T-007-old.md', OLD)
    await t.svc.update(upd(OLD))
    const once = await t.read('company/tickets/backlog/T-007-old.md')
    await t.svc.update(upd(once))
    expect(await t.read('company/tickets/backlog/T-007-old.md')).toBe(once)
  })
})

describe('ticket-text', () => {
  it('rewrite는 제목 없는 본문을 거부한다', () => {
    expect(
      rewriteTicket('본문만', 'T-001', {
        title: 'a',
        goal: '',
        criteria: ['c'],
        assignee: null,
        department: null,
        projectId: null
      })
    ).toBeNull()
  })

  it('render 결과를 rewrite해도 안정적이다', () => {
    const f = {
      title: 'a',
      goal: 'g',
      criteria: ['c'],
      assignee: null,
      department: null,
      projectId: 'web'
    }
    const text = renderTicket('T-001', f)
    expect(rewriteTicket(text, 'T-001', f)).toBe(text)
  })
})
