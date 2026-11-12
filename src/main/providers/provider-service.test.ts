import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionTestResult, ProviderDetection } from '../../shared/provider'
import type { SpawnFn } from './cli-runner'
import { runConnectionTest } from './connection-test'
import { ProviderService } from './provider-service'

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  kill = vi.fn(() => true)
}

function realTest(spawnFn: SpawnFn) {
  return (p: 'claude' | 'codex' | 'gemini', o?: { signal?: AbortSignal }) =>
    runConnectionTest(p, {
      ...o,
      spawnFn,
      execEnv: {
        platform: 'darwin',
        env: { PATH: '/x' },
        isExecutable: (f: string) => f === '/x/claude',
        homeDir: '/Users/u'
      }
    })
}

describe('ProviderService', () => {
  it('merges concurrent tests for the same provider and runs once', async () => {
    let release: (r: ConnectionTestResult) => void = () => undefined
    const test = vi.fn(() => new Promise<ConnectionTestResult>((r) => (release = r)))
    const svc = new ProviderService({ test })
    const a = svc.testConnection('claude')
    expect(svc.testConnection('claude')).toBe(a)
    expect(test).toHaveBeenCalledTimes(1)
    release({ provider: 'claude', state: 'ok', message: 'ok' })
    await a
    expect(svc.testConnection('claude')).not.toBe(a)
  })

  it('merges concurrent detections', async () => {
    let release: (r: ProviderDetection[]) => void = () => undefined
    const detect = vi.fn(() => new Promise<ProviderDetection[]>((r) => (release = r)))
    const svc = new ProviderService({ detect })
    const a = svc.detect()
    expect(svc.detect()).toBe(a)
    release([])
    await a
    expect(detect).toHaveBeenCalledTimes(1)
  })

  it('shutdown aborts a running test and terminates the child', async () => {
    const child = new FakeChild()
    const spawnFn = vi.fn(() => child as unknown as ChildProcess) as unknown as SpawnFn
    const svc = new ProviderService({ test: realTest(spawnFn) })
    const p = svc.testConnection('claude')
    svc.shutdown()
    expect((await p).state).toBe('failed')
    expect(child.kill).toHaveBeenCalled()
  })

  it('after shutdown, testConnection fails without spawning', async () => {
    const spawnFn = vi.fn() as unknown as SpawnFn
    const svc = new ProviderService({ test: realTest(spawnFn) })
    svc.shutdown()
    expect((await svc.testConnection('claude')).state).toBe('failed')
    expect(spawnFn).not.toHaveBeenCalled()
  })
})
