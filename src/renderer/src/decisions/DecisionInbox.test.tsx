import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Decision } from '../../../shared/decision'
import { DecisionCard } from './DecisionCard'
import { DecisionInbox } from './DecisionInbox'
import type { DecisionsState } from './decision-view'

const card = (over: Partial<Decision> = {}): Decision => ({
  id: 'D-001',
  title: '<img src=x onerror=alert(1)>',
  status: 'pending',
  ticketId: 'T-014',
  question: '<script>alert(1)</script>\n두 번째 줄',
  options: [
    { key: 'A', label: '승인', description: '진행' },
    { key: 'B', label: '거절', description: '보류' }
  ],
  recommended: 'A',
  chosen: null,
  memo: '',
  kind: 'proposal',
  proposedBy: 'hr',
  ...over
})

const noop = async (): Promise<string | null> => null
const inbox = (state: DecisionsState): string =>
  renderToStaticMarkup(
    <DecisionInbox state={state} refresh={async () => {}} markResolved={() => {}} />
  )

describe('DecisionInbox states', () => {
  it('renders loading, error and empty', () => {
    expect(inbox({ kind: 'loading' })).toContain('불러오고 있어요')
    const err = inbox({ kind: 'error', message: '결재함을 불러오지 못했어요.' })
    expect(err).toContain('role="alert"')
    expect(err).toContain('다시 시도')
    expect(inbox({ kind: 'ready', items: [], unreadable: [], stale: false })).toContain(
      '결재를 기다리는 일이 없어요'
    )
  })
  it('shows pending count, unreadable banner and keeps an empty auto-mode slot', () => {
    const html = inbox({
      kind: 'ready',
      items: [card(), card({ id: 'D-002', kind: undefined })],
      unreadable: [
        { path: 'decisions/pending/x.md', reason: 'duplicate' },
        { path: 'decisions/done/y.md', reason: 'too-large' }
      ],
      stale: false
    })
    expect(html).toContain('읽지 못한 카드 1건 (파일 확인 필요)')
    expect(html).toContain('decisions/pending/x.md')
    expect(html).not.toContain('decisions/done/y.md')
    expect(html).toContain('data-slot="auto-mode"></div>')
    expect(html).toContain('유형 필터')
  })
})

describe('DecisionCard', () => {
  it('escapes card text and shows proposer for proposals', () => {
    const html = renderToStaticMarkup(
      <DecisionCard decision={card()} expanded onToggle={() => {}} onResolve={noop} />
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('제안자')
    expect(html).toContain('인사(hr)')
    expect(html).toContain('추천')
    expect(html).toContain('aria-expanded="true"')
  })
  it('hides proposer on non-proposal cards and treats unknown kind as plain', () => {
    const html = renderToStaticMarkup(
      <DecisionCard
        decision={card({ kind: 'bogus' as Decision['kind'] })}
        expanded
        onToggle={() => {}}
        onResolve={noop}
      />
    )
    expect(html).not.toContain('제안자')
    expect(html).toContain('일반 결정')
  })
  it('shows the chosen option and memo for done cards', () => {
    const html = renderToStaticMarkup(
      <DecisionCard
        decision={card({ status: 'done', chosen: 'B', memo: '보류 사유' })}
        expanded
        onToggle={() => {}}
        onResolve={noop}
      />
    )
    expect(html).toContain('결과: B. 거절')
    expect(html).toContain('보류 사유')
    expect(html).not.toContain('<form')
  })
  it('has no submit controls until a choice is made', () => {
    const html = renderToStaticMarkup(
      <DecisionCard decision={card()} expanded onToggle={() => {}} onResolve={noop} />
    )
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>선택 확인/)
    expect(html).not.toContain('결정 확정')
  })
})
