import { useState } from 'react'

type CopyState = 'idle' | 'copied' | 'failed'

/** 고정 명령 문구를 보여 주고 복사한다. command는 호출하는 쪽의 상수만 받는다. */
export function CopyCommand({
  label,
  command
}: {
  label: string
  command: string
}): React.JSX.Element {
  const [state, setState] = useState<CopyState>('idle')

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(command)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <div className="copy-command">
      <p className="copy-command__label">{label}</p>
      <div className="copy-command__row">
        <code tabIndex={0} aria-label={`명령: ${command}`}>
          {command}
        </code>
        <button type="button" onClick={copy}>
          복사
        </button>
      </div>
      <p role="status" className="copy-command__status">
        {state === 'copied' && '복사했어요. 터미널에 붙여넣으세요.'}
        {state === 'failed' && '자동 복사에 실패했어요. 위 명령을 직접 선택해서 복사해 주세요.'}
      </p>
    </div>
  )
}
