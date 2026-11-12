export type BadgeTone = 'good' | 'warn' | 'bad' | 'info' | 'neutral'

export function Badge({
  tone = 'neutral',
  compact = false,
  children
}: {
  tone?: BadgeTone
  /** 좁은 화면에서 글씨를 숨기고 표식만 남긴다 (글씨는 스크린리더용으로 유지). */
  compact?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span className={`badge badge--${tone}${compact ? ' badge--compact' : ''}`}>
      <span className="badge__label">{children}</span>
    </span>
  )
}
