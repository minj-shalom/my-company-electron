import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { request } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GateResult } from '../../shared/gate'
import { ClaudeAdapter } from '../providers/claude/claude-adapter'
import { GateService } from './gate-service'
import { DENY_RULES, prepareGateRun } from './tool-bridge'

const calls: { ctx: unknown; tool: string; input: unknown }[] = []
const service = {
  call: async (ctx: unknown, tool: string, input: unknown): Promise<GateResult> => {
    calls.push({ ctx, tool, input })
    return { status: 'executed', message: 'ok' }
  }
} as unknown as GateService

let tmp = ''
afterEach(async () => {
  calls.length = 0
  if (tmp) await rm(tmp, { recursive: true, force: true })
  tmp = ''
})

const mk = async (): Promise<string> => (tmp = await mkdtemp(join(tmpdir(), 'mc-bridge-test-')))
const deps = (tmpRoot: string, known = true): Parameters<typeof prepareGateRun>[0] => ({
  service,
  isKnownEmployee: async () => known,
  tmpRoot
})
const req = { projectId: 'my-company', employeeId: 'developer', ticketId: 'T-053' }

interface Reply {
  status: number
  body: string
}
function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  method = 'POST'
): Promise<Reply> {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const r = request(
      {
        host: u.hostname,
        port: u.port,
        path: u.pathname,
        method,
        agent: false,
        headers: { 'content-type': 'application/json', ...headers }
      },
      (res) => {
        let b = ''
        res.on('data', (c: Buffer) => (b += c.toString()))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: b }))
      }
    )
    r.on('error', reject)
    r.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
}

describe('prepareGateRun', () => {
  it('writes typed tool config, serves the 3 gate tools, and cleans up on finish', async () => {
    const root = await mk()
    const run = await prepareGateRun(deps(root), req, { toolBridge: true })
    expect(run.autoAllowed).toBe(true)
    const tools = run.launch.tools
    expect(tools?.allowedTools).toEqual(['gate_push', 'gate_merge', 'gate_publish'])
    const cfg = JSON.parse(await readFile(tools!.toolConfigPath, 'utf8')) as {
      mcpServers: { gate: { url: string; headers: { Authorization: string } } }
    }
    const { url, headers } = cfg.mcpServers.gate
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect((await stat(tools!.toolConfigPath)).mode & 0o077).toBe(0)
    const settings = JSON.parse(await readFile(tools!.settingsPath, 'utf8')) as {
      permissions: { deny: string[] }
    }
    expect(settings.permissions.deny).toEqual([...DENY_RULES])
    expect(DENY_RULES).toContain('Bash(git push:*)')
    expect(DENY_RULES).toContain('Bash(gh pr merge:*)')
    expect(DENY_RULES).toContain('Write(company/audit/**)')
    expect(DENY_RULES).toContain('Edit(company/policies/**)')

    const auth = { authorization: headers.Authorization }
    const list = await post(url, auth, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const names = (
      JSON.parse(list.body) as { result: { tools: { name: string }[] } }
    ).result.tools.map((t) => t.name)
    expect(names).toEqual(['gate_push', 'gate_merge', 'gate_publish'])

    // 호출 직원·프로젝트는 서버가 고정한다. 입력에 섞어 보내도 맥락은 바뀌지 않는다.
    const call = await post(url, auth, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'gate_push', arguments: { branch: 'feature/x', employeeId: 'cto' } }
    })
    expect(JSON.parse(call.body)).toMatchObject({ result: { isError: false } })
    expect(calls[0].ctx).toEqual({ ...req, autoAllowed: true })
    expect(calls[0].input).toEqual({ branch: 'feature/x', employeeId: 'cto' })

    await run.launch.onFinish?.()
    await run.dispose()
    expect((await readdir(root)).length).toBe(0)
    await expect(post(url, auth, { jsonrpc: '2.0', id: 3, method: 'ping' })).rejects.toThrow()
  })

  it('rejects missing/wrong tokens, bad hosts, origins, other methods, unknown tools and kill-style names', async () => {
    const root = await mk()
    const run = await prepareGateRun(deps(root), req, { toolBridge: true })
    const cfg = JSON.parse(await readFile(run.launch.tools!.toolConfigPath, 'utf8')) as {
      mcpServers: { gate: { url: string; headers: { Authorization: string } } }
    }
    const { url, headers } = cfg.mcpServers.gate
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }
    expect((await post(url, {}, ping)).status).toBe(401)
    expect((await post(url, { authorization: 'Bearer nope' }, ping)).status).toBe(401)
    expect(
      (await post(url, { authorization: headers.Authorization, origin: 'https://evil' }, ping))
        .status
    ).toBe(403)
    expect(
      (await post(url, { authorization: headers.Authorization, host: 'evil.example' }, ping)).status
    ).toBe(403)
    expect((await post(url, { authorization: headers.Authorization }, ping, 'GET')).status).toBe(
      405
    )
    const ok = { authorization: headers.Authorization }
    for (const name of ['kill_switch_release', 'Bash', 'gate_push '])
      expect(
        JSON.parse(
          (await post(url, ok, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name } }))
            .body
        )
      ).toHaveProperty('error')
    expect((await post(url, ok, '{bad')).status).toBe(400)
    expect(calls).toHaveLength(0)
    await run.dispose()
  })

  it('without bridge support it starts nothing and disables auto', async () => {
    const root = await mk()
    const run = await prepareGateRun(deps(root), req, { toolBridge: false })
    expect(run.autoAllowed).toBe(false)
    expect(run.launch).toEqual({})
    expect(await readdir(root)).toEqual([])
  })

  it('rejects unknown employees and malformed ids, leaving no files', async () => {
    const root = await mk()
    await expect(prepareGateRun(deps(root, false), req, { toolBridge: true })).rejects.toThrow()
    await expect(
      prepareGateRun(deps(root), { ...req, employeeId: '../x' }, { toolBridge: true })
    ).rejects.toThrow()
    expect(await readdir(root)).toEqual([])
    expect(dirname(root)).toBeTruthy()
  })

  it('is torn down when a run is cancelled or times out', async () => {
    for (const how of ['cancel', 'timeout'] as const) {
      const root = await mk()
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: (): boolean => {
          queueMicrotask(() => child.emit('close', null, 'SIGTERM'))
          return true
        }
      })
      let argv: string[] = []
      const adapter = new ClaudeAdapter({
        cwd: '/work',
        spawnFn: (_c, a) => {
          argv = a
          return child as unknown as ChildProcess
        }
      })
      const run = await prepareGateRun(deps(root), req, adapter.capabilities)
      const started = adapter.start({ prompt: 'x', timeoutMs: 1000 }, () => undefined, run.launch)
      expect(started.ok).toBe(true)
      expect(argv).toContain(run.launch.tools!.toolConfigPath)
      expect(argv).toContain('--allowedTools')
      expect((await readdir(root)).length).toBe(1)
      if (how === 'cancel' && started.ok) adapter.cancel(started.runId)
      else child.emit('close', null, 'SIGTERM')
      await new Promise((r) => setTimeout(r, 50))
      expect(await readdir(root)).toEqual([])
      await rm(root, { recursive: true, force: true })
    }
    tmp = ''
  })
})
