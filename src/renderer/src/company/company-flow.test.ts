import { describe, expect, it, vi } from 'vitest'
import type { CompanyInfo } from '../../../shared/company'
import { validateCompanyName } from '../../../shared/company-name'
import {
  createAndOpenCompany,
  loadCompanyOnStartup,
  openErrorMessage,
  openExistingCompany,
  stateToGate,
  applyAction,
  applyRecheck,
  screenFor
} from './company-flow'

const company: CompanyInfo = { name: 'Acme', dir: '/x/Acme', mission: '' }

type Api = Parameters<typeof createAndOpenCompany>[0]

function api(over: Partial<Api> = {}): Api {
  return {
    getCurrentCompany: vi.fn().mockResolvedValue({ status: 'none' }),
    selectCompanyFolder: vi.fn().mockResolvedValue('/picked'),
    createCompany: vi.fn().mockResolvedValue({ ok: true, companyDir: '/picked/Acme' }),
    openCompany: vi.fn().mockResolvedValue({ ok: true, company }),
    ...over
  }
}

describe('stateToGate', () => {
  it('maps each status', () => {
    expect(stateToGate({ status: 'none' })).toEqual({ kind: 'start' })
    expect(stateToGate({ status: 'open', company })).toMatchObject({ kind: 'open', fresh: false })
    expect(stateToGate({ status: 'missing', name: 'a' })).toMatchObject({ reason: 'missing' })
    expect(stateToGate({ status: 'invalid', name: 'a', message: '/secret' })).toEqual({
      kind: 'notice',
      reason: 'invalid',
      name: 'a'
    })
  })
})

describe('loadCompanyOnStartup', () => {
  it('retries once when none, and picks up a late restore', async () => {
    const a = api({
      getCurrentCompany: vi
        .fn()
        .mockResolvedValueOnce({ status: 'none' })
        .mockResolvedValueOnce({ status: 'open', company })
    })
    const wait = vi.fn().mockResolvedValue(undefined)
    expect(await loadCompanyOnStartup(a, wait)).toMatchObject({ kind: 'open' })
    expect(a.getCurrentCompany).toHaveBeenCalledTimes(2)
  })
  it('does not retry when open, and never more than once', async () => {
    const a = api()
    const wait = vi.fn().mockResolvedValue(undefined)
    expect(await loadCompanyOnStartup(a, wait)).toEqual({ kind: 'start' })
    expect(a.getCurrentCompany).toHaveBeenCalledTimes(2)
    const b = api({
      getCurrentCompany: vi.fn().mockResolvedValue({ status: 'missing', name: 'a' })
    })
    await loadCompanyOnStartup(b, wait)
    expect(b.getCurrentCompany).toHaveBeenCalledTimes(1)
  })
  it('turns a thrown error into a friendly message without the original text', async () => {
    const a = api({ getCurrentCompany: vi.fn().mockRejectedValue(new Error('/Users/secret')) })
    const g = await loadCompanyOnStartup(a, async () => {})
    expect(g.kind).toBe('error')
    expect(JSON.stringify(g)).not.toContain('secret')
  })
})

describe('createAndOpenCompany', () => {
  it('selects create-location, creates, then opens the returned companyDir', async () => {
    const a = api()
    const r = await createAndOpenCompany(a, ' Acme ')
    expect(a.selectCompanyFolder).toHaveBeenCalledWith('create-location')
    expect(a.createCompany).toHaveBeenCalledWith({ name: 'Acme', path: '/picked' })
    expect(a.openCompany).toHaveBeenCalledWith({ path: '/picked/Acme' })
    expect(r).toEqual({ kind: 'opened', company, fresh: true })
  })
  it('stops quietly when the dialog is cancelled', async () => {
    const a = api({ selectCompanyFolder: vi.fn().mockResolvedValue(null) })
    expect(await createAndOpenCompany(a, 'Acme')).toEqual({ kind: 'cancelled' })
    expect(a.createCompany).not.toHaveBeenCalled()
  })
  it('rejects bad names before opening a dialog', async () => {
    const a = api()
    expect(await createAndOpenCompany(a, '  ')).toMatchObject({ kind: 'error' })
    expect(await createAndOpenCompany(a, '../x')).toMatchObject({ kind: 'error', field: 'name' })
    expect(await createAndOpenCompany(a, 'con')).toMatchObject({ kind: 'error' })
    expect(await createAndOpenCompany(a, 'a'.repeat(51))).toMatchObject({ kind: 'error' })
    expect(await createAndOpenCompany(a, 'acme.')).toMatchObject({ kind: 'error' })
    expect(a.selectCompanyFolder).not.toHaveBeenCalled()
  })
  it('maps contract codes to Korean messages without server text', async () => {
    const a = api({
      createCompany: vi
        .fn()
        .mockResolvedValue({ ok: false, code: 'already-exists', message: '/Users/me/Acme' })
    })
    const r = await createAndOpenCompany(a, 'Acme')
    expect(r).toMatchObject({ kind: 'error' })
    expect(JSON.stringify(r)).not.toContain('/Users')
    expect(a.openCompany).not.toHaveBeenCalled()
  })
})

describe('openExistingCompany', () => {
  it('uses the open purpose and the returned path', async () => {
    const a = api()
    expect(await openExistingCompany(a)).toEqual({ kind: 'opened', company, fresh: false })
    expect(a.selectCompanyFolder).toHaveBeenCalledWith('open')
    expect(a.openCompany).toHaveBeenCalledWith({ path: '/picked' })
  })
  it('explains not-company and hides the server message', async () => {
    const a = api({
      openCompany: vi.fn().mockResolvedValue({ ok: false, code: 'not-company', message: '/p' })
    })
    const r = await openExistingCompany(a)
    expect(r).toMatchObject({ kind: 'error' })
    expect(JSON.stringify(r)).toContain('회사 폴더가 아니에요')
    expect(r).toEqual({ kind: 'error', message: openErrorMessage('not-company') })
  })
  it('handles thrown errors', async () => {
    const a = api({ selectCompanyFolder: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await openExistingCompany(a)).toMatchObject({ kind: 'error' })
  })
})

describe('validateCompanyName (shared with main)', () => {
  it('accepts normal names including Korean', () => {
    expect(validateCompanyName('내 회사')).toBeNull()
    expect(validateCompanyName('a'.repeat(50))).toBeNull()
  })
  it('rejects empty, 51 chars, trailing dot, reserved and control chars', () => {
    expect(validateCompanyName('')).not.toBeNull()
    expect(validateCompanyName('a'.repeat(51))).not.toBeNull()
    expect(validateCompanyName('acme.')).not.toBeNull()
    expect(validateCompanyName('con')).not.toBeNull()
    expect(validateCompanyName('LPT1')).not.toBeNull()
    expect(validateCompanyName('a\u0007b')).not.toBeNull()
    expect(validateCompanyName('a/b')).not.toBeNull()
    expect(validateCompanyName('..')).not.toBeNull()
  })
})

describe('screenFor', () => {
  it('shows onboarding only for a freshly created company', () => {
    const fresh = { kind: 'open', company, fresh: true } as const
    expect(screenFor(fresh, false)).toBe('onboarding')
    expect(screenFor(fresh, true)).toBe('shell')
    expect(screenFor({ ...fresh, fresh: false }, false)).toBe('shell')
    expect(screenFor({ kind: 'loading' }, false)).toBe('loading')
    expect(screenFor({ kind: 'start' }, false)).toBe('start')
    expect(screenFor({ kind: 'notice', reason: 'missing', name: 'a' }, false)).toBe('start')
  })
})

describe('applyAction', () => {
  const start = { kind: 'start' } as const
  it('moves to open after opening', () => {
    const r = applyAction(start, { kind: 'opened', company, fresh: false })
    expect(screenFor(r.gate, false)).toBe('shell')
  })
  it('keeps the screen on error and cancel, passing the field', () => {
    expect(applyAction(start, { kind: 'error', message: 'm', field: 'name' })).toEqual({
      gate: start,
      error: { message: 'm', field: 'name' }
    })
    expect(applyAction(start, { kind: 'cancelled' })).toEqual({ gate: start })
  })
})

describe('applyRecheck', () => {
  it('explains when there is still no company', () => {
    expect(applyRecheck({ kind: 'start' }).info).toBe('저장된 회사가 없어요.')
    expect(applyRecheck({ kind: 'notice', reason: 'missing', name: 'a' }).info).toBeTruthy()
  })
  it('opens when found and keeps the screen on a failed lookup', () => {
    expect(applyRecheck({ kind: 'open', company, fresh: false }).gate?.kind).toBe('open')
    expect(applyRecheck({ kind: 'error', message: 'x' })).toEqual({ gate: null, error: 'x' })
  })
})
