import { useState } from 'react'

function App(): React.JSX.Element {
  const [result, setResult] = useState<string>('')
  const [error, setError] = useState<string>('')

  const onPing = async (): Promise<void> => {
    try {
      setError('')
      setResult(await window.api.ping())
    } catch {
      setError('연결에 실패했습니다.')
    }
  }

  return (
    <main>
      <h1>My Company</h1>
      <button onClick={onPing}>Ping</button>
      {result && <p>응답: {result}</p>}
      {error && <p role="alert">{error}</p>}
    </main>
  )
}

export default App
