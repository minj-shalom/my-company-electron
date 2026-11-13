import { useState } from 'react'
import { THEME_LABELS, THEME_PREFERENCES } from '../theme'
import { Panel } from '../ui/Panel'
import { useTheme } from '../use-theme'

/** 테마는 선택 즉시 적용되고 앱 설정에 저장되어 다음 실행에도 유지된다. */
export function ThemeSection(): React.JSX.Element {
  const { preference, setPreference } = useTheme()
  const [failed, setFailed] = useState(false)
  return (
    <Panel title="화면 테마">
      <div className="segmented" role="group" aria-label="화면 테마 선택">
        {THEME_PREFERENCES.map((p) => (
          <button
            key={p}
            type="button"
            aria-pressed={preference === p}
            onClick={() => void setPreference(p).then((ok) => setFailed(!ok))}
          >
            {THEME_LABELS[p]}
          </button>
        ))}
      </div>
      <p className="hint">고르면 바로 바뀌고, 앱을 다시 열어도 유지돼요.</p>
      <div role="status" aria-live="polite">
        {failed && (
          <p className="error">저장하지 못했어요. 지금은 적용되지만 다시 열면 돌아갈 수 있어요.</p>
        )}
      </div>
    </Panel>
  )
}
