import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MemberDetail } from './MemberDetail'

describe('MemberDetail', () => {
  it('renders employee text as escaped text, never as HTML', () => {
    const html = renderToStaticMarkup(
      createElement(MemberDetail, {
        tone: 'rnd',
        detail: {
          title: 'X',
          kindLabel: 'AI 직원',
          department: '<img src=x onerror=1>',
          reportsTo: '없음',
          role: '<b>bold</b>',
          fileNote: null,
          name: null,
          description: '<script>1</script>',
          model: '정보 없음',
          tools: ['<i>t</i>']
        }
      })
    )
    expect(html).not.toMatch(/<(b|img|script|i)[ >]/)
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;')
  })
})
