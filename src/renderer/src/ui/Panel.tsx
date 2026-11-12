interface Props {
  title?: React.ReactNode
  /** 제목 오른쪽에 붙는 요소 (배지 등). */
  titleExtra?: React.ReactNode
  labelledBy?: string
  as?: 'section' | 'div'
  children: React.ReactNode
}

export function Panel({
  title,
  titleExtra,
  labelledBy,
  as: Tag = 'section',
  children
}: Props): React.JSX.Element {
  return (
    <Tag className="panel" aria-labelledby={labelledBy}>
      {title !== undefined && (
        <div className="panel__title">
          {title}
          {titleExtra}
        </div>
      )}
      {children}
    </Tag>
  )
}
