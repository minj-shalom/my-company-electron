import { describe, expect, it } from 'vitest'
import type { ProposalAction } from '../../shared/proposal'
import { extractProposalBlocks, parseProposalBlock, renderProposalBlock } from './proposal-block'

const HASH = 'a'.repeat(64)
const parse = (s: string): string => {
  const r = parseProposalBlock(s)
  return r.ok ? 'ok' : r.reason
}

describe('proposal block parser', () => {
  it('round-trips every allowed action', () => {
    const actions: ProposalAction[] = [
      { action: 'assign', project: 'alpha', employee: 'developer' },
      { action: 'unassign', project: 'alpha', employee: 'ui-dev' },
      {
        action: 'hire',
        template: 'designer',
        id: 'designer',
        department: '디자인팀',
        reportsTo: 'COO',
        title: '디자이너'
      },
      {
        action: 'update',
        id: 'developer',
        description: '설명',
        model: 'sonnet',
        tools: ['Read', 'Edit'],
        base: HASH,
        after: 'b'.repeat(64)
      },
      { action: 'move', id: 'pm', department: '기획팀', reportsTo: 'CTO' },
      { action: 'retire', id: 'devops' },
      {
        action: 'policy-change',
        project: 'alpha',
        revision: 'rev1',
        values: { flow: 'x', modes: { push: 'every' } }
      }
    ]
    const r = parseProposalBlock(renderProposalBlock(actions))
    expect(r).toEqual({ ok: true, actions })
  })

  it('rejects unknown actions, keys, duplicate keys and non-list lines', () => {
    expect(parse('- action: delete-everything')).toBe('unknown-action')
    expect(parse('- action: assign\n- project: alpha\n- employee: pm\n- shell: rm -rf')).toBe(
      'unknown-key'
    )
    expect(parse('- action: assign\n- project: alpha\n- project: beta\n- employee: pm')).toBe(
      'duplicate-key'
    )
    expect(parse('- project: alpha')).toBe('bad-line')
    expect(parse('action: assign')).toBe('bad-line')
    expect(parse('- action: assign\nproject: alpha')).toBe('bad-line')
    expect(parse('')).toBe('empty')
    expect(parse('- action: assign\n- project: alpha')).toBe('missing-key')
    expect(parse('- action: assign\n- __proto__: x\n- employee: pm')).toBe('bad-line')
  })

  it('rejects path-shaped or malformed names', () => {
    for (const e of ['../../etc/passwd', 'a/b', '.hidden', 'A', 'x y', '', '-x', 'a'.repeat(51)])
      expect(parse(`- action: retire\n- id: ${e}`)).not.toBe('ok')
    expect(parse('- action: assign\n- project: ../x\n- employee: pm')).toBe('bad-value')
    expect(
      parse('- action: hire\n- template: ../t\n- id: x\n- department: d\n- reports-to: COO')
    ).toBe('bad-value')
  })

  it('refuses CEO and COO targets and protected titles', () => {
    expect(parse('- action: retire\n- id: coo')).toBe('protected')
    expect(parse('- action: update\n- id: ceo\n- description: x')).toBe('protected')
    expect(parse('- action: assign\n- project: alpha\n- employee: coo')).toBe('protected')
    expect(parse('- action: move\n- id: pm\n- title:  COO'.replace(':  ', ': '))).toBe('protected')
    expect(parse('- action: move\n- id: pm\n- title: coo')).toBe('protected')
    expect(
      parse(
        '- action: hire\n- template: pm\n- id: pm2\n- department: d\n- reports-to: COO\n- title: Coo'
      )
    ).toBe('protected')
  })

  it('enforces size and count limits', () => {
    const one = (i: number): string => `- action: retire\n- id: emp${i}`
    const ten = Array.from({ length: 10 }, (_, i) => one(i)).join('\n')
    expect(parse(ten)).toBe('ok')
    expect(parse(`${ten}\n${one(10)}`)).toBe('too-many')
    expect(parse('- action: retire\n- id: x\n' + '#'.repeat(20_000))).toBe('too-large')
    expect(parse(`- action: update\n- id: x\n- description: ${'가'.repeat(1001)}`)).toBe(
      'bad-value'
    )
    expect(
      parse(
        `- action: policy-change\n- project: a\n- revision: r\n- values: ${JSON.stringify({ k: 'x'.repeat(3100) })}`
      )
    ).toBe('bad-value')
  })

  it('rejects duplicate and contradictory actions', () => {
    const a = '- action: assign\n- project: alpha\n- employee: pm'
    expect(parse(`${a}\n${a}`)).toBe('duplicate-action')
    expect(parse(`${a}\n- action: unassign\n- project: alpha\n- employee: pm`)).toBe(
      'duplicate-action'
    )
    expect(parse('- action: update\n- id: pm\n- description: a\n- action: retire\n- id: pm')).toBe(
      'duplicate-action'
    )
  })

  it('rejects control characters, backticks, pipes and bad hashes or json', () => {
    expect(parse('- action: move\n- id: pm\n- department: a b')).toBe('bad-line')
    expect(parse('- action: move\n- id: pm\n- department: a\u0000b')).toBe('bad-value')
    expect(parse('- action: move\n- id: pm\n- department: a`b')).toBe('bad-value')
    expect(parse('- action: move\n- id: pm\n- role: a|b')).toBe('bad-value')
    expect(parse(`- action: update\n- id: pm\n- base: ${'A'.repeat(64)}\n- after: ${HASH}`)).toBe(
      'bad-value'
    )
    expect(parse(`- action: update\n- id: pm\n- base: ${HASH}`)).toBe('missing-key')
    expect(parse('- action: policy-change\n- project: a\n- revision: r\n- values: [1]')).toBe(
      'bad-value'
    )
    expect(parse('- action: policy-change\n- project: a\n- revision: r\n- values: {bad')).toBe(
      'bad-value'
    )
    expect(parse('- action: update\n- id: pm\n- tools: Read, $(rm -rf /)')).toBe('bad-value')
  })
})

describe('extractProposalBlocks', () => {
  it('finds proposal fences only and drops unclosed ones', () => {
    const md =
      'a\n```proposal\n- action: retire\n- id: x\n```\n```js\nfoo\n```\n```proposal\n- action: retire'
    expect(extractProposalBlocks(md)).toEqual(['- action: retire\n- id: x'])
  })
  it('does not let a value close the fence', () => {
    const r = parseProposalBlock('- action: move\n- id: pm\n- role: a ``` b')
    expect(r.ok).toBe(false)
  })
})
