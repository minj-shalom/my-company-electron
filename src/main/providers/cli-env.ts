/**
 * CLI 자식 프로세스에 넘기는 환경변수 허용 목록. 목록 밖(`GITHUB_TOKEN`, `AWS_*` 등 사용자의 다른 자격 증명)은
 * 에이전트가 `env`로 읽지 못하도록 전달하지 않는다. 제공자 CLI 자신의 변수(`CLAUDE_*`, `ANTHROPIC_*`)는 앱이 읽지 않고 그대로 통과만 시킨다.
 */
const EXACT = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'TERM',
  'TZ',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SystemRoot',
  'SYSTEMROOT',
  'ComSpec',
  'PATHEXT',
  'WINDIR',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'PROGRAMFILES',
  'NO_COLOR'
])
const PREFIXES = ['LC_', 'XDG_', 'CLAUDE_', 'ANTHROPIC_']

export function buildCliEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue
    if (EXACT.has(k) || PREFIXES.some((p) => k.startsWith(p))) out[k] = v
  }
  return out
}
