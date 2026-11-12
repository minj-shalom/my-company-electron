import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import type { ExecEnv } from './executable'
import { terminateTree, treeSpawnOptions } from './kill-tree'

function ctx(platform: NodeJS.Platform, env: Record<string, string> = {}): ExecEnv {
  return { platform, env, isExecutable: () => false, homeDir: '/h' }
}
function child(pid: number | undefined): ChildProcess {
  return { pid, kill: vi.fn(() => true) } as unknown as ChildProcess
}

describe('terminateTree', () => {
  it('win32: runs absolute taskkill with an argument array and no shell', () => {
    const spawnFn = vi.fn(() => ({ on: vi.fn(), unref: vi.fn() }) as unknown as ChildProcess)
    const c = child(4321)
    terminateTree(c, ctx('win32', { SystemRoot: 'C:\\Windows' }), { spawnFn })
    expect(spawnFn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '4321', '/T', '/F'],
      expect.objectContaining({ shell: false })
    )
    expect(c.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('win32: skips taskkill when SystemRoot is unsafe, still kills the child', () => {
    const spawnFn = vi.fn()
    const c = child(1)
    terminateTree(c, ctx('win32', { SystemRoot: 'C:\\a&b' }), { spawnFn })
    expect(spawnFn).not.toHaveBeenCalled()
    expect(c.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('rejects non-integer or non-positive pids', () => {
    const spawnFn = vi.fn()
    const killPid = vi.fn()
    for (const pid of [undefined, 0, -5, 1.5, NaN]) {
      terminateTree(child(pid as number), ctx('win32', { SystemRoot: 'C:\\Windows' }), { spawnFn })
      terminateTree(child(pid as number), ctx('darwin'), { killPid })
    }
    expect(spawnFn).not.toHaveBeenCalled()
    expect(killPid).not.toHaveBeenCalled()
  })

  it('posix: kills the whole process group with a negative pid', () => {
    const killPid = vi.fn()
    const c = child(777)
    terminateTree(c, ctx('darwin'), { killPid })
    expect(killPid).toHaveBeenCalledWith(-777, 'SIGKILL')
    expect(c.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('posix: survives ESRCH from an already-gone group', () => {
    const killPid = vi.fn(() => {
      throw Object.assign(new Error('x'), { code: 'ESRCH' })
    })
    const c = child(9)
    expect(() => terminateTree(c, ctx('linux'), { killPid })).not.toThrow()
    expect(c.kill).toHaveBeenCalled()
  })

  it('detached only on POSIX', () => {
    expect(treeSpawnOptions(ctx('darwin')).detached).toBe(true)
    expect(treeSpawnOptions(ctx('win32')).detached).toBe(false)
  })
})
