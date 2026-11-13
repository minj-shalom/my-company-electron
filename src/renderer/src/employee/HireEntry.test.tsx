import type { OrgSnapshot } from '../../../shared/org'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { mockGetOrg } from '../mock-org'
import { HireEntry } from './HireEntry'
import { MemberManager } from './MemberManager'

const load = async (s: 'normal' | 'no-hr'): Promise<OrgSnapshot> => {
  const r = await mockGetOrg(s)()
  if (!r.ok) throw new Error('mock')
  return r.value
}

describe('HireEntry', () => {
  it.each(['no-hr', 'normal'] as const)(
    '%s: only one hire button, no request or manual menu',
    async (k) => {
      const html = renderToStaticMarkup(
        createElement(HireEntry, { snapshot: await load(k), onHired: () => undefined })
      )
      expect(html.match(/직원 채용/g)).toHaveLength(1)
      expect(html).not.toContain('인사팀에 채용 요청')
      expect(html).not.toContain('직접 채용')
      expect(html).not.toContain('COO 대화')
      expect(html).not.toContain('<details')
      expect(html).not.toContain('aria-disabled')
    }
  )
})

describe('MemberManager', () => {
  it('shows unassigned chip, blocked retire reason and hr approval note', async () => {
    const s = await load('normal')
    const render = (title: string): string =>
      renderToStaticMarkup(
        createElement(MemberManager, {
          member: s.org.members.find((m) => m.title === title)!,
          snapshot: s,
          onDirtyChange: () => undefined,
          onChanged: () => undefined,
          onRetired: () => undefined
        })
      )
    const cto = render('CTO')
    expect(cto).toContain('배정 대기')
    expect(cto).toContain('보고하는 직원이 있어요')
    expect(cto).toContain('이 직원의 변경은 승인이 필요해요')
    expect(render('QA')).not.toContain('member-manager__reason')
  })
})
