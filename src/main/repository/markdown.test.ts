import { describe, expect, it } from 'vitest'
import { section, splitFrontmatter } from './markdown'

describe('splitFrontmatter', () => {
  it('parses yaml and returns body', () => {
    const r = splitFrontmatter('---\nname: a\ndescription: "x: y"\n---\n# T\n')
    expect(r.data).toEqual({ name: 'a', description: 'x: y' })
    expect(r.body).toBe('# T\n')
  })
  it('returns empty data without frontmatter', () => {
    expect(splitFrontmatter('# T\n').data).toEqual({})
  })
  it('throws on invalid yaml and non-mapping', () => {
    expect(() => splitFrontmatter('---\na: [1\n---\nx')).toThrow()
    expect(() => splitFrontmatter('---\n- a\n---\nx')).toThrow()
  })
  it('rejects alias bombs', () => {
    const bomb = `---\na: &a [x,x,x,x,x,x,x,x,x,x,x,x]\nb: [${Array(20).fill('*a').join(',')}]\n---\n`
    expect(() => splitFrontmatter(bomb)).toThrow()
  })
  it('does not execute js tags', () => {
    const r = splitFrontmatter('---\na: !!js/function "function(){}"\n---\n')
    expect(typeof r.data.a === 'string' || r.data.a === null || r.data.a === undefined).toBe(true)
    expect(typeof r.data.a).not.toBe('function')
  })
})

describe('section', () => {
  it('ignores headings inside code fences', () => {
    const md = '## A\n```\n## B\n```\ntext\n## C\nz'
    expect(section(md, 'A')).toBe('```\n## B\n```\ntext')
  })
})
