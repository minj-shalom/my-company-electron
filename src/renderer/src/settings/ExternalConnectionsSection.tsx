import { useEffect, useId, useState } from 'react'
import type { CredentialAdapterStatus } from '../../../shared/publisher'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'
import { Panel } from '../ui/Panel'
import {
  CONNECT_PENDING_NOTE,
  CREDENTIAL_DISCONNECT_ERROR,
  CREDENTIAL_EMPTY,
  CREDENTIAL_LOAD_ERROR,
  CREDENTIAL_NOTES,
  DISCONNECTED_NOTE,
  NO_ENCRYPTION_NOTE,
  NOT_REVOKED_NOTE,
  canDisconnect,
  connectableAdapters,
  credentialStateView,
  formatExpiry
} from './credential-model'

type Load =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; items: CredentialAdapterStatus[] }

/**
 * 설정의 "외부 연결" 섹션. 상태: 로딩, 오류(다시 시도), 빈(직접 올리기만), 정상.
 * 자격 증명 값을 받거나 입력받는 UI는 없다. 상태·만료·표시명만 보여 주고 해제만 할 수 있다.
 */
export function ExternalConnectionsSection(): React.JSX.Element {
  const [load, setLoad] = useState<Load>({ kind: 'loading' })
  const [target, setTarget] = useState<CredentialAdapterStatus | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const [tick, setTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      let next: Load
      try {
        const r = await window.api.getCredentialStatus()
        next = r.ok ? { kind: 'ready', items: r.value } : { kind: 'error' }
      } catch {
        next = { kind: 'error' }
      }
      if (!cancelled) setLoad(next)
    })()
    return () => {
      cancelled = true
    }
  }, [tick])

  const onDisconnected = (status: CredentialAdapterStatus, revoked: boolean): void => {
    setLoad((l) =>
      l.kind === 'ready'
        ? {
            kind: 'ready',
            items: l.items.map((i) => (i.adapterId === status.adapterId ? status : i))
          }
        : l
    )
    setMessage({
      kind: revoked ? 'ok' : 'error',
      text: revoked ? DISCONNECTED_NOTE : NOT_REVOKED_NOTE
    })
    setTarget(null)
  }

  const items = load.kind === 'ready' ? connectableAdapters(load.items) : []
  return (
    <Panel title="외부 연결">
      {CREDENTIAL_NOTES.map((n) => (
        <p className="hint" key={n}>
          {n}
        </p>
      ))}
      {load.kind === 'loading' && (
        <p role="status" className="hint">
          외부 연결 상태를 불러오고 있어요…
        </p>
      )}
      {load.kind === 'error' && (
        <>
          <p role="alert" className="error">
            {CREDENTIAL_LOAD_ERROR}
          </p>
          <Button
            onClick={() => {
              setLoad({ kind: 'loading' })
              setTick((n) => n + 1)
            }}
          >
            다시 시도
          </Button>
        </>
      )}
      {load.kind === 'ready' && items.length === 0 && <p className="hint">{CREDENTIAL_EMPTY}</p>}
      {items.length > 0 && (
        <ul className="connection-list" aria-label="외부 연결 목록">
          {items.map((item) => (
            <ConnectionItem key={item.adapterId} item={item} onDisconnect={() => setTarget(item)} />
          ))}
        </ul>
      )}
      <div role="status" aria-live="polite">
        {message && <p className={message.kind === 'error' ? 'error' : 'hint'}>{message.text}</p>}
      </div>
      {target && (
        <DisconnectDialog item={target} onClose={() => setTarget(null)} onDone={onDisconnected} />
      )}
    </Panel>
  )
}

export function ConnectionItem({
  item,
  onDisconnect
}: {
  item: CredentialAdapterStatus
  onDisconnect: () => void
}): React.JSX.Element {
  const nameId = useId()
  const view = credentialStateView(item.state)
  return (
    <li className="connection-item" aria-labelledby={nameId}>
      <div className="connection-item__head">
        <strong id={nameId}>{item.displayName}</strong>
        <Badge tone={view.tone}>{view.label}</Badge>
      </div>
      {item.state === 'error' && (
        <p className="error">연결에 문제가 있어요. 해제한 뒤 다시 연결해 주세요.</p>
      )}
      {item.accounts.length > 0 && (
        <ul className="connection-item__accounts" aria-label={`${item.displayName} 계정`}>
          {item.accounts.map((a) => (
            <li key={a.accountId}>
              {a.displayName} <span className="hint">· {formatExpiry(a.expiresAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {item.scopes.length > 0 && (
        <>
          <p className="hint">이 연결이 할 수 있는 일</p>
          <ul className="connection-item__scopes">
            {item.scopes.map((s) => (
              <li key={s.id}>{s.description}</li>
            ))}
          </ul>
        </>
      )}
      {!item.encryptionAvailable && <p className="error">{NO_ENCRYPTION_NOTE}</p>}
      <div className="toolbar">
        <Button size="small" disabled aria-label={`${item.displayName} 연결하기 (준비 중)`}>
          연결하기
        </Button>
        <span className="hint">{CONNECT_PENDING_NOTE}</span>
        {canDisconnect(item) && (
          <Button size="small" onClick={onDisconnect} aria-label={`${item.displayName} 연결 해제`}>
            연결 해제
          </Button>
        )}
      </div>
    </li>
  )
}

function DisconnectDialog({
  item,
  onClose,
  onDone
}: {
  item: CredentialAdapterStatus
  onClose: () => void
  onDone: (status: CredentialAdapterStatus, revoked: boolean) => void
}): React.JSX.Element {
  const titleId = useId()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const run = async (): Promise<void> => {
    setBusy(true)
    setFailed(false)
    try {
      const r = await window.api.disconnectCredential({ adapterId: item.adapterId })
      if (r.ok) return onDone(r.value.status, r.value.revoked)
    } catch {
      // 아래에서 고정 문구로 안내한다.
    }
    setFailed(true)
    setBusy(false)
  }
  return (
    <Modal labelledBy={titleId} busy={busy} onClose={onClose}>
      <h2 id={titleId} className="modal__title">
        {item.displayName} 연결을 해제할까요?
      </h2>
      <div className="modal__body">
        <p>이 컴퓨터에 보관된 연결 정보가 지워져요. 해제하면 이 서비스로 발행할 수 없어요.</p>
        <p className="hint">다시 쓰려면 새로 연결해야 해요.</p>
      </div>
      <div role="alert" className="modal__error">
        {failed && <p className="error">{CREDENTIAL_DISCONNECT_ERROR}</p>}
      </div>
      <div className="modal__actions">
        <Button onClick={onClose} disabled={busy}>
          취소
        </Button>
        <Button variant="primary" onClick={() => void run()} disabled={busy}>
          {busy ? '해제하는 중…' : '연결 해제'}
        </Button>
      </div>
    </Modal>
  )
}
