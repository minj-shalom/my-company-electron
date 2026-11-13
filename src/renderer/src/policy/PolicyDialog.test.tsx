import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PolicyValues } from '../../../shared/policy'
import { AutoConfirmDialog } from './AutoConfirmDialog'
import { describeAuto } from './policy-model'
import { ModeRow } from './ModeFields'
import { PolicyDialog } from './PolicyDialog'

const draft = (over: Partial<PolicyValues> = {}): PolicyValues => ({
  flow: 'dev-git-pr',
  modes: { push: 'every', merge: 'every', publish: 'every', 'draft-approve': 'every' },
  dailyLimits: {},
  autoPushPrefixes: [],
  autoMergeBranches: [],
  confirmInput: null,
  branchPrefix: 'feature/',
  baseBranch: 'develop',
  usePr: true,
  reviewStage: 'required',
  dailyOutputGoal: 0,
  outputDir: 'drafts/',
  publishAdapter: 'manual',
  activeHours: null,
  memo: null,
  ...over
})
const noop = (): void => {}

describe('PolicyDialog', () => {
  it('starts in loading state with the immutable rules reachable later', () => {
    const html = renderToStaticMarkup(
      <PolicyDialog projectId="a" projectName="앱" onClose={noop} onSaved={noop} />
    )
    expect(html).toContain('불러오고 있어요')
    expect(html).toContain('앱')
  })
})

describe('ModeRow', () => {
  it('shows every as default and hides auto details', () => {
    const html = renderToStaticMarkup(
      <ModeRow action="push" draft={draft()} projectName="앱" disabled={false} onChange={noop} />
    )
    expect(html).toMatch(
      /<input[^>]*checked[^>]*value="every"|<input[^>]*value="every"[^>]*checked/
    )
    expect(html).not.toContain('하루 최대 횟수')
  })
  it('auto shows danger text, limit and target fields', () => {
    const html = renderToStaticMarkup(
      <ModeRow
        action="push"
        draft={draft({
          modes: { push: 'auto', merge: 'every', publish: 'every', 'draft-approve': 'every' }
        })}
        projectName="앱"
        disabled={false}
        onChange={noop}
      />
    )
    expect(html).toContain('위험')
    expect(html).toContain('하루 최대 횟수')
    expect(html).toContain('브랜치 접두어')
  })
  it('protected merge target asks for the project name', () => {
    const html = renderToStaticMarkup(
      <ModeRow
        action="merge"
        draft={draft({
          modes: { push: 'every', merge: 'auto', publish: 'every', 'draft-approve': 'every' },
          autoMergeBranches: ['master']
        })}
        projectName="<b>앱</b>"
        disabled={false}
        onChange={noop}
      />
    )
    expect(html).toContain('프로젝트 이름')
    expect(html).not.toContain('<b>앱</b>')
  })
})

describe('AutoConfirmDialog', () => {
  it('lists what happens without confirmation and disables confirm until checked', () => {
    const d = draft({ dailyLimits: { push: 7 }, autoPushPrefixes: ['feature/'] })
    expect(describeAuto('push', d)).toContain('7')
    const html = renderToStaticMarkup(
      <AutoConfirmDialog
        actions={['push']}
        draft={d}
        projectName="앱"
        busy={false}
        onCancel={noop}
        onConfirm={noop}
      />
    )
    expect(html).toContain('컨펌 없이')
    expect(html).toMatch(/aria-disabled="true"[^>]*>자동 모드 켜고 저장/)
  })
})
