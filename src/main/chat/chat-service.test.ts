import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '../../shared/chat'
import type { RunEvent } from '../../shared/run'
import { createMemoryStateStore } from '../gate/state-store'
import type { ProviderAdapter, RunLaunchOptions } from '../providers/types'
import { SafeFs } from '../repository/safe-fs'
import { ChatHistory } from './chat-history'
import { ChatService, type ChatServiceDeps } from './chat-service'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

interface FakeRun {
  prompt: string
  launch: RunLaunchOptions | undefined
  emit: (e: RunEvent) => void
}

function fakeAdapter(
  id: 'claude' | 'codex',
  runs: FakeRun[],
  cancelled: string[]
): ProviderAdapter {
  return {
    id,
    capabilities: { toolBridge: false, pathScopedWrites: false },
    checkInstall: async () => ({ installed: true, version: null }),
    start: (req, emit, launch) => {
      runs.push({ prompt: (req as { prompt: string }).prompt, launch, emit })
      return { ok: true, runId: `run-${runs.length}` }
    },
    cancel: (runId) => {
      cancelled.push(runId)
      return true
    },
    cancelAll: () => undefined,
    extractUsage: () => null,
    agentTranslator: { translate: () => [] }
  }
}

async function setup(
  over: Partial<ChatServiceDeps> = {},
  id: 'claude' | 'codex' = 'claude'
): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'mc-chat-'))
  dirs.push(dir)
  const fs = await SafeFs.open(dir)
  const runs: FakeRun[] = []
  const cancelled: string[] = []
  const events: ChatEvent[] = []
  const history = new ChatHistory(createMemoryStateStore())
  let tick = false
  const svc = new ChatService({
    fs: () => fs,
    history: () => history,
    createAdapter: async () => fakeAdapter(id, runs, cancelled),
    isTickRunning: () => tick,
    checkLimit: async () => ({ ok: true, reason: '' }),
    broadcast: (e) => events.push(e),
    now: () => 1000,
    ...over
  })
  const finishRun = async (i: number, extra: RunEvent[] = []): Promise<void> => {
    const r = runs[i]
    const base = { runId: `run-${i + 1}` }
    r.emit({ ...base, type: 'start', sessionId: 'sess-1234abcd', model: null })
    for (const e of extra) r.emit(e)
    const done = events.filter((e) => e.type === 'done').length
    r.emit({ ...base, type: 'exit', exitCode: 0, signal: null })
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'done').length).toBe(done + 1))
  }
  return {
    svc,
    fs,
    runs,
    cancelled,
    events,
    history,
    setTick: (v: boolean) => (tick = v),
    finishRun
  }
}

const card = (id: string, title: string): string =>
  `# ${id}: ${title}\n\n- **상태:** pending\n\n## 질문\n무엇을 할까요?\n\n## 선택지\n1. **A. 진행** — 진행한다\n2. **B. 보류** — 보류한다\n\n## 추천안과 이유\n- 추천: A\n`

interface Harness {
  svc: ChatService
  fs: SafeFs
  runs: FakeRun[]
  cancelled: string[]
  events: ChatEvent[]
  history: ChatHistory
  setTick: (v: boolean) => boolean
  finishRun: (i: number, extra?: RunEvent[]) => Promise<void>
}

const result = (text: string, success = true): RunEvent => ({
  runId: 'run-1',
  type: 'result',
  success,
  subtype: 's',
  text,
  costUsd: null,
  durationMs: null,
  numTurns: null
})

describe('ChatService', () => {
  it('rejects invalid input without running anything', async () => {
    const t = await setup()
    expect(await t.svc.send({ text: '' })).toMatchObject({ ok: false, code: 'invalid-request' })
    expect(await t.svc.send({ text: 'a'.repeat(5000) })).toMatchObject({ ok: false })
    expect(t.runs).toHaveLength(0)
  })

  it('streams, stores the answer, keeps the session, and resumes it next time', async () => {
    const t = await setup()
    const r = await t.svc.send({ text: '현황 알려줘' })
    expect(r).toMatchObject({ ok: true, value: { started: true } })
    expect(t.runs[0].launch).toEqual({})
    expect(t.runs[0].prompt).toContain('현황 알려줘')
    await t.finishRun(0, [
      { runId: 'run-1', type: 'message', role: 'assistant', text: '확인 중' },
      {
        runId: 'run-1',
        type: 'tool_use',
        toolUseId: 'u',
        name: 'Read',
        input: { file_path: '/x' }
      },
      { runId: 'run-1', type: 'log', source: 'stderr', line: 'SECRET' },
      result('끝났어요')
    ])
    const types = t.events.map((e) => e.type)
    expect(types).toEqual(['started', 'text', 'tool', 'done'])
    expect(JSON.stringify(t.events)).not.toContain('SECRET')
    expect(JSON.stringify(t.events)).not.toContain('/x')
    const h = await t.svc.getHistory()
    expect(h.messages.map((m) => [m.role, m.text])).toEqual([
      ['ceo', '현황 알려줘'],
      ['coo', '끝났어요']
    ])
    expect(h.canResume).toBe(true)

    await t.svc.send({ text: '이어서' })
    expect(t.runs[1].launch).toEqual({ resumeSessionId: 'sess-1234abcd' })
  })

  it('records a failed reply when setup throws after the CEO message was stored', async () => {
    const t = await setup({
      createAdapter: async () => {
        throw new Error('boom')
      }
    })
    expect(await t.svc.send({ text: 'a' })).toMatchObject({ ok: false, code: 'internal' })
    expect(t.svc.isBusy()).toBe(false)
    const m = (await t.svc.getHistory()).messages
    expect(m.map((x) => [x.role, x.status])).toEqual([
      ['ceo', 'ok'],
      ['coo', 'failed']
    ])
  })

  it('does not resume on providers that do not support it', async () => {
    const t = await setup({}, 'codex')
    await t.svc.send({ text: 'a' })
    await t.finishRun(0, [result('ok')])
    await t.svc.send({ text: 'b' })
    expect(t.runs[1].launch).toEqual({})
  })

  it('drops the session when a resumed run fails', async () => {
    const t = await setup()
    await t.history.setSession('sess-1234abcd')
    await t.svc.send({ text: 'a' })
    t.runs[0].emit({ runId: 'run-1', type: 'error', code: 'exit-nonzero', message: 'x' })
    await t.finishRun(0)
    expect((await t.svc.getHistory()).canResume).toBe(false)
    expect((await t.svc.getHistory()).messages.at(-1)).toMatchObject({ status: 'failed' })
  })

  it('returns a lock notice while an automatic tick runs and blocks a second send', async () => {
    const t = await setup()
    t.setTick(true)
    expect(await t.svc.send({ text: 'a' })).toMatchObject({
      ok: true,
      value: { started: false, reason: 'tick-running' }
    })
    expect(t.runs).toHaveLength(0)
    expect((await t.svc.getState()).tickRunning).toBe(true)
    t.setTick(false)
    await t.svc.send({ text: 'a' })
    expect(t.svc.isBusy()).toBe(true)
    expect(await t.svc.send({ text: 'b' })).toMatchObject({
      value: { started: false, reason: 'chat-running' }
    })
    await t.finishRun(0, [result('ok')])
    expect(t.svc.isBusy()).toBe(false)
  })

  it('does not send when the usage check fails or is missing', async () => {
    const a = await setup({ checkLimit: async () => ({ ok: false, reason: '한도 초과 위험' }) })
    expect(await a.svc.send({ text: 'x' })).toMatchObject({
      value: { started: false, reason: 'limit' }
    })
    expect(a.svc.isBusy()).toBe(false)
    const b = await setup({ checkLimit: undefined })
    expect(await b.svc.send({ text: 'x' })).toMatchObject({
      value: { started: false, reason: 'limit' }
    })
    const c = await setup({ checkLimit: vi.fn().mockRejectedValue(new Error('boom')) })
    expect(await c.svc.send({ text: 'x' })).toMatchObject({
      value: { started: false, reason: 'limit' }
    })
  })

  it('cancels the active run and records it as cancelled', async () => {
    const t = await setup()
    await t.svc.send({ text: 'a' })
    expect(t.svc.cancel()).toBe(true)
    expect(t.cancelled).toEqual(['run-1'])
    t.runs[0].emit({ runId: 'run-1', type: 'error', code: 'cancelled', message: 'c' })
    await t.finishRun(0)
    expect((await t.svc.getHistory()).messages.at(-1)).toMatchObject({ status: 'cancelled' })
    expect(t.svc.cancel()).toBe(false)
  })

  it('attaches new decision cards and briefings created during the run', async () => {
    const t = await setup()
    await t.fs.writeText('company/decisions/pending/D-001-old.md', card('D-001', '기존 카드'))
    await t.svc.send({ text: 'a' })
    await t.fs.writeText('company/decisions/pending/D-002-new.md', card('D-002', '새 카드'))
    await t.fs.writeText('company/reports/briefing-20260101090000.md', '# 오전 브리핑\n\n내용\n')
    await t.finishRun(0, [result('정리했어요')])
    const last = (await t.svc.getHistory()).messages.at(-1)
    expect(last?.refs.map((r) => [r.kind, r.id])).toEqual([
      ['decision', 'D-002'],
      ['briefing', 'briefing-20260101090000']
    ])
    const refs = await t.svc.references()
    expect(refs.decisions.map((r) => r.id).sort()).toEqual(['D-001', 'D-002'])
  })

  it('refuses reset while running and clears otherwise', async () => {
    const t = await setup()
    await t.svc.send({ text: 'a' })
    expect(await t.svc.reset()).toMatchObject({ ok: false, code: 'conflict' })
    await t.finishRun(0, [result('ok')])
    expect(await t.svc.reset()).toMatchObject({ ok: true })
    expect((await t.svc.getHistory()).messages).toEqual([])
  })

  it('accepts hr instructions as request files and reports their state', async () => {
    const t = await setup()
    expect(await t.svc.requestHr({ text: 'a'.repeat(3000) })).toMatchObject({ ok: false })
    expect(await t.svc.requestHr({ text: 'pm 채용' })).toEqual({ ok: true, value: { id: '001' } })
    const s = await t.svc.hrStatuses()
    expect(s.items).toMatchObject([{ id: '001', status: 'pending', excerpt: 'pm 채용' }])
    expect(await t.fs.readText('company/hr-requests/001.md')).toContain('ceo-via-coo')
  })
})
