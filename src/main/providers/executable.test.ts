import { describe, expect, it } from 'vitest'
import {
  buildLaunch,
  resolveExecutable,
  resolveExecutableDetailed,
  windowsSystem32Path,
  windowsExtensions,
  type ExecEnv
} from './executable'

function ctx(platform: NodeJS.Platform, env: Record<string, string>, files: string[]): ExecEnv {
  const set = new Set(files)
  return { platform, env, isExecutable: (f) => set.has(f), homeDir: '/Users/u' }
}

describe('resolveExecutable (win32)', () => {
  const env = {
    Path: 'C:\\Windows;C:\\Users\\u\\AppData\\Roaming\\npm',
    PATHEXT: '.COM;.EXE;.BAT;.CMD'
  }

  it('finds .cmd in PATH with case-insensitive env keys', () => {
    const c = ctx('win32', env, ['C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd'])
    expect(resolveExecutable('claude', c)).toBe('C:\\Users\\u\\AppData\\Roaming\\npm\\claude.cmd')
  })

  it('prefers .exe over .cmd/.bat regardless of PATHEXT order and earlier dir wins', () => {
    const c = ctx('win32', env, [
      'C:\\Windows\\codex.bat',
      'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.exe',
      'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd'
    ])
    expect(resolveExecutable('codex', c)).toBe('C:\\Windows\\codex.bat')
    const c2 = ctx('win32', env, [
      'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd',
      'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.exe'
    ])
    expect(resolveExecutable('codex', c2)).toBe('C:\\Users\\u\\AppData\\Roaming\\npm\\codex.exe')
  })

  it('ignores extensionless shims, .com/.ps1 and relative PATH entries (no cwd search)', () => {
    const c = ctx('win32', { PATH: '.;bin;C:\\x', PATHEXT: '.COM;.PS1' }, [
      'C:\\x\\claude',
      'C:\\x\\claude.com',
      'C:\\x\\claude.ps1',
      'bin\\claude.exe',
      '.\\claude.exe'
    ])
    expect(resolveExecutable('claude', c)).toBeNull()
  })

  it('uses default extensions when PATHEXT is missing and strips quoted PATH entries', () => {
    const c = ctx('win32', { PATH: '"C:\\Program Files\\cli"' }, [
      'C:\\Program Files\\cli\\gemini.cmd'
    ])
    expect(resolveExecutable('gemini', c)).toBe('C:\\Program Files\\cli\\gemini.cmd')
  })

  it('normalizes extension case in PATHEXT', () => {
    expect(windowsExtensions('.Cmd;.EXE;.vbs')).toEqual(['.exe', '.cmd'])
  })

  it('rejects UNC and drive-less PATH entries so remote/rooted .exe is never spawned', () => {
    const c = ctx('win32', { PATH: '\\\\host\\share;\\foo;//host/share' }, [
      '\\\\host\\share\\claude.exe',
      '\\foo\\claude.exe',
      '//host/share\\claude.exe'
    ])
    expect(resolveExecutable('claude', c)).toBeNull()
  })

  it('rejects names outside the allow list', () => {
    const c = ctx('win32', env, ['C:\\Windows\\evil.exe'])
    expect(resolveExecutable('evil' as never, c)).toBeNull()
    expect(resolveExecutable('..\\evil' as never, c)).toBeNull()
  })
})

describe('resolveExecutable (darwin)', () => {
  it('uses ":" and "/" and checks extra GUI-safe dirs', () => {
    const c = ctx('darwin', { PATH: '/usr/bin:/bin' }, ['/opt/homebrew/bin/claude'])
    expect(resolveExecutable('claude', c)).toBe('/opt/homebrew/bin/claude')
    const c2 = ctx('darwin', { PATH: '/a:/b' }, ['/b/claude', '/a/claude'])
    expect(resolveExecutable('claude', c2)).toBe('/a/claude')
    const c3 = ctx('darwin', { PATH: '/usr/bin' }, ['/Users/u/.local/bin/claude'])
    expect(resolveExecutable('claude', c3)).toBe('/Users/u/.local/bin/claude')
  })

  it('is case-sensitive and ignores Windows extensions', () => {
    const c = ctx('darwin', { PATH: '/a', Path: '/b' }, ['/a/Claude', '/a/claude.exe', '/b/claude'])
    expect(resolveExecutable('claude', c)).toBeNull()
  })

  it('distinguishes a file without execute permission from a missing one', () => {
    const c = { ...ctx('darwin', { PATH: '/a' }, []), isFile: (f: string) => f === '/a/claude' }
    expect(resolveExecutableDetailed('claude', c)).toEqual({ kind: 'not-executable' })
    expect(resolveExecutableDetailed('codex', c)).toEqual({ kind: 'missing' })
    const both = { ...ctx('darwin', { PATH: '/a:/b' }, ['/b/claude']), isFile: () => true }
    expect(resolveExecutableDetailed('claude', both)).toEqual({ kind: 'found', path: '/b/claude' })
  })

  it('returns null when nothing is found', () => {
    expect(resolveExecutable('codex', ctx('darwin', { PATH: '/a' }, []))).toBeNull()
  })
})

describe('buildLaunch', () => {
  const win = ctx('win32', { SystemRoot: 'C:\\Windows' }, [])

  it('runs .exe directly with an argument array', () => {
    expect(buildLaunch('C:\\a\\claude.exe', ['--version'], win)).toEqual({
      file: 'C:\\a\\claude.exe',
      args: ['--version'],
      windowsVerbatimArguments: false
    })
  })

  it('delegates .cmd/.bat to cmd.exe with a quoted fixed command line', () => {
    const l = buildLaunch('C:\\Program Files\\n (x86)\\claude.CMD', ['--version'], win)
    expect(l).toEqual({
      file: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\Program Files\\n (x86)\\claude.CMD" --version"'],
      windowsVerbatimArguments: true
    })
    expect(buildLaunch('C:\\a\\gemini.bat', ['--version'], win)?.file).toMatch(/cmd\.exe$/)
  })

  it('refuses paths that could break out of the cmd.exe command line', () => {
    for (const bad of [
      'C:\\a&calc\\claude.cmd',
      'C:\\a|b\\claude.cmd',
      'C:\\a^b\\claude.cmd',
      'C:\\%TEMP%\\claude.cmd',
      'C:\\a"b\\claude.cmd',
      'C:\\a<b\\claude.cmd',
      'C:\\a!b\\claude.cmd',
      'C:\\a\nb\\claude.cmd',
      '\\\\host\\share\\claude.cmd',
      'claude.cmd'
    ]) {
      expect(buildLaunch(bad, ['--version'], win), bad).toBeNull()
    }
  })

  it('refuses non-token fixed args for cmd delegation and unknown extensions', () => {
    expect(buildLaunch('C:\\a\\claude.cmd', ['a b'], win)).toBeNull()
    expect(buildLaunch('C:\\a\\claude.cmd', ['x&y'], win)).toBeNull()
    expect(buildLaunch('C:\\a\\claude.ps1', ['--version'], win)).toBeNull()
  })

  it('refuses to run .cmd when SystemRoot is missing or unsafe (no bare cmd.exe fallback)', () => {
    for (const env of [
      {} as Record<string, string>,
      { SystemRoot: 'C:\\a&b' },
      { SystemRoot: '\\\\host\\share' },
      { SystemRoot: 'Windows' }
    ]) {
      expect(buildLaunch('C:\\a\\x.cmd', ['--version'], ctx('win32', env, []))).toBeNull()
    }
  })

  it('refuses non-ASCII and control characters in .cmd paths', () => {
    for (const bad of [
      'C:\\u\uFF06x\\claude.cmd',
      'C:\\u\uFF02x\\claude.cmd',
      'C:\\h\u00e9\\claude.cmd',
      'C:\\a\u007f\\claude.cmd',
      'C:\\a\u0085\\claude.cmd'
    ]) {
      expect(buildLaunch(bad, ['--version'], win), bad).toBeNull()
    }
  })

  it('windowsSystem32Path validates SystemRoot', () => {
    expect(windowsSystem32Path('taskkill.exe', win)).toBe('C:\\Windows\\System32\\taskkill.exe')
    expect(windowsSystem32Path('taskkill.exe', ctx('win32', {}, []))).toBeNull()
  })

  it('passes through unchanged on darwin', () => {
    expect(buildLaunch('/opt/homebrew/bin/claude', ['--version'], ctx('darwin', {}, []))).toEqual({
      file: '/opt/homebrew/bin/claude',
      args: ['--version'],
      windowsVerbatimArguments: false
    })
  })
})
