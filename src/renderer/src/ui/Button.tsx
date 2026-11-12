interface Props extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: 'default' | 'primary'
  size?: 'normal' | 'small'
}

export function Button({
  variant = 'default',
  size = 'normal',
  type = 'button',
  ...rest
}: Props): React.JSX.Element {
  const cls = ['btn', variant === 'primary' && 'btn--primary', size === 'small' && 'btn--small']
    .filter(Boolean)
    .join(' ')
  return <button type={type} className={cls} {...rest} />
}
