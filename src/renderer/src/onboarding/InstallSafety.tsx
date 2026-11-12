import type { InstallCommand } from './provider-guide'
import {
  SAFETY_TEXT,
  extractSourceUrls,
  isPipedInstaller,
  usesExecutionPolicyBypass
} from './install-safety'

export function InstallSafety({
  commands
}: {
  commands: readonly InstallCommand[]
}): React.JSX.Element {
  const piped = commands.some((c) => isPipedInstaller(c.command))
  const bypass = commands.some((c) => usesExecutionPolicyBypass(c.command))
  const urls = extractSourceUrls(commands)
  return (
    <div className="notice" role="note">
      <p>
        <strong>설치 전에 확인하세요.</strong>
      </p>
      {piped && <p>{SAFETY_TEXT.piped}</p>}
      {urls.length > 0 && (
        <p>
          내려받는 곳:{' '}
          {urls.map((u, i) => (
            <span key={u}>
              {i > 0 && ', '}
              <code>{u}</code>
            </span>
          ))}
        </p>
      )}
      {bypass && <p>{SAFETY_TEXT.bypass}</p>}
      <p>{SAFETY_TEXT.runByYou}</p>
      <p>{SAFETY_TEXT.doubt}</p>
    </div>
  )
}
