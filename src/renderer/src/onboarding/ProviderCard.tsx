import { useState } from 'react'
import type { ConnectionTestResult, ProviderDetection } from '../../../shared/provider'
import { InstallSafety } from './InstallSafety'
import { CopyCommand } from './CopyCommand'
import { NOT_FOUND_AFTER_INSTALL_HELP, connectionTestView, detectView } from './detection-view'
import { OS_LABELS, type OsKind, type ProviderGuide } from './provider-guide'

type TestStatus =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: ConnectionTestResult }
  | { kind: 'error'; message: string }

interface Props {
  guide: ProviderGuide
  os: OsKind
  /** null이면 감지 결과가 아직 없거나 조회 실패 상태다. */
  detection: ProviderDetection | null
  detectionLoading: boolean
}

export function ProviderCard({ guide, os, detection, detectionLoading }: Props): React.JSX.Element {
  const [test, setTest] = useState<TestStatus>({ kind: 'idle' })
  const headingId = `provider-${guide.id}`
  const view = detection ? detectView(detection.state) : null
  const installed = detection?.state === 'ok'

  // 사용자가 버튼을 눌렀을 때만 실행된다. 자동 호출 경로 없음.
  const runTest = async (): Promise<void> => {
    setTest({ kind: 'running' })
    try {
      const r = await window.api.testProviderConnection(guide.id)
      setTest(
        r.ok
          ? { kind: 'done', result: r.value }
          : {
              kind: 'error',
              message:
                r.code === 'not-implemented'
                  ? '이 버전의 앱은 아직 연결 테스트를 지원하지 않아요.'
                  : '연결 테스트를 실행하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
            }
      )
    } catch {
      setTest({
        kind: 'error',
        message: '연결 테스트를 실행하지 못했어요. 잠시 뒤 다시 시도해 주세요.'
      })
    }
  }

  return (
    <section className="card" aria-labelledby={headingId}>
      <header className="card__header">
        <h3 id={headingId}>{guide.name}</h3>
        <span className="card__service">{guide.service}</span>
        {detectionLoading ? (
          <span className="badge badge--neutral">확인 중…</span>
        ) : view ? (
          <span className={`badge badge--${view.tone}`}>
            {view.label}
            {detection?.state === 'ok' && detection.version ? ` (${detection.version})` : ''}
          </span>
        ) : (
          <span className="badge badge--neutral">확인 못 함</span>
        )}
      </header>
      {view && <p>{view.help}</p>}
      {detection?.state === 'not-installed' && (
        <p className="hint">{NOT_FOUND_AFTER_INSTALL_HELP}</p>
      )}

      <h4>1. 설치하기 ({OS_LABELS[os]})</h4>
      <InstallSafety commands={guide.install[os]} />
      {guide.install[os].map((c) => (
        <CopyCommand key={c.command} label={c.label} command={c.command} />
      ))}
      {guide.installNote && <p className="hint">{guide.installNote}</p>}
      <p className="hint">
        <a href={guide.docsUrl} target="_blank" rel="noopener noreferrer">
          공식 문서 열기
        </a>{' '}
        (설치가 잘 안 될 때 확인하세요)
      </p>

      <h4>2. 로그인하기</h4>
      <p className="notice">
        로그인은 이 앱이 아니라 <strong>직접 터미널에서</strong> 합니다. 이 앱은 아이디, 비밀번호,
        토큰을 묻지도 저장하지도 않아요.
      </p>
      <ol className="steps">
        {guide.loginSteps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <CopyCommand label="로그인 명령" command={guide.loginCommand} />

      <h4>3. 연결 확인하기</h4>
      <p className="hint">
        버튼을 누르면 AI에게 짧은 질문을 한 번 보내 로그인이 되었는지 확인해요. 사용량이 아주 조금
        쓰이고, 누르기 전에는 실행되지 않아요.
      </p>
      <button type="button" onClick={runTest} disabled={!installed || test.kind === 'running'}>
        {test.kind === 'running' ? '테스트 중…' : '연결 테스트'}
      </button>
      {!installed && !detectionLoading && (
        <p className="hint">설치된 것이 확인되면 누를 수 있어요.</p>
      )}
      <div role="status" aria-live="polite" className="test-result">
        {test.kind === 'running' && '연결을 확인하고 있어요. 최대 1분쯤 걸릴 수 있어요.'}
        {test.kind === 'done' && (
          <p>
            <span className={`badge badge--${connectionTestView(test.result.state).tone}`}>
              {connectionTestView(test.result.state).label}
            </span>{' '}
            {connectionTestView(test.result.state).help}
          </p>
        )}
        {test.kind === 'error' && <p className="error">{test.message}</p>}
      </div>
    </section>
  )
}
