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
      <ModeRow
        action="push"
        draft={draft()}
        projectName="앱"
        projectType="development"
        disabled={false}
        onChange={noop}
      />
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
        projectType="development"
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
        projectType="development"
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
        projectType="development"
        busy={false}
        onCancel={noop}
        onConfirm={noop}
      />
    )
    expect(html).toContain('컨펌 없이')
    expect(html).toMatch(/aria-disabled="true"[^>]*>자동 모드 켜고 저장/)
  })
})

describe('plain wording for non-development projects (D-024)', () => {
  const auto = draft({
    modes: { push: 'auto', merge: 'auto', publish: 'every', 'draft-approve': 'every' },
    dailyLimits: { push: 3, merge: 2 },
    autoPushPrefixes: ['feature/'],
    autoMergeBranches: ['master'],
    confirmInput: ''
  })
  it('hides PR/merge/push/branch terms in ModeRow and AutoConfirmDialog but keeps all modes', () => {
    const rows = (['push', 'merge'] as const).map((a) =>
      renderToStaticMarkup(
        <ModeRow
          action={a}
          draft={auto}
          projectName="글"
          projectType="content"
          disabled={false}
          onChange={noop}
        />
      )
    )
    const dialog = renderToStaticMarkup(
      <AutoConfirmDialog
        actions={['push', 'merge']}
        draft={auto}
        projectName="글"
        projectType="content"
        busy={false}
        onCancel={noop}
        onConfirm={noop}
      />
    )
    for (const html of [...rows, dialog]) expect(html).not.toMatch(/PR|머지|푸시|브랜치/)
    for (const m of ['every', 'batch', 'auto']) expect(rows[0]).toContain(`value="${m}"`)
  })
})
