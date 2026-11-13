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
  it('without hr: direct hire is the main button', async () => {
    const html = renderToStaticMarkup(
      createElement(HireEntry, { snapshot: await load('no-hr'), onHired: () => undefined })
    )
    expect(html).toContain('직원 채용')
    expect(html).not.toContain('인사팀에 채용 요청')
  })
  it('with hr: request is disabled and manual hire is folded', async () => {
    const html = renderToStaticMarkup(
      createElement(HireEntry, { snapshot: await load('normal'), onHired: () => undefined })
    )
    expect(html).toContain('인사팀에 채용 요청')
    expect(html).toContain('aria-disabled="true"')
    expect(html).toContain('<details')
  })
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
