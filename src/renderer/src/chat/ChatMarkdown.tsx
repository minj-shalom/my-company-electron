import { parseMarkdown, type Inline } from './chat-model'

function Inlines({ items }: { items: Inline[] }): React.JSX.Element {
  return (
    <>
      {items.map((it, i) =>
        it.kind === 'bold' ? (
          <strong key={i}>{it.text}</strong>
        ) : it.kind === 'code' ? (
          <code key={i}>{it.text}</code>
        ) : (
          <span key={i}>{it.text}</span>
        )
      )}
    </>
  )
}

/** COO 응답을 안전하게 그린다. 모든 글자는 React가 이스케이프하며 HTML을 직접 넣지 않는다. */
export function ChatMarkdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="chat-md">
      {parseMarkdown(text).map((b, i) =>
        b.kind === 'pre' ? (
          <pre key={i}>{b.text}</pre>
        ) : b.kind === 'ul' ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Inlines items={it} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={i}>
            <Inlines items={b.inlines} />
          </p>
        )
      )}
    </div>
  )
}
