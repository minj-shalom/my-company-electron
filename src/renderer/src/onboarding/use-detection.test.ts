import { describe, expect, it, vi } from 'vitest'
import { loadDetection } from './use-detection'

describe('loadDetection', () => {
  it('only calls detectProviders and returns ready items', async () => {
    const detectProviders = vi.fn().mockResolvedValue({ ok: true, value: [] })
    // 연결 테스트가 섞여 들어오면 즉시 실패하도록 spy를 함께 넘겨 호출 여부를 확인한다.
    const testProviderConnection = vi.fn()
    const api = { detectProviders, testProviderConnection }
    await expect(loadDetection(api)).resolves.toEqual({ kind: 'ready', items: [] })
    expect(detectProviders).toHaveBeenCalledTimes(1)
    expect(testProviderConnection).not.toHaveBeenCalled()
  })
  it('maps not-implemented and thrown errors to friendly messages', async () => {
    const ni = await loadDetection({
      detectProviders: async () => ({ ok: false, code: 'not-implemented', message: 'x' })
    })
    expect(ni).toMatchObject({ kind: 'error' })
    const thrown = await loadDetection({
      detectProviders: async () => {
        throw new Error('/secret/path')
      }
    })
    expect(thrown).toMatchObject({ kind: 'error' })
    expect(JSON.stringify(thrown)).not.toContain('/secret')
  })
})
