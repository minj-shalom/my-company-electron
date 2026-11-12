import { THEME_LABELS, THEME_PREFERENCES } from '../theme'
import { useTheme } from '../use-theme'

export function ThemeToggle(): React.JSX.Element {
  const { preference, setPreference } = useTheme()
  return (
    <div className="segmented" role="group" aria-label="화면 테마">
      {THEME_PREFERENCES.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={preference === p}
          onClick={() => setPreference(p)}
        >
          {THEME_LABELS[p]}
        </button>
      ))}
    </div>
  )
}
