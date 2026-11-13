import { createHash } from 'node:crypto'
import type { Publisher, PublishOutcome } from '../gate/publisher'
import type { PublishErrorCode } from '../../shared/publisher'
import type { CredentialService } from '../credentials/credential-service'
import type { AdapterRegistry } from './adapter-registry'

export interface DraftSource {
  /** 발행 시점에 초안 파일을 main이 다시 읽는다. 읽지 못하면 null. */
  read(projectId: string, draftPath: string): Promise<string | null>
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

function titleOf(body: string, fallback: string): string {
  const m = /^#\s+(.+)$/m.exec(body)
  return (m?.[1] ?? fallback).trim().slice(0, 200)
}

const GATE_CODE: Record<PublishErrorCode, 'rejected' | 'network' | 'auth' | 'unknown'> = {
  'hash-mismatch': 'rejected',
  'not-connected': 'auth',
  rejected: 'rejected',
  network: 'network',
  auth: 'auth',
  unknown: 'unknown'
}

/**
 * T-050 게이트의 `Publisher` 호출 자리와 어댑터 계약을 잇는다.
 * 발행 시점에 초안을 다시 읽어 해시가 승인된 `draftHash`와 같을 때만 어댑터를 부른다 (T-050 검수 요구).
 * 어댑터 예외는 내용을 버리고 `unknown`으로 바꾼다.
 */
export function createGatePublishers(deps: {
  registry: AdapterRegistry
  credentials: CredentialService
  drafts: DraftSource
}): Map<string, Publisher> {
  const out = new Map<string, Publisher>()
  for (const adapter of deps.registry.list()) {
    if (!adapter.usesCredentials) continue
    out.set(adapter.id, {
      id: adapter.id,
      publish: async (req, signal): Promise<PublishOutcome> => {
        const body = await deps.drafts.read(req.projectId, req.draftPath).catch(() => null)
        if (body === null || sha256(body) !== req.draftHash)
          return { ok: false, code: GATE_CODE['hash-mismatch'] }
        try {
          const r = await adapter.publish(
            {
              projectId: req.projectId,
              draftPath: req.draftPath,
              contentHash: req.draftHash,
              title: titleOf(body, req.draftPath),
              body,
              idempotencyKey: req.idempotencyKey
            },
            deps.credentials.contextFor(adapter.id, signal),
            { signal }
          )
          return r.ok ? { ok: true } : { ok: false, code: GATE_CODE[r.code] }
        } catch {
          return { ok: false, code: 'unknown' }
        }
      }
    })
  }
  return out
}
