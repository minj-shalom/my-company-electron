/// <reference types="node" />
import { describe, expect, it } from 'vitest'
import { DECISION_DIRS } from '../../../main/repository/parse-decision'
import { relPath } from '../../../main/repository/safe-fs'
import { filterUnreadable } from './decision-view'

// main이 실제로 만드는 경로 형식을 renderer 필터가 그대로 해석하는지 두 층을 묶어 보증한다.
describe('unreadable path contract with main', () => {
  const fromMain = (status: 'pending' | 'done', name: string): string =>
    relPath(DECISION_DIRS[status], name)
  const list = [
    { path: fromMain('pending', 'D-1-a.md'), reason: 'unreadable' as const },
    { path: fromMain('done', 'D-2-b.md'), reason: 'duplicate' as const }
  ]
  it('splits main-shaped paths per folder', () => {
    expect(filterUnreadable(list, 'pending').map((u) => u.path)).toEqual([list[0].path])
    expect(filterUnreadable(list, 'done').map((u) => u.path)).toEqual([list[1].path])
  })
  it('handles backslash separators', () => {
    const win = [{ path: 'company\\decisions\\done\\x.md', reason: 'unreadable' as const }]
    expect(filterUnreadable(win, 'pending')).toEqual([])
  })
})
