import { useRef, useState } from 'react'
import type { OrgSnapshot } from '../../../shared/org'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Panel } from '../ui/Panel'
import {
  AddDepartmentDialog,
  RemoveDepartmentDialog,
  RenameDepartmentDialog
} from './DepartmentDialogs'
import { departmentRows } from './department-model'

type Dialog = { kind: 'add' } | { kind: 'rename'; name: string } | { kind: 'remove'; name: string }

/**
 * 부서 관리. 부서 추가, 이름 변경, 삭제. 변경이 끝나면 조직도를 다시 읽어 부서별 목록과 사무실 방에 반영한다.
 * 부서 이름은 모두 React 텍스트로 그린다.
 */
export function DepartmentPanel({
  snapshot,
  onChanged
}: {
  snapshot: OrgSnapshot
  onChanged: () => void
}): React.JSX.Element {
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const rows = departmentRows(snapshot)
  const addRef = useRef<HTMLButtonElement>(null)
  const close = (): void => setDialog(null)
  const done = (message: string): void => {
    setDialog(null)
    setNotice(message)
    onChanged()
  }
  return (
    <Panel title="부서 관리" as="section">
      <div className="dept-manage__head">
        <p className="hint">부서를 만들고, 이름을 바꾸고, 빈 부서를 지워요.</p>
        <Button variant="primary" ref={addRef} onClick={() => setDialog({ kind: 'add' })}>
          부서 추가
        </Button>
      </div>
      <div role="status" aria-live="polite" className={notice ? 'hire-notice' : 'visually-hidden'}>
        {notice}
      </div>
      {rows.length === 0 ? (
        <p className="empty-state">아직 부서가 없어요.</p>
      ) : (
        <ul className="dept-manage" aria-label="부서 목록">
          {rows.map((r) => (
            <li key={r.name} className="dept-manage__row" data-tone={r.tone}>
              <div className="dept-manage__name">
                <strong>{r.name}</strong> <span className="hint">{r.count}명</span>
                {r.count === 0 && <Badge tone="neutral">빈 부서</Badge>}
              </div>
              <div className="dept-manage__actions">
                <Button
                  size="small"
                  aria-label={`${r.name} 이름 바꾸기`}
                  aria-disabled={r.renameBlock !== null}
                  aria-describedby={r.renameBlock ? `dept-rename-${r.name}` : undefined}
                  onClick={() =>
                    r.renameBlock === null && setDialog({ kind: 'rename', name: r.name })
                  }
                >
                  이름 바꾸기
                </Button>
                <Button
                  size="small"
                  aria-label={`${r.name} 삭제`}
                  aria-disabled={r.removeBlock !== null}
                  aria-describedby={r.removeBlock ? `dept-remove-${r.name}` : undefined}
                  onClick={() =>
                    r.removeBlock === null && setDialog({ kind: 'remove', name: r.name })
                  }
                >
                  삭제
                </Button>
              </div>
              {(r.renameBlock || r.removeBlock) && (
                <p className="hint dept-manage__why">
                  {r.renameBlock && <span id={`dept-rename-${r.name}`}>{r.renameBlock} </span>}
                  {r.removeBlock && <span id={`dept-remove-${r.name}`}>{r.removeBlock}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {dialog?.kind === 'add' && (
        <AddDepartmentDialog
          snapshot={snapshot}
          onClose={close}
          onDone={(n) => done(`${n} 부서를 만들었어요.`)}
        />
      )}
      {dialog?.kind === 'rename' && (
        <RenameDepartmentDialog
          from={dialog.name}
          snapshot={snapshot}
          onClose={close}
          onDone={(to) => done(`${dialog.name} 부서 이름을 ${to}(으)로 바꿨어요.`)}
        />
      )}
      {dialog?.kind === 'remove' && (
        <RemoveDepartmentDialog
          name={dialog.name}
          onClose={close}
          onDone={() => done(`${dialog.name} 부서를 지웠어요.`)}
        />
      )}
    </Panel>
  )
}
