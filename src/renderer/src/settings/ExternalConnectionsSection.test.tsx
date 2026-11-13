import type { CredentialAdapterStatus } from '../../../shared/publisher'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMockCredentialApi, type CredentialScenario } from '../mock-credentials'
import { ConnectionItem, ExternalConnectionsSection } from './ExternalConnectionsSection'
import {
  CREDENTIAL_NOTES,
  NOT_REVOKED_NOTE,
  connectableAdapters,
  formatExpiry
} from './credential-model'

async function itemsOf(s: CredentialScenario): Promise<CredentialAdapterStatus[]> {
  const r = await createMockCredentialApi(s).api.getCredentialStatus()
  if (!r.ok) throw new Error('load failed')
  return r.value
}
const render = (items: Awaited<ReturnType<typeof itemsOf>>): string =>
  renderToStaticMarkup(
    <ul>
      {items.map((i) => (
        <ConnectionItem key={i.adapterId} item={i} onDisconnect={() => undefined} />
      ))}
    </ul>
  )

describe('ExternalConnectionsSection', () => {
  it('starts loading with both notes', () => {
    const html = renderToStaticMarkup(<ExternalConnectionsSection />)
    expect(html).toContain('외부 연결')
    expect(html).toContain('불러오고 있어요')
    for (const n of CREDENTIAL_NOTES) expect(html).toContain(n)
  })

  it('shows state badge, account and scopes when connected', async () => {
    const html = render(await itemsOf('connected'))
    expect(html).toContain('연결됨')
    expect(html).toContain('마이컴퍼니 공식 블로그')
    expect(html).toContain('글 게시만 허용')
    expect(html).toContain('연결 해제')
  })

  it('warns when expiring and hides disconnect when not connected', async () => {
    expect(render(await itemsOf('expiring'))).toContain('곧 만료')
    const html = render(await itemsOf('disconnected'))
    expect(html).toContain('연결 안 됨')
    expect(html).not.toContain('연결 해제')
    expect(html).toContain('disabled')
  })

  it('explains when secure storage is unavailable', async () => {
    expect(render(await itemsOf('no-encryption'))).toContain(
      '이 컴퓨터에서는 안전하게 보관할 수 없어서 연결할 수 없어요'
    )
  })

  it('treats manual-only as empty', async () => {
    expect(connectableAdapters(await itemsOf('manual'))).toEqual([])
  })

  it('never renders a credential input, password field or token-like text', async () => {
    for (const s of ['connected', 'expiring', 'no-encryption', 'error', 'disconnected'] as const) {
      const html = render(await itemsOf(s))
      expect(html).not.toMatch(/<input|<textarea|type="password"|token|secret|api[_-]?key/i)
    }
    expect(renderToStaticMarkup(<ExternalConnectionsSection />)).not.toMatch(
      /<input|<textarea|type="password"/i
    )
  })

  it('formats expiry and has fixed wording when revoke failed', () => {
    expect(formatExpiry(null)).toBe('만료 없음')
    expect(formatExpiry('2000-01-01T00:00:00.000Z')).toContain('만료됨')
    expect(NOT_REVOKED_NOTE).toContain('이 컴퓨터의 값은 지웠어요')
  })

  it('mock disconnect clears accounts and reports revoked', async () => {
    const m = createMockCredentialApi('connected')
    const r = await m.api.disconnectCredential({ adapterId: 'demo' })
    expect(r.ok && r.value.revoked).toBe(true)
    expect(r.ok && r.value.status.accounts).toEqual([])
    const bad = await m.api.disconnectCredential({ adapterId: 'x' })
    expect(bad.ok).toBe(false)
  })
})
