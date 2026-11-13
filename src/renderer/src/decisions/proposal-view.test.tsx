import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PROPOSAL_FAILURE_CODES } from '../../../shared/proposal'
import { createMockDecisionApi } from '../mock-decisions'
import { QuestionBody } from './ProposalPanel'
import {
  actionView,
  isApprovable,
  proposalFailureText,
  quarantinedEmployees,
  splitQuestion,
  usesApplyApi
} from './proposal-view'

const block = (lines: string[]): string => ['앞 설명', '```proposal', ...lines, '```'].join('\n')

describe('proposal view', () => {
  it('has a distinct sentence for every failure code', () => {
    const texts = PROPOSAL_FAILURE_CODES.map((c) => proposalFailureText(c))
    expect(new Set(texts).size).toBe(PROPOSAL_FAILURE_CODES.length)
    expect(proposalFailureText('rollback-failed')).toContain('직접 확인')
    expect(proposalFailureText('???')).toBe(proposalFailureText('failed'))
  })
  it('splits fences, flags unknown actions and blocks approval', () => {
    const ok = splitQuestion(block(['- action: retire', '- id: qa']))
    expect(ok.map((s) => s.type)).toEqual(['text', 'proposal'])
    expect(isApprovable(ok)).toBe(true)
    const bad = splitQuestion(block(['- action: rm-rf', '- id: x']))
    expect(bad[1]).toMatchObject({ type: 'invalid' })
    expect(isApprovable(bad)).toBe(false)
    expect(isApprovable(splitQuestion('그냥 텍스트'))).toBe(false)
    // 닫히지 않은 펜스는 텍스트
    expect(splitQuestion('```proposal\n- action: retire')).toEqual([
      { type: 'text', text: '```proposal\n- action: retire' }
    ])
  })
  it('emphasizes Bash and model changes and renders text only', () => {
    const [, seg] = splitQuestion(
      block([
        '- action: update',
        '- id: developer',
        '- model: opus',
        '- tools: Read, Bash',
        '- description: <img src=x onerror=alert(1)>'
      ])
    )
    if (seg.type !== 'proposal') throw new Error('expected proposal')
    expect(actionView(seg.actions[0]).escalation).toBe(true)
    const html = renderToStaticMarkup(<QuestionBody segments={[seg]} />)
    expect(html).toContain('권한 변경')
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })
  it('reads quarantined ids only in valid form', () => {
    expect(quarantinedEmployees('격리된 직원(developer, ../x)은 해제될 때까지')).toEqual([
      'developer'
    ])
    expect(quarantinedEmployees('없음')).toEqual([])
  })
  it('routes only the three approval kinds to applyProposal', () => {
    expect(
      ['proposal', 'integrity-warning', 'revert-suggestion'].every((k) => usesApplyApi(k as never))
    ).toBe(true)
    expect(usesApplyApi('decision')).toBe(false)
    expect(usesApplyApi('git-confirm')).toBe(false)
  })
  it('mock applies, and reports stale/rollback-failed per scenario', async () => {
    const m = createMockDecisionApi('samples').api
    const r = await m.applyProposal({ id: 'D-010', choice: 'A' })
    expect(r).toEqual({ ok: true, value: { ok: true, status: 'applied', applied: 1 } })
    const stale = createMockDecisionApi('stale').api
    expect(await stale.applyProposal({ id: 'D-010', choice: 'A' })).toEqual({
      ok: true,
      value: { ok: false, code: 'stale' }
    })
    const rb = createMockDecisionApi('rollback').api
    expect(await rb.applyProposal({ id: 'D-011', choice: 'A' })).toEqual({
      ok: true,
      value: { ok: false, code: 'rollback-failed' }
    })
  })
})
