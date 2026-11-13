import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, resetMockApi } from '../mock-api'
import { CompanyProfileSection } from './CompanyProfileSection'
import { SettingsView } from './SettingsView'

describe('CompanyProfileSection', () => {
  it('starts in the loading state with a labelled panel', () => {
    const html = renderToStaticMarkup(
      <CompanyProfileSection onDirtyChange={() => undefined} onNameSaved={() => undefined} />
    )
    expect(html).toContain('회사 정보')
    expect(html).toContain('회사 정보를 불러오고 있어요')
  })
  it('is part of the settings view', () => {
    expect(renderToStaticMarkup(<SettingsView />)).toContain('회사 정보')
  })
})

describe('company profile via mock api', () => {
  beforeEach(() => resetMockApi())
  it('saves with the current revision and changes revision', async () => {
    const r = await mockApi.getCompanyProfile()
    if (!r.ok) throw new Error('load failed')
    const saved = await mockApi.saveCompanyProfile({ ...r.value, name: '새 이름' })
    expect(saved).toMatchObject({ ok: true, value: { name: '새 이름' } })
    if (saved.ok) expect(saved.value.revision).not.toBe(r.value.revision)
  })
  it('returns conflict for a stale revision', async () => {
    const r = await mockApi.getCompanyProfile()
    if (!r.ok) throw new Error('load failed')
    await mockApi.saveCompanyProfile({ ...r.value, name: 'A' })
    expect(await mockApi.saveCompanyProfile({ ...r.value, name: 'B' })).toMatchObject({
      ok: false,
      code: 'conflict'
    })
  })
})
