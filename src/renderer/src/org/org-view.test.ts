import { describe, expect, it } from 'vitest'
import type { OrgSnapshot } from '../../../shared/org'
import { mockGetOrg, parseOrgScenario } from '../mock-org'
import {
  describeIssue,
  groupByDepartment,
  loadOrgStatus,
  memberDetail,
  nextListIndex,
  NO_DEPARTMENT,
  toOrgStatus
} from './org-view'

async function normal(): Promise<OrgSnapshot> {
  const r = await mockGetOrg('normal')()
  if (!r.ok) throw new Error('mock failed')
  return r.value
}

describe('describeIssue', () => {
  it('uses Korean text, appends the line and ignores the raw message', () => {
    const v = describeIssue({ code: 'cycle', message: '/secret/path cycle', line: 7 })
    expect(v.text).toContain('(7번째 줄)')
    expect(v.text).not.toContain('secret')
    expect(v.blocking).toBe(false)
  })
  it('marks missing-org as blocking and handles unknown codes', () => {
    expect(describeIssue({ code: 'missing-org', message: '' }).blocking).toBe(true)
    const odd = describeIssue({ code: 'nope' as never, message: '', line: -1 })
    expect(odd.text).not.toContain('줄')
    expect(odd.blocking).toBe(false)
  })
})

describe('toOrgStatus / loadOrgStatus', () => {
  it('returns ready with issues for a populated org', async () => {
    const s = toOrgStatus(await normal())
    expect(s.kind).toBe('ready')
  })
  it('returns empty (with causes) when there are no members', async () => {
    const r = await mockGetOrg('empty')()
    const s = toOrgStatus(r.ok ? r.value : (null as never))
    expect(s).toEqual({ kind: 'empty', issues: [] })
    const withIssue = toOrgStatus({
      org: {
        members: [],
        departments: [],
        tree: [],
        chart: [],
        issues: [{ code: 'missing-org', message: '' }]
      },
      agents: []
    })
    expect(withIssue.kind === 'empty' && withIssue.issues[0].blocking).toBe(true)
  })
  it('maps not-implemented, failures and throws to error states', async () => {
    const ni = await loadOrgStatus({
      getOrg: async () => ({ ok: false, code: 'not-implemented', message: 'x' })
    })
    expect(ni).toMatchObject({ kind: 'error', message: expect.stringContaining('지원하지 않아요') })
    const bad = await loadOrgStatus({ getOrg: mockGetOrg('error') })
    expect(bad.kind).toBe('error')
    const thrown = await loadOrgStatus({
      getOrg: async () => {
        throw new Error('/internal/path')
      }
    })
    expect(thrown.kind === 'error' && thrown.message).not.toContain('internal')
  })
})

describe('groupByDepartment', () => {
  it('keeps department order, gives each a tone and collects leftovers', async () => {
    const snap = await normal()
    snap.org.members.push({
      title: '인턴',
      kind: 'invalid',
      agentId: null,
      fileExists: false,
      department: null,
      reportsTo: null,
      role: ''
    })
    const groups = groupByDepartment(snap)
    expect(groups.map((g) => g.name)).toEqual([
      '경영',
      'R&D',
      '재무',
      '기획팀',
      '개발팀',
      NO_DEPARTMENT
    ])
    expect(groups[0].tone).toBe('exec')
    expect(groups[4].tone).toBe('exec') // 4색을 돌려 쓴다
    expect(groups[4].members.map((m) => m.title)).toContain('UI 개발자')
  })
  it('does not list a member twice or invent unknown titles', async () => {
    const snap = await normal()
    snap.org.departments[0].members.push('CTO', '없는직급')
    const all = groupByDepartment(snap).flatMap((g) => g.members.map((m) => m.title))
    expect(all.filter((t) => t === 'CTO')).toHaveLength(1)
    expect(all).not.toContain('없는직급')
  })
})

describe('memberDetail', () => {
  it('shows role, model and tools of an agent', async () => {
    const snap = await normal()
    const cto = snap.org.members.find((m) => m.title === 'CTO')!
    const d = memberDetail(cto, snap.agents)
    expect(d).toMatchObject({ model: 'opus', kindLabel: 'AI 직원', fileNote: null })
    expect(d.tools).toContain('Bash')
  })
  it('falls back to empty values when model/tools are missing', async () => {
    const snap = await normal()
    const ui = snap.org.members.find((m) => m.title === 'UI 개발자')!
    expect(memberDetail(ui, snap.agents)).toMatchObject({ model: '정보 없음', tools: [] })
  })
  it('handles humans, missing files and absent agent data', async () => {
    const snap = await normal()
    const ceo = snap.org.members.find((m) => m.title === 'CEO')!
    expect(memberDetail(ceo, snap.agents)).toMatchObject({
      kindLabel: '사람',
      model: '정보 없음',
      name: null,
      reportsTo: '없음 (최상위)'
    })
    const devops = snap.org.members.find((m) => m.title === 'DevOps')!
    expect(memberDetail(devops, snap.agents).fileNote).toContain('아직 없어요')
    expect(memberDetail({ ...devops, role: '  ' }, []).role).toBe('정보 없음')
  })
})

describe('nextListIndex', () => {
  it('moves without wrapping and supports Home/End', () => {
    expect(nextListIndex('ArrowDown', 0, 3)).toBe(1)
    expect(nextListIndex('ArrowDown', 2, 3)).toBe(2)
    expect(nextListIndex('ArrowUp', 0, 3)).toBe(0)
    expect(nextListIndex('Home', 2, 3)).toBe(0)
    expect(nextListIndex('End', 0, 3)).toBe(2)
    expect(nextListIndex('a', 0, 3)).toBeNull()
    expect(nextListIndex('ArrowDown', 0, 0)).toBeNull()
  })
})

describe('parseOrgScenario', () => {
  it('accepts known scenarios only', () => {
    expect(parseOrgScenario('?mock-org=empty')).toBe('empty')
    expect(parseOrgScenario('?mock-org=<script>')).toBe('normal')
    expect(parseOrgScenario('')).toBe('normal')
  })
})
