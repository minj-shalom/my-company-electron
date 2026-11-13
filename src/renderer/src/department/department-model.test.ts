import { describe, expect, it } from 'vitest'
import { mockGetOrg } from '../mock-org'
import {
  departmentErrorText,
  departmentRows,
  leadCandidates,
  renameNeedsApproval,
  validateNewName,
  validateRename
} from './department-model'

const load = async (): Promise<Parameters<typeof departmentRows>[0]> => {
  const r = await mockGetOrg('normal')()
  if (!r.ok) throw new Error('mock')
  return r.value
}

describe('department-model', () => {
  it('lists filled and empty departments with block reasons', async () => {
    const rows = departmentRows(await load())
    const by = (n: string): (typeof rows)[number] => rows.find((r) => r.name === n)!
    expect(by('개발팀').removeBlock).toMatch(/4명/)
    expect(by('법무팀')).toMatchObject({ count: 0, removeBlock: null })
    expect(by('경영').renameBlock).toMatch(/COO/)
    expect(by('개발팀').renameBlock).toBeNull()
  })

  it('validates names, duplicates and self rename', async () => {
    const s = await load()
    expect(validateNewName('', s)).toMatch(/입력/)
    expect(validateNewName('a|b', s)).toMatch(/기호/)
    expect(validateNewName('가'.repeat(31), s)).toMatch(/30자/)
    expect(validateNewName(' 개발팀', s)).toBeTruthy()
    expect(validateNewName('개발 팀', s)).toMatch(/이미/)
    expect(validateNewName('콘텐츠팀', s)).toBeNull()
    expect(validateRename('개발팀', '개발팀', s)).toMatch(/같아요/)
    expect(validateRename('개발팀', '기획팀', s)).toMatch(/이미/)
    expect(validateRename('개발팀', '제품팀', s)).toBeNull()
  })

  it('flags approval and excludes protected leads', async () => {
    const s = await load()
    expect(renameNeedsApproval('R&D', s)).toBe(true)
    expect(renameNeedsApproval('개발팀', s)).toBe(false)
    const c = leadCandidates(s)
    expect(c.every((x) => x.member.kind === 'agent')).toBe(true)
    expect(c.find((x) => x.member.agentId === 'cto')?.block).toMatch(/승인/)
    expect(c.find((x) => x.member.agentId === 'pm')?.block).toBeNull()
  })

  it('uses plain Korean error text without raw codes', () => {
    expect(departmentErrorText('approval-required', 'rename')).toMatch(/CEO 승인이 필요해요/)
    expect(departmentErrorText('forbidden', 'rename')).toMatch(/바꿀 수 없어요/)
    expect(departmentErrorText('conflict', 'remove')).toMatch(/옮기거나 퇴사/)
    expect(departmentErrorText('internal', 'add')).not.toMatch(/internal/)
  })
})
