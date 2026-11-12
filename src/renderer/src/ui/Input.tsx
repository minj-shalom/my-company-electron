interface Props extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> {
  /** 폭 조절용 추가 클래스 (색/테두리는 .input이 정한다). */
  extraClass?: string
}

export function Input({ extraClass, ...rest }: Props): React.JSX.Element {
  return <input className={extraClass ? `input ${extraClass}` : 'input'} {...rest} />
}
